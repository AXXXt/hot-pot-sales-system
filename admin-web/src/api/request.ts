import axios from 'axios'
import { ElMessage } from 'element-plus'

export const API_BASE_URL = (import.meta.env.VITE_API_BASE_URL as string) ||
  (import.meta.env.PROD ? '/api/v1' : 'http://127.0.0.1:3000/api/v1')

const http = axios.create({
  baseURL: API_BASE_URL,
  timeout: 15000,
  headers: { 'Content-Type': 'application/json' }
})

let refreshPromise: Promise<string> | null = null
let refreshEpoch = -1
let sessionEpoch = 0
let observedGeneration: string | undefined
export function getSessionEpoch() {
  const current = localStorage.getItem('adminSessionGeneration') || ''
  if (observedGeneration !== undefined && observedGeneration !== current) sessionEpoch++
  observedGeneration = current
  return sessionEpoch
}
function changeSession() {
  sessionEpoch++
  observedGeneration = globalThis.crypto?.randomUUID?.() || `${Date.now()}-${Math.random()}`
  localStorage.setItem('adminSessionGeneration', observedGeneration)
}

let unauthorizedHandler: (() => void) | null = null
export function setUnauthorizedHandler(handler: () => void) { unauthorizedHandler = handler }
export function getAccessToken(): string | null { return localStorage.getItem('accessToken') }
function getRefreshToken(): string { return localStorage.getItem('refreshToken') || '' }
// 网络层已提示的错误交给页面保留表单；前端校验错误仍由页面显示。
export function showRequestError(error: any, fallback = '请求失败') {
  if (error?.noticeShown) return
  ElMessage.error(error?.message || fallback)
  if (error && typeof error === 'object') error.noticeShown = true
}
export function setTokens(access: string, refresh: string) {
  changeSession()
  writeTokens(access, refresh)
}
function writeTokens(access: string, refresh: string) {
  localStorage.setItem('accessToken', access)
  localStorage.setItem('refreshToken', refresh)
}
export function clearTokens() {
  changeSession()
  localStorage.removeItem('accessToken')
  localStorage.removeItem('refreshToken')
  localStorage.removeItem('user')
  localStorage.removeItem('profile')
}

function refreshAccessToken(): Promise<string> {
  if (!refreshPromise || refreshEpoch !== getSessionEpoch()) {
    const epoch = getSessionEpoch(), previousRefresh = getRefreshToken()
    refreshEpoch = epoch
    const pending: Promise<string> = axios.post(`${API_BASE_URL}/auth/refresh-token`, { refreshToken: previousRefresh }, { timeout: 15000 })
      .then(response => {
        if (epoch !== getSessionEpoch()) throw new Error('登录状态已变化')
        if (getRefreshToken() !== previousRefresh && getAccessToken()) return getAccessToken()!
        const next = response.data?.data
        if (response.data?.code !== 0 || !next?.accessToken || !next?.refreshToken) throw new Error('会话刷新失败')
        writeTokens(next.accessToken, next.refreshToken)
        return next.accessToken as string
      }).catch(error => {
        if (epoch === getSessionEpoch() && getRefreshToken() !== previousRefresh && getAccessToken()) return getAccessToken()!
        if (epoch === getSessionEpoch()) { clearTokens(); unauthorizedHandler?.() }
        throw error
      }).finally(() => { if (refreshPromise === pending) refreshPromise = null })
    refreshPromise = pending
  }
  return refreshPromise
}

http.interceptors.request.use((config) => {
  ;(config as any)._sessionEpoch = getSessionEpoch()
  const token = getAccessToken()
  if (token) {
    config.headers.Authorization = `Bearer ${token}`
  }
  return config
})

http.interceptors.response.use(
  (response) => {
    if ((response.config as any)._sessionEpoch !== getSessionEpoch()) return Promise.reject(Object.assign(new Error('登录状态已变化'), { noticeShown: true }))
    const body = response.data
    if (body && typeof body.code === 'number' && body.code !== 0) {
      const err: any = new Error(body.message || '请求失败')
      err.code = body.code
      err.errorCode = body.errorCode
      err.data = body.data
      return Promise.reject(err)
    }
    return body
  },
  async (error) => {
    const status = error.response?.status
    const body = error.response?.data

    if (error.config?._sessionEpoch !== undefined && error.config._sessionEpoch !== getSessionEpoch()) return Promise.reject(error)
    const publicAuthentication = body?.errorCode === 'AUTH_PASSWORD_INVALID' || /\/auth\/(?:send-code|login|register-or-login|check-status|registration-status|refresh-token|password\/(?:login|setup|setup-info))$/.test(String(error.config?.url || '').split('?')[0])
    if (!publicAuthentication && (status === 401 || body?.errorCode === 'AUTH_3005')) {
      if (getRefreshToken() && !error.config?._retried) {
        error.config._retried = true
        try {
          const token = await refreshAccessToken()
          error.config.headers.Authorization = `Bearer ${token}`
          return http(error.config)
        } catch { return Promise.reject(error) }
      }
      clearTokens()
      unauthorizedHandler?.()
      return Promise.reject(error)
    }

    const fallbackMessages: Record<number, string> = {
      400: '请求失败',
      403: '当前账号没有执行此操作的权限',
      404: '请求的接口或数据不存在',
      409: '数据状态冲突，请刷新后重试',
      500: '服务器处理失败，请稍后重试'
    }
    const raw = body?.message
    const msgText = Array.isArray(raw) ? raw.join('; ') : typeof raw === 'string' ? raw : ''
    const serverMessage = msgText.length > 0 ? msgText : ''
    const msg = serverMessage || fallbackMessages[status] || error.message || '网络错误'
    error.message = msg
    showRequestError(error, msg)
    return Promise.reject(error)
  }
)

export default http
