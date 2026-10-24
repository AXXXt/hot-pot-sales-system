import { randomUUID } from 'node:crypto'
import { PrismaClient } from '@prisma/client'
import { PrismaService } from '../src/prisma.service'
import { AuditService } from '../src/audit/audit.service'
import { StaffAccessService, StaffActor } from '../src/auth/staff-access.service'
import { CustomerService } from '../src/customer/customer.service'
import { OrderService } from '../src/order/order.service'
import { OrderNotificationService } from '../src/notify/order-notification.service'
import { ProductVisibilityService } from '../src/product/product-visibility.service'

// Central serial execution only. This suite calls real domain services/MySQL, not HTTP/auth or WeChat.
const url = process.env.TEST_DATABASE_URL
if (!url) throw new Error('Isolated loopback TEST_DATABASE_URL ending in _test required')
const target = new URL(url)
if (target.protocol !== 'mysql:' || !['localhost', '127.0.0.1', '[::1]'].includes(target.hostname)
  || !target.pathname.endsWith('_test') || target.search) throw new Error('Isolated loopback TEST_DATABASE_URL ending in _test required')
const db = new PrismaClient({ datasources: { db: { url } } })
let tenantId = -1, adminId: number, buyerId: number, customerId: number
let productId: number, skuId: number, otherSkuId: number, actor: StaffActor
let service: OrderService, customers: CustomerService
const wx = { orderTemplateId: '', orderNoticeTemplates: [], sendSubscribeMessageResult: jest.fn() }
let notifications: OrderNotificationService

function makeService(prisma = db as unknown as PrismaService) {
  return new OrderService(prisma, new ProductVisibilityService(prisma), new AuditService(prisma), wx as any, {} as any, undefined, undefined, notifications)
}
async function quoted() {
  const row = await service.create({ customerId, items: [{ skuId, quantity: 2 }] }, buyerId)
  await service.transition(row.id, 'pending_quote', buyerId)
  await service.quote(row.id, [{ skuId, quotedPrice: 10 }], '隔离报价', adminId)
  return row.id
}
async function proof(name: string) {
  const fileUrl = `https://private-proof.invalid/${randomUUID()}/${name}.png`
  await db.file.create({ data: { tenantId, fileName: name, fileType: 'payment-proof', fileUrl, fileSize: 123, createdBy: buyerId } })
  return fileUrl
}
async function state(id: number) {
  return {
    order: await db.order.findUniqueOrThrow({ where: { id } }),
    sku: await db.productSku.findUniqueOrThrow({ where: { id: skuId } }),
    customer: await db.customer.findUniqueOrThrow({ where: { id: customerId } }),
    movements: await db.stockMovement.findMany({ where: { tenantId, sourceId: id } }),
    logs: await db.orderStatusLog.findMany({ where: { orderId: id }, orderBy: { id: 'asc' } }),
    inbox: await db.customerNotification.findMany({ where: { orderId: id }, orderBy: { id: 'asc' } })
  }
}

beforeAll(async () => {
  tenantId = (await db.tenant.create({ data: { code: randomUUID(), name: 'Isolated order closeout' } })).id
  adminId = (await db.user.create({ data: { tenantId, userType: 'super_admin', phone: 'oc-' + randomUUID().slice(0, 15), name: 'Review operator' } })).id
  customerId = (await db.customer.create({ data: { tenantId, customerName: 'Isolated closeout buyer', status: 'active', productVisibilityMode: 'all', creditLimit: '100' } })).id
  buyerId = (await db.user.create({ data: { tenantId, customerId, userType: 'customer_user', phone: 'ob-' + randomUUID().slice(0, 15), name: 'Isolated buyer' } })).id
  for (let index = 0; index < 2; index++) {
    const brand = await db.brand.create({ data: { tenantId, code: `CLOSE-${index}`, name: `Closeout brand ${index}` } })
    const product = await db.product.create({ data: { tenantId, brandId: brand.id, code: `CLOSE-${index}`, name: '固定管理标签', subtitle: '下单时真实商品名' } })
    const sku = await db.productSku.create({ data: { tenantId, productId: product.id, skuCode: `CLOSE-${index}-01`, specText: '500克/袋', saleUnit: '袋', basePrice: '12', minOrderQty: 1, stockNum: 50 } })
    if (!index) { productId = product.id; skuId = sku.id } else otherSkuId = sku.id
  }
  const prisma = db as unknown as PrismaService
  notifications = new OrderNotificationService(prisma, wx as any)
  service = makeService(); customers = new CustomerService(prisma, new AuditService(prisma))
  actor = await new StaffAccessService(prisma).actor(adminId)
})

beforeEach(async () => {
  const where = { tenantId }
  for (const model of ['customerNotification', 'auditLog', 'stockMovement', 'orderRefund', 'orderPriceAdjustment', 'orderStatusLog', 'orderItem', 'customerPriceHistory', 'order', 'file', 'customerPriceRule'] as const) await (db[model] as any).deleteMany({ where })
  await db.productSku.updateMany({ where, data: { stockNum: 50, reservedNum: 0, basePrice: '12' } })
  await db.product.update({ where: { id: productId }, data: { subtitle: '下单时真实商品名' } })
  await db.customer.update({ where: { id: customerId }, data: { creditLimit: '100', creditUsed: '0' } })
  wx.sendSubscribeMessageResult.mockClear()
})

afterAll(async () => {
  if (tenantId > 0) {
    const where = { tenantId }
    for (const model of ['customerNotification', 'auditLog', 'stockMovement', 'orderRefund', 'orderPriceAdjustment', 'orderStatusLog', 'orderItem', 'customerPriceHistory', 'order', 'file', 'customerPriceRule', 'user', 'productSku', 'product', 'customer', 'brand'] as const) await (db[model] as any).deleteMany({ where })
    await db.tenant.delete({ where: { id: tenantId } })
  }
  await db.$disconnect()
})

it('returns a transfer review with reason and inbox, replaces its proof, approves once, then restores stock on cancel', async () => {
  const id = await quoted(), first = await proof('first'), second = await proof('replacement')
  await service.submitFinance(id, first, false, buyerId)
  const returned = await service.rejectFinance(id, '  金额不一致，请更换凭证  ', adminId)
  expect(returned.financeRejection?.reason).toBe('金额不一致，请更换凭证')
  let saved = await state(id)
  expect(saved.order).toMatchObject({ status: 'pending_confirm', stockReserved: true, paymentProof: first, paymentMethod: null })
  expect(saved.sku).toMatchObject({ stockNum: 50, reservedNum: 2 }); expect(saved.movements).toHaveLength(0)
  expect(saved.inbox.filter(x => x.event === 'order.finance_rejected')).toHaveLength(1)
  await expect(service.rejectFinance(id, '重复退回', adminId)).rejects.toThrow('当前状态')
  await service.submitFinance(id, second, false, buyerId)
  expect((await service.detail(id)).financeRejection).toBeNull()
  await service.approveFinance(id, adminId)
  await expect(service.approveFinance(id, adminId)).rejects.toThrow('当前状态')
  saved = await state(id)
  expect(saved.order.paymentProof).toBe(second); expect(saved.sku).toMatchObject({ stockNum: 48, reservedNum: 0 })
  expect(saved.movements.filter(x => x.type === 'order_out')).toHaveLength(1)
  await service.cancel(id, buyerId)
  expect((await state(id)).sku).toMatchObject({ stockNum: 50, reservedNum: 0 })
  expect(wx.sendSubscribeMessageResult).not.toHaveBeenCalled()
})

it('releases only the returned order credit and reclaims it on re-submit without duplicate reservation', async () => {
  const id = await quoted()
  await db.customer.update({ where: { id: customerId }, data: { creditUsed: '7' } })
  await service.submitFinance(id, undefined, true, buyerId)
  expect((await state(id)).customer.creditUsed.toString()).toBe('27')
  await service.rejectFinance(id, '请核对账期申请', adminId)
  let saved = await state(id)
  expect(saved.customer.creditUsed.toString()).toBe('7'); expect(saved.order.creditAmount.toString()).toBe('0')
  expect(saved.sku).toMatchObject({ stockNum: 50, reservedNum: 2 })
  await service.submitFinance(id, undefined, true, buyerId)
  expect((await state(id)).customer.creditUsed.toString()).toBe('27')
  await service.approveFinance(id, adminId); await service.cancel(id, buyerId)
  saved = await state(id)
  expect(saved.customer.creditUsed.toString()).toBe('7'); expect(saved.sku).toMatchObject({ stockNum: 50, reservedNum: 0 })
})

it('keeps order, reservation and credit unchanged when available credit is insufficient', async () => {
  const id = await quoted()
  await db.customer.update({ where: { id: customerId }, data: { creditLimit: '25', creditUsed: '7' } })
  const before = await state(id)
  await expect(service.submitFinance(id, undefined, true, buyerId)).rejects.toThrow('账期额度不足')
  expect(await state(id)).toEqual(before)
})

it('rejects an already displayed quote after a staff adjustment, then accepts only a fresh explicit confirmation', async () => {
  const id = await quoted(), displayed = await service.detail(id)
  await service.adjustPrice(id, { afterAmount: '21', reason: '隔离报价更新' }, adminId)
  const before = await state(id)
  await expect(service.submitFinance(id, undefined, true, buyerId, { updatedAt: displayed.updatedAt.toISOString(), payableAmount: '20' })).rejects.toMatchObject({ response: { errorCode: 'ORD_QUOTE_CHANGED' } })
  expect(await state(id)).toEqual(before)
  const fresh = await service.detail(id)
  await service.submitFinance(id, undefined, true, buyerId, { updatedAt: fresh.updatedAt.toISOString(), payableAmount: '21.00' })
  expect((await state(id)).customer.creditUsed.toString()).toBe('21')
})

it('rolls back state, credit, reason and inbox if the transactional audit cannot be written', async () => {
  const id = await quoted(); await service.submitFinance(id, undefined, true, buyerId)
  const before = await state(id)
  const failing: any = new Proxy(db, { get(original, key) {
    if (key !== '$transaction') return Reflect.get(original, key)
    return (run: any) => db.$transaction(tx => run(new Proxy(tx, { get(client, property) {
      return property === 'auditLog' ? { create: async () => { throw new Error('injected audit failure') } } : Reflect.get(client, property)
    } })))
  } })
  await expect(makeService(failing).rejectFinance(id, '需补充凭证', adminId)).rejects.toThrow('injected audit failure')
  expect(await state(id)).toEqual(before)
})

it('allows exactly one winner for simultaneous approval and return, without leaking credit or movements', async () => {
  const id = await quoted(); await service.submitFinance(id, undefined, true, buyerId)
  const results = await Promise.allSettled([service.approveFinance(id, adminId), service.rejectFinance(id, '并发退回', adminId)])
  expect(results.filter(x => x.status === 'fulfilled')).toHaveLength(1)
  const saved = await state(id)
  if (saved.order.status === 'pending_confirm') {
    expect(saved.customer.creditUsed.toString()).toBe('0'); expect(saved.sku).toMatchObject({ stockNum: 50, reservedNum: 2 }); expect(saved.movements).toHaveLength(0)
  } else {
    expect(saved.order.status).toBe('pending_shipment'); expect(saved.customer.creditUsed.toString()).toBe('20')
    expect(saved.sku).toMatchObject({ stockNum: 48, reservedNum: 0 }); expect(saved.movements).toHaveLength(1)
  }
})

it('rejects a mixed-brand order, accepts separate brand orders and reserves each SKU independently', async () => {
  await expect(service.create({ customerId, items: [{ skuId, quantity: 1 }, { skuId: otherSkuId, quantity: 3 }] }, buyerId)).rejects.toThrow('同一品牌')
  expect(await db.order.count({ where: { tenantId } })).toBe(0)
  const first = await service.create({ customerId, items: [{ skuId, quantity: 1 }] }, buyerId)
  const second = await service.create({ customerId, items: [{ skuId: otherSkuId, quantity: 3 }] }, buyerId)
  expect(first.brandId).not.toBe(second.brandId)
  await service.transition(first.id, 'pending_quote', buyerId); await service.transition(second.id, 'pending_quote', buyerId)
  expect((await db.productSku.findUniqueOrThrow({ where: { id: skuId } })).reservedNum).toBe(1)
  expect((await db.productSku.findUniqueOrThrow({ where: { id: otherSkuId } })).reservedNum).toBe(3)
  await service.cancel(first.id, buyerId)
  expect((await db.productSku.findUniqueOrThrow({ where: { id: otherSkuId } })).reservedNum).toBe(3)
})

it('preserves the purchased name and original price after catalog rename/base-price changes and order quote adjustment', async () => {
  const id = await quoted()
  await db.product.update({ where: { id: productId }, data: { subtitle: '之后的新商品名' } })
  await db.productSku.update({ where: { id: skuId }, data: { basePrice: '99' } })
  await service.adjustPrice(id, { afterAmount: '18.00', reason: '隔离测试优惠' }, adminId)
  const saved = await service.detail(id)
  expect(saved.items[0].productName).toBe('下单时真实商品名')
  expect(saved.items[0].unitPrice.toString()).toBe('10'); expect(saved.items[0].quotedPrice?.toString()).toBe('10')
  expect(saved.payableAmount.toString()).toBe('18')
  expect(await db.orderPriceAdjustment.count({ where: { tenantId, orderId: id } })).toBe(1)
  await db.productSku.update({ where: { id: skuId }, data: { basePrice: '12' } })
})

it('applies only active agreement windows, stores Beijing offset as UTC and can clear the window', async () => {
  const now = Date.now(), dto = { customerId, skuId, price: '8.80' }
  await customers.createPriceRule({ ...dto, startAt: new Date(now + 600000).toISOString(), endAt: null }, actor)
  let row = await service.create({ customerId, items: [{ skuId, quantity: 1 }] }, buyerId)
  expect(row.items[0].unitPrice.toString()).toBe('12')
  await customers.createPriceRule({ ...dto, startAt: new Date(now - 600000).toISOString(), endAt: new Date(now - 300000).toISOString() }, actor)
  row = await service.create({ customerId, items: [{ skuId, quantity: 1 }] }, buyerId)
  expect(row.items[0].unitPrice.toString()).toBe('12')
  await customers.createPriceRule({ ...dto, startAt: new Date(now - 600000).toISOString(), endAt: new Date(now + 600000).toISOString() }, actor)
  row = await service.create({ customerId, items: [{ skuId, quantity: 1 }] }, buyerId)
  expect(row.items[0].unitPrice.toString()).toBe('8.8')
  await customers.createPriceRule({ ...dto, startAt: '2026-10-24T08:00:00+08:00', endAt: '2026-10-25T08:00:00+08:00' }, actor)
  expect((await db.customerPriceRule.findFirstOrThrow({ where: { tenantId, customerId, skuId } })).startAt?.toISOString()).toBe('2026-10-24T00:00:00.000Z')
  await customers.createPriceRule({ ...dto, startAt: null, endAt: null }, actor)
  row = await service.create({ customerId, items: [{ skuId, quantity: 1 }] }, buyerId)
  expect(row.items[0].unitPrice.toString()).toBe('8.8')
})

it('accepts exactly 0.10 of real SQL credit remaining after 99.90 used out of 100.00', async () => {
  const id = await quoted()
  await service.adjustPrice(id, { afterAmount: '0.10', reason: '隔离分币边界' }, adminId)
  await db.customer.update({ where: { id: customerId }, data: { creditLimit: '100.00', creditUsed: '99.90' } })
  const before = await state(id)
  await service.submitFinance(id, undefined, true, buyerId)
  const after = await state(id)
  expect(after.order.status).toBe('pending_finance'); expect(after.order.creditAmount.toFixed(2)).toBe('0.10')
  expect(after.customer.creditUsed.toFixed(2)).toBe('100.00')
  expect(after.sku.stockNum).toBe(before.sku.stockNum); expect(after.sku.reservedNum).toBe(before.sku.reservedNum)
  expect(after.movements).toHaveLength(0)
  expect(after.logs.filter(log => log.toStatus === 'pending_finance')).toHaveLength(1)
  expect(after.inbox.filter(message => message.event === 'order.confirmed')).toHaveLength(1)
})

it('rejects 0.11 with only 0.10 real SQL credit left and preserves order, credit, inventory, logs, inbox and audit', async () => {
  const id = await quoted()
  await service.adjustPrice(id, { afterAmount: '0.11', reason: '隔离分币超额边界' }, adminId)
  await db.customer.update({ where: { id: customerId }, data: { creditLimit: '100.00', creditUsed: '99.90' } })
  const before = await state(id), audits = await db.auditLog.count({ where: { tenantId } })
  await expect(service.submitFinance(id, undefined, true, buyerId)).rejects.toMatchObject({ response: {
    errorCode: 'CREDIT_1001', message: '账期额度不足，当前可用 ¥0.10'
  } })
  expect(await state(id)).toEqual(before)
  expect(await db.auditLog.count({ where: { tenantId } })).toBe(audits)
})
