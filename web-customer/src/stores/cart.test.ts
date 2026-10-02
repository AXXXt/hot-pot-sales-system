import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'
import { useCartStore } from './cart'

beforeEach(() => {
  vi.stubGlobal('localStorage', { getItem: () => null, setItem: vi.fn() })
  setActivePinia(createPinia())
})

describe('cart validation', () => {
  it('marks missing and invalid SKUs unavailable instead of keeping stale purchasable items', () => {
    const cart = useCartStore()
    cart.addRepeatedSku({ skuId: 1, quantity: 2, unitPrice: '10' })
    cart.addRepeatedSku({ skuId: 2, quantity: 1, unitPrice: '20' })
    cart.applyValidation({ items: [], invalidSkuIds: [1] })
    expect(cart.hasUnavailable).toBe(true)
    expect(cart.validItems).toHaveLength(0)
    expect(cart.items).toHaveLength(2)
  })
  it('preserves failed groups when successful SKUs are removed', () => {
    const cart = useCartStore()
    cart.addRepeatedSku({ skuId: 1, quantity: 2, unitPrice: '10' })
    cart.addRepeatedSku({ skuId: 2, quantity: 1, unitPrice: '20' })
    cart.removeItemsBySkuIds([1])
    expect(cart.items.map(item => item.skuId)).toEqual([2])
  })
})
