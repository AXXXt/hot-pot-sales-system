import { randomUUID } from 'node:crypto'
import { PrismaClient } from '@prisma/client'
import { PrismaService } from '../src/prisma.service'
import { AuditService } from '../src/audit/audit.service'
import { StaffAccessService, StaffActor } from '../src/auth/staff-access.service'
import { ProductService } from '../src/product/product.service'
import { InventoryService } from '../src/inventory/inventory.service'
import { InventoryPlanningService } from '../src/inventory/inventory-planning.service'
import { businessDate } from '../src/inventory/stock-ledger'

// This suite is prepared for central serial execution only. Never fall back to DATABASE_URL.
const url = process.env.TEST_DATABASE_URL
if (!url) throw new Error('Isolated loopback TEST_DATABASE_URL ending in _test required')
const target = new URL(url)
if (target.protocol !== 'mysql:' || !['localhost', '127.0.0.1', '[::1]'].includes(target.hostname) || !target.pathname.endsWith('_test')) {
  throw new Error('Isolated loopback TEST_DATABASE_URL ending in _test required')
}
const db = new PrismaClient({ datasources: { db: { url } } })
let tenantId = -1, operatorId: number, skuId: number
let actor: StaffActor, inventory: InventoryService, products: ProductService, planning: InventoryPlanningService
const future = () => new Date(businessDate().getTime() + 60 * 86400000).toISOString().slice(0, 10)

beforeAll(async () => {
  tenantId = (await db.tenant.create({ data: { code: randomUUID(), name: 'Cancel and legacy inventory integration' } })).id
  operatorId = (await db.user.create({ data: { tenantId, userType: 'super_admin', name: 'Isolated inventory operator', phone: 'il-' + randomUUID().slice(0, 16) } })).id
  const brand = await db.brand.create({ data: { tenantId, code: 'LEGACY', name: 'Isolated batch brand' } })
  const product = await db.product.create({ data: { tenantId, brandId: brand.id, code: 'LEGACY-001', name: '管理标签', subtitle: '隔离未知批次商品' } })
  skuId = (await db.productSku.create({ data: { tenantId, productId: product.id, skuCode: 'LEGACY-001-01', specText: '500克/袋', saleUnit: '袋', minOrderQty: 1, basePrice: '10', stockNum: 22, reservedNum: 3 } })).id
  const prisma = db as unknown as PrismaService, access = new StaffAccessService(prisma), audit = new AuditService(prisma)
  actor = await access.actor(operatorId)
  inventory = new InventoryService(prisma, audit)
  products = new ProductService(prisma, {} as any, {} as any, audit)
  planning = new InventoryPlanningService(prisma, access)
})

beforeEach(async () => {
  for (const model of ['auditLog', 'stockMovement', 'stockAdjustment', 'stocktakeItem', 'stocktake', 'stockBatch'] as const) await (db[model] as any).deleteMany({ where: { tenantId } })
  await db.productSku.update({ where: { id: skuId }, data: { stockNum: 22, reservedNum: 3, batchTracking: false } })
})

afterAll(async () => {
  if (tenantId > 0) {
    for (const model of ['auditLog', 'stockMovement', 'stockAdjustment', 'stocktakeItem', 'stocktake', 'stockBatch', 'productSku', 'product', 'brand', 'user'] as const) await (db[model] as any).deleteMany({ where: { tenantId } })
    await db.tenant.delete({ where: { id: tenantId } })
  }
  await db.$disconnect()
})

it('cancels saved zero counts without changing stock, reservations or lots, and blocks replay/edit/complete', async () => {
  const take = await inventory.createStocktake({ skuIds: [skuId] }, operatorId)
  await inventory.updateStocktakeItems(take.id, { items: [{ skuId, countedQty: 0, remark: '尚未应用的盘点' }] }, operatorId)
  const saved = await db.stocktakeItem.findMany({ where: { stocktakeId: take.id } })
  await inventory.cancelStocktake(take.id, operatorId)
  expect(await db.stocktake.findUniqueOrThrow({ where: { id: take.id } })).toMatchObject({ status: 'cancelled', reviewedBy: operatorId })
  expect(await db.stocktakeItem.findMany({ where: { stocktakeId: take.id } })).toEqual(saved)
  expect(await db.productSku.findUniqueOrThrow({ where: { id: skuId } })).toMatchObject({ stockNum: 22, reservedNum: 3 })
  expect(await db.stockMovement.count({ where: { tenantId } })).toBe(0)
  expect(await db.stockBatch.count({ where: { tenantId } })).toBe(0)
  await expect(inventory.cancelStocktake(take.id, operatorId)).rejects.toThrow('仅草稿盘点单')
  const input = { items: [{ skuId, countedQty: 22 }] }
  await expect(inventory.updateStocktakeItems(take.id, input, operatorId)).rejects.toThrow('仅草稿盘点单')
  await expect(inventory.completeStocktake(take.id, input, operatorId)).rejects.toThrow('仅草稿盘点单')
  const audits = await db.auditLog.findMany({ where: { tenantId, targetType: 'stocktake', targetId: String(take.id) } })
  expect(audits.filter(row => (row.afterData as any)?.status === 'cancelled')).toHaveLength(1)
})

it('allows exactly one terminal transition when cancel and complete read the same draft snapshot', async () => {
  const take = await inventory.createStocktake({ skuIds: [skuId] }, operatorId)
  let reads = 0, release!: () => void
  const ready = new Promise<void>(resolve => { release = resolve })
  const delegate = new Proxy(db.stocktake, { get(original, key) {
    if (key !== 'findUnique') return Reflect.get(original, key)
    return async (args: any) => {
      const row = await db.stocktake.findUnique(args)
      if (args.where.id === take.id && args.include?.items === true) {
        if (++reads === 2) release()
        let timer: ReturnType<typeof setTimeout> | undefined
        try { await Promise.race([ready, new Promise<never>((_, reject) => { timer = setTimeout(() => reject(new Error('stocktake read barrier timed out')), 5000) })]) }
        finally { if (timer) clearTimeout(timer) }
      }
      return row
    }
  } })
  const client = new Proxy(db, { get(original, key) {
    if (key === 'stocktake') return delegate
    const value = Reflect.get(original, key)
    return typeof value === 'function' ? value.bind(original) : value
  } })
  const service = new InventoryService(client as unknown as PrismaService, new AuditService(db as unknown as PrismaService))
  const results = await Promise.allSettled([
    service.cancelStocktake(take.id, operatorId),
    service.completeStocktake(take.id, { items: [{ skuId, countedQty: 22 }] }, operatorId)
  ])
  expect(reads).toBe(2)
  expect(results.filter(row => row.status === 'fulfilled')).toHaveLength(1)
  const rejected = results.find(row => row.status === 'rejected') as PromiseRejectedResult
  expect(rejected.reason.message).toMatch(/盘点单已变化|仅草稿盘点单/)
  expect(['cancelled', 'completed']).toContain((await db.stocktake.findUniqueOrThrow({ where: { id: take.id } })).status)
  expect(await db.productSku.findUniqueOrThrow({ where: { id: skuId } })).toMatchObject({ stockNum: 22, reservedNum: 3 })
  expect(await db.stockMovement.count({ where: { tenantId } })).toBe(0)
  expect(await db.auditLog.count({ where: { tenantId, targetType: 'stocktake', targetId: String(take.id) } })).toBe(2)
})

it('enables historical stock once across concurrent edits, then receives only dated new stock and rolls back missing dates', async () => {
  await Promise.all([products.updateSku(skuId, { batchTracking: true }), products.updateSku(skuId, { batchTracking: true })])
  await products.updateSku(skuId, { batchTracking: true })
  expect(await db.productSku.findUniqueOrThrow({ where: { id: skuId } })).toMatchObject({ batchTracking: true, stockNum: 22, reservedNum: 3 })
  const rows = await db.stockBatch.findMany({ where: { tenantId, skuId } })
  expect(rows).toHaveLength(1)
  expect(rows[0]).toMatchObject({ batchNo: '__LEGACY__', quantity: 22, productionDate: null, expiryDate: null })
  expect((await planning.overview(actor)).items[0]).toMatchObject({ unknownBatchQuantity: 22, availableNum: 19, expiredQuantity: 0 })
  expect((await planning.batches(actor, skuId)).items[0]).toMatchObject({ state: '日期未知', productionDate: '', expiryDate: '' })
  await inventory.createAdjustment({ type: 'manual_in', items: [{ skuId, quantity: 5, batchNo: 'NEW-DATED', expiryDate: future() }] }, operatorId)
  const before = await db.stockBatch.findMany({ where: { tenantId, skuId }, orderBy: { id: 'asc' } })
  expect(before.map(row => row.quantity)).toEqual([22, 5])
  await expect(inventory.createAdjustment({ type: 'manual_in', items: [{ skuId, quantity: 1 }] }, operatorId)).rejects.toThrow('须填写批次号和到期日期')
  expect(await db.productSku.findUniqueOrThrow({ where: { id: skuId } })).toMatchObject({ stockNum: 27, reservedNum: 3 })
  expect(await db.stockBatch.findMany({ where: { tenantId, skuId }, orderBy: { id: 'asc' } })).toEqual(before)
  expect(await db.stockMovement.count({ where: { tenantId } })).toBe(1)
  expect(await db.stockAdjustment.count({ where: { tenantId } })).toBe(1)
})

it('does not fabricate a zero legacy lot or permit disabling traceability after enabling an empty SKU', async () => {
  await db.productSku.update({ where: { id: skuId }, data: { stockNum: 0, reservedNum: 0 } })
  await products.updateSku(skuId, { batchTracking: true })
  expect(await db.stockBatch.count({ where: { tenantId, skuId } })).toBe(0)
  await expect(products.updateSku(skuId, { batchTracking: false })).rejects.toThrow('不支持关闭')
  expect(await db.productSku.findUniqueOrThrow({ where: { id: skuId } })).toMatchObject({ batchTracking: true, stockNum: 0, reservedNum: 0 })
})
