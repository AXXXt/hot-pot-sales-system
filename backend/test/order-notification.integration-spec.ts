import { randomUUID } from 'node:crypto'
import { PrismaClient } from '@prisma/client'
import { OrderService } from '../src/order/order.service'
import { OrderNotificationService } from '../src/notify/order-notification.service'
import { ShipmentNotificationService } from '../src/notify/shipment-notification.service'
import { configuredOrderTemplate, QUOTE_FIELDS, QUOTE_TEMPLATE_ID } from '../src/notify/order-notification-template'
import { SHIPMENT_TEMPLATE_ID } from '../src/notify/shipment-template'

const url = process.env.TEST_DATABASE_URL
if (!url || !new URL(url).pathname.endsWith('_test')) throw new Error('Isolated TEST_DATABASE_URL required')
const db = new PrismaClient({ datasources: { db: { url } } })
const provider = { orderTemplateId: SHIPMENT_TEMPLATE_ID, subscriptionReady: true,
  orderNoticeTemplates: [configuredOrderTemplate('order.quoted', '报价完成', QUOTE_TEMPLATE_ID, JSON.stringify(QUOTE_FIELDS))!,
    configuredOrderTemplate('order.approved', '审核通过', 'fK5PEF0WvqWeXdR9P3SPtuBFNGa6k5c7MOe4H39D3yg',
      JSON.stringify({ character_string1: 'orderNo', time2: 'eventTime', phrase3: 'state', thing4: 'remark' }))!],
  sendSubscribeMessageResult: jest.fn().mockResolvedValue({ status: 'sent' }) }
const notices = new OrderNotificationService(db as any, provider as any)
const orders = new OrderService(db as any, {} as any, { write: jest.fn() } as any, provider as any, {} as any,
  undefined, new ShipmentNotificationService(db as any, provider as any), notices)
let tenantId: number, customerId: number, buyerId: number, otherBuyerId: number, staffId: number, brandId: number, skuId: number
beforeAll(async () => {
  tenantId = (await db.tenant.create({ data: { code: randomUUID(), name: 'Isolated notifications' } })).id
  customerId = (await db.customer.create({ data: { tenantId, customerName: '测试门店', status: 'active', creditLimit: '500' } })).id
  const user = async (userType: 'customer_user' | 'super_admin') => (await db.user.create({ data: {
    tenantId, name: '测试用户', phone: 'N' + randomUUID().slice(0, 15), userType,
    customerId: userType === 'customer_user' ? customerId : null,
    openid: userType === 'customer_user' ? 'fixture-' + randomUUID() : null
  } })).id
  buyerId = await user('customer_user'); otherBuyerId = await user('customer_user'); staffId = await user('super_admin')
  brandId = (await db.brand.create({ data: { tenantId, code: 'N', name: '通知测试品牌' } })).id
  const product = await db.product.create({ data: { tenantId, brandId, code: 'N-001', name: '通知测试商品' } })
  skuId = (await db.productSku.create({ data: { tenantId, productId: product.id, skuCode: 'N-001-01', specText: '袋', saleUnit: '袋', minOrderQty: 1, basePrice: '10', stockNum: 20 } })).id
})
afterAll(async () => {
  if (tenantId) {
    for (const model of ['customerNotification', 'auditLog', 'stockMovement', 'customerPriceHistory', 'orderStatusLog', 'orderItem', 'order', 'user', 'productSku', 'product', 'brand', 'customer'] as const) {
      await (db[model] as any).deleteMany({ where: { tenantId } })
    }
    await db.tenant.delete({ where: { id: tenantId } })
  }
  await db.$disconnect()
})
beforeEach(() => provider.sendSubscribeMessageResult.mockClear())
async function createOrder() {
  return db.order.create({ data: { tenantId, customerId, userId: buyerId, brandId,
    orderNo: 'NT' + randomUUID().replaceAll('-', '').slice(0, 22), status: 'draft', totalAmount: '10', payableAmount: '10',
    items: { create: [{ tenantId, skuId, productName: '牛筋丸', skuSpecText: '袋', saleUnit: '袋', quantity: 1, unitPrice: '10', amount: '10', priceSource: 'base' }] }
  } })
}
it('commits the full real state flow with six inbox messages and only the configured key pushes', async () => {
  const order = await createOrder()
  await orders.transition(order.id, 'pending_quote', buyerId)
  await orders.quote(order.id, [{ skuId, quotedPrice: 12.9 }], undefined, staffId)
  await orders.submitFinance(order.id, undefined, true, buyerId)
  await orders.approveFinance(order.id, staffId)
  await orders.ship(order.id, { logisticsType: 'tricycle' }, staffId)
  await orders.complete(order.id, buyerId)
  const items = await db.customerNotification.findMany({ where: { orderId: order.id }, orderBy: { id: 'asc' } })
  expect(items.map(item => item.event)).toEqual(['order.submitted', 'order.quoted', 'order.confirmed', 'order.approved', 'order.shipped', 'order.completed'])
  expect(provider.sendSubscribeMessageResult).toHaveBeenCalledTimes(3)
  expect(provider.sendSubscribeMessageResult.mock.calls[0][0].data.amount4.value).toBe('12.90')
  expect(items.find(x => x.event === 'order.approved')!.content).not.toMatch(/到账|付款成功/)
  const list = await notices.list(buyerId, 1, 20)
  expect(list.unreadCount).toBeGreaterThanOrEqual(6)
  await expect(notices.read(otherBuyerId, items[0].id)).rejects.toThrow('不可访问')
  expect((await notices.list(otherBuyerId, 1, 20)).items).toEqual([])
  await notices.read(buyerId, items[0].id)
  expect((await db.customerNotification.findUniqueOrThrow({ where: { id: items[0].id } })).readAt).not.toBeNull()
  await notices.readAll(buyerId)
  expect((await notices.list(buyerId, 1, 20)).unreadCount).toBe(0)
})
it('a duplicate quote cannot duplicate the inbox or send; cancellation remains a station message', async () => {
  const order = await createOrder()
  await orders.transition(order.id, 'pending_quote', buyerId)
  const results = await Promise.allSettled([
    orders.quote(order.id, [{ skuId, quotedPrice: 11 }], undefined, staffId),
    orders.quote(order.id, [{ skuId, quotedPrice: 12 }], undefined, staffId)
  ])
  expect(results.filter(x => x.status === 'fulfilled')).toHaveLength(1)
  expect(await db.customerNotification.count({ where: { orderId: order.id, event: 'order.quoted' } })).toBe(1)
  expect(provider.sendSubscribeMessageResult).toHaveBeenCalledTimes(1)
  await orders.cancel(order.id, buyerId)
  expect(await db.customerNotification.count({ where: { orderId: order.id, event: 'order.cancelled' } })).toBe(1)
  expect(provider.sendSubscribeMessageResult).toHaveBeenCalledTimes(1)
})
it('failure rolls back the state log and its inbox entry together', async () => {
  const order = await createOrder()
  await expect(db.$transaction(async tx => {
    await tx.order.update({ where: { id: order.id }, data: { status: 'pending_quote' } })
    const log = await tx.orderStatusLog.create({ data: { tenantId, orderId: order.id, fromStatus: 'draft', toStatus: 'pending_quote' } })
    await notices.record(tx, order.id, 'pending_quote', log)
    throw Error('abort fixture')
  })).rejects.toThrow('abort fixture')
  expect((await db.order.findUniqueOrThrow({ where: { id: order.id } })).status).toBe('draft')
  expect(await db.customerNotification.count({ where: { orderId: order.id } })).toBe(0)
})
