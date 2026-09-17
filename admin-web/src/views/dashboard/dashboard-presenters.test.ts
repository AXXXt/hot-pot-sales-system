import { describe, expect, it } from 'vitest'
import { getTopLowStockItems } from './dashboard-presenters'

describe('dashboard presenters', () => {
  it('puts zero-stock items before other low-stock items', () => {
    const result = getTopLowStockItems([
      { id: 1, productId: 1, skuName: '库存 4', availableQty: 4, warningQty: 10 },
      { id: 2, productId: 2, skuName: '库存 0', availableQty: 0, warningQty: 10 },
      { id: 3, productId: 3, skuName: '库存 2', availableQty: 2, warningQty: 10 }
    ])

    expect(result.map((item) => item.skuName)).toEqual(['库存 0', '库存 2', '库存 4'])
  })

  it('sorts by stock-to-warning ratio, then available quantity', () => {
    const result = getTopLowStockItems([
      { id: 1, productId: 1, skuName: '比例 50%', availableQty: 5, warningQty: 10 },
      { id: 2, productId: 2, skuName: '比例 20%', availableQty: 2, warningQty: 10 },
      { id: 3, productId: 3, skuName: '比例 10%', availableQty: 1, warningQty: 10 },
      { id: 4, productId: 4, skuName: '同类更低', availableQty: 1, warningQty: 5 }
    ])

    expect(result.map((item) => item.skuName)).toEqual(['比例 10%', '同类更低', '比例 20%', '比例 50%'])
  })

  it('returns at most five items without mutating the source list', () => {
    const source = Array.from({ length: 7 }, (_, index) => ({
      id: index,
      productId: index,
      skuName: `SKU ${index}`,
      availableQty: index,
      warningQty: 10
    }))

    const result = getTopLowStockItems(source)

    expect(result).toHaveLength(5)
    expect(source).toHaveLength(7)
  })
})
