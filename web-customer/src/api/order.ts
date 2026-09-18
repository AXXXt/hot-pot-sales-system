import http from './request'

export interface OrderListItem {
  id: number
  orderNo: string
  status: string
  totalAmount: string
  payableAmount: string
  createdAt: string
  itemCount?: number
  productNames?: string[]
  customer?: { customerName: string }
}

export interface OrderItem {
  id: number
  productId: number
  skuId: number
  productName: string
  skuName?: string
  skuSpecText?: string
  saleUnit?: string
  quantity: number
  unitPrice: string
  amount: string
}

export interface OrderDetail {
  id: number
  orderNo: string
  status: string
  totalAmount: string
  discountAmount: string
  payableAmount: string
  remark?: string
  paymentMethod?: string
  createdAt: string
  items: OrderItem[]
  customer?: {
    customerName: string
    contactName?: string
    contactPhone?: string
    creditRemaining?: string
  }
}

export function getOrders(params: Record<string, unknown>) {
  return http.get<{ items: OrderListItem[]; total: number; page: number; pageSize: number }>('/orders', { params })
}

export function getOrderDetail(id: number) {
  return http.get<OrderDetail>(`/orders/${id}`)
}

export function createOrder(data: { customerId: number; items: Array<{ skuId: number; quantity: number }>; remark?: string }) {
  return http.post<{ id: number; orderNo: string }>('/orders', data)
}

export function submitOrder(id: number) {
  return http.post(`/orders/${id}/submit`)
}

export function cancelOrder(id: number) {
  return http.post(`/orders/${id}/cancel`)
}

export function completeOrder(id: number) {
  return http.post(`/orders/${id}/complete`)
}

export function getOrderLogistics(id: number) {
  return http.get(`/orders/${id}/logistics`)
}