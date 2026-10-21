import { randomUUID } from 'node:crypto'
import { INestApplication, ValidationPipe } from '@nestjs/common'
import { Test } from '@nestjs/testing'
import { ConfigService } from '@nestjs/config'
import { JwtService } from '@nestjs/jwt'
import { PrismaClient } from '@prisma/client'
import request from 'supertest'
import { PrismaService } from '../src/prisma.service'
import { OrderController } from '../src/order/order.controller'
import { OrderService } from '../src/order/order.service'
import { ProductVisibilityService } from '../src/product/product-visibility.service'
import { SuccessInterceptor } from '../src/success.interceptor'
import { AppFilter } from '../src/app.filter'

const url = process.env.TEST_DATABASE_URL
if (!url || !new URL(url).pathname.endsWith('_test')) {
  throw new Error('TEST_DATABASE_URL must select an isolated database ending in _test')
}
const db = new PrismaClient({ datasources: { db: { url } } })
const secret = randomUUID()
const jwt = new JwtService({ secret })
const tenantIds: number[] = []
let app: INestApplication
let tenantId: number
let customerId: number
let customerUserId: number
let skuId: number
let foreignSkuId: number
let customerToken: string
let otherCustomerToken: string
let adminToken: string
let foreignAdminToken: string
let unprivilegedToken: string

const post = (route: string, token: string, body = {}) => request(app.getHttpServer())
  .post(`/api/v1/${route}`).set('Authorization', `Bearer ${token}`).send(body)
const get = (route: string, token: string) => request(app.getHttpServer())
  .get(`/api/v1/${route}`).set('Authorization', `Bearer ${token}`)

async function actor(tenant: number, userType: 'super_admin' | 'customer_user' | 'sales', customer?: number) {
  const user = await db.user.create({ data: { tenantId: tenant, name: 'Test actor', userType, customerId: customer, phone: `test-${randomUUID().slice(0, 12)}` } })
  return { id: user.id, token: jwt.sign({ sub: user.id, tenantId: tenant }, { expiresIn: '10m' }) }
}

beforeAll(async () => {
  // Reserve a separate tenant so hard-coded tenant 1 cannot silently pass this suite.
  for (let i = 0; i < 3; i++) {
    tenantIds.push((await db.tenant.create({ data: { name: 'Isolated HTTP test', code: randomUUID() } })).id)
  }
  tenantId = tenantIds[1]
  const brand = await db.brand.create({ data: { tenantId, name: 'Test brand', code: 'FLOW' } })
  const customer = await db.customer.create({ data: { tenantId, customerName: 'Test buyer', productVisibilityMode: 'all', creditLimit: '1000' } })
  customerId = customer.id
  const other = await db.customer.create({ data: { tenantId, customerName: 'Other buyer' } })
  const customerActor = await actor(tenantId, 'customer_user', customerId)
  customerUserId = customerActor.id
  customerToken = customerActor.token
  otherCustomerToken = (await actor(tenantId, 'customer_user', other.id)).token
  adminToken = (await actor(tenantId, 'super_admin')).token
  unprivilegedToken = (await actor(tenantId, 'sales')).token
  foreignAdminToken = (await actor(tenantIds[2], 'super_admin')).token
  const product = await db.product.create({ data: { tenantId, brandId: brand.id, name: 'Test product', code: 'FLOW', isFactoryProduct: true } })
  skuId = (await db.productSku.create({ data: { tenantId, productId: product.id, skuCode: 'FLOW', specText: 'test', saleUnit: 'box', basePrice: '50.10', minOrderQty: 1, stockNum: 20 } })).id
  const foreignBrand = await db.brand.create({ data: { tenantId: tenantIds[2], name: 'Other brand', code: 'OTHER' } })
  const foreignProduct = await db.product.create({ data: { tenantId: tenantIds[2], brandId: foreignBrand.id, name: 'Other product', code: 'OTHER', isFactoryProduct: true } })
  foreignSkuId = (await db.productSku.create({ data: { tenantId: tenantIds[2], productId: foreignProduct.id, skuCode: 'OTHER', specText: 'test', saleUnit: 'box', basePrice: '1', minOrderQty: 1, stockNum: 20 } })).id

  const visibility = new ProductVisibilityService(db as any)
  const orders = new OrderService(db as any, visibility, { write: async () => {} } as any, {} as any, {} as any)
  const moduleRef = await Test.createTestingModule({
    controllers: [OrderController],
    providers: [
      { provide: OrderService, useValue: orders },
      { provide: PrismaService, useValue: db },
      { provide: ConfigService, useValue: new ConfigService({ JWT_ACCESS_SECRET: secret }) },
      { provide: JwtService, useValue: jwt }
    ]
  }).compile()
  app = moduleRef.createNestApplication()
  app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true, forbidNonWhitelisted: true }))
  app.useGlobalInterceptors(new SuccessInterceptor())
  app.useGlobalFilters(new AppFilter())
  app.setGlobalPrefix('api/v1')
  await app.init()
})

beforeEach(async () => {
  await db.customer.update({ where: { id: customerId }, data: { status: 'active', creditUsed: '0', creditLimit: '1000' } })
  await db.productSku.update({ where: { id: skuId }, data: { stockNum: 20, status: 'active' } })
})

afterAll(async () => {
  if (app) await app.close()
  // Delete only this suite's fixtures, never truncate or reset a shared database.
  const where = { tenantId: { in: tenantIds } }
  for (const model of ['stockMovement', 'orderRefund', 'orderPriceAdjustment', 'orderStatusLog', 'orderItem', 'customerPriceHistory', 'order', 'file', 'user', 'productSku', 'product', 'customer', 'brand'] as const) {
    await (db[model] as any).deleteMany({ where })
  }
  await db.tenant.deleteMany({ where: { id: { in: tenantIds } } })
  await db.$disconnect()
})

async function draft() {
  const response = await post('orders', customerToken, { customerId, items: [{ skuId, quantity: 1 }, { skuId, quantity: 1 }] }).expect(201)
  const created = response.body.data
  expect(created.tenantId).toBe(tenantId)
  expect(created.items).toHaveLength(1)
  expect(created.items[0].tenantId).toBe(tenantId)
  expect(Number(created.payableAmount)).toBe(100.2)
  return created.id as number
}

async function quoted() {
  const id = await draft()
  await post(`orders/${id}/submit`, customerToken).expect(201)
  await post(`orders/${id}/quote`, adminToken, { items: [{ skuId, quotedPrice: 45.25 }] }).expect(201)
  return id
}

test('new orders snapshot the real name and subsequent renames preserve historical order items', async () => {
  const sku = await db.productSku.findUniqueOrThrow({ where: { id: skuId }, include: { product: true } })
  try {
    await db.product.update({ where: { id: sku.productId }, data: { subtitle: '爆汁牛筋丸' } })
    const first = await post('orders', customerToken, { customerId, items: [{ skuId, quantity: 1 }] }).expect(201)
    expect(first.body.data.items[0].productName).toBe('爆汁牛筋丸')
    await db.product.update({ where: { id: sku.productId }, data: { subtitle: '手打牛筋丸' } })
    const second = await post('orders', customerToken, { customerId, items: [{ skuId, quantity: 1 }] }).expect(201)
    expect(second.body.data.items[0].productName).toBe('手打牛筋丸')
    expect((await get(`orders/${first.body.data.id}`, customerToken).expect(200)).body.data.items[0].productName).toBe('爆汁牛筋丸')
    expect((await db.product.findUniqueOrThrow({ where: { id: sku.productId } })).name).toBe(sku.product.name)
  } finally {
    await db.product.update({ where: { id: sku.productId }, data: { subtitle: sku.product.subtitle } })
  }
})

test('HTTP: create, quote, credit approval, stock deduction, shipping and receipt', async () => {
  const id = await quoted()
  await post(`orders/${id}/submit-finance`, customerToken, { creditRequested: true }).expect(201)
  await post(`orders/${id}/approve-finance`, adminToken).expect(201)
  await post(`orders/${id}/ship`, adminToken, { logisticsType: 'tricycle' }).expect(201)
  const response = await post(`orders/${id}/complete`, customerToken).expect(201)
  expect(response.body.data.status).toBe('completed')
  expect(response.body.data.statusLogs.map((log: any) => log.toStatus)).toEqual(['draft', 'pending_quote', 'pending_confirm', 'pending_finance', 'pending_shipment', 'shipped', 'completed'])
  expect(response.body.data.statusLogs.every((log: any) => log.tenantId === tenantId)).toBe(true)
  expect((await db.customer.findUniqueOrThrow({ where: { id: customerId } })).creditUsed.toString()).toBe('90.5')
  expect((await db.productSku.findUniqueOrThrow({ where: { id: skuId } })).stockNum).toBe(18)
  await post(`orders/${id}/complete`, customerToken).expect(400)
  await post(`orders/${id}/cancel`, customerToken).expect(400)
})

test('HTTP: other customers, other tenants and unprivileged staff cannot read or change an order', async () => {
  const id = await draft()
  await get(`orders/${id}`, otherCustomerToken).expect(404)
  await post(`orders/${id}/cancel`, otherCustomerToken).expect(404)
  await get(`orders/${id}`, foreignAdminToken).expect(404)
  await get(`orders/${id}`, unprivilegedToken).expect(403)
  await post(`orders/${id}/quote`, customerToken, { items: [{ skuId, quotedPrice: 1 }] }).expect(403)
  const otherList = await get(`orders?customerId=${customerId}`, otherCustomerToken).expect(200)
  expect(otherList.body.data.total).toBe(0)
  await db.customer.update({ where: { id: customerId }, data: { status: 'disabled' } })
  await get(`orders/${id}`, customerToken).expect(401)
})

test('HTTP: disabled and cross-tenant SKUs cannot be ordered', async () => {
  await post('orders', customerToken, { customerId, items: [{ skuId: foreignSkuId, quantity: 1 }] }).expect(400)
  await db.productSku.update({ where: { id: skuId }, data: { status: 'disabled' } })
  await post('orders', customerToken, { customerId, items: [{ skuId, quantity: 1 }] }).expect(400)
})

test('HTTP: payment proof must belong to the customer before approval and refund', async () => {
  const id = await quoted()
  const proof = `https://storage.invalid/payment-proofs/${randomUUID()}.png`
  await post(`orders/${id}/submit-finance`, customerToken, { paymentProof: proof }).expect(400)
  await db.file.create({ data: { tenantId, createdBy: customerUserId, fileName: 'test.png', fileUrl: proof, fileType: 'payment-proof', fileSize: 10, mimeType: 'image/png' } })
  await post(`orders/${id}/submit-finance`, customerToken, { paymentProof: proof }).expect(201)
  await post(`orders/${id}/approve-finance`, adminToken).expect(201)
  await post(`orders/${id}/approve-finance`, adminToken).expect(400)
  await post(`orders/${id}/cancel`, customerToken).expect(201)
  await post(`orders/${id}/cancel`, customerToken).expect(400)
  expect((await db.productSku.findUniqueOrThrow({ where: { id: skuId } })).stockNum).toBe(20)
  await post(`orders/${id}/refund`, adminToken, { amount: '90.50' }).expect(201)
  await post(`orders/${id}/refund`, adminToken, { amount: '0.01' }).expect(400)
})

test('HTTP: concurrent credit confirmation and cancellation do not occupy or release credit twice', async () => {
  const id = await quoted()
  const results = await Promise.all([
    post(`orders/${id}/submit-finance`, customerToken, { creditRequested: true }),
    post(`orders/${id}/submit-finance`, customerToken, { creditRequested: true })
  ])
  expect(results.map(result => result.status).sort()).toEqual([201, 400])
  expect((await db.customer.findUniqueOrThrow({ where: { id: customerId } })).creditUsed.toString()).toBe('90.5')
  await post(`orders/${id}/cancel`, customerToken).expect(201)
  await post(`orders/${id}/cancel`, customerToken).expect(400)
  expect((await db.customer.findUniqueOrThrow({ where: { id: customerId } })).creditUsed.toString()).toBe('0')
})

test('HTTP: concurrent different orders cannot exceed the customer credit limit', async () => {
  const first = await quoted()
  const second = await quoted()
  await db.customer.update({ where: { id: customerId }, data: { creditLimit: '100' } })
  const results = await Promise.all([
    post(`orders/${first}/submit-finance`, customerToken, { creditRequested: true }),
    post(`orders/${second}/submit-finance`, customerToken, { creditRequested: true })
  ])
  expect(results.map(result => result.status).sort()).toEqual([201, 400])
  expect((await db.customer.findUniqueOrThrow({ where: { id: customerId } })).creditUsed.toString()).toBe('90.5')
  expect(await db.order.count({ where: { id: { in: [first, second] }, status: 'pending_finance' } })).toBe(1)
})
