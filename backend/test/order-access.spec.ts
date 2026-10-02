import { INestApplication, ValidationPipe } from '@nestjs/common'
import { ConfigService } from '@nestjs/config'
import { JwtService } from '@nestjs/jwt'
import { Test } from '@nestjs/testing'
import request from 'supertest'
import { OrderController } from '../src/order/order.controller'
import { OrderService } from '../src/order/order.service'
import { PrismaService } from '../src/prisma.service'
import { ProductImageStorageService } from '../src/upload/product-image-storage.service'

describe('order HTTP isolation', () => {
  let app: INestApplication
  const jwt = new JwtService({ secret: 'order-access-test' })
  const actors: Record<number, any> = {
    1: { tenantId: 1, customerId: 10, userType: 'customer_user', status: 'active' },
    2: { tenantId: 1, customerId: 20, userType: 'customer_user', status: 'active' },
    3: { tenantId: 1, customerId: null, userType: 'admin', status: 'active' },
    4: { tenantId: 1, customerId: null, userType: 'super_admin', status: 'active' }
  }
  const orders = [{ id: 100, tenantId: 1, customerId: 10 }, { id: 200, tenantId: 1, customerId: 20 }, { id: 300, tenantId: 2, customerId: 30 }]
  const prisma = {
    user: { findUnique: jest.fn(async ({ where }) => actors[where.id]) },
    userRole: { findFirst: jest.fn().mockResolvedValue(null), findMany: jest.fn().mockResolvedValue([]) },
    order: { findFirst: jest.fn(async ({ where }) => orders.find(o => o.id === where.id && o.tenantId === where.tenantId && (!where.customerId || o.customerId === where.customerId))) }
  }
  const service = Object.fromEntries(['list', 'detail', 'cancel', 'complete', 'transition', 'getLogistics', 'quote'].map(key => [key, jest.fn().mockResolvedValue({ ok: true })]))
  const token = (id: number) => `Bearer ${jwt.sign({ sub: id, tenantId: 1 })}`

  beforeAll(async () => {
    const module = await Test.createTestingModule({
      controllers: [OrderController],
      providers: [
        { provide: OrderService, useValue: service }, { provide: PrismaService, useValue: prisma },
        { provide: JwtService, useValue: jwt },
        { provide: ConfigService, useValue: { get: () => 'order-access-test' } }
      ]
    }).compile()
    app = module.createNestApplication()
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true, forbidNonWhitelisted: true }))
    await app.init()
  })
  beforeEach(() => jest.clearAllMocks())
  afterAll(() => app.close())

  it('requires login', () => request(app.getHttpServer()).get('/orders').expect(401))
  it('overrides a forged customer filter with the authenticated customer', async () => {
    await request(app.getHttpServer()).get('/orders?customerId=20').set('Authorization', token(1)).expect(200)
    expect(service.list).toHaveBeenCalledWith(expect.objectContaining({ tenantId: 1, customerId: 10 }))
  })
  it.each(['', '/logistics'])('hides other customers orders%s', async suffix => {
    await request(app.getHttpServer()).get(`/orders/200${suffix}`).set('Authorization', token(1)).expect(404)
  })
  it.each(['submit', 'cancel', 'complete', 'submit-finance'])('blocks cross-customer %s', async action => {
    await request(app.getHttpServer()).post(`/orders/200/${action}`).set('Authorization', token(1)).send({}).expect(404)
    expect(service.cancel).not.toHaveBeenCalled()
    expect(service.complete).not.toHaveBeenCalled()
    expect(service.transition).not.toHaveBeenCalled()
  })
  it('allows the owner to read an order', () => request(app.getHttpServer()).get('/orders/100').set('Authorization', token(1)).expect(200))
  it('denies staff without order permission', () => request(app.getHttpServer()).get('/orders').set('Authorization', token(3)).expect(403))
  it('keeps administrators inside their tenant', () => request(app.getHttpServer()).get('/orders/300').set('Authorization', token(4)).expect(404))
  it.each([[], [{ skuId: 1, quotedPrice: -1 }], [{ skuId: 1, quotedPrice: 0.001 }]].map(items => ({ items })))('rejects invalid HTTP quotes', async ({ items }) => {
    await request(app.getHttpServer()).post('/orders/100/quote').set('Authorization', token(4)).send({ items }).expect(400)
    expect(service.quote).not.toHaveBeenCalled()
  })
})

describe('payment proof ownership', () => {
  const key = 'payment-proofs/2026/10/abc.jpg'
  function subject(ownOrder = false, ownFile = false) {
    const client = {
      bucketExists: jest.fn().mockResolvedValue(true),
      getBucketPolicy: jest.fn().mockResolvedValue('{"Statement":[]}'),
      setBucketPolicy: jest.fn(), presignedGetObject: jest.fn().mockResolvedValue('signed-url')
    }
    const prisma = {
      user: { findUnique: jest.fn().mockResolvedValue({ tenantId: 1, customerId: 10, userType: 'customer_user' }) },
      order: { findFirst: jest.fn().mockResolvedValue(ownOrder ? { id: 1 } : null) },
      file: { findFirst: jest.fn().mockResolvedValue(ownFile ? { id: 1 } : null) }
    }
    const service = new ProductImageStorageService(client as any, { getOrThrow: (k: string) => k === 'MINIO_BUCKET' ? 'bucket' : 'https://assets.test' } as any, prisma as any)
    return { service, client, prisma }
  }
  it('does not sign an unowned proof even when its key is known', async () => {
    const { service, client } = subject()
    await expect(service.getPaymentProofSignedUrl(key, 1)).rejects.toMatchObject({ status: 403 })
    expect(client.presignedGetObject).not.toHaveBeenCalled()
  })
  it.each([[true, false], [false, true]])('allows an owned order or uploaded file', async (ownOrder, ownFile) => {
    const { service, prisma } = subject(ownOrder, ownFile)
    await expect(service.getPaymentProofSignedUrl(key, 1)).resolves.toMatchObject({ url: 'signed-url' })
    expect(prisma.order.findFirst).toHaveBeenCalledWith(expect.objectContaining({ where: expect.objectContaining({ customerId: 10, tenantId: 1 }) }))
  })
})
