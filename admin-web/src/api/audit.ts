import http from './request'

export function getAuditLogs(params: Record<string, unknown>) {
  return http.get('/audit-logs', { params })
}

export function getAuditLogDetail(id: number) {
  return http.get(`/audit-logs/${id}`)
}
