import { AuthSessionService } from '../src/auth/auth-session.service'
import { randomUUID } from 'node:crypto'
import { INestApplication } from '@nestjs/common'
import { ConfigService } from '@nestjs/config'
import { JwtService } from '@nestjs/jwt'
import { Test } from '@nestjs/testing'
import { PrismaClient } from '@prisma/client'
import { Workbook } from 'exceljs'
import request from 'supertest'
import { ImportController } from '../src/import/import.controller'
import { ImportService } from '../src/import/import.service'
import { ProductService } from '../src/product/product.service'
import { ProductVisibilityService } from '../src/product/product-visibility.service'
import { MonitorController } from '../src/monitor/monitor.controller'
import { MetricsService } from '../src/monitor/metrics.service'
import { StaffAccessService } from '../src/auth/staff-access.service'
import { PrismaService } from '../src/prisma.service'
import { AuditService } from '../src/audit/audit.service'
import { REDIS } from '../src/redis.provider'
import { AppFilter } from '../src/app.filter'
import { SuccessInterceptor } from '../src/success.interceptor'
import { ExportController } from '../src/export/export.controller'
import { ExportService } from '../src/export/export.service'

const url = process.env.TEST_DATABASE_URL
if (!url || !new URL(url).pathname.endsWith('_test')) throw Error('Isolated TEST_DATABASE_URL required')
const secret = 'isolated-' + randomUUID(), db = new PrismaClient({ datasources: { db: { url } } }), jwt = new JwtService({ secret })
const tenants: number[] = [], permissionIds: number[] = [], brands: any[] = []
let app: INestApplication, admin: string, staff: string, noPrice: string, customer: string, productId: number, skuId: number, categoryId: number
const headers = ['品牌', '品牌编码', '分类', '商品名称', '商品编码', '规格', '单位', '基础价', '起订量', '库存', '协议价']
const row = () => ['品牌甲', 'BRANDA', '丸滑', '真实商品名', 'ORIGINAL-001', '500克/袋', '袋', '19.90', 1, '', ''] as Array<string | number>
async function excel(rows: unknown[][], columns = headers) {
  const wb = new Workbook(), sheet = wb.addWorksheet('商品'); sheet.addRow(columns); rows.forEach(x => sheet.addRow(x))
  return Buffer.from(await wb.xlsx.writeBuffer())
}
const upload = (buffer: Buffer, token = staff, query = '') => request(app.getHttpServer()).post('/api/v1/imports/products' + query).set('Authorization', 'Bearer ' + token).attach('file', buffer, 'fixture.xlsx')

beforeAll(async () => {
  for (let i = 0; i < 2; i++) tenants.push((await db.tenant.create({ data: { code: randomUUID(), name: 'Import scope fixture' } })).id)
  const tenantId = tenants[0], owner = await db.user.create({ data: { tenantId, phone: randomUUID().slice(0, 20), name: 'Owner', userType: 'super_admin' } })
  admin = jwt.sign({ sub: owner.id, tenantId })
  const scoped = await db.user.create({ data: { tenantId, phone: randomUUID().slice(0, 20), name: 'Scoped importer', userType: 'sales' } })
  staff = jwt.sign({ sub: scoped.id, tenantId })
  const limited = await db.user.create({ data: { tenantId, phone: randomUUID().slice(0, 20), name: 'No price importer', userType: 'warehouse' } })
  noPrice = jwt.sign({ sub: limited.id, tenantId })
  for (const [userId, codes] of [[scoped.id, ['product:update', 'product:create', 'product:price:update', 'customer:manage', 'monitor:read']], [limited.id, ['product:update']]] as const) {
    const role = await db.role.create({ data: { tenantId, code: randomUUID(), name: 'Import fixture role' } })
    await db.userRole.create({ data: { tenantId, userId, roleId: role.id } })
    for (const code of codes) {
      let permission = await db.permission.findUnique({ where: { code } })
      if (!permission) { permission = await db.permission.create({ data: { code, name: code, type: 'api' } }); permissionIds.push(permission.id) }
      await db.rolePermission.create({ data: { tenantId, roleId: role.id, permissionId: permission.id } })
    }
  }
  for (let i = 0; i < 3; i++) brands.push(await db.brand.create({ data: { tenantId: i === 2 ? tenants[1] : tenantId, code: 'BRAND' + String.fromCharCode(65 + i), name: ['品牌甲', '品牌乙', '外租户品牌'][i] } }))
  await db.userBrandAccess.create({ data: { tenantId, userId: scoped.id, brandId: brands[0].id } })
  await db.userBrandAccess.create({ data: { tenantId, userId: limited.id, brandId: brands[0].id } })
  categoryId = (await db.productCategory.create({ data: { tenantId, code: 'CAT', name: '丸滑' } })).id
  productId = (await db.product.create({ data: { tenantId, brandId: brands[0].id, categoryId, code: 'ORIGINAL-001', name: '品牌甲丸滑', subtitle: '真实商品名' } })).id
  skuId = (await db.productSku.create({ data: { tenantId, productId, skuCode: 'ORIGINAL-001-01', specText: '500克/袋', saleUnit: '袋', basePrice: '10', minOrderQty: 3, stockNum: 8, reservedNum: 2 } })).id
  const own = await db.customer.create({ data: { tenantId, customerName: 'Owned', contactPhone: '13000000001', salesOwnerId: scoped.id } })
  await db.customer.create({ data: { tenantId, customerName: 'Unassigned', contactPhone: '13000000002' } })
  const buyer = await db.user.create({ data: { tenantId, customerId: own.id, phone: randomUUID().slice(0, 20), name: 'Buyer', userType: 'customer_user' } })
  customer = jwt.sign({ sub: buyer.id, tenantId })
  const module = await Test.createTestingModule({ controllers: [ImportController, ExportController, MonitorController], providers: [
      // Business fixture: session revocation itself is covered by auth-session.integration-spec.ts.
      { provide: AuthSessionService, useValue: { assertActive: async () => {} } },ImportService, ExportService, ProductService, ProductVisibilityService, StaffAccessService, AuditService,
    { provide: PrismaService, useValue: db }, { provide: JwtService, useValue: jwt }, { provide: ConfigService, useValue: new ConfigService({ JWT_ACCESS_SECRET: secret }) },
    { provide: MetricsService, useValue: { getSummary: async () => ({ api: { requests: 0 } }), getAlerts: async () => [] } },
    { provide: REDIS, useValue: { get: async () => null, set: async () => 'OK' } }
  ] }).compile()
  app = module.createNestApplication(); app.setGlobalPrefix('api/v1'); app.useGlobalFilters(new AppFilter()); app.useGlobalInterceptors(new SuccessInterceptor()); await app.init()
})

afterAll(async () => {
  if (app) await app.close()
  const where = { tenantId: { in: tenants } }
  await db.user.updateMany({ where, data: { customerId: null } })
  for (const model of ['auditLog', 'customerPriceRule', 'userBrandAccess', 'userRole', 'rolePermission', 'role', 'productSku', 'product', 'productCategory', 'brand', 'customer', 'user'] as const) await (db[model] as any).deleteMany({ where })
  await db.permission.deleteMany({ where: { id: { in: permissionIds } } }); await db.tenant.deleteMany({ where: { id: { in: tenants } } }); await db.$disconnect()
})

it('imports the correct Excel columns while preserving existing stock, reservations and historical codes', async () => {
  const input = row(); input[8] = ''
  await upload(await excel([input])).expect(201)
  expect(await db.productSku.findUniqueOrThrow({ where: { id: skuId } })).toMatchObject({ stockNum: 8, reservedNum: 2, minOrderQty: 3, skuCode: 'ORIGINAL-001-01' })
  expect((await db.productSku.findUniqueOrThrow({ where: { id: skuId } })).basePrice.toString()).toBe('19.9')
  expect(await db.product.findUniqueOrThrow({ where: { id: productId } })).toMatchObject({ name: '品牌甲丸滑', subtitle: '真实商品名', code: 'ORIGINAL-001' })
})

it('reports invalid rows and rolls back earlier valid rows when a later relation fails', async () => {
  const before = await db.productSku.findUniqueOrThrow({ where: { id: skuId } }), first = row(), bad = row(); first[7] = '0.01'; bad[4] = 'MISSING'
  const result = await upload(await excel([first, bad])).expect(400)
  expect(result.body.data.errors).toEqual([expect.objectContaining({ row: 3 })])
  expect((await db.productSku.findUniqueOrThrow({ where: { id: skuId } })).basePrice.toString()).toBe(before.basePrice.toString())
  const invalid = row(); invalid[3] = ''
  await upload(await excel([first, invalid])).expect(400)
  const stock = row(); stock[9] = 99
  await upload(await excel([stock])).expect(400)
  expect((await db.productSku.findUniqueOrThrow({ where: { id: skuId } })).stockNum).toBe(8)
  const named = row(), aliased = row(); named[4] = ''; aliased[4] = ''; aliased[2] = 'CAT'; aliased[7] = '1.00'
  await upload(await excel([named, aliased])).expect(400)
  expect((await db.productSku.findUniqueOrThrow({ where: { id: skuId } })).basePrice.toString()).toBe(before.basePrice.toString())
})

it('prevents price, brand and customer-scope bypasses through the import endpoint', async () => {
  await upload(await excel([row()]), noPrice).expect(403)
  await upload(await excel([row()]), customer).expect(403)
  for (const brand of brands.slice(1)) { const outside = row(); outside[0] = brand.name; outside[1] = brand.code; await upload(await excel([outside])).expect(403) }
  const priced = row(); priced[10] = '9'
  await upload(await excel([priced]), staff, '?customerPhone=13000000002').expect(403)
  await upload(await excel([priced]), staff, '?customerPhone=13000000001').expect(201)
  expect((await db.customerPriceRule.findMany({ where: { tenantId: tenants[0] } }))).toHaveLength(1)
})

it('allocates ordinary product/SKU identities and safely reimports identical rows without duplicates', async () => {
  const input = row(); input[3] = '新增真实商品'; input[4] = ''
  const beforeProducts = await db.product.count({ where: { tenantId: tenants[0] } })
  const first = await upload(await excel([input, input]), admin).expect(201)
  expect(first.body.data.skipped).toBe(1)
  await upload(await excel([input]), admin).expect(201)
  const alias = [...input]; alias[2] = 'CAT'; alias[7] = '19.9'
  expect((await upload(await excel([input, alias]), admin).expect(201)).body.data.skipped).toBe(1)
  expect(await db.product.count({ where: { tenantId: tenants[0] } })).toBe(beforeProducts + 1)
  const created = await db.product.findFirstOrThrow({ where: { tenantId: tenants[0], subtitle: '新增真实商品' }, include: { skus: true } })
  expect(created.code).toMatch(/^BRANDA-.*-\d+$/); expect(created.skus).toHaveLength(1)
  expect(created.skus[0]).toMatchObject({ stockNum: 0, reservedNum: 0, skuCode: created.code + '-01' })
  expect(await db.auditLog.count({ where: { tenantId: tenants[0], operatorId: { not: null }, targetType: 'product_import' } })).toBeGreaterThan(0)
})

it('does not silently accept conflicting duplicates or restore a disabled brand', async () => {
  const first = row(), conflict = row(); conflict[7] = '1'
  await upload(await excel([first, conflict])).expect(400)
  await db.brand.update({ where: { id: brands[0].id }, data: { status: 'disabled' } })
  await upload(await excel([first]), admin).expect(400)
  expect((await db.brand.findUniqueOrThrow({ where: { id: brands[0].id } })).status).toBe('disabled')
  await db.brand.update({ where: { id: brands[0].id }, data: { status: 'active' } })
})

it('keeps global monitor behind fresh super-admin identity even if a normal staff role grants monitor:read', async () => {
  for (const path of ['summary', 'alerts']) {
    await request(app.getHttpServer()).get('/api/v1/monitor/' + path).set('Authorization', 'Bearer ' + staff).expect(403)
    await request(app.getHttpServer()).get('/api/v1/monitor/' + path).set('Authorization', 'Bearer ' + admin).expect(200)
    await request(app.getHttpServer()).get('/api/v1/monitor/' + path).expect(401)
  }
})

it('validates export filters and returns only assigned customer rows with Shanghai timestamps', async () => {
  await request(app.getHttpServer()).get('/api/v1/exports/orders?customerId=1oops').set('Authorization', 'Bearer ' + admin).expect(400)
  await request(app.getHttpServer()).get('/api/v1/exports/orders?status=invalid').set('Authorization', 'Bearer ' + admin).expect(400)
  await request(app.getHttpServer()).get('/api/v1/exports/customers').set('Authorization', 'Bearer ' + customer).expect(403)
  const result = await request(app.getHttpServer()).get('/api/v1/exports/customers').set('Authorization', 'Bearer ' + staff).buffer(true).parse((res, done) => {
    const chunks: Buffer[] = []; res.on('data', chunk => chunks.push(chunk)); res.on('end', () => done(null, Buffer.concat(chunks)))
  }).expect(200)
  const workbook = new Workbook(); await workbook.xlsx.load(result.body)
  expect(workbook.worksheets[0].rowCount).toBe(2)
  expect(workbook.worksheets[0].getRow(2).getCell(1).value).toBe('Owned')
  const own = await db.customer.findFirstOrThrow({ where: { tenantId: tenants[0], customerName: 'Owned' } })
  expect(workbook.worksheets[0].getRow(2).getCell(10).value).toBe(new Date(own.createdAt.getTime() + 8 * 3600_000).toISOString().slice(0, 19).replace('T', ' '))
})
