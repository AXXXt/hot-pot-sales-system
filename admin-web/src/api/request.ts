import axios from 'axios'
import { ElMessage } from 'element-plus'

const http = axios.create({
  baseURL: 'http://127.0.0.1:3000/api/v1',
  timeout: 15000,
  headers: { 'Content-Type': 'application/json' }
})

let isRefreshing = false
let refreshQueue: Array<{ resolve: (token: string) => void; reject: (err: unknown) => void }> = []

let unauthorizedHandler: (() => void) | null = null
export function setUnauthorizedHandler(handler: () => void) { unauthorizedHandler = handler }
export function getAccessToken(): string | null { return localStorage.getItem('accessToken') }
function getRefreshToken(): string { return localStorage.getItem('refreshToken') || '' }
export function setTokens(access: string, refresh: string) {
  localStorage.setItem('accessToken', access)
  localStorage.setItem('refreshToken', refresh)
}
export function clearTokens() {
  localStorage.removeItem('accessToken')
  localStorage.removeItem('refreshToken')
  localStorage.removeItem('user')
  localStorage.removeItem('profile')
}

http.interceptors.request.use((config) => {
  const token = getAccessToken()
  if (token) {
    config.headers.Authorization = `Bearer ${token}`
  }
  return config
})

http.interceptors.response.use(
  (response) => {
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

    if (status === 401 || (body && body.errorCode === 'AUTH_3005')) {
      const refreshToken = getRefreshToken()

      // No refresh token at all -> immediate cleanup
      if (!refreshToken) {
        clearTokens()
        unauthorizedHandler?.()
        return Promise.reject(error)
      }

      // The refresh call itself failed -> cleanup everything
      if (error.config.url?.includes('/auth/refresh-token')) {
        clearTokens()
        unauthorizedHandler?.()
        return Promise.reject(error)
      }

      // Try token refresh
      if (!isRefreshing) {
        isRefreshing = true
        try {
          const res = await axios.post('http://127.0.0.1:3000/api/v1/auth/refresh-token', { refreshToken })
          if (res.data?.code === 0 && res.data?.data) {
            const { accessToken, refreshToken: newRefresh } = res.data.data
            setTokens(accessToken, newRefresh)
            refreshQueue.forEach((q) => q.resolve(accessToken))
            refreshQueue = []
            error.config.headers.Authorization = `Bearer ${accessToken}`
            return http(error.config)
          }
          // Refresh returned non-zero code -> fail
          throw new Error('refresh returned error')
        } catch {
          // Refresh failed: reject ALL queued requests and cleanup
          refreshQueue.forEach((q) => q.reject(new Error('会话已过期，请重新登录')))
          refreshQueue = []
          clearTokens()
          unauthorizedHandler?.()
          return Promise.reject(error)
        } finally {
          isRefreshing = false
        }
      }

      // Another refresh is in progress, queue this request
      return new Promise((resolve, reject) => {
        refreshQueue.push({
          resolve: (token: string) => {
            error.config.headers.Authorization = `Bearer ${token}`
            resolve(http(error.config))
          },
          reject
        })
      })
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
    ElMessage.error(msg)
    return Promise.reject(error)
  }
)

export default http
