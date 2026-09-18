import http from './request'

export function getInventoryStock(params: Record<string, unknown>) {
  return http.get('/inventory/stock', { params })
}

export function getStockMovements(params: Record<string, unknown>) {
  return http.get('/inventory/movements', { params })
}

export function getAdjustments(params: Record<string, unknown> = {}) {
  return http.get('/inventory/adjustments', { params })
}

export function getAdjustmentDetail(id: number) {
  return http.get(`/inventory/adjustments/${id}`)
}

export function createAdjustment(data: Record<string, unknown>) {
  return http.post('/inventory/adjustments', data)
}

export function getStocktakes(params: Record<string, unknown> = {}) {
  return http.get('/inventory/stocktakes', { params })
}

export function getStocktakeDetail(id: number) {
  return http.get(`/inventory/stocktakes/${id}`)
}

export function createStocktake(data: Record<string, unknown>) {
  return http.post('/inventory/stocktakes', data)
}

export function updateStocktakeItems(id: number, data: { items: Array<{ skuId: number; countedQty: number; remark?: string }> }) {
  return http.patch(`/inventory/stocktakes/${id}/items`, data)
}

export function completeStocktake(id: number, data: { items: Array<{ skuId: number; countedQty: number; remark?: string }> }) {
  return http.post(`/inventory/stocktakes/${id}/complete`, data)
}

export function cancelStocktake(id: number) {
  return http.post(`/inventory/stocktakes/${id}/cancel`)
}