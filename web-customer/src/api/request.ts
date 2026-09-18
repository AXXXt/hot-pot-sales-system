import axios from 'axios'
import { ElMessage } from 'element-plus'

export const API_BASE_URL = import.meta.env.VITE_API_BASE_URL || 'http://127.0.0.1:3000/api/v1'

const http = axios.create({
  baseURL: API_BASE_URL,
  timeout: 15000,
  headers: { 'Content-Type': 'application/json' }
})

let unauthorizedHandler: (() => void) | null = null
export function setUnauthorizedHandler(handler: () => void) { unauthorizedHandler = handler }
export function getAccessToken(): string | null { return localStorage.getItem('webAccessToken') }
export function getRefreshToken(): string | null { return localStorage.getItem('webRefreshToken') }
export function setTokens(access: string, refresh: string) {
  localStorage.setItem('webAccessToken', access)
  localStorage.setItem('webRefreshToken', refresh)
}
export function clearTokens() {
  localStorage.removeItem('webAccessToken')
  localStorage.removeItem('webRefreshToken')
  localStorage.removeItem('webProfile')
}

http.interceptors.request.use((config) => {
  const token = getAccessToken()
  if (token) config.headers.Authorization = `Bearer ${token}`
  return config
})

http.interceptors.response.use(
  (response) => response.data,
  async (error) => {
    const status = error.response?.status
    const body = error.response?.data

    if (status === 401 && getRefreshToken() && !String(error.config.url).includes('/auth/refresh-token')) {
      try {
        const refreshResponse = await axios.post(`${API_BASE_URL}/auth/refresh-token`, {
          refreshToken: getRefreshToken()
        })
        const next = refreshResponse.data?.data
        if (next?.accessToken) {
          setTokens(next.accessToken, next.refreshToken)
          error.config.headers.Authorization = `Bearer ${next.accessToken}`
          return http(error.config)
        }
      } catch {
        clearTokens()
        unauthorizedHandler?.()
      }
    }

    if (status === 401) {
      clearTokens()
      unauthorizedHandler?.()
    }

    const rawMessage = body?.message
    const message = Array.isArray(rawMessage) ? rawMessage.join('; ') : rawMessage
    ElMessage.error(message || (status === 403 ? '当前账号没有操作权限' : '网络请求失败，请稍后重试'))
    return Promise.reject(error)
  }
)

export default http