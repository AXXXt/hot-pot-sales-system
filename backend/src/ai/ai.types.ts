export interface ProductDraft {
  brandId: number | null
  categoryId: number | null
  brandName?: string
  categoryName?: string
  subtitle: string
  description: string
  skus: Array<{ specText: string; saleUnit: string; basePrice: string; minOrderQty: number }>
  attachmentIds: string[]
  warnings: string[]
}

export const AI_PERMISSIONS = [
  ['ai:use', '使用AI运营助手'], ['ai:execute', '确认AI业务操作'],
  ['ai:configure', '配置AI助手'], ['ai:usage:read', '查看AI用量'],
  ['ai:audit:read', '查看AI审计'], ['task:manage_own', '管理个人事务'],
  ['analytics:view', '查看经营统计'], ['product:price:update', '调整商品销售价'],
  ['export:create', '导出业务报告']
] as const

export const EFFECTIVE_ORDER_STATUSES = ['pending_shipment', 'shipped', 'completed'] as const
