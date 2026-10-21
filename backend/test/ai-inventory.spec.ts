import { AiInventoryService, inventoryMissing, normalizeInventoryDraft } from '../src/ai/ai-inventory.service'
import { StaffAccessService, StaffActor } from '../src/auth/staff-access.service'
import { nextSkuCode } from '../src/product/sku-code'

const actor: StaffActor = { id: 1, tenantId: 7, userType: 'warehouse', superAdmin: false, permissions: new Set(['ai:use', 'ai:execute', 'inventory:read', 'inventory:adjust']), brandIds: [3], customerIds: null, leadIds: null, fingerprint: 'scope' }
const sku = { id: 10, productId: 8, skuCode: 'P-01', specText: '500克/袋', saleUnit: '袋', stockNum: 20, product: { name: '品牌丸滑', subtitle: '爆汁牛筋丸' } }
const input = { keyword: '爆汁牛筋丸', specText: '500克', mode: 'increase', quantity: 10, unit: '袋', reason: '采购到货' }
function fixture(items = [sku]) {
  const db: any = { productSku: { findMany: jest.fn().mockResolvedValue(items) } }
  const tx: any = { productSku: { findFirst: jest.fn().mockResolvedValue(sku), updateMany: jest.fn().mockResolvedValue({ count: 1 }) }, stockAdjustment: { create: jest.fn().mockResolvedValue({ id: 2, adjustmentNo: 'AI-1' }) }, stockMovement: { create: jest.fn() }, auditLog: { create: jest.fn() } }
  const service = new AiInventoryService(db, new StaffAccessService({} as any))
  return { db, tx, service }
}

it('allocates after all historical SKU suffixes, including old prefixes and disabled items', () => {
  expect(nextSkuCode('P-001', ['P-001-02', 'P-001-01'])).toBe('P-001-03')
  expect(nextSkuCode('NEW-001', ['OLD-001-09'])).toBe('NEW-001-10')
})

it('ignores model-supplied stock snapshots, execution fields and foreign identities', () => {
  const payload = normalizeInventoryDraft({ ...input, item: sku, beforeQty: 9999, afterQty: 9999, tenantId: 99, quantity: '10' })
  expect(payload).toMatchObject({ item: null, quantity: null, afterQty: null })
  expect(payload).not.toHaveProperty('tenantId')
})

it('resolves the authorized SKU and previews the change without writing', async () => {
  const { service, db, tx } = fixture()
  const payload = await service.prepare(actor, input)
  expect(payload).toMatchObject({ skuId: 10, item: { productName: '爆汁牛筋丸', beforeQty: 20 }, afterQty: 30, changeQty: 10 })
  expect(inventoryMissing(payload)).toEqual([])
  expect(db.productSku.findMany.mock.calls[0][0].where).toMatchObject({ tenantId: 7, product: { AND: expect.arrayContaining([{ tenantId: 7, brandId: { in: [3] } }]) } })
  expect(tx.productSku.updateMany).not.toHaveBeenCalled()
})

it('requires a choice for ambiguous products and refuses unauthorized stock operations', async () => {
  const { service } = fixture([sku, { ...sku, id: 11, specText: '200克/袋' }])
  expect(inventoryMissing(await service.prepare(actor, { ...input, specText: '' }))).toContain('请选择唯一商品规格')
  await expect(service.prepare({ ...actor, permissions: new Set(['inventory:read']) }, input)).rejects.toThrow('权限')
})

it.each([
  [{ ...input, quantity: -1 }, '有效数量'],
  [{ ...input, mode: 'decrease', quantity: 21 }, '库存不足'],
  [{ ...input, unit: '箱' }, '数量单位'],
  [{ ...input, mode: 'set', quantity: 20 }, '无需调整'],
  [{ ...input, quantity: 2147483647 }, '超过支持范围']
])('refuses invalid or unsafe quantities %j', async (value, message) => {
  const { service, tx } = fixture()
  const payload = await service.prepare(actor, value)
  expect(inventoryMissing(payload).join(' ')).toContain(message)
  await expect(service.apply(tx, actor, payload, 'draft')).rejects.toThrow()
  expect(tx.productSku.updateMany).not.toHaveBeenCalled()
})

it('sets stock to zero and atomically records the linked outbound document, movement and audit', async () => {
  const { service, tx } = fixture()
  const payload = await service.prepare(actor, { ...input, mode: 'set', quantity: 0 })
  const result = await service.apply(tx, actor, payload, 'draft')
  expect(result).toMatchObject({ beforeQty: 20, afterQty: 0, changeQty: -20 })
  expect(tx.stockMovement.create).toHaveBeenCalledWith({ data: expect.objectContaining({ tenantId: 7, skuId: 10, operatorId: 1, type: 'manual_out', changeQty: -20, beforeQty: 20, afterQty: 0, stockAdjustmentId: 2, sourceId: 2 }) })
  expect(tx.auditLog.create).toHaveBeenCalledWith({ data: expect.objectContaining({ action: 'inventory_adjust', tenantId: 7 }) })
})

it.each(['changed', 'race', 'disabled'])('rejects stale previews and concurrent changes: %s', async scenario => {
  const { service, tx } = fixture()
  const payload = await service.prepare(actor, input)
  if (scenario === 'changed') tx.productSku.findFirst.mockResolvedValue({ ...sku, stockNum: 19 })
  if (scenario === 'disabled') tx.productSku.findFirst.mockResolvedValue(null)
  if (scenario === 'race') tx.productSku.updateMany.mockResolvedValue({ count: 0 })
  await expect(service.apply(tx, actor, payload, 'draft')).rejects.toThrow()
  expect(tx.stockMovement.create).not.toHaveBeenCalled()
})
