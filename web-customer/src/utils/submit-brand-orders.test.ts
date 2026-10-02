import { describe, it, expect, vi } from 'vitest'
import { submitBrandOrders } from './submit-brand-orders'

const groups = [
  { brand: 'A', items: [{ skuId: 1, quantity: 2 }] },
  { brand: 'B', items: [{ skuId: 2, quantity: 3 }] }
]

describe('brand order checkout', () => {
  it('removes only successfully created groups when another group fails', async () => {
    const remove = vi.fn()
    const result = await submitBrandOrders(groups, {
      create: vi.fn().mockResolvedValueOnce({ id: 10, orderNo: 'OD10' }).mockRejectedValueOnce(new Error('stock')),
      submit: vi.fn().mockResolvedValue({}), remove
    })
    expect(result.failures).toEqual(['B'])
    expect(result.created).toEqual([{ id: 10, orderNo: 'OD10', brand: 'A', submitted: true }])
    expect(remove.mock.calls).toEqual([[[1]]])
  })
  it('retains a recoverable draft without recreating its order', async () => {
    const create = vi.fn().mockResolvedValue({ id: 10, orderNo: 'OD10' })
    const remove = vi.fn()
    const result = await submitBrandOrders(groups.slice(0, 1), { create, submit: vi.fn().mockRejectedValue(new Error('timeout')), remove })
    expect(result.created[0].submitted).toBe(false)
    expect(create).toHaveBeenCalledTimes(1)
    expect(remove).toHaveBeenCalledWith([1])
  })
  it('keeps all items when no order was created', async () => {
    const remove = vi.fn()
    const submit = vi.fn()
    const result = await submitBrandOrders(groups, { create: vi.fn().mockRejectedValue(new Error('offline')), submit, remove })
    expect(result.created).toEqual([])
    expect(result.failures).toEqual(['A', 'B'])
    expect(remove).not.toHaveBeenCalled()
    expect(submit).not.toHaveBeenCalled()
  })
})
