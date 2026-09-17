import http from './request'

export function getDashboardStats() {
  return http.get('/dashboard/stats')
}
