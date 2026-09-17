import http from './request'

export function getCustomers(params: Record<string, unknown>) {
  return http.get('/customers', { params })
}

export function getCustomerDetail(id: number) {
  return http.get(`/customers/${id}`)
}

export function createCustomer(data: Record<string, unknown>) {
  return http.post('/customers', data)
}

export function updateCustomer(id: number, data: Record<string, unknown>) {
  return http.patch(`/customers/${id}`, data)
}

export function getProductVisibility(customerId: number) {
  return http.get(`/customers/${customerId}/product-visibility`)
}

export function updateProductVisibility(customerId: number, data: Record<string, unknown>) {
  return http.put(`/customers/${customerId}/product-visibility`, data)
}

export function getCustomerLevels() {
  return http.get('/customer-levels')
}

export function createCustomerLevel(data: Record<string, unknown>) {
  return http.post('/customer-levels', data)
}

export function getPriceRules(customerId: number) {
  return http.get('/customer-price-rules', { params: { customerId } })
}

export function createPriceRule(data: Record<string, unknown>) {
  return http.post('/customer-price-rules', data)
}

export function deletePriceRule(id: number) {
  return http.delete(`/customer-price-rules/${id}`)
}

export function approveCustomer(id: number) {
  return http.post(`/customers/${id}/approve`)
}

export function rejectCustomer(id: number, reason?: string) {
  return http.post(`/customers/${id}/reject`, { reason })
}

export function getRepayments(customerId: number) {
  return http.get(`/customers/${customerId}/repayments`)
}

export function createRepayment(customerId: number, data: Record<string, unknown>) {
  return http.post(`/customers/${customerId}/repayments`, data)
}