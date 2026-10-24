import axios from 'axios'
import { ElMessage } from 'element-plus'

export const API_BASE_URL = import.meta.env.VITE_API_BASE_URL ||
  (import.meta.env.PROD ? '/api/v1' : 'http://127.0.0.1:3000/api/v1')

const http = axios.create({
  baseURL: API_BASE_URL,
  timeout: 15000,
  headers: { 'Content-Type': 'application/json' }
})

let unauthorizedHandler: (() => void) | null = null
let refreshPromise: Promise<string> | null = null
let sessionEpoch = 0
let refreshEpoch = -1
let observedGeneration: string | undefined
export function getSessionEpoch() {
  const current = localStorage.getItem('webSessionGeneration') || ''
  if (observedGeneration !== undefined && observedGeneration !== current) sessionEpoch++
  observedGeneration = current
  return sessionEpoch
}
function changeSession() {
  sessionEpoch++
  observedGeneration = globalThis.crypto?.randomUUID?.() || `${Date.now()}-${Math.random()}`
  localStorage.setItem('webSessionGeneration', observedGeneration)
}
export function setUnauthorizedHandler(handler: () => void) { unauthorizedHandler = handler }
export function getAccessToken(): string | null { return localStorage.getItem('webAccessToken') }
export function getRefreshToken(): string | null { return localStorage.getItem('webRefreshToken') }
export function setTokens(access: string, refresh: string) {
  changeSession()
  writeTokens(access, refresh)
}
function writeTokens(access: string, refresh: string) {
  localStorage.setItem('webAccessToken', access)
  localStorage.setItem('webRefreshToken', refresh)
}
export function clearTokens() {
  changeSession()
  localStorage.removeItem('webAccessToken')
  localStorage.removeItem('webRefreshToken')
  localStorage.removeItem('webProfile')
}

// 多个接口同时过期时共用一次刷新，避免旧刷新令牌互相覆盖并误退出登录。
function refreshAccessToken(): Promise<string> {
  if (!refreshPromise || refreshEpoch !== getSessionEpoch()) {
    const epoch = getSessionEpoch(), previousRefresh = getRefreshToken()
    refreshEpoch = epoch
    const pending: Promise<string> = axios.post(`${API_BASE_URL}/auth/refresh-token`, {
      refreshToken: previousRefresh
    }, { timeout: 15000 }).then(response => {
      const next = response.data?.data
      if (epoch !== getSessionEpoch()) throw new Error('登录状态已变化')
      if (getRefreshToken() !== previousRefresh && getAccessToken()) return getAccessToken()!
      if (response.data?.code !== 0 || !next?.accessToken || !next?.refreshToken) {
        throw new Error('会话刷新失败')
      }
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
  if (token) config.headers.Authorization = `Bearer ${token}`
  return config
})

http.interceptors.response.use(
  (response) => {
    if ((response.config as any)._sessionEpoch !== getSessionEpoch()) return Promise.reject(Object.assign(new Error('登录状态已变化'), { handled: true }))
    return response.data
  },
  async (error) => {
    const status = error.response?.status
    const body = error.response?.data
    if (error.config?._sessionEpoch !== undefined && error.config._sessionEpoch !== getSessionEpoch()) return Promise.reject(error)
    const publicAuthentication = /\/auth\/(?:send-code|login|register-or-login|check-status|registration-status|refresh-token|password\/(?:login|setup|setup-info))$/.test(String(error.config?.url || '').split('?')[0])

    if (!publicAuthentication && status === 401 && getRefreshToken() && !error.config?._retried) {
      error.config._retried = true
      try {
        const token = await refreshAccessToken()
        error.config.headers.Authorization = `Bearer ${token}`
        return http(error.config)
      } catch {
        return Promise.reject(error)
      }
    }

    if (!publicAuthentication && status === 401) {
      clearTokens()
      unauthorizedHandler?.()
    }

    const rawMessage = body?.message
    const message = Array.isArray(rawMessage) ? rawMessage.join('; ') : rawMessage
    ElMessage.error(message || (status === 403 ? '当前账号没有操作权限' : '网络请求失败，请稍后重试'))
    error.handled = true
    return Promise.reject(error)
  }
)

export default http
