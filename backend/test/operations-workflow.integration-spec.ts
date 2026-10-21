import { randomUUID } from 'node:crypto'
import { ConfigService } from '@nestjs/config'
import { PrismaClient } from '@prisma/client'
import { PrismaService } from '../src/prisma.service'
import { StaffAccessService, StaffActor } from '../src/auth/staff-access.service'
import { ProductService } from '../src/product/product.service'
import { ProductVisibilityService } from '../src/product/product-visibility.service'
import { OrderService } from '../src/order/order.service'
import { AiInventoryService } from '../src/ai/ai-inventory.service'
import { AiWorkflowsService } from '../src/ai/ai-workflows.service'
import { AiDraftService } from '../src/ai/ai-draft.service'
import { AiSettingsService } from '../src/ai/ai-settings.service'
import { InventoryPlanningService } from '../src/inventory/inventory-planning.service'
import { InventoryService } from '../src/inventory/inventory.service'
import { changeStock } from '../src/inventory/stock-ledger'

const url = process.env.TEST_DATABASE_URL
if (!url || !new URL(url).pathname.endsWith('_test')) throw new Error('Isolated TEST_DATABASE_URL required')
const db = new PrismaClient({ datasources: { db: { url } } })
const tenants: number[] = []
let actor: StaffActor, drafts: AiDraftService, conversationId: string, skuId: number, otherSku: number, customerId: number, buyerId: number
let products: ProductService, orders: OrderService, planning: InventoryPlanningService
const future = '2030-01-01', later = '2031-01-01'
const line = (id = skuId, quantity = 1, unit = '袋') => ({ skuId: id, keyword: '', specText: '', quantity, unit })
async function stock(quantity = 100, tracked = false) {
  await db.stockBatch.deleteMany({ where: { skuId } })
  await db.productSku.update({ where: { id: skuId }, data: { stockNum: quantity, reservedNum: 0, batchTracking: tracked } })
}
async function confirm(action: string, value: unknown) {
  const draft = await drafts.create(actor, conversationId, action, value)
  expect(draft.missing).toEqual([])
  return drafts.confirm(actor, draft.id, draft.version, draft.digest)
}

beforeAll(async () => {
  for (let i = 0; i < 2; i++) tenants.push((await db.tenant.create({ data: { code: randomUUID(), name: 'Workflow integration' } })).id)
  const tenantId = tenants[0]
  const user = await db.user.create({ data: { tenantId, userType: 'super_admin', phone: 'test-' + randomUUID().slice(0, 12), name: 'Operator' } })
  const customer = await db.customer.create({ data: { tenantId, customerName: '清单客户', status: 'active', productVisibilityMode: 'all' } }); customerId = customer.id
  buyerId = (await db.user.create({ data: { tenantId, customerId, name: '采购员', userType: 'customer_user', phone: 'test-' + randomUUID().slice(0, 12) } })).id
  for (let i = 0; i < 2; i++) {
    const brand = await db.brand.create({ data: { tenantId, name: `清单品牌${i}`, code: `W${i}` } })
    const product = await db.product.create({ data: { tenantId, brandId: brand.id, code: `W${i}-001`, name: '管理标签', subtitle: i ? '虾滑' : '牛筋丸', images: ['/a.jpg', '/b.jpg'] } })
    const sku = await db.productSku.create({ data: { tenantId, productId: product.id, skuCode: `W${i}-001-01`, specText: '500克/袋', saleUnit: '袋', minOrderQty: 1, basePrice: '20', stockNum: 100, packagingUnits: [{ unit: '箱', factor: 20 }] } })
    if (i) otherSku = sku.id; else skuId = sku.id
  }
  const pricedSku = await db.productSku.findUniqueOrThrow({ where: { id: skuId }, include: { product: true } })
  await db.customerPriceRule.create({ data: { tenantId, customerId, skuId, brandId: pricedSku.product.brandId, priceType: 'agreement', price: '18.50' } })
  const prisma = db as unknown as PrismaService, access = new StaffAccessService(prisma), visibility = new ProductVisibilityService(prisma)
  actor = await access.actor(user.id)
  products = new ProductService(prisma, {} as any, visibility, { write: jest.fn() } as any)
  orders = new OrderService(prisma, visibility, { write: jest.fn() } as any, {} as any, {} as any)
  const inventory = new AiInventoryService(prisma, access), workflows = new AiWorkflowsService(prisma, access, inventory, visibility, orders)
  const settings = new AiSettingsService(prisma, new ConfigService(), access)
  drafts = new AiDraftService(prisma, access, products, settings, inventory, workflows)
  planning = new InventoryPlanningService(prisma, access)
  await db.aiConfig.create({ data: { tenantId, enabled: true, allowWrites: true, features: { inventory: true, orders: true } } })
  conversationId = (await db.aiConversation.create({ data: { tenantId, ownerId: actor.id, title: 'Operations workflow', fingerprint: actor.fingerprint } })).id
})

afterAll(async () => {
  const where = { tenantId: { in: tenants } }
  for (const model of ['auditLog', 'stockMovement', 'stockBatch', 'stockAdjustment', 'stocktakeItem', 'stocktake', 'replenishmentPlan', 'aiActionExecution', 'aiActionDraft', 'aiMessage', 'aiConversation', 'aiConfig', 'orderStatusLog', 'orderItem', 'order', 'customerPriceRule', 'user', 'productSku', 'product', 'brand', 'customer'] as const) await (db[model] as any).deleteMany({ where })
  await db.tenant.deleteMany({ where: { id: { in: tenants } } }); await db.$disconnect()
})

it('validates image ownership and package configuration, clears removed images and keeps copies empty', async () => {
  const sku = await db.productSku.findUniqueOrThrow({ where: { id: skuId } })
  await expect(products.updateSku(skuId, { imageUrl: 'https://untrusted.test/a.jpg' })).rejects.toThrow('图库')
  await expect(products.updateSku(skuId, { packagingUnits: [{ unit: '箱', factor: 0 }] })).rejects.toThrow('包装单位')
  await expect(products.updateSku(skuId, { saleUnit: '箱' })).rejects.toThrow('基础销售单位')
  await products.updateSku(skuId, { imageUrl: '/b.jpg' })
  const copy = await products.createSku(sku.productId, { specText: '200克/袋', saleUnit: '袋', basePrice: '10', minOrderQty: 1, stockNum: 999, imageUrl: '/a.jpg' })
  expect(copy).toMatchObject({ stockNum: 0, reservedNum: 0, skuCode: 'W0-001-02', imageUrl: '/a.jpg' })
  await products.update(sku.productId, { images: ['/a.jpg'] }, actor.id)
  expect((await db.productSku.findUniqueOrThrow({ where: { id: skuId } })).imageUrl).toBeNull()
})

it('converts a whole receipt list to base units and confirms it exactly once', async () => {
  await stock(100)
  const beforeOther = (await db.productSku.findUniqueOrThrow({ where: { id: otherSku } })).stockNum
  const draft = await drafts.create(actor, conversationId, 'inventory.batch', { mode: 'increase', reason: '到货', lines: [line(skuId, 2, '箱'), line(otherSku, 3)] })
  expect((draft.payload as any).lines[0]).toMatchObject({ factor: 20, afterQty: 140 })
  const results = await Promise.all([1, 2].map(() => drafts.confirm(actor, draft.id, draft.version, draft.digest)))
  expect(results[0].id).toBe(results[1].id)
  const movements = await db.stockMovement.findMany({ where: { stockAdjustmentId: (results[0].result as any).id } })
  expect(movements).toHaveLength(2)
  expect((await db.productSku.findUniqueOrThrow({ where: { id: skuId } })).stockNum).toBe(140)
  expect((await db.productSku.findUniqueOrThrow({ where: { id: otherSku } })).stockNum).toBe(beforeOther + 3)
})

it('rolls back the whole list if a later line has become stale, and refuses duplicated or ambiguous rows', async () => {
  await stock(100)
  const draft = await drafts.create(actor, conversationId, 'inventory.batch', { mode: 'increase', lines: [line(skuId, 5), line(otherSku, 5)] })
  await db.productSku.update({ where: { id: otherSku }, data: { stockNum: { increment: 1 } } })
  await expect(drafts.confirm(actor, draft.id, draft.version, draft.digest)).rejects.toThrow('已变化')
  expect((await db.productSku.findUniqueOrThrow({ where: { id: skuId } })).stockNum).toBe(100)
  expect(await db.aiActionExecution.count({ where: { draftId: draft.id } })).toBe(0)
  expect((await drafts.create(actor, conversationId, 'inventory.batch', { mode: 'set', lines: [line(), line()] })).missing.join()).toContain('重复')
  expect((await drafts.create(actor, conversationId, 'inventory.batch', { mode: 'increase', lines: [{ keyword: '牛筋丸', quantity: 1, unit: '袋' }] })).missing.join()).toContain('唯一')
})

it('reserves submitted orders, prevents overlapping demand and releases on cancellation and finance deduction', async () => {
  await stock(10)
  const first = await orders.create({ customerId, items: [{ skuId, quantity: 7 }] }, actor.id)
  const second = await orders.create({ customerId, items: [{ skuId, quantity: 7 }] }, actor.id)
  const submits = await Promise.allSettled([orders.transition(first.id, 'pending_quote', actor.id), orders.transition(second.id, 'pending_quote', actor.id)])
  expect(submits.filter(x => x.status === 'fulfilled')).toHaveLength(1)
  expect((await db.productSku.findUniqueOrThrow({ where: { id: skuId } })).reservedNum).toBe(7)
  const productId = (await db.productSku.findUniqueOrThrow({ where: { id: skuId } })).productId
  const customerView = await products.detail(productId, buyerId), staffView = await products.detail(productId, actor.id)
  expect(customerView.skus.find(x => x.id === skuId)).toMatchObject({ stockNum: 3, availableNum: 3 })
  expect(staffView.skus.find(x => x.id === skuId)).toMatchObject({ stockNum: 10, availableNum: 3 })
  const held = await db.order.findFirstOrThrow({ where: { id: { in: [first.id, second.id] }, stockReserved: true } })
  await expect(confirm('inventory.adjust', { ...line(skuId, 5), mode: 'set' })).rejects.toThrow()
  await orders.cancel(held.id, actor.id)
  expect((await db.productSku.findUniqueOrThrow({ where: { id: skuId } })).reservedNum).toBe(0)
  const draft = held.id === first.id ? second : first
  await orders.transition(draft.id, 'pending_quote', actor.id)
  await db.order.update({ where: { id: draft.id }, data: { status: 'pending_finance' } })
  await orders.approveFinance(draft.id, actor.id)
  expect(await db.productSku.findUniqueOrThrow({ where: { id: skuId } })).toMatchObject({ stockNum: 3, reservedNum: 0 })
  await orders.cancel(draft.id, actor.id)
  expect((await db.productSku.findUniqueOrThrow({ where: { id: skuId } })).stockNum).toBe(10)
})

it('creates orders split by brand with customer prices and rechecks changed agreement prices', async () => {
  await stock(100)
  const value = { customerId, lines: [line(skuId, 2, '箱'), line(otherSku, 3)] }
  const preview = await drafts.create(actor, conversationId, 'order.create', value)
  expect(preview.missing).toEqual([])
  expect((preview.payload as any).lines[0]).toMatchObject({ baseQuantity: 40, unitPrice: '18.50', amount: '740.00' })
  const execution = await drafts.confirm(actor, preview.id, preview.version, preview.digest)
  const created = (execution.result as any).orders
  expect(created).toHaveLength(2)
  for (const order of created) expect(await db.order.findUniqueOrThrow({ where: { id: order.id } })).toMatchObject({ status: 'draft', stockReserved: false })
  const stale = await drafts.create(actor, conversationId, 'order.create', value)
  await db.customerPriceRule.updateMany({ where: { customerId, skuId }, data: { price: '19' } })
  await expect(drafts.confirm(actor, stale.id, stale.version, stale.digest)).rejects.toThrow('价格已变化')
  await expect(drafts.create({ ...actor, superAdmin: false, permissions: new Set(['ai:use']) }, conversationId, 'order.create', value)).rejects.toThrow('权限')
  const foreignCustomer = await db.customer.create({ data: { tenantId: tenants[1], customerName: '外租户', status: 'active' } })
  expect((await drafts.create(actor, conversationId, 'order.create', { customerId: foreignCustomer.id, lines: [line()] })).missing.join()).toContain('客户')
})

it('records lots, allocates earliest expiry first, and restores the same lots on cancellation', async () => {
  await stock(0, true)
  await confirm('inventory.batch', { mode: 'increase', lines: [{ ...line(skuId, 10), batchNo: 'LATE', expiryDate: later }] })
  await confirm('inventory.batch', { mode: 'increase', lines: [{ ...line(skuId, 10), batchNo: 'EARLY', expiryDate: future }] })
  const order = await orders.create({ customerId, items: [{ skuId, quantity: 12 }] }, actor.id)
  await orders.transition(order.id, 'pending_quote', actor.id)
  await db.order.update({ where: { id: order.id }, data: { status: 'pending_finance' } })
  await orders.approveFinance(order.id, actor.id)
  expect(await db.stockBatch.findMany({ where: { skuId }, orderBy: { batchNo: 'asc' }, select: { batchNo: true, quantity: true } })).toEqual([{ batchNo: 'EARLY', quantity: 0 }, { batchNo: 'LATE', quantity: 8 }])
  await orders.cancel(order.id, actor.id)
  expect(await db.stockBatch.findMany({ where: { skuId }, select: { quantity: true } })).toEqual([{ quantity: 10 }, { quantity: 10 }])
  await expect(products.updateSku(skuId, { batchTracking: false })).rejects.toThrow('关闭')
})

it('rejects expired receipts and inconsistent lot dates; assigns historical lots without changing stock', async () => {
  await stock(10, true)
  await db.stockBatch.create({ data: { tenantId: actor.tenantId, skuId, batchNo: '__LEGACY__', quantity: 10 } })
  const before = (await db.productSku.findUniqueOrThrow({ where: { id: skuId } })).stockNum
  const unknown = await db.stockBatch.findFirstOrThrow({ where: { skuId, expiryDate: null } })
  await planning.assignBatch(actor, { fromBatchId: unknown.id, quantity: 4, batchNo: 'HISTORY', expiryDate: '2025-01-01' })
  expect((await db.productSku.findUniqueOrThrow({ where: { id: skuId } })).stockNum).toBe(before)
  const sku = await db.productSku.findUniqueOrThrow({ where: { id: skuId } })
  await expect(db.$transaction(tx => changeStock(tx, sku, 3, { orderOut: true }))).rejects.toThrow('到期')
  expect((await planning.overview(actor)).items.find(x => x.skuId === skuId)).toMatchObject({ expiredQuantity: 4, availableNum: 6 })
  const expired = await drafts.create(actor, conversationId, 'inventory.batch', { mode: 'increase', lines: [{ ...line(), batchNo: 'EXPIRED', expiryDate: '2025-01-01' }] })
  expect(expired.missing.join()).toContain('到期')
  await expect(drafts.confirm(actor, expired.id, expired.version, expired.digest)).rejects.toThrow('到期')
  await planning.assignBatch(actor, { fromBatchId: unknown.id, quantity: 2, batchNo: 'KNOWN', expiryDate: future })
  await expect(planning.assignBatch(actor, { fromBatchId: unknown.id, quantity: 1, batchNo: 'KNOWN', expiryDate: later })).rejects.toThrow('不同日期')
})

it('saves a replenishment plan without changing stock and protects status updates', async () => {
  const requestId = randomUUID(), before = (await db.productSku.findUniqueOrThrow({ where: { id: skuId } })).stockNum
  const plan = await planning.createPlan(actor, { requestId, items: [{ skuId, quantity: 30 }] })
  expect((await planning.createPlan(actor, { requestId, items: [{ skuId, quantity: 30 }] })).id).toBe(plan.id)
  await planning.updatePlan(actor, plan.id, 'ordered', plan.updatedAt.toISOString())
  await expect(planning.updatePlan(actor, plan.id, 'closed', plan.updatedAt.toISOString())).rejects.toThrow('变化')
  expect((await db.productSku.findUniqueOrThrow({ where: { id: skuId } })).stockNum).toBe(before)
})

it('persists surplus-lot dates across stocktake draft saves and completes against the same receipt', async () => {
  await stock(10, true)
  const inventory = new InventoryService(db as unknown as PrismaService, { write: jest.fn() } as any)
  const take = await inventory.createStocktake({ skuIds: [skuId], remark: '实物盘点' }, actor.id)
  await inventory.updateStocktakeItems(take.id, { items: [{ skuId, countedQty: 12, batchNo: 'SURPLUS', productionDate: '2026-01-01', expiryDate: future }] }, actor.id)
  const saved = await inventory.stocktakeDetail(take.id)
  expect(saved.items[0].receiptBatch).toMatchObject({ batchNo: 'SURPLUS', expiryDate: future })
  expect(saved.items[0].sku.batchTracking).toBe(true)
  await inventory.completeStocktake(take.id, { items: [{ skuId, countedQty: 12 }] }, actor.id)
  expect((await db.productSku.findUniqueOrThrow({ where: { id: skuId } })).stockNum).toBe(12)
  expect(await db.stockBatch.findFirstOrThrow({ where: { skuId, batchNo: 'SURPLUS' } })).toMatchObject({ quantity: 2, expiryDate: new Date(future) })
  expect(await db.stockMovement.findFirstOrThrow({ where: { sourceType: 'stocktake', sourceId: take.id } })).toMatchObject({ tenantId: actor.tenantId, changeQty: 2 })
})

it('receives multiple lots of the same SKU on one document with chained stock previews', async () => {
  await stock(0, true)
  const draft = await drafts.create(actor, conversationId, 'inventory.batch', { mode: 'increase', lines: [{ ...line(skuId, 2), batchNo: 'ONE', expiryDate: future }, { ...line(skuId, 3), batchNo: 'TWO', expiryDate: later }] })
  expect(draft.missing).toEqual([])
  expect((draft.payload as any).lines.map((x: any) => [x.item.beforeQty, x.afterQty])).toEqual([[0, 2], [2, 5]])
  const execution = await drafts.confirm(actor, draft.id, draft.version, draft.digest)
  expect((execution.result as any).items).toHaveLength(2)
  expect((await db.productSku.findUniqueOrThrow({ where: { id: skuId } })).stockNum).toBe(5)
  const same = await drafts.create(actor, conversationId, 'inventory.batch', { mode: 'increase', lines: [{ ...line(), batchNo: 'ONE', expiryDate: future }, { ...line(), batchNo: 'ONE', expiryDate: future }] })
  expect(same.missing.join()).toContain('重复')
})
