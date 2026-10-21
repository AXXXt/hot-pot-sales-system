import http from './request'

export interface ProductSku {
  id: number
  skuCode: string
  name: string
  specText: string
  saleUnit: string
  basePrice: string
  customerPrice?: string | null
  minOrderQty: number
  stockNum: number
}

export interface Product {
  id: number
  name: string
  subtitle?: string
  displayName?: string
  managementLabel?: string
  nameNeedsReview?: boolean
  mainImageUrl?: string
  images?: string[]
  baseSpec?: string
  deliveryText?: string
  description?: string
  isRecommended?: boolean
  isNew?: boolean
  isHot?: boolean
  category?: { id: number; name: string }
  brand?: { id: number; name: string }
  skus: ProductSku[]
}

export interface Category {
  id: number
  name: string
  sortOrder?: number
}

export interface Brand {
  id: number
  name: string
  code: string
  logoUrl?: string
  description?: string
}

export interface CartValidationItem {
  skuId: number
  productId: number
  brandId: number
  brandName: string
  name: string
  spec: string
  unit: string
  price: string
  minOrderQty: number
  stockNum: number
  available: boolean
  unavailableReason?: string | null
}

export interface CartValidationResult {
  items: CartValidationItem[]
  invalidSkuIds: number[]
}

export interface PagedProducts {
  items: Product[]
  page: number
  pageSize: number
  total: number
}

export function getProducts(params: Record<string, unknown>) {
  return http.get<PagedProducts>('/products', { params }).then(response => {
    response.data.items = response.data.items.map(presentProduct)
    return response
  })
}

export function getProduct(id: number) {
  return http.get<Product>(`/products/${id}`).then(response => {
    response.data = presentProduct(response.data)
    return response
  })
}

function presentProduct(product: Product): Product {
  return { ...product, name: product.displayName?.trim() || product.subtitle?.trim() || product.name }
}

export function getCategories() {
  return http.get<Category[]>('/product-categories')
}

export function getBrands() {
  return http.get<Brand[]>('/brands')
}

export function validateCart(skuIds: number[]) {
  return http.post<CartValidationResult>('/products/cart-validation', { skuIds })
}
