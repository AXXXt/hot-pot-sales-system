import { AuthSessionService } from '../src/auth/auth-session.service'
import { randomUUID } from 'node:crypto'
import { INestApplication, ValidationPipe } from '@nestjs/common'
import { Test } from '@nestjs/testing'
import { ConfigService } from '@nestjs/config'
import { JwtService } from '@nestjs/jwt'
import { PrismaClient } from '@prisma/client'
import { Workbook } from 'exceljs'
import request from 'supertest'
import { InventoryController } from '../src/inventory/inventory.controller'
import { InventoryService } from '../src/inventory/inventory.service'
import { ExportController } from '../src/export/export.controller'
import { ExportService } from '../src/export/export.service'
import { StaffAccessService } from '../src/auth/staff-access.service'
import { PrismaService } from '../src/prisma.service'
import { AuditService } from '../src/audit/audit.service'
import { SuccessInterceptor } from '../src/success.interceptor'
import { AppFilter } from '../src/app.filter'

const url = process.env.TEST_DATABASE_URL
if (!url || !new URL(url).pathname.endsWith('_test')) throw Error('Isolated TEST_DATABASE_URL required')
const db = new PrismaClient({ datasources: { db: { url } } })
const secret = randomUUID(), jwt = new JwtService({ secret }), tenants: number[] = [], permissions: number[] = []
const skus: number[] = [], brands: number[] = [], adjustments: number[] = [], takes: number[] = []
let app: INestApplication, staff: string, admin: string, customerId: number, otherCustomer: number
const get = (path: string, token = staff) => request(app.getHttpServer()).get('/api/v1/' + path).set('Authorization', 'Bearer ' + token)

beforeAll(async () => {
  for (let i = 0; i < 2; i++) tenants.push((await db.tenant.create({ data: { code: randomUUID(), name: 'Scope integration' } })).id)
  const tenantId = tenants[0]
  const sales = await db.user.create({ data: { tenantId, userType: 'sales', name: 'Scoped sales tester', phone: 'scope-' + randomUUID().slice(0, 12) } })
  const owner = await db.user.create({ data: { tenantId, userType: 'super_admin', name: 'Scoped administrator', phone: 'scope-' + randomUUID().slice(0, 12) } })
  staff = jwt.sign({ sub: sales.id, tenantId }); admin = jwt.sign({ sub: owner.id, tenantId })
  const role = await db.role.create({ data: { tenantId, code: 'scope', name: 'Scope test role' } })
  await db.userRole.create({ data: { tenantId, userId: sales.id, roleId: role.id } })
  for (const code of ['inventory:read', 'inventory:adjust', 'order:read', 'customer:manage']) {
    let permission = await db.permission.findUnique({ where: { code } })
    if (!permission) { permission = await db.permission.create({ data: { code, name: code, type: 'api' } }); permissions.push(permission.id) }
    await db.rolePermission.create({ data: { tenantId, roleId: role.id, permissionId: permission.id } })
  }
  customerId = (await db.customer.create({ data: { tenantId, customerName: 'Allowed customer', salesOwnerId: sales.id } })).id
  otherCustomer = (await db.customer.create({ data: { tenantId, customerName: 'Other customer' } })).id
  for (let i = 0; i < 3; i++) {
    const rowTenant = i === 2 ? tenants[1] : tenantId
    const brand = await db.brand.create({ data: { tenantId: rowTenant, code: 'B' + i, name: 'Scope brand ' + i } }); brands.push(brand.id)
    const product = await db.product.create({ data: { tenantId: rowTenant, brandId: brand.id, code: 'P' + i, name: 'Management ' + i, subtitle: 'Real name ' + i } })
    const sku = await db.productSku.create({ data: { tenantId: rowTenant, productId: product.id, skuCode: 'P' + i + '-01', specText: '袋', saleUnit: '袋', basePrice: '10', minOrderQty: 1, stockNum: 10 } }); skus.push(sku.id)
    const adjustment = await db.stockAdjustment.create({ data: { tenantId: rowTenant, adjustmentNo: randomUUID(), type: 'manual_in' } }); adjustments.push(adjustment.id)
    await db.stockMovement.create({ data: { tenantId: rowTenant, skuId: sku.id, changeQty: 10, beforeQty: 0, afterQty: 10, type: 'manual_in', sourceType: 'adjustment', stockAdjustmentId: adjustment.id } })
    const take = await db.stocktake.create({ data: { tenantId: rowTenant, stocktakeNo: randomUUID(), items: { create: { tenantId: rowTenant, skuId: sku.id, systemQty: 10 } } } }); takes.push(take.id)
    if (i < 2) for (const customer of [customerId, otherCustomer]) await db.order.create({ data: { tenantId, brandId: brand.id, customerId: customer, orderNo: randomUUID(), totalAmount: '10', payableAmount: '10' } })
  }
  await db.userBrandAccess.create({ data: { tenantId, userId: sales.id, brandId: brands[0] } })
  const mixed = await db.stockAdjustment.create({ data: { tenantId, adjustmentNo: randomUUID(), type: 'manual_in' } })
  for (const skuId of skus.slice(0, 2)) await db.stockMovement.create({ data: { tenantId, skuId, stockAdjustmentId: mixed.id, type: 'manual_in', sourceType: 'adjustment', changeQty: 1, beforeQty: 0, afterQty: 1 } })
  await db.stocktake.create({ data: { tenantId, stocktakeNo: randomUUID(), items: { create: skus.slice(0, 2).map(skuId => ({ tenantId, skuId, systemQty: 10 })) } } })
  const module = await Test.createTestingModule({ controllers: [InventoryController, ExportController], providers: [
      // Business fixture: session revocation itself is covered by auth-session.integration-spec.ts.
      { provide: AuthSessionService, useValue: { assertActive: async () => {} } },
    InventoryService, ExportService, StaffAccessService,
    { provide: PrismaService, useValue: db }, { provide: JwtService, useValue: jwt },
    { provide: ConfigService, useValue: new ConfigService({ JWT_ACCESS_SECRET: secret }) },
    { provide: AuditService, useValue: { write: async () => {} } }
  ] }).compile()
  app = module.createNestApplication()
  app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true, forbidNonWhitelisted: true }))
  app.useGlobalInterceptors(new SuccessInterceptor()); app.useGlobalFilters(new AppFilter())
  app.setGlobalPrefix('api/v1'); await app.init()
})

afterAll(async () => {
  if (app) await app.close()
  const where = { tenantId: { in: tenants } }
  for (const model of ['stockMovement', 'stockAdjustment', 'stocktakeItem', 'stocktake', 'order', 'userBrandAccess', 'userRole', 'rolePermission', 'role', 'productSku', 'product', 'brand', 'customer', 'user'] as const) await (db[model] as any).deleteMany({ where })
  await db.permission.deleteMany({ where: { id: { in: permissions } } })
  await db.tenant.deleteMany({ where: { id: { in: tenants } } }); await db.$disconnect()
})

it('filters stock and movements by brand and tenant even with an explicit forbidden filter', async () => {
  expect((await get('inventory/stock').expect(200)).body.data.items.map((x: any) => x.id)).toEqual([skus[0]])
  expect((await get(`inventory/stock?brandId=${brands[1]}`).expect(200)).body.data.total).toBe(0)
  expect((await get('inventory/stock', admin).expect(200)).body.data.items.map((x: any) => x.id)).toEqual(skus.slice(0, 2))
  expect((await get('inventory/movements').expect(200)).body.data.items.map((x: any) => x.skuId)).toEqual([skus[0], skus[0]])
  expect((await get(`inventory/movements?skuId=${skus[1]}`).expect(200)).body.data.total).toBe(0)
})

it('protects document listings, direct identifiers and cancellation outside the assigned brand', async () => {
  expect((await get('inventory/adjustments').expect(200)).body.data.items.map((x: any) => x.id)).toEqual([adjustments[0]])
  expect((await get('inventory/stocktakes').expect(200)).body.data.items.map((x: any) => x.id)).toEqual([takes[0]])
  const detail = (await get(`inventory/stocktakes/${takes[0]}`).expect(200)).body.data.items[0].sku.product
  expect(detail.name).toBe('Real name 0'); expect(detail.managementLabel).toBe('Management 0')
  for (const index of [1, 2]) {
    await get(`inventory/adjustments/${adjustments[index]}`).expect(403)
    await get(`inventory/stocktakes/${takes[index]}`).expect(403)
    await request(app.getHttpServer()).post(`/api/v1/inventory/stocktakes/${takes[index]}/cancel`).set('Authorization', 'Bearer ' + staff).expect(403)
    expect((await db.stocktake.findUniqueOrThrow({ where: { id: takes[index] } })).status).toBe('draft')
  }
})

async function rows(path: string) {
  const result = await get(path).buffer(true).parse((res, done) => {
    const chunks: Buffer[] = []; res.on('data', chunk => chunks.push(chunk)); res.on('end', () => done(null, Buffer.concat(chunks)))
  }).expect(200)
  const workbook = new Workbook(); await workbook.xlsx.load(result.body)
  return workbook.worksheets[0].getSheetValues().slice(2).filter(Boolean) as any[]
}

it('exports only the authorized brand and assigned customers, with no filter-based scope bypass', async () => {
  const inventory = await rows('exports/inventory')
  expect(inventory).toHaveLength(1); expect(inventory[0][3]).toBe('Real name 0')
  const customers = await rows('exports/customers')
  expect(customers).toHaveLength(1); expect(customers[0][1]).toBe('Allowed customer')
  expect(await rows('exports/orders')).toHaveLength(1)
  expect(await rows(`exports/orders?customerId=${otherCustomer}`)).toHaveLength(0)
})
