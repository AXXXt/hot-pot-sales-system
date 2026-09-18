import http from './request'

export interface CustomerProfile {
  id: number
  customerName: string
  customerType: string
  status: string
  address?: string
  contactName?: string
  contactPhone?: string
  creditRemaining?: string
  creditDays?: number
}

export interface ClientProfile {
  user: { id: number; name: string; phone: string; userType: string }
  customer: CustomerProfile | null
  tenant: { id: number; name: string }
  brands: Array<{ id: number; name: string; code: string; logoUrl?: string }>
}

export function sendCode(phone: string) {
  return http.post('/auth/send-code', { phone })
}

export function login(phone: string, code: string) {
  return http.post<{ accessToken: string; refreshToken: string }>('/auth/login', { phone, code })
}

export function logout() {
  return http.post('/auth/logout')
}

export function getProfile() {
  return http.get<ClientProfile>('/auth/profile')
}