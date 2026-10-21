import http from './request'

export interface UserProfile {
  user: { id: number; name: string; phone: string; status: string; userType?: string }
  customer: Record<string, unknown> | null
  tenant: { id: number; name: string; code: string }
  brands: Array<{ id: number; name: string; code: string }>
  roles: Array<{ id: number; name: string; code: string }>
  permissions: Array<string | { code: string }>
  menus: Array<{ code: string; name: string; path: string | null }>
}

export function sendCode(phone: string, purpose: 'login' | 'register' = 'login') {
  return http.post('/auth/send-code', { phone, purpose })
}

export function login(phone: string, code: string) {
  return http.post('/auth/login', { phone, code })
}

export function refreshToken(token: string) {
  return http.post('/auth/refresh-token', { refreshToken: token })
}

export function logout() {
  return http.post('/auth/logout')
}

export function getProfile() {
  return http.get('/auth/profile')
}
