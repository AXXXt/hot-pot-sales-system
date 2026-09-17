import http from './request'

export function getSystemConfigs() {
  return http.get('/system-configs')
}

export function updateSystemConfig(key: string, data: Record<string, unknown>) {
  return http.put(`/system-configs/${key}`, data)
}
