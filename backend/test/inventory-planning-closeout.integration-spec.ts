import { randomUUID } from 'node:crypto'
import { ConfigService } from '@nestjs/config'
import { PrismaClient } from '@prisma/client'
import { PrismaService } from '../src/prisma.service'
import { StaffAccessService, StaffActor } from '../src/auth/staff-access.service'
import { InventoryPlanningService } from '../src/inventory/inventory-planning.service'
import { AiDraftService } from '../src/ai/ai-draft.service'
import { AiSettingsService } from '../src/ai/ai-settings.service'
import { AiInventoryService } from '../src/ai/ai-inventory.service'
import { AiWorkflowsService } from '../src/ai/ai-workflows.service'
import { ProductService } from '../src/product/product.service'
import { ProductVisibilityService } from '../src/product/product-visibility.service'
import { DashboardService } from '../src/dashboard/dashboard.service'

const target = new URL(process.env.TEST_DATABASE_URL || 'invalid://missing')
if (target.protocol !== 'mysql:' || !['127.0.0.1', 'localhost', '[::1]'].includes(target.hostname) || !target.pathname.endsWith('_test')) throw Error('Loopback mysql *_test database required')
const db = new PrismaClient({ datasources: { db: { url: process.env.TEST_DATABASE_URL } } }), tenants: number[] = [], createdPermissions: number[] = []
let actor: StaffActor, owner: StaffActor, planning: InventoryPlanningService, drafts: AiDraftService, skuIds: number[], brandId: number, categoryId: number, conversationId: string

beforeAll(async () => {
  for (let i = 0; i < 2; i++) tenants.push((await db.tenant.create({ data: { code: randomUUID(), name: 'Local planning completeness fixture' } })).id)
  const user = await db.user.create({ data: { tenantId: tenants[0], phone: randomUUID().slice(0, 20), name: 'Local warehouse fixture', userType: 'warehouse' } })
  const admin = await db.user.create({ data: { tenantId: tenants[0], phone: randomUUID().slice(0, 20), name: 'Local AI fixture', userType: 'super_admin' } })
  const role = await db.role.create({ data: { tenantId: tenants[0], code: randomUUID(), name: 'Local stock permissions' } })
  await db.userRole.create({ data: { tenantId: tenants[0], userId: user.id, roleId: role.id } })
  for (const code of ['inventory:read', 'inventory:adjust']) {
    let permission = await db.permission.findUnique({ where: { code } })
    if (!permission) { permission = await db.permission.create({ data: { code, name: code, type: 'api' } }); createdPermissions.push(permission.id) }
    await db.rolePermission.create({ data: { tenantId: tenants[0], roleId: role.id, permissionId: permission.id } })
  }
  brandId = (await db.brand.create({ data: { tenantId: tenants[0], name: 'Local permitted brand', code: 'PLAN' } })).id
  categoryId = (await db.productCategory.create({ data: { tenantId: tenants[0], name: '测试分类', code: 'PLAN' } })).id
  await db.userBrandAccess.create({ data: { tenantId: tenants[0], userId: user.id, brandId } })
  const product = await db.product.create({ data: { tenantId: tenants[0], brandId, categoryId, code: 'PLAN-001', name: '管理标签', subtitle: 'Local planning product' } })
  await db.productSku.createMany({ data: Array.from({ length: 501 }, (_, index) => ({ tenantId: tenants[0], productId: product.id, skuCode: `PLAN-${String(index).padStart(4, '0')}`, specText: `${index}袋`, saleUnit: '袋', basePrice: '1', stockNum: 20, minOrderQty: 1 })) })
  skuIds = (await db.productSku.findMany({ where: { productId: product.id }, orderBy: { id: 'asc' }, select: { id: true } })).map(sku => sku.id)
  for (const [tenantId, code] of [[tenants[0], 'HIDDEN'], [tenants[1], 'FOREIGN']] as const) {
    const brand = await db.brand.create({ data: { tenantId, code, name: code } })
    const hidden = await db.product.create({ data: { tenantId, brandId: brand.id, name: code, code } })
    await db.productSku.create({ data: { tenantId, productId: hidden.id, skuCode: code, specText: '袋', saleUnit: '袋', basePrice: '1', stockNum: 9, minOrderQty: 1 } })
  }
  await db.productSku.update({ where: { id: skuIds[500] }, data: { stockNum: 501, batchTracking: true } })
  await db.stockBatch.createMany({ data: Array.from({ length: 501 }, (_, index) => ({ tenantId: tenants[0], skuId: skuIds[500], batchNo: `LOCAL-${index}`, quantity: 1, expiryDate: new Date('2035-01-01T00:00:00Z') })) })
  const prisma = db as unknown as PrismaService, access = new StaffAccessService(prisma)
  actor = await access.actor(user.id); owner = await access.actor(admin.id); planning = new InventoryPlanningService(prisma, access)
  const inventory = new AiInventoryService(prisma, access), workflows = new AiWorkflowsService(prisma, access, inventory, {} as any, {} as any)
  const products = new ProductService(prisma, {} as any, new ProductVisibilityService(prisma), {} as any)
  drafts = new AiDraftService(prisma, access, products, new AiSettingsService(prisma, new ConfigService(), access), inventory, workflows)
  await db.aiConfig.create({ data: { tenantId: tenants[0], enabled: true, allowWrites: true, features: { products: true, inventory: true } } })
  conversationId = (await db.aiConversation.create({ data: { tenantId: tenants[0], ownerId: owner.id, title: 'Local deterministic AI drafts', fingerprint: owner.fingerprint } })).id
}, 60000)

afterAll(async () => {
  const where = { tenantId: { in: tenants } }
  if (tenants.length) {
    for (const model of ['auditLog', 'stockMovement', 'stockAdjustment', 'stockBatch', 'replenishmentPlan', 'aiActionExecution', 'aiActionDraft', 'aiMessage', 'aiConversation', 'aiConfig', 'userBrandAccess', 'userRole', 'rolePermission', 'role', 'user', 'productSku', 'product', 'productCategory', 'brand'] as const) await (db[model] as any).deleteMany({ where })
    await db.tenant.deleteMany({ where: { id: { in: tenants } } })
  }
  if (createdPermissions.length) await db.permission.deleteMany({ where: { id: { in: createdPermissions } } })
  await db.$disconnect()
})

it('counts and paginates all 501 permitted SKUs without truncating the last SKU or leaking hidden brands', async () => {
  const first = await planning.overview(actor), last = await planning.overview(actor, '', 2, 500)
  expect(first).toMatchObject({ total: 501, page: 1, pageSize: 500, hasMore: true, truncated: true })
  expect(first.items).toHaveLength(500)
  expect(last).toMatchObject({ total: 501, page: 2, hasMore: false, truncated: false })
  expect(last.items.map(sku => sku.skuId)).toEqual([skuIds[500]])
  await db.productSku.update({ where: { id: skuIds[500] }, data: { status: 'disabled' } })
  try { expect(await planning.overview(actor)).toMatchObject({ total: 500, hasMore: false, truncated: false }) }
  finally { await db.productSku.update({ where: { id: skuIds[500] }, data: { status: 'active' } }) }
  const found = await planning.overview(actor, 'PLAN-0500', 1, 100)
  expect(found.total).toBe(1); expect(found.items[0].skuId).toBe(skuIds[500])
  expect(await planning.overview(actor, 'FOREIGN')).toMatchObject({ total: 0, items: [] })
})

it('paginates 501 stock batches with true totals and rejects invalid page or SKU boundaries', async () => {
  const first = await planning.batches(actor, skuIds[500], 1, 500), last = await planning.batches(actor, skuIds[500], 2, 500)
  expect(first).toMatchObject({ total: 501, hasMore: true }); expect(first.items).toHaveLength(500)
  expect(last).toMatchObject({ total: 501, hasMore: false }); expect(last.items).toHaveLength(1)
  expect(new Set([...first.items, ...last.items].map(batch => batch.id)).size).toBe(501)
  for (const [page, size] of [[0, 1], [1, 501], [1, 0], [1.5, 10]]) await expect(planning.overview(actor, '', page, size)).rejects.toMatchObject({ status: 400 })
  await expect(planning.batches(actor, 0)).rejects.toMatchObject({ status: 400 })
})

it('keeps request contents immutable, advances plan state with fresh versions and never changes stock', async () => {
  const before = await db.productSku.findMany({ where: { id: { in: skuIds.slice(0, 2) } }, select: { id: true, stockNum: true, reservedNum: true } })
  const requestId = randomUUID(), input = { requestId, items: [{ skuId: skuIds[0], quantity: 5 }, { skuId: skuIds[1], quantity: 7 }] }
  const plan = await planning.createPlan(actor, input)
  expect((await planning.createPlan(actor, { ...input, items: [...input.items].reverse() })).id).toBe(plan.id)
  await expect(planning.createPlan(actor, { ...input, items: [{ skuId: skuIds[0], quantity: 9 }] })).rejects.toMatchObject({ status: 409 })
  await planning.updatePlan(actor, plan.id, 'ordered', plan.updatedAt.toISOString())
  await expect(planning.updatePlan(actor, plan.id, 'closed', plan.updatedAt.toISOString())).rejects.toMatchObject({ status: 409 })
  const ordered = await db.replenishmentPlan.findUniqueOrThrow({ where: { id: plan.id } })
  await planning.updatePlan(actor, plan.id, 'closed', ordered.updatedAt.toISOString())
  await expect(planning.updatePlan(actor, plan.id, 'ordered', ordered.updatedAt.toISOString())).rejects.toMatchObject({ status: 400 })
  const cancelled = await planning.createPlan(actor, { requestId: randomUUID(), items: [{ skuId: skuIds[0], quantity: 1 }] })
  await planning.updatePlan(actor, cancelled.id, 'cancelled', cancelled.updatedAt.toISOString())
  await expect(planning.updatePlan(actor, cancelled.id, 'ordered', cancelled.updatedAt.toISOString())).rejects.toMatchObject({ status: 400 })
  expect(await db.productSku.findMany({ where: { id: { in: skuIds.slice(0, 2) } }, select: { id: true, stockNum: true, reservedNum: true } })).toEqual(before)
})

it('continues beyond 100 replenishment plans while omitting revoked or malformed plan contents', async () => {
  const hidden = await db.productSku.findFirstOrThrow({ where: { tenantId: tenants[0], skuCode: 'HIDDEN' } })
  const prefix = `LOCAL-PAGE-${randomUUID()}`
  await db.replenishmentPlan.createMany({ data: Array.from({ length: 104 }, (_, index) => ({
    tenantId: tenants[0], ownerId: actor.id, planNo: `${prefix}-${index}`,
    payload: { items: [{ skuId: index === 103 ? hidden.id : skuIds[0], quantity: 1 }] }
  })) })
  await db.replenishmentPlan.create({ data: { tenantId: tenants[0], ownerId: actor.id, planNo: `${prefix}-malformed`, payload: { items: [] } } })
  try {
    const first = await planning.plans(actor, 1, 100), next = await planning.plans(actor, 2, 100)
    expect(first).toMatchObject({ page: 1, pageSize: 100, hasMore: true })
    expect(next).toMatchObject({ page: 2, pageSize: 100, hasMore: false })
    const all = [...first.items, ...next.items] as Array<{ id: number; planNo: string; payload: { items: Array<{ skuId: number }> } }>
    expect(all.filter(plan => plan.planNo.startsWith(prefix))).toHaveLength(103)
    expect(new Set(all.map(plan => plan.id)).size).toBe(all.length)
    expect(all.every(plan => plan.payload.items.every(item => item.skuId !== hidden.id))).toBe(true)
    expect(next.items.length).toBeGreaterThan(0)
  } finally { await db.replenishmentPlan.deleteMany({ where: { tenantId: tenants[0], planNo: { startsWith: prefix } } }) }
})

it('uses real SQL at the Shanghai day boundary and describes dashboard inventory as 500 scanned of 501 permitted SKUs', async () => {
  const tenantId = tenants[0], customer = await db.customer.create({ data: { tenantId, customerName: 'Local dashboard boundary', contactPhone: '13000000001' } })
  // Capture Shanghai's calendar date independently of the server/SQL session timezone.
  const day = new Date(new Date().getTime() + 8 * 3600_000).toISOString().slice(0, 10)
  const start = new Date(`${day}T00:00:00+08:00`), previous = new Date(start.getTime() - 1)
  const base = { tenantId, customerId: customer.id, brandId, totalAmount: '19.90', payableAmount: '19.90', paymentMethod: 'transfer' }
  const orders = []
  for (const [createdAt, status, sampleFlag] of [[start, 'completed', false], [previous, 'shipped', false], [start, 'cancelled', false], [start, 'completed', true]] as const) {
    orders.push(await db.order.create({ data: { ...base, orderNo: `LOCAL-DASH-${randomUUID()}`, createdAt, status, sampleFlag } }))
  }
  await db.productSku.update({ where: { id: skuIds[0] }, data: { reservedNum: 20 } })
  try {
    const dashboard = new DashboardService(db as unknown as PrismaService, planning)
    const result = await dashboard.getStats({ order: { tenantId, id: { in: orders.map(order => order.id) } }, product: { tenantId, brandId }, inventory: { tenantId, brandId }, customer: { tenantId, id: customer.id } }, actor)
    expect(result).toMatchObject({ todayOrders: 3, yesterdayOrders: 1, todayRevenue: 19.9, yesterdayRevenue: 19.9, inventoryScanned: 500, inventoryTotal: 501, inventoryTruncated: true })
    expect(result.trend[result.trend.length - 1]).toMatchObject({ date: day, orders: 1, revenue: 19.9 })
    expect(result.lowStockItems.find(sku => sku.id === skuIds[0])).toMatchObject({ availableQty: 0 })
    expect(result.lowStockItems.some(sku => sku.id === skuIds[500])).toBe(false)
  } finally {
    await db.productSku.update({ where: { id: skuIds[0] }, data: { reservedNum: 0 } })
    await db.order.deleteMany({ where: { tenantId, customerId: customer.id } })
    await db.customer.delete({ where: { id: customer.id } })
  }
})

it('rolls back a whole AI product bundle, nested SKUs and allocation when its audit cannot be saved, then confirms exactly once', async () => {
  const value = { brandId, categoryId, subtitle: 'Local AI rollback product', skus: [{ specText: '200克', saleUnit: '袋', basePrice: '9.90', minOrderQty: 1 }, { specText: '500克', saleUnit: '袋', basePrice: '19.90', minOrderQty: 1 }] }
  const draft = await drafts.create(owner, conversationId, 'product.create', value)
  const count = await db.product.count({ where: { tenantId: tenants[0] } }), skuCount = await db.productSku.count({ where: { tenantId: tenants[0] } })
  const sequence = (await db.productCategory.findUniqueOrThrow({ where: { id: categoryId } })).productSequence
  const realTransaction = db.$transaction.bind(db)
  const operation = jest.spyOn(db, '$transaction').mockImplementationOnce((async (callback: unknown, options: any) => realTransaction(async tx =>
    (callback as any)(new Proxy(tx, { get(target, key) { if (key === 'auditLog') return { create: async () => { throw Error('synthetic AI audit failure') } }; return Reflect.get(target, key) } }))
  , options)) as any)
  try { await expect(drafts.confirm(owner, draft.id, draft.version, draft.digest)).rejects.toThrow('synthetic AI audit failure') } finally { operation.mockRestore() }
  expect(await db.product.count({ where: { tenantId: tenants[0] } })).toBe(count)
  expect(await db.productSku.count({ where: { tenantId: tenants[0] } })).toBe(skuCount)
  expect(await db.aiActionExecution.count({ where: { draftId: draft.id } })).toBe(0)
  expect((await db.productCategory.findUniqueOrThrow({ where: { id: categoryId } })).productSequence).toBe(sequence)
  expect(await db.aiActionDraft.findUniqueOrThrow({ where: { id: draft.id } })).toMatchObject({ status: 'draft' })
  const results = await Promise.all([drafts.confirm(owner, draft.id, draft.version, draft.digest), drafts.confirm(owner, draft.id, draft.version, draft.digest)])
  expect(results[0].id).toBe(results[1].id)
  const created = await db.product.findUniqueOrThrow({ where: { id: Number((results[0].result as any).id) }, include: { skus: true } })
  expect(created.status).toBe('disabled'); expect(created.skus).toHaveLength(2)
  expect(created.skus.every(sku => sku.stockNum === 0 && sku.reservedNum === 0)).toBe(true)
})

it('confirms a full 50-line inventory draft without truncation and rejects 51 lines', async () => {
  const lines = skuIds.slice(1, 51).map(skuId => ({ skuId, quantity: 1, unit: '袋' }))
  const draft = await drafts.create(owner, conversationId, 'inventory.batch', { mode: 'increase', reason: 'Local 50-line fixture', lines })
  expect(draft.missing).toEqual([])
  await drafts.confirm(owner, draft.id, draft.version, draft.digest)
  const stocks = await db.productSku.findMany({ where: { id: { in: lines.map(line => line.skuId) } } })
  expect(stocks).toHaveLength(50); expect(stocks.every(sku => sku.stockNum === 21)).toBe(true)
  await expect(drafts.create(owner, conversationId, 'inventory.batch', { mode: 'increase', lines: [...lines, { skuId: skuIds[51], quantity: 1, unit: '袋' }] })).rejects.toThrow('50')
}, 60000)
