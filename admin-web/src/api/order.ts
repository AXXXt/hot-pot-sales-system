import http from './request'

export function getOrders(params: Record<string, unknown>) {
  return http.get('/orders', { params })
}

export function getOrderDetail(id: number) {
  return http.get(`/orders/${id}`)
}

export function createOrder(data: Record<string, unknown>) {
  return http.post('/orders', data)
}

export function quoteOrder(id: number, data: { items: Array<{ skuId: number; quotedPrice: number }>; note?: string }) {
  return http.post(`/orders/${id}/quote`, data)
}

export function submitOrder(id: number) {
  return http.post(`/orders/${id}/submit`)
}

export function getPriceHistory(customerId: number, skuIds: number[]) {
  return http.get(`/orders/price-history/${customerId}`, { params: { skuIds: skuIds.join(',') } })
}

export function approveFinance(id: number) {
  return http.post(`/orders/${id}/approve-finance`)
}

export function shipOrder(id: number, data: { logisticsType: string; driverName?: string; driverPhone?: string; plateNumber?: string }) {
  return http.post(`/orders/${id}/ship`, data)
}

export function cancelOrder(id: number) {
  return http.post(`/orders/${id}/cancel`)
}

export function completeOrder(id: number) {
  return http.post(`/orders/${id}/complete`)
}

export function adjustOrderPrice(id: number, data: Record<string, unknown>) {
  return http.post(`/orders/${id}/adjust-price`, data)
}

export function refundOrder(id: number, data: { amount: string; method?: string; reason?: string }) {
  return http.post(`/orders/${id}/refund`, data)
}