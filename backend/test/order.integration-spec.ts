import { PrismaClient, OrderStatus } from '@prisma/client'
import { randomUUID } from 'crypto'
import { OrderService } from '../src/order/order.service'

const url = process.env.TEST_DATABASE_URL
if (!url || !new URL(url).pathname.endsWith('_test')) {
  throw new Error('TEST_DATABASE_URL must explicitly select an isolated database ending in _test')
}
const db = new PrismaClient({ datasources: { db: { url } } })
const service = new OrderService(db as any, {} as any, { write: async () => {} } as any, {} as any, {} as any)
let tenantId: number
let brandId: number
let customerId: number
let skuId: number

async function order(status: OrderStatus, quantity = 2) {
  return db.order.create({ data: {
    tenantId, brandId, customerId, orderNo: randomUUID(), status,
    totalAmount: '100', payableAmount: '100',
    items: { create: [{ tenantId, skuId, productName: 'Integration fixture', skuSpecText: 'test', saleUnit: 'box', quantity, unitPrice: '50', amount: String(quantity * 50), priceSource: 'base' }] }
  } })
}

beforeAll(async () => {
  const tenant = await db.tenant.create({ data: { name: 'Launch test', code: randomUUID() } })
  tenantId = tenant.id
  brandId = (await db.brand.create({ data: { tenantId, name: 'Test brand', code: 'TEST' } })).id
  customerId = (await db.customer.create({ data: { tenantId, customerName: 'Test customer' } })).id
  const product = await db.product.create({ data: { tenantId, brandId, name: 'Test product', code: 'TEST' } })
  skuId = (await db.productSku.create({ data: { tenantId, productId: product.id, skuCode: 'TEST', specText: 'test', saleUnit: 'box', basePrice: '50', minOrderQty: 1, stockNum: 10 } })).id
})

afterAll(async () => {
  // Only remove this run's uniquely created tenant fixtures, never reset the database.
  if (tenantId) {
    for (const model of ['stockMovement', 'orderRefund', 'orderStatusLog', 'orderItem', 'order', 'customerPriceHistory', 'productSku', 'product', 'customer', 'brand'] as const) {
      await (db[model] as any).deleteMany({ where: { tenantId } })
    }
    await db.tenant.delete({ where: { id: tenantId } })
  }
  await db.$disconnect()
})

test('real MySQL serializes duplicate approvals and cancellations without duplicate inventory movements', async () => {
  const created = await order('pending_finance')
  const approved = await Promise.allSettled([service.approveFinance(created.id), service.approveFinance(created.id)])
  expect(approved.filter(result => result.status === 'fulfilled')).toHaveLength(1)
  expect((await db.productSku.findUniqueOrThrow({ where: { id: skuId } })).stockNum).toBe(8)
  const cancelled = await Promise.allSettled([service.cancel(created.id), service.cancel(created.id)])
  expect(cancelled.filter(result => result.status === 'fulfilled')).toHaveLength(1)
  expect((await db.productSku.findUniqueOrThrow({ where: { id: skuId } })).stockNum).toBe(10)
  expect(await db.stockMovement.count({ where: { sourceId: created.id, tenantId } })).toBe(2)
})

test('real MySQL rejects overselling across different orders', async () => {
  const first = await order('pending_finance', 7)
  const second = await order('pending_finance', 7)
  const results = await Promise.allSettled([service.approveFinance(first.id), service.approveFinance(second.id)])
  expect(results.filter(result => result.status === 'fulfilled')).toHaveLength(1)
  expect((await db.productSku.findUniqueOrThrow({ where: { id: skuId } })).stockNum).toBe(3)
  const winner = await db.order.findFirstOrThrow({ where: { id: { in: [first.id, second.id] }, status: 'pending_shipment' } })
  await service.cancel(winner.id)
})

test('real MySQL locks cumulative refunds and permits only the remaining amount', async () => {
  const created = await order('cancelled')
  const results = await Promise.allSettled([service.refund(created.id, { amount: '80' }), service.refund(created.id, { amount: '80' })])
  expect(results.filter(result => result.status === 'fulfilled')).toHaveLength(1)
  await service.refund(created.id, { amount: '20' })
  await expect(service.refund(created.id, { amount: '0.01' })).rejects.toThrow('累计退款')
  const aggregate = await db.orderRefund.aggregate({ where: { orderId: created.id }, _sum: { amount: true } })
  expect(aggregate._sum.amount?.toString()).toBe('100')
})
