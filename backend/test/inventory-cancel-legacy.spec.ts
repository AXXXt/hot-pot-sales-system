import { ForbiddenException } from '@nestjs/common'
import { InventoryService } from '../src/inventory/inventory.service'
import { InventoryController } from '../src/inventory/inventory.controller'
import { InventoryPlanningService } from '../src/inventory/inventory-planning.service'
import { StaffAccessService, StaffActor } from '../src/auth/staff-access.service'
import { ProductService } from '../src/product/product.service'

function cancelFixture() {
  const stock = { stockNum: 22, reservedNum: 3, batches: [{ id: 4, quantity: 22 }] }
  const document = { id: 5, tenantId: 7, stocktakeNo: 'PD-FIXTURE', status: 'draft', reviewedBy: null as number | null,
    updatedAt: new Date('2026-10-24T01:00:00Z'), items: [
      { id: 1, skuId: 40, systemQty: 22, countedQty: 0, diffQty: -22, remark: '尚未应用的实盘', receiptBatch: { batchNo: 'SAVED' }, sku: { product: { name: '管理标签', subtitle: '测试商品' } } },
      { id: 2, skuId: 41, systemQty: 0, countedQty: null, diffQty: 0, remark: null, receiptBatch: null, sku: { product: { name: '另一个商品' } } }
    ] }
  const user = { userType: 'warehouse', tenantId: 7, brandAccess: [{ brandId: 3 }] }
  const mutation = () => jest.fn(() => { throw new Error('Cancellation must not mutate physical inventory') })
  const db = { user: { findUnique: jest.fn().mockResolvedValue(user) },
    stocktake: { findUnique: jest.fn(async () => structuredClone(document)), updateMany: jest.fn(async ({ where, data }) => {
      if (document.status !== where.status) return { count: 0 }
      Object.assign(document, data)
      return { count: 1 }
    }) },
    productSku: { count: jest.fn().mockResolvedValue(2), update: mutation(), updateMany: mutation() },
    stocktakeItem: { update: mutation(), deleteMany: mutation() }, stockBatch: { updateMany: mutation() },
    stockMovement: { create: mutation() }, $transaction: mutation() }
  const audit = { write: jest.fn().mockResolvedValue(undefined) }
  return { db, document, user, stock, audit, service: new InventoryService(db as any, audit as any) }
}

describe('STK-008 stocktake cancellation', () => {
  it('cancels a partially counted draft including zero without applying or deleting the saved counts', async () => {
    const f = cancelFixture(), beforeItems = structuredClone(f.document.items), beforeStock = structuredClone(f.stock)
    const result = await f.service.cancelStocktake(5, 9)
    expect(result).toMatchObject({ status: 'cancelled', reviewedBy: 9 })
    expect(f.document.items).toEqual(beforeItems)
    expect(f.stock).toEqual(beforeStock)
    expect(f.db.productSku.updateMany).not.toHaveBeenCalled()
    expect(f.db.stockMovement.create).not.toHaveBeenCalled()
    expect(f.db.stockBatch.updateMany).not.toHaveBeenCalled()
    expect(f.db.stocktakeItem.update).not.toHaveBeenCalled()
    expect(f.audit.write).toHaveBeenCalledTimes(1)
    expect(f.audit.write).toHaveBeenCalledWith(expect.objectContaining({ tenantId: 7, operatorId: 9, targetId: 5, afterData: { stocktakeNo: 'PD-FIXTURE', status: 'cancelled' } }))
  })

  it('refuses replay, further editing and completion after cancellation without another stock or audit write', async () => {
    const f = cancelFixture()
    await f.service.cancelStocktake(5, 9)
    await expect(f.service.cancelStocktake(5, 9)).rejects.toThrow('仅草稿盘点单可取消')
    const input = { items: [{ skuId: 40, countedQty: 0 }, { skuId: 41, countedQty: 0 }] }
    await expect(f.service.updateStocktakeItems(5, input, 9)).rejects.toThrow('仅草稿盘点单')
    await expect(f.service.completeStocktake(5, input, 9)).rejects.toThrow('仅草稿盘点单')
    expect(f.db.stocktake.updateMany).toHaveBeenCalledTimes(1)
    expect(f.db.$transaction).not.toHaveBeenCalled()
    expect(f.audit.write).toHaveBeenCalledTimes(1)
  })

  it.each(['completed', 'cancelled'])('does not alter an already %s stocktake', async status => {
    const f = cancelFixture(); f.document.status = status
    await expect(f.service.cancelStocktake(5, 9)).rejects.toThrow('仅草稿盘点单可取消')
    expect(f.db.stocktake.updateMany).not.toHaveBeenCalled()
    expect(f.audit.write).not.toHaveBeenCalled()
  })

  it('does not cancel or audit when a concurrent completion already won the conditional update', async () => {
    const f = cancelFixture()
    f.db.stocktake.updateMany.mockImplementationOnce(async () => { f.document.status = 'completed'; return { count: 0 } })
    await expect(f.service.cancelStocktake(5, 9)).rejects.toThrow('盘点单已变化')
    expect(f.document.status).toBe('completed')
    expect(f.audit.write).not.toHaveBeenCalled()
    expect(f.db.stockMovement.create).not.toHaveBeenCalled()
  })

  it.each(['foreign-tenant', 'unassigned-brand', 'customer-user'])('rejects a %s cancellation before any document mutation', async reason => {
    const f = cancelFixture()
    if (reason === 'foreign-tenant') f.document.tenantId = 8
    if (reason === 'unassigned-brand') f.db.productSku.count.mockResolvedValue(1)
    if (reason === 'customer-user') f.user.userType = 'customer_user'
    await expect(f.service.cancelStocktake(5, 9)).rejects.toBeInstanceOf(ForbiddenException)
    expect(f.db.stocktake.updateMany).not.toHaveBeenCalled()
    expect(f.audit.write).not.toHaveBeenCalled()
  })

  it('checks fresh staff eligibility at the cancellation controller before reaching the service', async () => {
    const inventory = { cancelStocktake: jest.fn() }, access = { actor: jest.fn().mockRejectedValue(new ForbiddenException('账号已停用')) }
    await expect(new InventoryController(inventory as any, access as any).cancelStocktake(5, { user: { sub: 9 } })).rejects.toBeInstanceOf(ForbiddenException)
    expect(inventory.cancelStocktake).not.toHaveBeenCalled()
  })
})

function legacyFixture(quantity = 22, reserved = 3) {
  const batches: any[] = []
  const sku = { id: 40, tenantId: 7, productId: 29, batchTracking: false, stockNum: quantity, reservedNum: reserved,
    lowStockThreshold: 10, leadTimeDays: 3, safetyStock: 0, specText: '袋', saleUnit: '袋', product: { name: '管理标签', subtitle: '测试商品' } }
  const tx = { $queryRaw: jest.fn().mockResolvedValue([{ id: sku.id }]),
    auditLog: { create: jest.fn().mockResolvedValue({ id: 1 }) },
    productSku: { findUnique: jest.fn(async () => structuredClone(sku)), update: jest.fn(async ({ data }) => Object.assign(sku, data)) },
    stockBatch: { create: jest.fn(async ({ data }) => { const row = { id: batches.length + 1, productionDate: null, expiryDate: null, ...data }; batches.push(row); return row }) } }
  const db = { $transaction: jest.fn(async (callback: any) => callback(tx)),
    productSku: { count: jest.fn().mockResolvedValue(1), findUnique: jest.fn(async () => structuredClone(sku)), findMany: jest.fn(async () => [{ ...sku, batches }]) },
    stockBatch: { count: jest.fn(async () => batches.length), findMany: jest.fn(async () => batches.map(row => ({ ...row, sku }))) } }
  const products = new ProductService(db as any, {} as any, {} as any, {} as any)
  const planning = new InventoryPlanningService(db as any, new StaffAccessService(db as any))
  const actor: StaffActor = { id: 9, tenantId: 7, userType: 'warehouse', superAdmin: false, permissions: new Set(['inventory:read']), brandIds: [3], customerIds: null, leadIds: null, fingerprint: 'legacy-fixture' }
  return { sku, batches, tx, db, products, planning, actor }
}

describe('BAT-006 enabling batch tracking for historical inventory', () => {
  it('seeds all physical inventory once as undated legacy stock and preserves reservations', async () => {
    const f = legacyFixture()
    await f.products.updateSku(40, { batchTracking: true })
    await f.products.updateSku(40, { batchTracking: true })
    expect(f.sku).toMatchObject({ batchTracking: true, stockNum: 22, reservedNum: 3 })
    expect(f.tx.stockBatch.create).toHaveBeenCalledTimes(1)
    expect(f.tx.stockBatch.create).toHaveBeenCalledWith({ data: { tenantId: 7, skuId: 40, batchNo: '__LEGACY__', quantity: 22 } })
    expect(f.tx.stockBatch.create.mock.calls[0][0].data).not.toHaveProperty('expiryDate')
    expect(f.tx.stockBatch.create.mock.calls[0][0].data).not.toHaveProperty('productionDate')
    expect(f.batches).toEqual([expect.objectContaining({ quantity: 22, expiryDate: null, productionDate: null })])
  })

  it('presents unknown dates without fabricating expiry, while availability still subtracts reservations', async () => {
    const f = legacyFixture()
    await f.products.updateSku(40, { batchTracking: true })
    const overview = await f.planning.overview(f.actor), batches = await f.planning.batches(f.actor, 40)
    expect(overview.items[0]).toMatchObject({ stockNum: 22, reservedNum: 3, availableNum: 19, unknownBatchQuantity: 22, expiredQuantity: 0 })
    expect(batches.items[0]).toMatchObject({ batchNo: '历史/未注明批次', state: '日期未知', productionDate: '', expiryDate: '', quantity: 22 })
  })

  it('does not create a fake zero-quantity historical lot when enabling an empty SKU', async () => {
    const f = legacyFixture(0, 0)
    await f.products.updateSku(40, { batchTracking: true })
    expect(f.sku.batchTracking).toBe(true)
    expect(f.tx.stockBatch.create).not.toHaveBeenCalled()
    expect((await f.planning.overview(f.actor)).items[0].unknownBatchQuantity).toBe(0)
  })

  it('cannot turn tracking back off after legacy stock is recorded', async () => {
    const f = legacyFixture()
    await f.products.updateSku(40, { batchTracking: true })
    await expect(f.products.updateSku(40, { batchTracking: false })).rejects.toThrow('不支持关闭')
    expect(f.sku.batchTracking).toBe(true)
    expect(f.batches[0].quantity).toBe(22)
  })
})
