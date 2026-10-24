const env = require('../../config')
const auth = require('../../store/modules/auth')
const { captureSession, isCurrentSession } = require('../../utils/auth-session')
const { refreshAccessToken } = require('../request')

const safeServerMessages = new Set([
  '请选择转账凭证', '图片不能超过 5MB', '仅支持 JPG、PNG、WebP 图片', '图片文件无效',
  '图片存储服务暂不可用', '当前账号没有执行此操作的权限'
])

function uploadNetworkError(error) {
  const reason = typeof error?.errMsg === 'string' ? error.errMsg : ''
  if (/domain list|合法域名/i.test(reason)) return { code: 'UPLOAD_DOMAIN_NOT_ALLOWED', message: '图片上传域名未配置，请联系管理员' }
  if (/ssl|tls|certificate|err_cert/i.test(reason)) return { code: 'UPLOAD_TLS_FAILED', message: '图片上传连接失败，请稍后重试' }
  if (/timeout|timed out/i.test(reason)) return { code: 'UPLOAD_TIMEOUT', message: '图片上传超时，请重试' }
  return { code: 'UPLOAD_NETWORK', message: '图片上传失败，请检查网络后重试' }
}

function uploadResponseError(payload, statusCode) {
  const code = statusCode === 401 || payload?.code === 401 || payload?.errorCode === 'AUTH_3005' ? 401 : statusCode
  const message = code === 401 ? '登录已过期，请重新登录'
    : statusCode === 413 ? '图片不能超过 5MB'
      : safeServerMessages.has(payload?.message) ? payload.message : '转账凭证上传失败，请稍后重试'
  return { code, message }
}

// 上传转账凭证图片，返回后端保存的对象地址。
function uploadPaymentProof(filePath, options = {}) {
  const token = auth.state.token || wx.getStorageSync('token') || ''
  const session = captureSession(auth)
  if (!env.baseUrl) {
    return Promise.reject({ message: '后端地址未配置' })
  }
  if (typeof filePath !== 'string' || !filePath.trim()) return Promise.reject({ code: 'UPLOAD_INVALID_FILE', message: '未获取到图片，请重新选择' })

  function actionError() {
    if (!isCurrentSession(auth, session)) return { code: 'AUTH_SESSION_CHANGED', message: '登录账号已变化，请重试' }
    let active = true
    try { if (typeof options.isActive === 'function') active = options.isActive() } catch { active = false }
    if (!active) return { code: 'UPLOAD_ACTION_CANCELLED', message: '上传操作已取消' }
    if (!auth.state.token) return { code: 401, message: '登录已过期，请重新登录' }
    return null
  }

  function doUpload(accessToken, allowRecovery = true) {
    return new Promise((resolve, reject) => {
      const stopped = actionError()
      if (stopped) { reject(stopped); return }
      const failed = error => reject(actionError() || uploadNetworkError(error))
      try { wx.uploadFile({
        url: `${env.baseUrl}/api/v1/uploads/payment-proof`, filePath, name: 'file',
        header: { Authorization: `Bearer ${accessToken}` },
        success(res) {
          const stopped = actionError()
          if (stopped) { reject(stopped); return }
          let payload
          try { payload = JSON.parse(res.data || '{}') }
          catch {
            if (res.statusCode !== 401) { reject({ code: 'UPLOAD_INVALID_RESPONSE', message: '上传响应格式错误，请重试' }); return }
            payload = {}
          }
          const authFailure = res.statusCode === 401 || payload?.code === 401 || payload?.errorCode === 'AUTH_3005'
          if (authFailure && allowRecovery) {
            refreshAccessToken(session).catch(error => {
              throw error?.code === 'AUTH_SESSION_CHANGED'
                ? { code: 'AUTH_SESSION_CHANGED', message: '登录账号已变化，请重试' }
                : { code: 401, message: '登录已过期，请重新登录' }
            }).then(freshToken => {
              const stopped = actionError()
              if (stopped) throw stopped
              return doUpload(freshToken, false)
            }).then(resolve, reject)
            return
          }
          if (res.statusCode < 200 || res.statusCode >= 300 || payload?.code !== 0) {
            reject(uploadResponseError(payload, res.statusCode)); return
          }
          resolve(payload)
        },
        fail: failed
      }) } catch (error) { failed(error) }
    })
  }

  return doUpload(token)
}

module.exports = { uploadPaymentProof }
