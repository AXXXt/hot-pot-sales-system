import { AuthSessionService } from '../src/auth/auth-session.service'
import { randomUUID } from 'node:crypto'
import { INestApplication, ValidationPipe } from '@nestjs/common'
import { ConfigService } from '@nestjs/config'
import { JwtService } from '@nestjs/jwt'
import { Test } from '@nestjs/testing'
import { PrismaClient } from '@prisma/client'
import request from 'supertest'
import sharp from 'sharp'
import { AppFilter } from '../src/app.filter'
import { AuditService } from '../src/audit/audit.service'
import { PrismaService } from '../src/prisma.service'
import { OrderController } from '../src/order/order.controller'
import { OrderService } from '../src/order/order.service'
import { ProductVisibilityService } from '../src/product/product-visibility.service'
import { ProductImageStorageService } from '../src/upload/product-image-storage.service'
import { UploadController } from '../src/upload/upload.controller'

const url = process.env.TEST_DATABASE_URL
if (!url || !new URL(url).pathname.endsWith('_test')) throw new Error('An isolated TEST_DATABASE_URL ending in _test is required')
const db = new PrismaClient({ datasources: { db: { url } } })
const secret = randomUUID(), jwt = new JwtService({ secret }), tenants: number[] = [], permissionIds: number[] = []
const storageOrigin = 'https://private-storage.invalid', bucket = 'scope-proof-test'
const client = {
  bucketExists: jest.fn().mockResolvedValue(true),
  getBucketPolicy: jest.fn().mockResolvedValue('{"Statement":[]}'),
  setBucketPolicy: jest.fn().mockResolvedValue(undefined),
  putObject: jest.fn().mockResolvedValue({ etag: 'fixture-only' }),
  presignedGetObject: jest.fn(async (_bucket: string, key: string) => `${storageOrigin}/signed/${key}`)
}
let app: INestApplication, service: OrderService
let tenantId: number, adminId: number, salesId: number, buyerId: number
let customerId: number, otherCustomerId: number, skuId: number, otherSkuId: number
let adminToken: string, salesToken: string, buyerToken: string, otherBuyerToken: string
let foreignAdminToken: string
let ownOrderId: number, otherBuyerOrderId: number, otherBrandOrderId: number

const get = (route: string, token: string) => request(app.getHttpServer()).get(route).set('Authorization', `Bearer ${token}`)
const post = (route: string, token: string, body: object = {}) => request(app.getHttpServer()).post(route).set('Authorization', `Bearer ${token}`).send(body)
const bearer = (id: number) => jwt.sign({ sub: id, tenantId }, { expiresIn: '15m' })

async function user(userType: 'super_admin' | 'sales' | 'customer_user', customer?: number) {
  return db.user.create({ data: { tenantId, userType, customerId: customer, phone: `T-${randomUUID().slice(0, 15)}`, name: 'Order proof fixture' } })
}
async function draft(token = buyerToken, customer = customerId, sku = skuId) {
  const response = await post('/orders', token, { customerId: customer, items: [{ skuId: sku, quantity: 1 }] }).expect(201)
  return response.body.id as number
}
async function quoted() {
  const id = await draft()
  await post(`/orders/${id}/submit`, buyerToken).expect(201)
  await post(`/orders/${id}/quote`, adminToken, { items: [{ skuId, quotedPrice: 10 }] }).expect(201)
  return id
}
async function proof(token = buyerToken) {
  const image = await sharp({ create: { width: 2, height: 2, channels: 3, background: '#ffffff' } }).jpeg().toBuffer()
  const result = await request(app.getHttpServer()).post('/uploads/payment-proof').set('Authorization', `Bearer ${token}`)
    .attach('file', image, { filename: 'QA-proof.jpg', contentType: 'image/jpeg' }).expect(201)
  return result.body as { objectKey: string; url: string }
}

beforeAll(async () => {
  for (let i = 0; i < 2; i++) tenants.push((await db.tenant.create({ data: { code: randomUUID(), name: 'Order proof isolation fixture' } })).id)
  tenantId = tenants[0]
  adminId = (await user('super_admin')).id; adminToken = bearer(adminId)
  const foreign = await db.user.create({ data: { tenantId: tenants[1], userType: 'super_admin', phone: `T-${randomUUID().slice(0, 15)}`, name: 'Other tenant' } })
  foreignAdminToken = jwt.sign({ sub: foreign.id, tenantId: tenants[1] }, { expiresIn: '15m' })
  salesId = (await user('sales')).id; salesToken = bearer(salesId)
  customerId = (await db.customer.create({ data: { tenantId, customerName: 'Assigned buyer', salesOwnerId: salesId, productVisibilityMode: 'all', status: 'active' } })).id
  otherCustomerId = (await db.customer.create({ data: { tenantId, customerName: 'Unassigned buyer', productVisibilityMode: 'all', status: 'active' } })).id
  buyerId = (await user('customer_user', customerId)).id; buyerToken = bearer(buyerId)
  otherBuyerToken = bearer((await user('customer_user', otherCustomerId)).id)
  const role = await db.role.create({ data: { tenantId, name: 'Order read and confirm', code: randomUUID() } })
  for (const code of ['order:read', 'order:confirm']) {
    let permission = await db.permission.findUnique({ where: { code } })
    if (!permission) {
      permission = await db.permission.create({ data: { code, name: code, type: 'api' } })
      permissionIds.push(permission.id)
    }
    await db.rolePermission.create({ data: { tenantId, roleId: role.id, permissionId: permission.id } })
  }
  await db.userRole.create({ data: { tenantId, userId: salesId, roleId: role.id } })
  for (let i = 0; i < 2; i++) {
    const brand = await db.brand.create({ data: { tenantId, code: `PROOF-${i}`, name: `Proof brand ${i}` } })
    if (!i) await db.userBrandAccess.create({ data: { tenantId, userId: salesId, brandId: brand.id } })
    const product = await db.product.create({ data: { tenantId, brandId: brand.id, code: `PROOF-${i}`, name: 'Management label', subtitle: `Real product ${i}` } })
    const sku = await db.productSku.create({ data: { tenantId, productId: product.id, skuCode: `PROOF-${i}-01`, specText: '500g', saleUnit: 'bag', basePrice: '10', minOrderQty: 1, stockNum: 100 } })
    if (!i) skuId = sku.id; else otherSkuId = sku.id
  }
  const prisma = db as unknown as PrismaService
  service = new OrderService(prisma, new ProductVisibilityService(prisma), new AuditService(prisma), {} as any, {} as any)
  const storage = new ProductImageStorageService(client as any, new ConfigService({ MINIO_BUCKET: bucket, MINIO_PUBLIC_URL: storageOrigin }), prisma)
  const moduleRef = await Test.createTestingModule({
    controllers: [OrderController, UploadController],
    providers: [
      // Business fixture: session revocation itself is covered by auth-session.integration-spec.ts.
      { provide: AuthSessionService, useValue: { assertActive: async () => {} } },
      { provide: OrderService, useValue: service }, { provide: ProductImageStorageService, useValue: storage },
      { provide: PrismaService, useValue: db }, { provide: JwtService, useValue: jwt },
      { provide: ConfigService, useValue: new ConfigService({ JWT_ACCESS_SECRET: secret }) }
    ]
  }).compile()
  app = moduleRef.createNestApplication()
  app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true, forbidNonWhitelisted: true }))
  app.useGlobalFilters(new AppFilter())
  await app.init()
  ownOrderId = await draft()
  otherBuyerOrderId = await draft(otherBuyerToken, otherCustomerId)
  otherBrandOrderId = await draft(buyerToken, customerId, otherSkuId)
})

afterAll(async () => {
  if (app) await app.close()
  const where = { tenantId: { in: tenants } }
  for (const model of ['auditLog', 'stockMovement', 'orderRefund', 'orderPriceAdjustment', 'orderStatusLog', 'orderItem', 'customerPriceHistory', 'order', 'file', 'rolePermission', 'userRole', 'userBrandAccess', 'user', 'productSku', 'product', 'customer', 'brand', 'role'] as const) {
    await (db[model] as any).deleteMany({ where })
  }
  await db.permission.deleteMany({ where: { id: { in: permissionIds } } })
  await db.tenant.deleteMany({ where: { id: { in: tenants } } })
  await db.$disconnect()
})

it('bounds order lists, direct reads and writes by both assigned customer and brand', async () => {
  const own = await get('/orders', salesToken).expect(200)
  expect(own.body.items.map((item: any) => item.id)).toEqual([ownOrderId])
  expect((await get(`/orders?customerId=${otherCustomerId}`, salesToken).expect(200)).body.total).toBe(0)
  await get(`/orders/${ownOrderId}`, salesToken).expect(200)
  await get(`/orders/${ownOrderId}`, foreignAdminToken).expect(404)
  await post(`/orders/${ownOrderId}/cancel`, foreignAdminToken).expect(404)
  for (const id of [otherBuyerOrderId, otherBrandOrderId]) {
    await get(`/orders/${id}`, salesToken).expect(404)
    for (const action of ['submit', 'cancel', 'approve-finance', 'refund']) await post(`/orders/${id}/${action}`, salesToken, action === 'refund' ? { amount: '1' } : {}).expect(404)
    expect((await db.order.findUniqueOrThrow({ where: { id } })).status).toBe('draft')
  }
})

it('bounds staff-created orders and historical quote prices without widening via request parameters', async () => {
  const before = await db.order.count({ where: { tenantId } })
  await post('/orders', salesToken, { customerId: otherCustomerId, items: [{ skuId, quantity: 1 }] }).expect(403)
  await post('/orders', salesToken, { customerId, items: [{ skuId: otherSkuId, quantity: 1 }] }).expect(403)
  expect(await db.order.count({ where: { tenantId } })).toBe(before)
  await draft(salesToken)
  await db.customerPriceHistory.createMany({ data: [
    { tenantId, customerId, skuId, price: '9' }, { tenantId, customerId, skuId: otherSkuId, price: '8' },
    { tenantId, customerId: otherCustomerId, skuId, price: '7' }
  ] })
  const history = await get(`/orders/price-history/${customerId}?skuIds=${skuId},${otherSkuId}`, salesToken).expect(200)
  expect(history.body).toEqual([{ skuId, price: '9' }])
  await get(`/orders/price-history/${otherCustomerId}?skuIds=${skuId}`, salesToken).expect(404)
})

it('keeps an uploaded proof private to its uploader before submission and rejects another buyer attachment', async () => {
  const uploaded = await proof()
  await get(`/uploads/payment-proof-url?key=${encodeURIComponent(uploaded.objectKey)}`, buyerToken).expect(200)
  await get(`/uploads/payment-proof-url?key=${encodeURIComponent(uploaded.url)}`, otherBuyerToken).expect(403)
  await get(`/uploads/payment-proof-url?key=${encodeURIComponent(uploaded.objectKey)}`, salesToken).expect(403)
  const target = await draft(otherBuyerToken, otherCustomerId)
  await post(`/orders/${target}/submit`, otherBuyerToken).expect(201)
  await post(`/orders/${target}/quote`, adminToken, { items: [{ skuId, quotedPrice: 10 }] }).expect(201)
  await post(`/orders/${target}/submit-finance`, otherBuyerToken, { paymentProof: uploaded.url }).expect(400)
  expect((await db.order.findUniqueOrThrow({ where: { id: target } })).status).toBe('pending_confirm')
})

it('signs submitted order proofs only inside current staff assignments, then immediately respects revocation', async () => {
  const own = await proof(), otherBuyer = await proof(otherBuyerToken), otherBrand = await proof()
  for (const [id, uploaded] of [[ownOrderId, own], [otherBuyerOrderId, otherBuyer], [otherBrandOrderId, otherBrand]] as const) {
    await db.order.update({ where: { id }, data: { paymentProof: uploaded.url } })
  }
  await get(`/uploads/payment-proof-url?key=${encodeURIComponent(own.objectKey)}`, salesToken).expect(200)
  for (const uploaded of [otherBuyer, otherBrand]) await get(`/uploads/payment-proof-url?key=${encodeURIComponent(uploaded.objectKey)}`, salesToken).expect(403)
  const revoked = await db.userBrandAccess.findFirstOrThrow({ where: { userId: salesId } })
  await db.userBrandAccess.delete({ where: { id: revoked.id } })
  try {
    await get(`/orders/${ownOrderId}`, salesToken).expect(404)
    await get(`/uploads/payment-proof-url?key=${encodeURIComponent(own.objectKey)}`, salesToken).expect(403)
  } finally {
    await db.userBrandAccess.create({ data: { tenantId, userId: salesId, brandId: revoked.brandId } })
  }
})

it('serializes transfer approval/cancellation/refunds, restores stock once, and audits in the correct tenant', async () => {
  const id = await quoted(), uploaded = await proof()
  const before = (await db.productSku.findUniqueOrThrow({ where: { id: skuId } })).stockNum
  await post(`/orders/${id}/submit-finance`, buyerToken, { paymentProof: uploaded.url }).expect(201)
  await post(`/orders/${id}/submit-finance`, buyerToken, { paymentProof: uploaded.url }).expect(400)
  const approvals = await Promise.all([post(`/orders/${id}/approve-finance`, adminToken), post(`/orders/${id}/approve-finance`, adminToken)])
  expect(approvals.map(result => result.status).sort()).toEqual([201, 400])
  expect((await db.productSku.findUniqueOrThrow({ where: { id: skuId } })).stockNum).toBe(before - 1)
  await post(`/orders/${id}/cancel`, buyerToken).expect(201)
  await post(`/orders/${id}/cancel`, buyerToken).expect(400)
  expect((await db.productSku.findUniqueOrThrow({ where: { id: skuId } })).stockNum).toBe(before)
  const refunds = await Promise.all([post(`/orders/${id}/refund`, adminToken, { amount: '7' }), post(`/orders/${id}/refund`, adminToken, { amount: '7' })])
  expect(refunds.map(result => result.status).sort()).toEqual([201, 400])
  await post(`/orders/${id}/refund`, adminToken, { amount: '3' }).expect(201)
  await post(`/orders/${id}/refund`, adminToken, { amount: '0.01' }).expect(400)
  expect((await db.orderRefund.aggregate({ where: { orderId: id }, _sum: { amount: true } }))._sum.amount?.toString()).toBe('10')
  expect(await db.stockMovement.count({ where: { tenantId, sourceType: 'order', sourceId: id, type: 'order_out' } })).toBe(1)
  expect(await db.stockMovement.count({ where: { tenantId, sourceType: 'order', sourceId: id, type: 'order_return' } })).toBe(1)
  const audits = await db.auditLog.findMany({ where: { targetType: 'order', targetId: String(id) } })
  expect(audits.length).toBeGreaterThan(0)
  expect(audits.every(log => log.tenantId === tenantId)).toBe(true)
  const refundAudits = await db.auditLog.findMany({ where: { targetType: 'order_refund', operatorId: adminId } })
  expect(refundAudits).toHaveLength(2)
  expect(refundAudits.every(log => log.tenantId === tenantId)).toBe(true)
})

it.each(['page=0', 'pageSize=501', 'customerId=1oops', 'status=not-a-state'])('rejects invalid list parameters: %s', async query => {
  await get(`/orders?${query}`, adminToken).expect(400)
})
