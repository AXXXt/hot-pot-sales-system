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

export interface LegalConsentInput { consentAccepted: boolean; consentVersion: string; consentChannel: 'admin_web' }

export function login(phone: string, code: string, consent?: LegalConsentInput) {
  return http.post('/auth/login', { phone, code, ...consent })
}

export function refreshToken(token: string) {
  return http.post('/auth/refresh-token', { refreshToken: token })
}

export function loginWithPassword(phone: string, password: string, consent?: LegalConsentInput) {
  return http.post('/auth/password/login', { phone, password, ...consent })
}
export function passwordSetupInfo(token: string) { return http.post('/auth/password/setup-info', { token }) }
export function setLoginPassword(token: string, password: string) { return http.post('/auth/password/setup', { token, password }) }
export function createPasswordSetupLink(userId: number) { return http.post('/auth/password/setup-links', { userId }) }
export function changeLoginPassword(currentPassword: string, password: string) { return http.post('/auth/password/change', { currentPassword, password }) }

export function logout() {
  return http.post('/auth/logout')
}

export function getProfile() {
  return http.get('/auth/profile')
}
