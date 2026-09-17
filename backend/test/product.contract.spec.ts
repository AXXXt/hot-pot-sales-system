import { Test } from '@nestjs/testing'
import { ExecutionContext, INestApplication } from '@nestjs/common'
import { ConfigService } from '@nestjs/config'
import { JwtService } from '@nestjs/jwt'
import request from 'supertest'
import { ProductController } from '../src/product/product.controller'
import { ProductService } from '../src/product/product.service'
import { PrismaService } from '../src/prisma.service'
import { REDIS } from '../src/redis.provider'
import { JwtAuthGuard } from '../src/auth/auth.guard'
import { requestIdMiddleware } from '../src/request-id.middleware'
import { SuccessInterceptor } from '../src/success.interceptor'
import { AppFilter } from '../src/app.filter'

describe('product HTTP contract', () => {
  let app: INestApplication

  const mockProduct = {
    list: jest.fn().mockResolvedValue({ items: [{ id: 1, name: 'Test', skus: [] }], page: 1, pageSize: 10, total: 1 }),
    create: jest.fn(),
    detail: jest.fn().mockResolvedValue({ id: 1, name: 'Test', skus: [], brand: { name: 'Demo' }, category: { name: 'Cat' }, unit: null }),
    update: jest.fn(),
    updateStatus: jest.fn(),
    batchUpdateStatus: jest.fn().mockResolvedValue({ productIds: [1, 2], status: 'disabled', updatedCount: 2 }),
    archiveProduct: jest.fn().mockResolvedValue({ id: 1, status: 'archived' }),
    batchArchiveProducts: jest.fn().mockResolvedValue({ productIds: [1, 2], status: 'archived', updatedCount: 2 }),
    validateCart: jest.fn().mockResolvedValue({ items: [{ skuId: 1, available: true }], invalidSkuIds: [] }),
    skus: jest.fn().mockResolvedValue([{ id: 1, skuCode: 'SKU-001', basePrice: '88' }]),
    createSku: jest.fn(),
    updateSku: jest.fn(),
    updateSkuStatus: jest.fn(),
    categories: jest.fn().mockResolvedValue([{ id: 1, name: 'Cat' }]),
    managedCategories: jest.fn().mockResolvedValue([{ id: 1, name: 'Cat', status: 'active', _count: { products: 1 } }]),
    createCategory: jest.fn(),
    updateCategory: jest.fn(),
    deleteCategory: jest.fn().mockResolvedValue({ id: 1, deletionMode: 'disabled', linkedProductCount: 1 }),
    restoreCategory: jest.fn().mockResolvedValue({ id: 1, status: 'active' }),
    brands: jest.fn().mockResolvedValue([{ id: 1, code: 'demo-brand' }])
  }

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      controllers: [ProductController],
      providers: [
        { provide: ProductService, useValue: mockProduct },
        { provide: ConfigService, useValue: { get: jest.fn().mockReturnValue('secret') } },
        { provide: JwtService, useValue: { sign: jest.fn(), verify: jest.fn() } },
        { provide: PrismaService, useValue: {} },
        { provide: REDIS, useValue: { get: jest.fn(), set: jest.fn() } }
      ]
    }).overrideGuard(JwtAuthGuard).useValue({
      canActivate: (context: ExecutionContext) => {
        context.switchToHttp().getRequest().user = { sub: 1, tenantId: 1 }
        return true
      }
    }).compile()

    app = moduleRef.createNestApplication()
    app.use(requestIdMiddleware)
    app.useGlobalInterceptors(new SuccessInterceptor())
    app.useGlobalFilters(new AppFilter())
    app.setGlobalPrefix('api/v1')
    await app.init()
  })

  afterAll(async () => { await app.close() })

  it('GET /api/v1/products returns paginated list', async () => {
    const res = await request(app.getHttpServer()).get('/api/v1/products?brandId=1').expect(200)
    expect(res.body.data.items).toHaveLength(1)
    expect(res.body.data.total).toBe(1)
  })

  it('GET /api/v1/products does not force a hidden default brand', async () => {
    mockProduct.list.mockClear()

    await request(app.getHttpServer()).get('/api/v1/products').expect(200)

    expect(mockProduct.list).toHaveBeenCalledWith(expect.objectContaining({
      brandId: undefined,
      includeDisabled: false
    }), undefined)
  })

  it('GET /api/v1/products/:id returns detail', async () => {
    const res = await request(app.getHttpServer()).get('/api/v1/products/1').expect(200)
    expect(res.body.data.name).toBe('Test')
  })

  it('GET /api/v1/products/:id/skus returns SKUs', async () => {
    const res = await request(app.getHttpServer()).get('/api/v1/products/1/skus').expect(200)
    expect(res.body.data[0].basePrice).toBe('88')
  })

  it('POST /api/v1/products/cart-validation returns current cart availability', async () => {
    const res = await request(app.getHttpServer())
      .post('/api/v1/products/cart-validation')
      .set('Authorization', 'Bearer mock-token')
      .send({ skuIds: [1] })
      .expect(201)
    expect(res.body.data.items[0].available).toBe(true)
  })

  it('PATCH /api/v1/products/batch-status disables selected products', async () => {
    const res = await request(app.getHttpServer())
      .patch('/api/v1/products/batch-status')
      .set('Authorization', 'Bearer mock-token')
      .send({ productIds: [1, 2], status: 'disabled' })
      .expect(200)

    expect(mockProduct.batchUpdateStatus).toHaveBeenCalledWith([1, 2], 'disabled')
    expect(res.body.data.updatedCount).toBe(2)
  })

  it('DELETE /api/v1/products/:id safely archives one product', async () => {
    const res = await request(app.getHttpServer())
      .delete('/api/v1/products/1')
      .set('Authorization', 'Bearer mock-token')
      .expect(200)

    expect(mockProduct.archiveProduct).toHaveBeenCalledWith(1)
    expect(res.body.data).toEqual({ id: 1, status: 'archived' })
  })

  it('PATCH /api/v1/products/batch-archive safely archives selected products', async () => {
    const res = await request(app.getHttpServer())
      .patch('/api/v1/products/batch-archive')
      .set('Authorization', 'Bearer mock-token')
      .send({ productIds: [1, 2] })
      .expect(200)

    expect(mockProduct.batchArchiveProducts).toHaveBeenCalledWith([1, 2])
    expect(res.body.data.updatedCount).toBe(2)
  })

  it('GET /api/v1/product-categories returns global categories', async () => {
    mockProduct.categories.mockClear()

    const res = await request(app.getHttpServer()).get('/api/v1/product-categories').expect(200)

    expect(mockProduct.categories).toHaveBeenCalledWith(undefined)
    expect(res.body.data[0].name).toBe('Cat')
  })

  it('GET /api/v1/admin/product-categories returns managed tenant categories', async () => {
    const res = await request(app.getHttpServer())
      .get('/api/v1/admin/product-categories')
      .set('Authorization', 'Bearer mock-token')
      .expect(200)

    expect(mockProduct.managedCategories).toHaveBeenCalledWith(1)
    expect(res.body.data[0]._count.products).toBe(1)
  })

  it('category writes forward the authenticated tenant id', async () => {
    await request(app.getHttpServer())
      .post('/api/v1/product-categories')
      .set('Authorization', 'Bearer mock-token')
      .send({ name: '鸭血', code: '鸭血' })
      .expect(201)
    await request(app.getHttpServer())
      .patch('/api/v1/product-categories/1')
      .set('Authorization', 'Bearer mock-token')
      .send({ name: '鲜鸭血' })
      .expect(200)
    await request(app.getHttpServer())
      .delete('/api/v1/product-categories/1')
      .set('Authorization', 'Bearer mock-token')
      .expect(200)

    expect(mockProduct.createCategory).toHaveBeenCalledWith({ name: '鸭血', code: '鸭血' }, 1)
    expect(mockProduct.updateCategory).toHaveBeenCalledWith(1, { name: '鲜鸭血' }, 1)
    expect(mockProduct.deleteCategory).toHaveBeenCalledWith(1, 1)
  })

  it('PATCH /api/v1/admin/product-categories/:id/restore restores a category', async () => {
    const res = await request(app.getHttpServer())
      .patch('/api/v1/admin/product-categories/1/restore')
      .set('Authorization', 'Bearer mock-token')
      .expect(200)

    expect(mockProduct.restoreCategory).toHaveBeenCalledWith(1, 1)
    expect(res.body.data.status).toBe('active')
  })

  it('GET /api/v1/brands returns brands', async () => {
    const res = await request(app.getHttpServer()).get('/api/v1/brands').expect(200)
    expect(res.body.data[0].code).toBe('demo-brand')
  })
})
