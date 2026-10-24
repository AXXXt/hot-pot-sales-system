import { AuthSessionService } from '../src/auth/auth-session.service'
import { randomUUID } from 'node:crypto'
import { INestApplication, ValidationPipe } from '@nestjs/common'
import { ConfigService } from '@nestjs/config'
import { JwtService } from '@nestjs/jwt'
import { Test } from '@nestjs/testing'
import { PrismaClient } from '@prisma/client'
import request from 'supertest'
import { ProductController } from '../src/product/product.controller'
import { ProductService } from '../src/product/product.service'
import { ProductMutationGuard } from '../src/product/product-mutation.guard'
import { ProductVisibilityService } from '../src/product/product-visibility.service'
import { BrandController } from '../src/brand/brand.controller'
import { BrandService } from '../src/brand/brand.service'
import { StaffAccessService } from '../src/auth/staff-access.service'
import { PrismaService } from '../src/prisma.service'
import { AuditService } from '../src/audit/audit.service'
import { REDIS } from '../src/redis.provider'
import { SuccessInterceptor } from '../src/success.interceptor'
import { AppFilter } from '../src/app.filter'

const url = process.env.TEST_DATABASE_URL
if (!url || !new URL(url).pathname.endsWith('_test')) throw Error('Isolated TEST_DATABASE_URL required')
const db = new PrismaClient({ datasources: { db: { url } } })
const secret = randomUUID(), jwt = new JwtService({ secret }), tenants: number[] = [], permissionIds: number[] = []
const brands: number[] = [], products: number[] = [], skus: number[] = [], categories: number[] = [], units: number[] = []
let app: INestApplication, staff: string, noPrice: string, admin: string, staffId: number, customer: string
const call = (method: 'get' | 'post' | 'patch' | 'delete', route: string, body?: object, token = staff) => {
  const req = request(app.getHttpServer())[method]('/api/v1/' + route).set('Authorization', 'Bearer ' + token)
  return body ? req.send(body) : req
}
const skuInput = { specText: '500克/袋', saleUnit: '袋', basePrice: '10', minOrderQty: 1 }

beforeAll(async () => {
  for (let i = 0; i < 2; i++) tenants.push((await db.tenant.create({ data: { code: randomUUID(), name: 'Catalog scope' } })).id)
  const tenantId = tenants[0]
  const owner = await db.user.create({ data: { tenantId, phone: randomUUID().slice(0, 20), name: 'Catalog owner', userType: 'super_admin' } })
  admin = jwt.sign({ sub: owner.id, tenantId })
  for (let i = 0; i < 2; i++) {
    const user = await db.user.create({ data: { tenantId, phone: randomUUID().slice(0, 20), name: 'Catalog sales', userType: 'sales' } })
    const token = jwt.sign({ sub: user.id, tenantId })
    if (i === 0) { staff = token; staffId = user.id } else noPrice = token
    const role = await db.role.create({ data: { tenantId, code: 'catalog-' + i, name: 'Catalog role ' + i } })
    await db.userRole.create({ data: { tenantId, userId: user.id, roleId: role.id } })
    for (const code of ['product:read', 'product:create', 'product:update', 'brand:manage', ...(i === 0 ? ['product:price:update'] : [])]) {
      let permission = await db.permission.findUnique({ where: { code } })
      if (!permission) { permission = await db.permission.create({ data: { code, name: code, type: 'api' } }); permissionIds.push(permission.id) }
      await db.rolePermission.create({ data: { tenantId, roleId: role.id, permissionId: permission.id } })
    }
  }
  for (let i = 0; i < 3; i++) {
    const tid = i === 2 ? tenants[1] : tenantId
    brands.push((await db.brand.create({ data: { tenantId: tid, code: 'CAT' + i, name: 'Catalog brand ' + i } })).id)
    categories.push((await db.productCategory.create({ data: { tenantId: tid, code: 'CAT' + i, name: 'Catalog category ' + i } })).id)
    products.push((await db.product.create({ data: { tenantId: tid, brandId: brands[i], categoryId: categories[i], name: 'Management ' + i, subtitle: 'Real product ' + i, code: 'CAT' + i + '-001' } })).id)
    skus.push((await db.productSku.create({ data: { tenantId: tid, productId: products[i], skuCode: 'CAT' + i + '-001-01', ...skuInput, stockNum: i === 0 ? 4 : 0, reservedNum: i === 0 ? 1 : 0 } })).id)
  }
  const scopedUsers = await db.user.findMany({ where: { tenantId, userType: 'sales' }, select: { id: true } })
  for (const user of scopedUsers) await db.userBrandAccess.create({ data: { tenantId, userId: user.id, brandId: brands[0] } })
  for (const tid of tenants) units.push((await db.unit.create({ data: { tenantId: tid, code: 'BAG', name: '袋' } })).id)
  units.push((await db.unit.create({ data: { tenantId, code: 'DISABLED', name: '停用单位', status: 'disabled' } })).id)
  const buyer = await db.user.create({ data: { tenantId, phone: randomUUID().slice(0, 20), name: 'Catalog buyer', userType: 'customer_user' } })
  customer = jwt.sign({ sub: buyer.id, tenantId })
  const module = await Test.createTestingModule({ controllers: [ProductController, BrandController], providers: [
      // Business fixture: session revocation itself is covered by auth-session.integration-spec.ts.
      { provide: AuthSessionService, useValue: { assertActive: async () => {} } },
    ProductService, ProductVisibilityService, ProductMutationGuard, BrandService, StaffAccessService, AuditService,
    { provide: PrismaService, useValue: db }, { provide: JwtService, useValue: jwt },
    { provide: ConfigService, useValue: new ConfigService({ JWT_ACCESS_SECRET: secret }) },
    { provide: REDIS, useValue: { get: async () => null, set: async () => 'OK' } }
  ] }).compile()
  app = module.createNestApplication(); app.setGlobalPrefix('api/v1')
  app.useGlobalPipes(new ValidationPipe({ transform: true, whitelist: true, forbidNonWhitelisted: true }))
  app.useGlobalInterceptors(new SuccessInterceptor()); app.useGlobalFilters(new AppFilter()); await app.init()
})

afterAll(async () => {
  if (app) await app.close()
  const where = { tenantId: { in: tenants } }
  await db.productCategory.updateMany({ where, data: { parentId: null } })
  for (const model of ['auditLog', 'userBrandAccess', 'userRole', 'rolePermission', 'role', 'productSku', 'product', 'productCategory', 'unit', 'brand', 'user'] as const) await (db[model] as any).deleteMany({ where })
  await db.permission.deleteMany({ where: { id: { in: permissionIds } } }); await db.tenant.deleteMany({ where: { id: { in: tenants } } }); await db.$disconnect()
})

it('keeps product lists, totals, details and SKU reads inside assigned brands and tenant', async () => {
  expect((await call('get', 'products').expect(200)).body.data.items.map((x: any) => x.id)).toEqual([products[0]])
  expect((await call('get', `products?brandId=${brands[1]}&includeDisabled=true`).expect(200)).body.data.total).toBe(0)
  expect((await call('get', 'products', undefined, admin).expect(200)).body.data.total).toBe(2)
  const staffBrands = (await call('get', 'brands').expect(200)).body.data
  expect(staffBrands.map((x: any) => x.id)).toEqual([brands[0]])
  expect(Object.keys(staffBrands[0]).sort()).toEqual(['code', 'description', 'id', 'logoUrl', 'name'])
  expect((await call('get', 'brands', undefined, admin).expect(200)).body.data).toHaveLength(2)
  expect((await call('get', 'brands', undefined, customer).expect(200)).body.data).toHaveLength(2)
  for (const id of products.slice(1)) {
    await call('get', 'products/' + id).expect(404)
    await call('get', `products/${id}/skus`).expect(404)
  }
  await call('get', `products?brandId=${brands[0]}oops`).expect(400)
})

it('rejects mixed-scope batch status/archive and SKU mutations before any partial write', async () => {
  for (const id of products.slice(1)) {
    await call('patch', 'products/batch-status', { productIds: [products[0], id], status: 'disabled' }).expect(404)
    await call('patch', 'products/batch-archive', { productIds: [products[0], id] }).expect(404)
    await call('post', `products/${id}/skus`, skuInput).expect(404)
    await call('delete', 'products/' + id).expect(404)
  }
  expect((await db.product.findUniqueOrThrow({ where: { id: products[0] } })).status).toBe('active')
  await call('patch', `skus/${skus[1]}`, { specText: 'Forbidden' }).expect(400)
  await call('patch', `skus/${skus[0]}`, { basePrice: '9' }, noPrice).expect(403)
  await call('post', `products/${products[0]}/skus`, skuInput, noPrice).expect(403)
  await call('patch', `skus/${skus[0]}`, { stockNum: 99 }).expect(400)
  await call('patch', `skus/${skus[0]}`, { saleUnit: '箱' }).expect(400)
  expect(await db.productSku.findUniqueOrThrow({ where: { id: skus[0] } })).toMatchObject({ stockNum: 4, reservedNum: 1, saleUnit: '袋' })
})

it('scopes brand list and direct writes; retains assigned access through disable and restore', async () => {
  expect((await call('get', 'admin/brands').expect(200)).body.data.map((x: any) => x.id)).toEqual([brands[0]])
  for (const id of brands.slice(1)) {
    await call('patch', 'admin/brands/' + id, { name: 'Forbidden' }).expect(404)
    await call('delete', 'admin/brands/' + id).expect(404)
    await call('patch', `admin/brands/${id}/restore`).expect(404)
  }
  await call('post', 'admin/brands', { name: 'Out of scope creation', code: 'DENIED' }).expect(403)
  expect(await db.brand.count({ where: { tenantId: tenants[0], code: 'DENIED' } })).toBe(0)
  await call('patch', 'admin/brands/' + brands[0], { name: 'Renamed brand' }).expect(200)
  expect(await db.product.findUniqueOrThrow({ where: { id: products[0] } })).toMatchObject({ code: 'CAT0-001', name: 'Renamed brandCatalog category 0', subtitle: 'Real product 0' })
  await call('delete', 'admin/brands/' + brands[0]).expect(200)
  expect((await call('get', 'admin/brands?status=disabled').expect(200)).body.data.map((x: any) => x.id)).toEqual([brands[0]])
  await call('patch', `admin/brands/${brands[0]}/restore`).expect(200)
  expect((await db.brand.findUniqueOrThrow({ where: { id: brands[0] } })).status).toBe('active')
})

it('persists and clears a brand image and rejects unsafe URL schemes before changing the brand', async () => {
  const logoUrl = 'https://example.com/qa-brand.png'
  await call('patch', 'admin/brands/' + brands[0], { logoUrl }).expect(200)
  expect((await call('get', 'brands', undefined, customer).expect(200)).body.data.find((x: any) => x.id === brands[0]).logoUrl).toBe(logoUrl)
  await call('patch', 'admin/brands/' + brands[0], { logoUrl: 'javascript:alert(1)' }).expect(400)
  expect((await db.brand.findUniqueOrThrow({ where: { id: brands[0] } })).logoUrl).toBe(logoUrl)
  await call('patch', 'admin/brands/' + brands[0], { logoUrl: null, description: null }).expect(200)
  expect((await db.brand.findUniqueOrThrow({ where: { id: brands[0] } })).logoUrl).toBeNull()
})

it('orders public categories by the persisted administrator order and leaves product codes and names unchanged', async () => {
  const before = await db.product.findUniqueOrThrow({ where: { id: products[0] } })
  await call('patch', 'product-categories/' + categories[0], { sortOrder: 900 }, admin).expect(200)
  await call('patch', 'product-categories/' + categories[1], { sortOrder: 10 }, admin).expect(200)
  const result = (await call('get', 'product-categories', undefined, customer).expect(200)).body.data
  expect(result.map((x: any) => x.id)).toEqual([categories[1], categories[0]])
  const after = await db.product.findUniqueOrThrow({ where: { id: products[0] } })
  expect(after.code).toBe(before.code)
  expect(after.subtitle).toBe(before.subtitle)
  expect(after.name).toBe(before.name)
})

it('rejects cross-tenant or disabled units/categories without allocating or changing products', async () => {
  const before = await db.productCategory.findUniqueOrThrow({ where: { id: categories[0] } })
  for (const unitId of [units[1], units[2]]) {
    await call('post', 'products', { brandId: brands[0], categoryId: categories[0], subtitle: 'Invalid association', unitId }).expect(400)
    await call('patch', 'products/' + products[0], { unitId }).expect(400)
  }
  await call('patch', 'products/' + products[0], { categoryId: categories[2] }).expect(400)
  expect((await db.productCategory.findUniqueOrThrow({ where: { id: categories[0] } })).productSequence).toBe(before.productSequence)
  expect(await db.product.findUniqueOrThrow({ where: { id: products[0] } })).toMatchObject({ unitId: null, categoryId: categories[0], code: 'CAT0-001' })
  await call('patch', 'products/' + products[0], { unitId: units[0] }).expect(200)
})

it('validates shared tenant category parents, rejects cycles and safely handles parents with children', async () => {
  await call('post', 'product-categories', { code: 'FOREIGN-PARENT', name: 'Invalid', parentId: categories[2] }).expect(400)
  await call('patch', `product-categories/${categories[0]}`, { parentId: categories[0] }).expect(400)
  const root = (await call('post', 'product-categories', { code: 'ROOT', name: 'Root' }).expect(201)).body.data
  const child = (await call('post', 'product-categories', { code: 'CHILD', name: 'Child', parentId: root.id }).expect(201)).body.data
  await call('patch', `product-categories/${root.id}`, { parentId: child.id }).expect(400)
  expect((await db.productCategory.findUniqueOrThrow({ where: { id: root.id } })).parentId).toBeNull()
  expect((await call('delete', `product-categories/${root.id}`).expect(200)).body.data.deletionMode).toBe('disabled')
  await call('post', 'product-categories', { code: 'DISABLED-PARENT', name: 'Invalid', parentId: root.id }).expect(400)
  await call('patch', `admin/product-categories/${root.id}/restore`).expect(200)
  await call('delete', `product-categories/${child.id}`).expect(200)
  expect((await call('delete', `product-categories/${root.id}`).expect(200)).body.data.deletionMode).toBe('physical')
  for (const body of [{ name: '   ' }, { name: null }, { parentId: 0 }, { code: 'x'.repeat(65) }]) await call('patch', 'product-categories/' + categories[0], body).expect(400)
  await call('get', 'admin/product-categories', undefined, customer).expect(403)
  await call('patch', 'product-categories/' + categories[2], { name: 'Forbidden' }).expect(404)
})

it('allocates unique sequential SKU codes concurrently and ignores client-supplied codes', async () => {
  await db.productSku.create({ data: { tenantId: tenants[0], productId: products[0], skuCode: 'CAT0-001-09', ...skuInput, status: 'disabled' } })
  const results = await Promise.all([1, 2].map(index => call('post', `products/${products[0]}/skus`, { ...skuInput, specText: 'Copy ' + index, skuCode: 'CLIENT-IGNORED', stockNum: 0 }).expect(201)))
  expect(results.map(x => x.body.data.skuCode).sort()).toEqual(['CAT0-001-10', 'CAT0-001-11'])
  expect(results.every(x => x.body.data.stockNum === 0 && x.body.data.reservedNum === 0)).toBe(true)
  await call('post', `products/${products[0]}/skus`, { ...skuInput, stockNum: 2 }).expect(400)
  await call('post', `products/${products[0]}/skus`, { ...skuInput, basePrice: '-1' }).expect(400)
})

it('removes revoked brand access immediately from both read and write interfaces', async () => {
  await db.userBrandAccess.deleteMany({ where: { tenantId: tenants[0], userId: staffId, brandId: brands[0] } })
  expect((await call('get', 'admin/brands').expect(200)).body.data).toEqual([])
  expect((await call('get', 'brands').expect(200)).body.data).toEqual([])
  expect((await call('get', 'products').expect(200)).body.data.total).toBe(0)
  await call('patch', `products/${products[0]}/status`, { status: 'disabled' }).expect(404)
  await call('patch', `admin/brands/${brands[0]}`, { name: 'Revoked access' }).expect(404)
})
