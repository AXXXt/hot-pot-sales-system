const env = require('../config')
const { auth } = require('../store/index')
const { captureSession, isCurrentSession } = require('../utils/auth-session')

const REQUEST_TIMEOUT_MS = 15000
let refreshTask = null
const sessionChanged = () => ({ code: 'AUTH_SESSION_CHANGED', message: '登录账号已变化，请重试' })

// 将微信请求失败对象转换为页面可读的错误，同时保留原始 errMsg 供真机排查。
function networkError(error) {
  const errMsg = error && typeof error.errMsg === 'string' ? error.errMsg : ''
  let code = 'SYS_NETWORK'
  let message = '网络连接失败，请稍后重试'
  if (/domain list|合法域名/i.test(errMsg)) {
    code = 'SYS_DOMAIN_NOT_ALLOWED'
    message = '接口域名未配置，请联系管理员'
  } else if (/ssl|tls|certificate|err_cert/i.test(errMsg)) {
    code = 'SYS_TLS_FAILED'
    message = 'HTTPS连接失败，请联系管理员'
  } else if (/timeout|timed out/i.test(errMsg)) {
    code = 'SYS_NETWORK_TIMEOUT'
    message = '网络请求超时，请稍后重试'
  } else if (/connection[_ ]reset|econnreset/i.test(errMsg)) {
    code = 'SYS_CONNECTION_RESET'
    message = '网络连接被中断，请稍后重试'
  }
  return { code, message, errMsg, data: null, requestId: '' }
}

// JSON requests and multipart uploads share this queue so refresh-token rotation happens once.
function recoverSession(session, retry, reject, allowAnonymousRetry = true) {
  if (!isCurrentSession(auth, session)) { reject(sessionChanged()); return }
  const refreshToken = auth.state.refreshToken || wx.getStorageSync('refreshToken') || ''
  if (!refreshToken) {
    auth.clearAuth()
    if (!allowAnonymousRetry) { reject({ code: 401, message: '登录已过期，请重新登录' }); return }
    Object.assign(session, captureSession(auth))
    retry('')
    return
  }

  if (refreshTask && isCurrentSession(auth, refreshTask.session)) {
    refreshTask.queue.push({ retry, reject })
    return
  }

  const task = { session: captureSession(auth), queue: [{ retry, reject }] }
  refreshTask = task

  function failRefresh() {
    if (isCurrentSession(auth, task.session)) {
      auth.clearAuth()
      for (const q of task.queue) q.reject({ code: 401, message: '登录已过期，请重新登录' })
    } else {
      for (const q of task.queue) q.reject(sessionChanged())
    }
    task.queue = []
  }

  wx.request({
    url: `${env.baseUrl}/api/v1/auth/refresh-token`,
    method: 'POST',
    timeout: REQUEST_TIMEOUT_MS,
    data: { refreshToken },
    header: { 'content-type': 'application/json' },
    success(refreshRes) {
      if (!isCurrentSession(auth, task.session)) { failRefresh(); return }
      const payload = refreshRes.data || {}
      if (payload.code === 0 && payload.data) {
        auth.setToken(payload.data.accessToken, { refresh: true })
        auth.setRefreshToken(payload.data.refreshToken)
        const queue = task.queue
        task.queue = []
        queue.forEach(q => q.retry(payload.data.accessToken))
      } else {
        failRefresh()
      }
    },
    fail() { failRefresh() },
    complete() { if (refreshTask === task) refreshTask = null }
  })
}

/** Multipart recovery remains authenticated; it never retries a private file as a guest. */
function refreshAccessToken(session = captureSession(auth)) {
  return new Promise((resolve, reject) => recoverSession(session, resolve, reject, false))
}

function request({ url, method = 'GET', data = {}, header = {}, showLoading = true }) {
  const baseUrl = env.baseUrl || ''
  const token = auth.state.token || wx.getStorageSync('token') || ''
  const session = captureSession(auth)
  // An invalid SMS proof/application ticket is not an expired access token.
  const publicAuthentication = /^\/api\/v1\/auth\/(?:send-code|login|register-or-login|check-status|registration-status|refresh-token)(?:\?|$)/.test(url)

  if (!baseUrl) {
    return Promise.reject({
      code: 'SYS_NO_BASE_URL',
      message: '后端地址未配置',
      data: null,
      requestId: ''
    })
  }

  if (showLoading) {
    wx.showLoading({ title: '加载中', mask: true })
  }

  function doRequest(accessToken, allowAuthRecovery = true) {
    return new Promise((resolve, reject) => {
      wx.request({
        url: `${baseUrl}${url}`,
        method,
        data,
        timeout: REQUEST_TIMEOUT_MS,
        header: {
          'content-type': 'application/json',
          ...(accessToken ? { Authorization: `Bearer ${accessToken}` } : {}),
          ...header
        },
        success(res) {
          if (!isCurrentSession(auth, session)) { reject(sessionChanged()); return }
          const payload = res.data || {}
          const isAuthFailure = res.statusCode === 401 ||
            payload.code === 401 || payload.errorCode === 'AUTH_3005'
          if (isAuthFailure) {
            if (allowAuthRecovery) {
              handleRefresh(resolve, reject)
            } else {
              reject(payload)
            }
            return
          }
          if (res.statusCode < 200 || res.statusCode >= 300) {
            reject(payload)
            return
          }
          if (typeof payload.code === 'number' && payload.code !== 0) {
            reject(payload)
            return
          }
          resolve(payload)
        },
        fail(err) {
          reject(networkError(err))
        },
        complete() {
          if (showLoading) wx.hideLoading()
        }
      })
    })
  }

  function handleRefresh(resolve, reject) {
    const retry = (accessToken) => doRequest(accessToken, false).then(resolve, reject)
    recoverSession(session, retry, reject)
  }

  return doRequest(token, !publicAuthentication)
}

module.exports = { request, refreshAccessToken }
