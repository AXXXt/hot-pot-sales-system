import { packagingUnits, convertQuantity } from '../src/inventory/packaging'
import { batchDates } from '../src/inventory/stock-ledger'
import { normalizeWorkflow, workflowMissing } from '../src/ai/ai-workflows.service'

it('converts only explicit packages and rejects duplicate, guessed, fractional or overflowing quantities', () => {
  const sku = { saleUnit: '袋', packagingUnits: [{ unit: '箱', factor: 20 }] }
  expect(convertQuantity(sku, 3, '箱')).toEqual({ unit: '箱', factor: 20, baseQuantity: 60 })
  expect(convertQuantity(sku, 0)).toMatchObject({ baseQuantity: 0, factor: 1 })
  expect(() => convertQuantity(sku, 1, '件')).toThrow('未配置')
  expect(() => convertQuantity(sku, 0.5, '箱')).toThrow('整数')
  expect(() => convertQuantity(sku, 2147483647, '箱')).toThrow('范围')
  expect(() => packagingUnits([{ unit: '袋', factor: 20 }], '袋')).toThrow('唯一')
  expect(() => packagingUnits([{ unit: '箱', factor: 20 }, { unit: '箱', factor: 10 }], '袋')).toThrow('唯一')
})

it('rejects invalid calendar dates, future production dates and reversed expiry dates', () => {
  expect(() => batchDates({ expiryDate: '2026-02-30' })).toThrow('有效')
  expect(() => batchDates({ productionDate: '2100-01-01' })).toThrow('今天')
  expect(() => batchDates({ productionDate: '2026-01-01', expiryDate: '2025-01-01' })).toThrow('晚于')
  expect(batchDates({ productionDate: '2024-02-29', expiryDate: '2030-01-01' }).productionDate?.toISOString()).toBe('2024-02-29T00:00:00.000Z')
})

it('does not trust workflow snapshots or silently truncate long original lists', () => {
  const payload = normalizeWorkflow('order.create', { tenantId: 99, customerId: 1, lines: [{ skuId: 1, quantity: 2, unit: '袋', unitPrice: '0', baseQuantity: 9999, item: { id: 999 } }] })
  expect(payload.lines[0]).not.toHaveProperty('unitPrice')
  expect(payload.lines[0]).not.toHaveProperty('item')
  expect(payload).not.toHaveProperty('tenantId')
  expect(() => normalizeWorkflow('inventory.batch', { lines: Array(51).fill({}) })).toThrow('截断')
  expect(workflowMissing('inventory.batch', { lines: [{ skuId: 1, keyword: 'A', mode: 'set', quantity: 0, unit: '袋', item: { saleUnit: '袋' }, afterQty: 0, changeQty: -1 }, { skuId: 1, keyword: 'A', mode: 'set', quantity: 0, unit: '袋', item: { saleUnit: '袋' }, afterQty: 0, changeQty: -1 }] }).join()).toContain('重复')
})
