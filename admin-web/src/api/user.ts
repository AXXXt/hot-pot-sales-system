import http from './request'

export function getUsers(params: Record<string, unknown>) {
  return http.get('/users', { params })
}

export function createUser(data: Record<string, unknown>) {
  return http.post('/users', data)
}

export function getUser(id: number) {
  return http.get(`/users/${id}`)
}

// These existing endpoints retain both role:manage and ai:configure checks.
export function getUserBrandOptions() {
  return http.get('/admin/ai/authorization')
}

export function updateUserBrands(id: number, brandIds: number[]) {
  return http.patch(`/admin/ai/authorization/users/${id}/brands`, { brandIds })
}

export function updateUser(id: number, data: Record<string, unknown>) {
  return http.patch(`/users/${id}`, data)
}

export function getRoles() {
  return http.get('/roles')
}

export function createRole(data: Record<string, unknown>) {
  return http.post('/roles', data)
}

export function updateRole(id: number, data: Record<string, unknown>) {
  return http.patch(`/roles/${id}`, data)
}

export function updateRolePermissions(id: number, permissionIds: number[]) {
  return http.post(`/roles/${id}/permissions`, { permissionIds })
}

export function getPermissions() {
  return http.get('/permissions')
}
