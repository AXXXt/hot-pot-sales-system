export function formatAmount(value: unknown) {
  return Number(value || 0).toFixed(2)
}

export const ORDER_STATUS_MAP: Record<string, { label: string; type: 'info' | 'warning' | 'primary' | 'success' | 'danger' }> = {
  draft: { label: '草稿', type: 'info' },
  pending_quote: { label: '待报价', type: 'warning' },
  pending_confirm: { label: '待确认', type: 'warning' },
  pending_finance: { label: '待审核', type: 'warning' },
  pending_shipment: { label: '待发货', type: 'primary' },
  shipped: { label: '配送中', type: 'primary' },
  completed: { label: '已完成', type: 'success' },
  cancelled: { label: '已取消', type: 'info' }
}

export function orderStatus(status: string) {
  return ORDER_STATUS_MAP[status] || { label: status || '未知', type: 'info' as const }
}

export function formatDateTime(value: string) {
  if (!value) return '--'
  return new Date(value).toLocaleString('zh-CN', { hour12: false })
}

export function firstSku(product?: { skus?: Array<{ stockNum: number }> } | null) {
  return product?.skus?.find(sku => sku.stockNum > 0) || product?.skus?.[0]
}