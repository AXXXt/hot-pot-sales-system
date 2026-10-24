export interface DashboardLowStockItem {
  id: number | string
  productId: number | string
  productName?: string | null
  skuName: string
  warehouse?: string | null
  availableQty?: number | string | null
  warningQty?: number | string | null
}

function toFiniteNumber(value: unknown): number {
  const amount = Number(value)
  return Number.isFinite(amount) ? amount : 0
}

function riskRatio(item: DashboardLowStockItem): number {
  const availableQty = toFiniteNumber(item.availableQty)
  const warningQty = toFiniteNumber(item.warningQty)
  if (warningQty <= 0) return availableQty > 0 ? 1 : 0
  return availableQty / warningQty
}

export function lowStockPercent(item: DashboardLowStockItem): number {
  const availableQty = toFiniteNumber(item.availableQty)
  const warningQty = warningQuantity(item)
  if (warningQty <= 0) return availableQty > 0 ? 100 : 0
  return Math.max(0, Math.min(100, Math.round((availableQty / warningQty) * 100)))
}

export function lowStockWarningText(item: DashboardLowStockItem): string {
  return `预警线 ${warningQuantity(item)}`
}

function warningQuantity(item: DashboardLowStockItem): number {
  const value = item.warningQty
  const quantity = Number(value)
  // Retain the legacy fallback only when a warning line is missing or invalid.
  return value == null || value === '' || !Number.isFinite(quantity) ? 10 : Math.max(0, quantity)
}

export function getTopLowStockItems(
  items: DashboardLowStockItem[] | null | undefined,
  limit = 5
): DashboardLowStockItem[] {
  return [...(items || [])]
    .map((item, index) => ({ item, index }))
    .sort((left, right) => {
      const ratioDifference = riskRatio(left.item) - riskRatio(right.item)
      if (ratioDifference !== 0) return ratioDifference

      const quantityDifference = toFiniteNumber(left.item.availableQty) - toFiniteNumber(right.item.availableQty)
      if (quantityDifference !== 0) return quantityDifference

      return left.index - right.index
    })
    .slice(0, Math.max(0, limit))
    .map(({ item }) => item)
}
