import { randomUUID } from 'node:crypto'
import { PrismaClient } from '@prisma/client'
import { PrismaService } from '../src/prisma.service'
import { OrderService } from '../src/order/order.service'
import { ShipmentNotificationService } from '../src/notify/shipment-notification.service'
import { SHIPMENT_TEMPLATE_ID } from '../src/notify/shipment-template'

const url = process.env.TEST_DATABASE_URL
if (!url || !new URL(url).pathname.endsWith('_test')) throw new Error('Isolated TEST_DATABASE_URL required')
const db = new PrismaClient({ datasources: { db: { url } } })
let tenantId: number, customerId: number, buyerId: number, operatorId: number, brandId: number, skuId: number
const provider = { subscriptionReady: true, orderTemplateId: SHIPMENT_TEMPLATE_ID, sendSubscribeMessageResult: jest.fn().mockResolvedValue({ status: 'sent' }) }
const notifier = new ShipmentNotificationService(db as unknown as PrismaService, provider as any)
const orders = new OrderService(db as any, {} as any, { write: jest.fn() } as any, provider as any, {} as any, undefined, notifier)

beforeAll(async () => {
  tenantId = (await db.tenant.create({ data: { code: randomUUID(), name: 'Isolated Wechat tests' } })).id
  customerId = (await db.customer.create({ data: { tenantId, customerName: '测试门店', status: 'active' } })).id
  buyerId = (await db.user.create({ data: { tenantId, customerId, name: '测试采购', phone: 'test-' + randomUUID().slice(0, 12), userType: 'customer_user', openid: 'fixture-openid' } })).id
  operatorId = (await db.user.create({ data: { tenantId, name: '测试运营', phone: 'test-' + randomUUID().slice(0, 12), userType: 'super_admin' } })).id
  brandId = (await db.brand.create({ data: { tenantId, code: 'W', name: '测试品牌' } })).id
  const product = await db.product.create({ data: { tenantId, brandId, code: 'W-001', name: '测试管理标签' } })
  skuId = (await db.productSku.create({ data: { tenantId, productId: product.id, skuCode: 'W-001-01', specText: '袋', saleUnit: '袋', minOrderQty: 1, basePrice: '10', stockNum: 20 } })).id
})

afterAll(async () => {
  if (tenantId) {
    const where = { tenantId }
    for (const model of ['auditLog', 'orderStatusLog', 'orderItem', 'order', 'user', 'productSku', 'product', 'brand', 'customer'] as const) await (db[model] as any).deleteMany({ where })
    await db.tenant.delete({ where: { id: tenantId } })
  }
  await db.$disconnect()
})

beforeEach(() => provider.sendSubscribeMessageResult.mockClear())
async function order(userId = buyerId) {
  return db.order.create({ data: {
    tenantId, customerId, brandId, userId, orderNo: 'WX' + randomUUID().replaceAll('-', '').slice(0, 24),
    status: 'pending_shipment', totalAmount: '10', payableAmount: '10',
    items: { create: [{ tenantId, skuId, productName: '牛筋丸', skuSpecText: '袋', saleUnit: '袋', quantity: 1, unitPrice: '10', amount: '10', priceSource: 'base' }] }
  } })
}

it('actual shipping commits status, supplies the persisted shipping timestamp, and sends once across service instances', async () => {
  const record = await order()
  await orders.ship(record.id, { logisticsType: 'tricycle' }, operatorId)
  const second = new ShipmentNotificationService(db as any, provider as any)
  await Promise.all([notifier.notify(record.id), second.notify(record.id)])
  expect(provider.sendSubscribeMessageResult).toHaveBeenCalledTimes(1)
  const log = await db.auditLog.findUniqueOrThrow({ where: { requestId: `wx-shipment-${tenantId}-${record.id}` } })
  expect(log.afterData).toMatchObject({ status: 'sent', userId: buyerId, event: 'order.shipped' })
  expect(provider.sendSubscribeMessageResult.mock.calls[0][0].data.phrase5.value).toBe('已发货')
  expect((await db.productSku.findUniqueOrThrow({ where: { id: skuId } })).stockNum).toBe(20)
})

it('a provider rejection cannot roll back shipment, and a repeated notification does not consume another grant', async () => {
  const record = await order()
  provider.sendSubscribeMessageResult.mockResolvedValueOnce({ status: 'rejected', errorCode: 43101 })
  await expect(orders.ship(record.id, { logisticsType: 'tricycle' }, operatorId)).resolves.toMatchObject({ status: 'shipped' })
  await notifier.notify(record.id)
  expect(provider.sendSubscribeMessageResult).toHaveBeenCalledTimes(1)
  expect((await db.auditLog.findUniqueOrThrow({ where: { requestId: `wx-shipment-${tenantId}-${record.id}` } })).afterData).toMatchObject({ status: 'rejected', errorCode: 43101 })
})

it('does not send the customer message to the staff account that created a draft on their behalf', async () => {
  const record = await order(operatorId)
  await orders.ship(record.id, { logisticsType: 'tricycle' }, operatorId)
  expect(provider.sendSubscribeMessageResult).not.toHaveBeenCalled()
  expect(await db.auditLog.count({ where: { requestId: `wx-shipment-${tenantId}-${record.id}` } })).toBe(0)
})
