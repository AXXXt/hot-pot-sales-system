import { randomUUID } from 'node:crypto'
import { INestApplication, ValidationPipe } from '@nestjs/common'
import { Test } from '@nestjs/testing'
import { ConfigService } from '@nestjs/config'
import { JwtService } from '@nestjs/jwt'
import { PrismaClient } from '@prisma/client'
import request from 'supertest'
import { ProductController } from '../src/product/product.controller'
import { ProductService } from '../src/product/product.service'
import { ProductVisibilityService } from '../src/product/product-visibility.service'
import { StaffAccessService } from '../src/auth/staff-access.service'
import { PrismaService } from '../src/prisma.service'
import { REDIS } from '../src/redis.provider'
import { AuditService } from '../src/audit/audit.service'
import { SuccessInterceptor } from '../src/success.interceptor'
import { AppFilter } from '../src/app.filter'

const url = process.env.TEST_DATABASE_URL
if (!url || !new URL(url).pathname.endsWith('_test')) throw new Error('Isolated TEST_DATABASE_URL required')
const db = new PrismaClient({ datasources: { db: { url } } })
const secret = randomUUID()
const jwt = new JwtService({ secret })
const tenants: number[] = []
let app: INestApplication
let admin: string, buyer: string, staff: string
let productId: number, hiddenSkuId: number, brandId: number, categoryId: number
const get = (route: string, token: string) => request(app.getHttpServer()).get('/api/v1/' + route).set('Authorization', 'Bearer ' + token)
const post = (route: string, token: string, body: object) => request(app.getHttpServer()).post('/api/v1/' + route).set('Authorization', 'Bearer ' + token).send(body)

beforeAll(async () => {
  for (let i = 0; i < 2; i++) tenants.push((await db.tenant.create({ data: { code: randomUUID(), name: 'Catalog test' } })).id)
  const tenantId = tenants[0]
  const customer = await db.customer.create({ data: { tenantId, customerName: 'Catalog buyer', productVisibilityMode: 'all' } })
  for (const userType of ['super_admin', 'customer_user', 'sales'] as const) {
    const user = await db.user.create({ data: { tenantId, userType, name: 'Catalog tester', phone: 'test-' + randomUUID().slice(0, 12), customerId: userType === 'customer_user' ? customer.id : undefined } })
    const token = jwt.sign({ sub: user.id, tenantId })
    if (userType === 'super_admin') admin = token
    if (userType === 'customer_user') buyer = token
    if (userType === 'sales') staff = token
  }
  brandId = (await db.brand.create({ data: { tenantId, code: 'CAT', name: 'Catalog brand' } })).id
  categoryId = (await db.productCategory.create({ data: { tenantId, code: 'CAT', name: 'Catalog category' } })).id
  const product = await db.product.create({ data: { tenantId, brandId, categoryId, code: 'CAT-1', name: 'Catalog product', isFactoryProduct: true } })
  productId = product.id
  await db.productSku.create({ data: { tenantId, productId, skuCode: 'CAT-A', specText: '500克/袋', saleUnit: '袋', basePrice: '29.9', minOrderQty: 1, stockNum: 0 } })
  hiddenSkuId = (await db.productSku.create({ data: { tenantId, productId, skuCode: 'CAT-D', specText: '停用规格', saleUnit: '袋', basePrice: '0', minOrderQty: 1, stockNum: 100, status: 'disabled' } })).id
  const otherBrand = await db.brand.create({ data: { tenantId: tenants[1], code: 'CAT', name: 'Foreign brand' } })
  await db.product.create({ data: { tenantId: tenants[1], brandId: otherBrand.id, code: 'CAT-2', name: 'Foreign product', isFactoryProduct: true } })
  const module = await Test.createTestingModule({ controllers: [ProductController], providers: [
    ProductService, ProductVisibilityService, StaffAccessService,
    { provide: PrismaService, useValue: db }, { provide: JwtService, useValue: jwt },
    { provide: ConfigService, useValue: new ConfigService({ JWT_ACCESS_SECRET: secret }) },
    { provide: REDIS, useValue: {} }, { provide: AuditService, useValue: { write: async () => {} } }
  ] }).compile()
  app = module.createNestApplication()
  app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true, forbidNonWhitelisted: true }))
  app.useGlobalInterceptors(new SuccessInterceptor())
  app.useGlobalFilters(new AppFilter())
  app.setGlobalPrefix('api/v1')
  await app.init()
})

afterAll(async () => {
  if (app) await app.close()
  const where = { tenantId: { in: tenants } }
  for (const model of ['user', 'productSku', 'product', 'productCategory', 'brand', 'customer'] as const) await (db[model] as any).deleteMany({ where })
  await db.tenant.deleteMany({ where: { id: { in: tenants } } })
  await db.$disconnect()
})

it('tenant-scoped catalog reads hide foreign products and unauthorized staff brands', async () => {
  for (const token of [admin, buyer]) {
    const result = await get('products', token).expect(200)
    expect(result.body.data.items.map((item: any) => item.id)).toEqual([productId])
  }
  expect((await get('products', staff).expect(200)).body.data.items).toEqual([])
  expect((await get('brands', buyer).expect(200)).body.data.map((item: any) => item.id)).toEqual([brandId])
  expect((await get('product-categories', buyer).expect(200)).body.data.map((item: any) => item.id)).toEqual([categoryId])
})

it('disabled SKUs stay editable by operators and cannot be exposed or ordered by customers', async () => {
  expect((await get(`products/${productId}`, buyer).expect(200)).body.data.skus).toHaveLength(1)
  expect((await get(`products/${productId}`, admin).expect(200)).body.data.skus).toHaveLength(2)
  const cart = await post('products/cart-validation', buyer, { skuIds: [hiddenSkuId] }).expect(201)
  expect(cart.body.data.invalidSkuIds).toEqual([hiddenSkuId])
  expect(cart.body.data.items).toEqual([])
})

it('an explicit brand filter cannot widen staff catalog permissions', async () => {
  const result = await get(`products?brandId=${brandId}`, staff).expect(200)
  expect(result.body.data.items).toEqual([])
  expect(result.body.data.total).toBe(0)
})

it('searches specification text and preserves the sold-out state', async () => {
  const result = await get('products?keyword=' + encodeURIComponent('500克'), buyer).expect(200)
  expect(result.body.data.total).toBe(1)
  expect(result.body.data.items[0].skus[0].stockNum).toBe(0)
  expect((await get('products?inStock=true', buyer).expect(200)).body.data.total).toBe(0)
})

it('rejects malformed filters, negative amounts and invalid order minimums before writing', async () => {
  for (const query of ['page=0', 'pageSize=0', 'pageSize=501', 'categoryId=1oops', 'brandId=-1']) await get('products?' + query, buyer).expect(400)
  await post(`products/${productId}/skus`, admin, { skuCode: 'BAD', specText: 'test', saleUnit: '袋', basePrice: '-1', minOrderQty: 0 }).expect(400)
  expect(await db.productSku.count({ where: { productId } })).toBe(2)
})

it('a newly created product follows its publication status in the customer catalog', async () => {
  const created = await post('products', admin, { brandId, categoryId, subtitle: 'New catalog fixture' }).expect(201)
  const id = created.body.data.id
  const status = (value: string) => request(app.getHttpServer()).patch(`/api/v1/products/${id}/status`).set('Authorization', 'Bearer ' + admin).send({ status: value })
  await status('disabled').expect(200)
  await get(`products/${id}`, buyer).expect(404)
  await status('active').expect(200)
  await get(`products/${id}`, buyer).expect(200)
})

it('uses the legacy subtitle as the real name and keeps the automatic label, code and SKUs unchanged', async () => {
  const before = await db.product.findUniqueOrThrow({ where: { id: productId }, include: { skus: true, category: true } })
  const legacy = (await get(`products/${productId}`, buyer).expect(200)).body.data
  expect(legacy).toMatchObject({ name: before.name, managementLabel: before.name, nameNeedsReview: true })
  const response = await request(app.getHttpServer()).patch(`/api/v1/products/${productId}`)
    .set('Authorization', 'Bearer ' + admin)
    .send({ subtitle: '  爆汁牛筋丸  ', name: '伪造标签', code: 'MANUAL' }).expect(200)
  expect(response.body.data).toMatchObject({ name: '爆汁牛筋丸', displayName: '爆汁牛筋丸', managementLabel: before.name, nameNeedsReview: false, code: before.code })
  const after = await db.product.findUniqueOrThrow({ where: { id: productId }, include: { skus: true, category: true } })
  expect(after.name).toBe(before.name)
  expect(after.code).toBe(before.code)
  expect(after.skus).toEqual(before.skus)
  expect(after.category?.productSequence).toBe(before.category?.productSequence)
  expect((await get(`products/${productId}`, buyer).expect(200)).body.data.name).toBe('爆汁牛筋丸')
  expect((await get('products?keyword=' + encodeURIComponent('爆汁牛筋丸'), buyer).expect(200)).body.data.total).toBe(1)
  const cart = await post('products/cart-validation', buyer, { skuIds: [before.skus.find(sku => sku.status === 'active')!.id] }).expect(201)
  expect(cart.body.data.items[0]).toMatchObject({ name: '爆汁牛筋丸', stockNum: 0, available: false })
})

it('rejects invalid real names and unauthorized renames without changing stored data', async () => {
  for (const subtitle of ['', '   ', '商'.repeat(256), null]) {
    await request(app.getHttpServer()).patch(`/api/v1/products/${productId}`)
      .set('Authorization', 'Bearer ' + admin).send({ subtitle }).expect(400)
  }
  await request(app.getHttpServer()).patch(`/api/v1/products/${productId}`)
    .set('Authorization', 'Bearer ' + buyer).send({ subtitle: '越权修改' }).expect(403)
  expect((await db.product.findUniqueOrThrow({ where: { id: productId } })).subtitle).toBe('爆汁牛筋丸')
})

it('persists ordered galleries with a consistent cover without altering product identity or SKUs', async () => {
  const before = await db.product.findUniqueOrThrow({ where: { id: productId }, include: { skus: true } })
  const patch = (body: object, token = admin) => request(app.getHttpServer()).patch(`/api/v1/products/${productId}`).set('Authorization', 'Bearer ' + token).send(body)
  const images = ['https://example.com/second.jpg', 'https://example.com/first.jpg']
  await patch({ images, mainImageUrl: images[1] }).expect(200)
  expect((await get(`products/${productId}`, buyer).expect(200)).body.data).toMatchObject({ images, mainImageUrl: images[0] })
  await patch({ description: 'Gallery preserved' }).expect(200)
  expect((await get(`products/${productId}`, buyer).expect(200)).body.data.images).toEqual(images)
  for (const images of [null, [''], [12], ['javascript:alert(1)'], Array(10).fill('https://example.com/a.jpg')]) await patch({ images }).expect(400)
  await patch({ images: [] }, buyer).expect(403)
  const after = await db.product.findUniqueOrThrow({ where: { id: productId }, include: { skus: true } })
  expect(after).toMatchObject({ code: before.code, name: before.name, brandId: before.brandId, categoryId: before.categoryId, images, mainImageUrl: images[0], skus: before.skus })
  await patch({ images: [] }).expect(200)
  expect((await get(`products/${productId}`, buyer).expect(200)).body.data).toMatchObject({ images: [], mainImageUrl: '' })
  await db.product.update({ where: { id: productId }, data: { images: [], mainImageUrl: images[0] } })
  expect((await get(`products/${productId}`, buyer).expect(200)).body.data.images).toEqual([images[0]])
})

it('allocates consecutive SKU codes under concurrent creation and never reuses disabled suffixes', async () => {
  const product = await db.product.findUniqueOrThrow({ where: { id: productId } })
  await db.productSku.create({ data: { tenantId: product.tenantId, productId, skuCode: product.code + '-09', specText: '历史停用规格', saleUnit: '袋', basePrice: '1', minOrderQty: 1, status: 'disabled' } })
  const results = await Promise.all(Array.from({ length: 4 }, (_, i) => post(`products/${productId}/skus`, admin, { skuCode: 'CLIENT-CANNOT-OVERRIDE', specText: `${100 + i}克/袋`, saleUnit: '袋', basePrice: '10', minOrderQty: 1 }).expect(201)))
  expect(results.map(r => r.body.data.skuCode).sort()).toEqual([10, 11, 12, 13].map(n => `${product.code}-${n}`))
  expect(results.every(r => r.body.data.stockNum === 0)).toBe(true)
  const automatic = await post(`products/${productId}/skus`, admin, { specText: '新规格', saleUnit: '袋', basePrice: '10', minOrderQty: 1 }).expect(201)
  expect(automatic.body.data.skuCode).toBe(product.code + '-14')
})
