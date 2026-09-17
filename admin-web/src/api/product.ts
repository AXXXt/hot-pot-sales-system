import http from './request'

export function getProducts(params: Record<string, unknown>) {
  return http.get('/products', { params })
}

export function getProductDetail(id: number) {
  return http.get(`/products/${id}`)
}

export function getProductSkus(id: number) {
  return http.get(`/products/${id}/skus`)
}

export function createProduct(data: Record<string, unknown>) {
  return http.post('/products', data)
}

export function updateProduct(id: number, data: Record<string, unknown>) {
  return http.patch(`/products/${id}`, data)
}

export function updateProductStatus(id: number, status: string) {
  return http.patch(`/products/${id}/status`, { status })
}

export function batchUpdateProductStatus(productIds: number[], status: string) {
  return http.patch('/products/batch-status', { productIds, status })
}

export function deleteProduct(id: number) {
  return http.delete(`/products/${id}`)
}

export function batchArchiveProducts(productIds: number[]) {
  return http.patch('/products/batch-archive', { productIds })
}

export function uploadProductImage(file: File) {
  const data = new FormData()
  data.append('file', file)
  return http.post('/uploads/product-image', data, {
    headers: { 'Content-Type': 'multipart/form-data' }
  })
}

export function createSku(productId: number, data: Record<string, unknown>) {
  return http.post(`/products/${productId}/skus`, data)
}

export function updateSku(id: number, data: Record<string, unknown>) {
  return http.patch(`/skus/${id}`, data)
}

export function updateSkuStatus(id: number, status: string) {
  return http.patch(`/skus/${id}/status`, { status })
}

export function getCategories() {
  return http.get('/product-categories')
}

export function getManagedCategories() {
  return http.get('/admin/product-categories')
}

export function createCategory(data: Record<string, unknown>) {
  return http.post('/product-categories', data)
}

export function updateCategory(id: number, data: Record<string, unknown>) {
  return http.patch(`/product-categories/${id}`, data)
}

export function deleteCategory(id: number) {
  return http.delete(`/product-categories/${id}`)
}

export function restoreCategory(id: number) {
  return http.patch(`/admin/product-categories/${id}/restore`)
}

export function getBrands() {
  return http.get('/brands')
}

export function getManagedBrands(params: Record<string, unknown> = {}) {
  return http.get('/admin/brands', { params })
}

export function suggestBrandCode(name: string) {
  return http.get('/admin/brands/code-suggestion', { params: { name } })
}

export function createBrand(data: Record<string, unknown>) {
  return http.post('/admin/brands', data)
}

export function updateBrand(id: number, data: Record<string, unknown>) {
  return http.patch(`/admin/brands/${id}`, data)
}

export function deleteBrand(id: number) {
  return http.delete(`/admin/brands/${id}`)
}

export function restoreBrand(id: number) {
  return http.patch(`/admin/brands/${id}/restore`)
}
