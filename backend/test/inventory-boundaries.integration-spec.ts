import { AuthSessionService } from '../src/auth/auth-session.service'
import { randomUUID } from 'node:crypto'
import { INestApplication, ValidationPipe } from '@nestjs/common'
import { ConfigService } from '@nestjs/config'
import { Test } from '@nestjs/testing'
import { JwtService } from '@nestjs/jwt'
import { PrismaClient } from '@prisma/client'
import request from 'supertest'
import { PrismaService } from '../src/prisma.service'
import { AuditService } from '../src/audit/audit.service'
import { StaffAccessService, StaffActor } from '../src/auth/staff-access.service'
import { InventoryController } from '../src/inventory/inventory.controller'
import { InventoryService } from '../src/inventory/inventory.service'
import { InventoryPlanningController } from '../src/inventory/inventory-planning.controller'
import { InventoryPlanningService } from '../src/inventory/inventory-planning.service'
import { businessDate, changeStock, reserveOrder } from '../src/inventory/stock-ledger'
import { SuccessInterceptor } from '../src/success.interceptor'
import { AppFilter } from '../src/app.filter'

// No fallback to DATABASE_URL: these tests write and remove only their own isolated tenants.
const url = process.env.TEST_DATABASE_URL
if (!url || !new URL(url).pathname.endsWith('_test')) throw new Error('Isolated TEST_DATABASE_URL ending in _test required')
const db = new PrismaClient({ datasources: { db: { url } } })
const tenants: number[] = [], skus: number[] = [], brands: number[] = [], createdPermissions: number[] = []
const secret = randomUUID(), jwt = new JwtService({ secret })
const date = (offset: number) => new Date(businessDate().getTime() + offset * 86400000)
const dateText = (offset: number) => date(offset).toISOString().slice(0, 10)
let app: INestApplication, inventory: InventoryService, planning: InventoryPlanningService, access: StaffAccessService
let actor: StaffActor, owner: number, warehouseId: number, warehouse: string, buyer: string, admin: string, customerId: number
const get = (path: string, token = warehouse) => request(app.getHttpServer()).get('/api/v1/inventory/' + path).set('Authorization', 'Bearer ' + token)
const post = (path: string, body: object, token = warehouse) => request(app.getHttpServer()).post('/api/v1/inventory/' + path).set('Authorization', 'Bearer ' + token).send(body)

async function seedStock(index: number, quantity: number, reservedNum = 0, tracked = false) {
  await db.stockBatch.deleteMany({ where: { skuId: skus[index] } })
  return db.productSku.update({ where: { id: skus[index] }, data: { stockNum: quantity, reservedNum, batchTracking: tracked } })
}
async function batch(index: number, batchNo: string, quantity: number, expiryDate: Date | null) {
  return db.stockBatch.create({ data: { tenantId: index === 3 ? tenants[1] : tenants[0], skuId: skus[index], batchNo, quantity, expiryDate } })
}
async function makeOrder() {
  return db.order.create({ data: { tenantId: tenants[0], customerId, brandId: brands[0], orderNo: randomUUID(), totalAmount: '10', payableAmount: '10' } })
}

beforeAll(async () => {
  for (let i = 0; i < 2; i++) tenants.push((await db.tenant.create({ data: { code: randomUUID(), name: 'Inventory boundary integration' } })).id)
  const tenantId = tenants[0]
  owner = (await db.user.create({ data: { tenantId, userType: 'super_admin', name: 'Inventory administrator', phone: 'ib-' + randomUUID().slice(0, 14) } })).id
  warehouseId = (await db.user.create({ data: { tenantId, userType: 'warehouse', name: 'Scoped warehouse', phone: 'ib-' + randomUUID().slice(0, 14) } })).id
  customerId = (await db.customer.create({ data: { tenantId, customerName: 'Boundary customer', status: 'active' } })).id
  const buyerId = (await db.user.create({ data: { tenantId, customerId, userType: 'customer_user', name: 'Buyer', phone: 'ib-' + randomUUID().slice(0, 14) } })).id
  admin = jwt.sign({ sub: owner, tenantId }); warehouse = jwt.sign({ sub: warehouseId, tenantId }); buyer = jwt.sign({ sub: buyerId, tenantId })
  const role = await db.role.create({ data: { tenantId, code: 'inventory-boundaries', name: 'Inventory boundary role' } })
  await db.userRole.create({ data: { tenantId, userId: warehouseId, roleId: role.id } })
  for (const code of ['inventory:read', 'inventory:adjust']) {
    let permission = await db.permission.findUnique({ where: { code } })
    if (!permission) { permission = await db.permission.create({ data: { code, name: code, type: 'api' } }); createdPermissions.push(permission.id) }
    await db.rolePermission.create({ data: { tenantId, roleId: role.id, permissionId: permission.id } })
  }
  for (let i = 0; i < 3; i++) {
    const rowTenant = i === 2 ? tenants[1] : tenantId
    const brand = await db.brand.create({ data: { tenantId: rowTenant, code: 'IB' + i, name: 'Boundary brand ' + i } }); brands.push(brand.id)
    const product = await db.product.create({ data: { tenantId: rowTenant, brandId: brand.id, code: 'IB' + i + '-001', name: 'Inventory management label', subtitle: 'Inventory real name ' + i } })
    for (let j = 0; j < (i === 0 ? 2 : 1); j++) {
      skus.push((await db.productSku.create({ data: { tenantId: rowTenant, productId: product.id, skuCode: 'IB' + i + '-001-0' + (j + 1), specText: j ? '500克/袋' : '200克/袋', saleUnit: '袋', basePrice: '10', minOrderQty: 1 } })).id)
    }
  }
  await db.userBrandAccess.create({ data: { tenantId, userId: warehouseId, brandId: brands[0] } })
  const module = await Test.createTestingModule({ controllers: [InventoryController, InventoryPlanningController], providers: [
      // Business fixture: session revocation itself is covered by auth-session.integration-spec.ts.
      { provide: AuthSessionService, useValue: { assertActive: async () => {} } },
    InventoryService, InventoryPlanningService, StaffAccessService,
    { provide: PrismaService, useValue: db }, { provide: JwtService, useValue: jwt },
    { provide: ConfigService, useValue: new ConfigService({ JWT_ACCESS_SECRET: secret }) },
    { provide: AuditService, useValue: { write: async () => {} } }
  ] }).compile()
  app = module.createNestApplication()
  app.setGlobalPrefix('api/v1'); app.useGlobalPipes(new ValidationPipe({ transform: true, whitelist: true, forbidNonWhitelisted: true }))
  app.useGlobalInterceptors(new SuccessInterceptor()); app.useGlobalFilters(new AppFilter()); await app.init()
  inventory = app.get(InventoryService); planning = app.get(InventoryPlanningService); access = app.get(StaffAccessService); actor = await access.actor(owner)
})

beforeEach(async () => {
  const where = { tenantId: { in: tenants } }
  for (const model of ['auditLog', 'stockMovement', 'stockAdjustment', 'stockBatch', 'stocktakeItem', 'stocktake', 'replenishmentPlan', 'orderItem', 'order'] as const) await (db[model] as any).deleteMany({ where })
  for (let i = 0; i < skus.length; i++) await seedStock(i, 0)
})

afterAll(async () => {
  if (app) await app.close()
  const where = { tenantId: { in: tenants } }
  for (const model of ['auditLog', 'stockMovement', 'stockAdjustment', 'stockBatch', 'stocktakeItem', 'stocktake', 'replenishmentPlan', 'orderItem', 'order', 'userBrandAccess', 'userRole', 'rolePermission', 'role', 'productSku', 'product', 'brand', 'user', 'customer'] as const) await (db[model] as any).deleteMany({ where })
  await db.permission.deleteMany({ where: { id: { in: createdPermissions } } })
  await db.tenant.deleteMany({ where: { id: { in: tenants } } }); await db.$disconnect()
})

it('keeps inventory, planning and expiry totals consistent without leaking foreign or unassigned brands', async () => {
  await seedStock(0, 22, 3, true); await batch(0, 'EXPIRED', 5, date(0)); await batch(0, 'GOOD', 17, date(60))
  for (const index of [2, 3]) { await seedStock(index, 5, 0, true); await batch(index, 'PRIVATE', 5, date(60)) }
  const stock = (await get('stock').expect(200)).body.data.items
  expect(stock.map((x: any) => x.skuId)).toEqual(skus.slice(0, 2))
  expect(stock[0]).toMatchObject({ stockNum: 22, reservedNum: 3, availableNum: 14 })
  const overview = (await get('planning').expect(200)).body.data
  expect(overview.items[0]).toMatchObject({ stockNum: 22, availableNum: 14, expiredQuantity: 5, sold28: null, pendingDemand: null })
  expect(overview.canForecast).toBe(false)
  for (const index of [2, 3]) expect((await get('batches?skuId=' + skus[index]).expect(200)).body.data.items).toEqual([])
  await get('planning', buyer).expect(403)
})

it('uses FEFO for sales, leaves expiry and unknown dates last, and restores the exact allocated lots', async () => {
  const sku = await seedStock(0, 22, 0, true)
  const unknown = await batch(0, '__LEGACY__', 3, null), later = await batch(0, 'LATER', 8, date(60)), early = await batch(0, 'EARLY', 7, date(10)), expired = await batch(0, 'EXPIRED', 4, date(0))
  const allocations = await db.$transaction(tx => changeStock(tx, sku, 6, { orderOut: true }))
  expect(allocations).toEqual([{ batchId: early.id, batchNo: 'EARLY', quantity: 7 }, { batchId: later.id, batchNo: 'LATER', quantity: 8 }, { batchId: unknown.id, batchNo: '__LEGACY__', quantity: 1 }])
  expect((await db.stockBatch.findUniqueOrThrow({ where: { id: expired.id } })).quantity).toBe(4)
  const after = await db.productSku.findUniqueOrThrow({ where: { id: sku.id } })
  await db.$transaction(tx => changeStock(tx, after, 22, { restore: allocations }))
  const restored = await db.stockBatch.findMany({ where: { skuId: sku.id }, orderBy: { id: 'asc' } })
  expect(restored.map(x => x.quantity)).toEqual([3, 8, 7, 4])
  expect((await db.productSku.findUniqueOrThrow({ where: { id: sku.id } })).stockNum).toBe(22)
})

it('rolls back total stock and every partially allocated lot when non-expired stock is insufficient', async () => {
  const sku = await seedStock(0, 10, 0, true)
  await batch(0, 'EXPIRED', 4, date(-1)); await batch(0, 'GOOD', 6, date(60))
  await expect(db.$transaction(tx => changeStock(tx, sku, 3, { orderOut: true }))).rejects.toThrow('到期')
  expect((await db.productSku.findUniqueOrThrow({ where: { id: sku.id } })).stockNum).toBe(10)
  expect((await db.stockBatch.findMany({ where: { skuId: sku.id }, orderBy: { id: 'asc' } })).map(x => x.quantity)).toEqual([4, 6])
  await db.$transaction(tx => changeStock(tx, sku, 6, { receipt: { batchNo: 'EXPIRED' } }))
  expect((await db.stockBatch.findFirstOrThrow({ where: { skuId: sku.id, batchNo: 'EXPIRED' } })).quantity).toBe(0)
})

it('assigns unknown dates without changing total stock, validates dates and protects warehouse brand scope', async () => {
  await seedStock(0, 10, 0, true)
  const unknown = await batch(0, '__LEGACY__', 10, null)
  await post('batches/assign', { fromBatchId: unknown.id, quantity: 4, batchNo: 'KNOWN', expiryDate: dateText(60) }).expect(201)
  expect((await db.productSku.findUniqueOrThrow({ where: { id: skus[0] } })).stockNum).toBe(10)
  expect((await db.stockBatch.findMany({ where: { skuId: skus[0] }, orderBy: { id: 'asc' } })).map(x => x.quantity)).toEqual([6, 4])
  await post('batches/assign', { fromBatchId: unknown.id, quantity: 1, batchNo: 'KNOWN', expiryDate: dateText(61) }).expect(409)
  await post('batches/assign', { fromBatchId: unknown.id, quantity: 1, batchNo: 'BAD', expiryDate: '2027-02-29' }).expect(400)
  await seedStock(2, 3, 0, true)
  const privateBatch = await batch(2, '__LEGACY__', 3, null)
  await post('batches/assign', { fromBatchId: privateBatch.id, quantity: 1, batchNo: 'PRIVATE', expiryDate: dateText(60) }).expect(404)
  expect((await db.stockBatch.findUniqueOrThrow({ where: { id: privateBatch.id } })).quantity).toBe(3)
  expect(await db.stockMovement.count({ where: { tenantId: actor.tenantId, type: 'batch_assign' } })).toBe(1)
})

it('saves partial counts including zero, completes every row once and rejects replay without new stock movements', async () => {
  await seedStock(0, 5); await seedStock(1, 8)
  const take = (await post('stocktakes', { skuIds: skus.slice(0, 2) }).expect(201)).body.data
  const saved = await request(app.getHttpServer()).patch(`/api/v1/inventory/stocktakes/${take.id}/items`).set('Authorization', 'Bearer ' + warehouse).send({ items: [{ skuId: skus[0], countedQty: 0 }] }).expect(200)
  expect(saved.body.data.items.map((x: any) => x.countedQty)).toEqual([0, null])
  expect((await db.productSku.findUniqueOrThrow({ where: { id: skus[0] } })).stockNum).toBe(5)
  await post(`stocktakes/${take.id}/complete`, { items: [{ skuId: skus[0], countedQty: 0 }] }).expect(400)
  const body = { items: [{ skuId: skus[0], countedQty: 0 }, { skuId: skus[1], countedQty: 9 }] }
  await post(`stocktakes/${take.id}/complete`, body).expect(201)
  expect((await db.productSku.findMany({ where: { id: { in: skus.slice(0, 2) } }, orderBy: { id: 'asc' } })).map(x => x.stockNum)).toEqual([0, 9])
  expect(await db.stockMovement.count({ where: { sourceType: 'stocktake', sourceId: take.id } })).toBe(2)
  await post(`stocktakes/${take.id}/complete`, body).expect(400)
  expect(await db.stockMovement.count({ where: { sourceType: 'stocktake', sourceId: take.id } })).toBe(2)
})

it('rolls back an earlier stocktake row when a later count would consume another order reservation', async () => {
  await seedStock(0, 5); await seedStock(1, 8, 6)
  const take = await inventory.createStocktake({ skuIds: skus.slice(0, 2) }, owner)
  await expect(inventory.completeStocktake(take.id, { items: [{ skuId: skus[0], countedQty: 6 }, { skuId: skus[1], countedQty: 5 }] }, owner)).rejects.toThrow('预占')
  expect((await db.productSku.findMany({ where: { id: { in: skus.slice(0, 2) } }, orderBy: { id: 'asc' } })).map(x => x.stockNum)).toEqual([5, 8])
  expect(await db.stockMovement.count({ where: { sourceType: 'stocktake', sourceId: take.id } })).toBe(0)
  expect((await db.stocktake.findUniqueOrThrow({ where: { id: take.id } })).status).toBe('draft')
  expect((await db.stocktakeItem.findMany({ where: { stocktakeId: take.id } })).map(x => x.countedQty)).toEqual([null, null])
})

it('prevents overlapping reservations, does not reserve expired stock and cannot release twice', async () => {
  await seedStock(0, 10, 0, true); await batch(0, 'EXPIRED', 4, date(0)); await batch(0, 'GOOD', 6, date(60))
  const first = await makeOrder(), second = await makeOrder()
  const attempts = await Promise.allSettled([first, second].map(order => db.$transaction(tx => reserveOrder(tx, order, [{ skuId: skus[0], quantity: 4 }]))))
  expect(attempts.filter(x => x.status === 'fulfilled')).toHaveLength(1)
  const held = await db.order.findFirstOrThrow({ where: { id: { in: [first.id, second.id] }, stockReserved: true } })
  expect((await db.productSku.findUniqueOrThrow({ where: { id: skus[0] } })).reservedNum).toBe(4)
  await db.$transaction(tx => reserveOrder(tx, held, [{ skuId: skus[0], quantity: 4 }], true))
  await expect(db.$transaction(tx => reserveOrder(tx, held, [{ skuId: skus[0], quantity: 4 }], true))).rejects.toThrow('预占数量不一致')
  expect((await db.productSku.findUniqueOrThrow({ where: { id: skus[0] } })).reservedNum).toBe(0)
})

it('deduplicates simultaneous replenishment requests, preserves stock and rejects stale status changes', async () => {
  await seedStock(0, 10)
  const input = { requestId: randomUUID(), items: [{ skuId: skus[0], quantity: 30 }] }
  const results = await Promise.all(Array.from({ length: 4 }, () => planning.createPlan(actor, input)))
  expect(new Set(results.map(x => x.id)).size).toBe(1)
  const plan = results[0]
  expect(await db.replenishmentPlan.count({ where: { planNo: 'RP' + input.requestId } })).toBe(1)
  expect(await db.auditLog.count({ where: { tenantId: actor.tenantId, targetType: 'replenishment_plan', action: 'create' } })).toBe(1)
  await planning.updatePlan(actor, plan.id, 'ordered', plan.updatedAt.toISOString())
  await expect(planning.updatePlan(actor, plan.id, 'closed', plan.updatedAt.toISOString())).rejects.toThrow('变化')
  expect((await db.productSku.findUniqueOrThrow({ where: { id: skus[0] } })).stockNum).toBe(10)
  await post('replenishment-plans', { requestId: randomUUID(), items: [{ skuId: skus[2], quantity: 1 }] }).expect(400)
  await get('stock', admin).expect(200)
})

it('honors the manual minimum while forecasting only recent completed non-sample demand', async () => {
  await seedStock(0, 50)
  const sku = await db.productSku.update({ where: { id: skus[0] }, data: { lowStockThreshold: 100, leadTimeDays: 1, safetyStock: 3 } })
  for (const item of [
    { quantity: 1, status: 'completed' as const, sampleFlag: false, daysAgo: 1 },
    { quantity: 1000, status: 'draft' as const, sampleFlag: false, daysAgo: 1 },
    { quantity: 1000, status: 'completed' as const, sampleFlag: true, daysAgo: 1 },
    { quantity: 1000, status: 'completed' as const, sampleFlag: false, daysAgo: 29 },
    { quantity: 1000, status: 'completed' as const, sampleFlag: false, daysAgo: -1 }
  ]) {
    await db.order.create({ data: { tenantId: actor.tenantId, customerId, brandId: brands[0], orderNo: randomUUID(), totalAmount: '10', payableAmount: '10',
      status: item.status, sampleFlag: item.sampleFlag, createdAt: new Date(Date.now() - item.daysAgo * 86400000),
      items: { create: { tenantId: actor.tenantId, skuId: sku.id, productId: sku.productId, productName: 'Forecast test', skuSpecText: sku.specText, saleUnit: sku.saleUnit, quantity: item.quantity, unitPrice: '10', amount: '10', priceSource: 'base' } } } })
  }
  const view = (await planning.overview(actor)).items.find(x => x.skuId === sku.id)
  expect(view).toMatchObject({ availableNum: 50, sold28: 1, threshold: 100, lowStock: true, suggestedQuantity: 50 })
})

it('rejects warehouse writes and existing stocktake changes after the assigned brand is disabled', async () => {
  await seedStock(0, 10)
  const take = await inventory.createStocktake({ skuIds: [skus[0]] }, warehouseId)
  await db.brand.update({ where: { id: brands[0] }, data: { status: 'disabled' } })
  try {
    expect((await get('stock').expect(200)).body.data.items).toEqual([])
    await post('adjustments', { type: 'manual_in', items: [{ skuId: skus[0], quantity: 1 }] }).expect(403)
    await post(`stocktakes/${take.id}/complete`, { items: [{ skuId: skus[0], countedQty: 11 }] }).expect(403)
    expect((await db.productSku.findUniqueOrThrow({ where: { id: skus[0] } })).stockNum).toBe(10)
    expect((await db.stocktake.findUniqueOrThrow({ where: { id: take.id } })).status).toBe('draft')
  } finally { await db.brand.update({ where: { id: brands[0] }, data: { status: 'active' } }) }
})

it('rejects warehouse mutations after its tenant is disabled even while the old JWT remains valid', async () => {
  await seedStock(0, 10)
  await db.tenant.update({ where: { id: tenants[0] }, data: { status: 'disabled' } })
  try {
    await get('stock').expect(403)
    await post('adjustments', { type: 'manual_in', items: [{ skuId: skus[0], quantity: 1 }] }).expect(403)
    await post('stocktakes', { skuIds: [skus[0]] }).expect(403)
    expect((await db.productSku.findUniqueOrThrow({ where: { id: skus[0] } })).stockNum).toBe(10)
    expect(await db.stockAdjustment.count({ where: { tenantId: tenants[0] } })).toBe(0)
  } finally { await db.tenant.update({ where: { id: tenants[0] }, data: { status: 'active' } }) }
})
