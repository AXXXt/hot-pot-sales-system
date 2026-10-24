import { AuthSessionService } from '../src/auth/auth-session.service'
import { randomUUID } from 'node:crypto'
import { INestApplication, ValidationPipe } from '@nestjs/common'
import { ConfigService } from '@nestjs/config'
import { JwtService } from '@nestjs/jwt'
import { Test } from '@nestjs/testing'
import { PrismaClient } from '@prisma/client'
import request from 'supertest'
import { CustomerController } from '../src/customer/customer.controller'
import { CustomerService } from '../src/customer/customer.service'
import { LeadController } from '../src/lead/lead.controller'
import { LeadService } from '../src/lead/lead.service'
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
const customers: number[] = [], leads: number[] = [], brands: number[] = [], products: number[] = [], skus: number[] = []
let app: INestApplication, staff: string, admin: string, staffId: number, foreignAdmin: number
const buyers: string[] = []
const call = (method: 'get' | 'post' | 'patch' | 'put' | 'delete', route: string, body?: object, token = staff) => {
  const req = request(app.getHttpServer())[method]('/api/v1/' + route).set('Authorization', 'Bearer ' + token)
  return body ? req.send(body) : req
}

beforeAll(async () => {
  for (let i = 0; i < 2; i++) tenants.push((await db.tenant.create({ data: { code: randomUUID(), name: 'Customer lead scope' } })).id)
  const tenantId = tenants[0]
  const sales = await db.user.create({ data: { tenantId, userType: 'sales', phone: randomUUID().slice(0, 20), name: 'Scoped sales' } })
  staffId = sales.id; staff = jwt.sign({ sub: staffId, tenantId })
  const owner = await db.user.create({ data: { tenantId, userType: 'super_admin', phone: randomUUID().slice(0, 20), name: 'Scoped admin' } })
  admin = jwt.sign({ sub: owner.id, tenantId })
  foreignAdmin = (await db.user.create({ data: { tenantId: tenants[1], userType: 'super_admin', phone: randomUUID().slice(0, 20), name: 'Foreign admin' } })).id
  const role = await db.role.create({ data: { tenantId, code: 'customer-lead-scope', name: 'Scope fixture role' } })
  await db.userRole.create({ data: { tenantId, userId: staffId, roleId: role.id } })
  for (const code of ['customer:manage', 'lead:read', 'lead:manage']) {
    let p = await db.permission.findUnique({ where: { code } })
    if (!p) { p = await db.permission.create({ data: { code, name: code, type: 'api' } }); permissionIds.push(p.id) }
    await db.rolePermission.create({ data: { tenantId, roleId: role.id, permissionId: p.id } })
  }
  for (let i = 0; i < 3; i++) {
    const tid = i === 2 ? tenants[1] : tenantId
    customers.push((await db.customer.create({ data: { tenantId: tid, customerName: 'Scope customer ' + i, salesOwnerId: i === 0 ? staffId : undefined, creditUsed: '10' } })).id)
    leads.push((await db.lead.create({ data: { tenantId: tid, phone: '1300000000' + i, storeName: 'Scope lead ' + i, assignedToId: i === 0 ? staffId : undefined } })).id)
    brands.push((await db.brand.create({ data: { tenantId: tid, code: 'S' + i, name: 'Scope brand ' + i } })).id)
    products.push((await db.product.create({ data: { tenantId: tid, brandId: brands[i], code: 'S' + i, name: 'Label', subtitle: 'Real product ' + i } })).id)
    skus.push((await db.productSku.create({ data: { tenantId: tid, productId: products[i], skuCode: 'S' + i + '-01', specText: '袋', saleUnit: '袋', basePrice: '10', minOrderQty: 1 } })).id)
  }
  await db.userBrandAccess.create({ data: { tenantId, userId: staffId, brandId: brands[0] } })
  for (const index of [0, 2]) {
    const buyer = await db.user.create({ data: { tenantId: index === 0 ? tenantId : tenants[1], customerId: customers[index], userType: 'customer_user', phone: randomUUID().slice(0, 20), name: 'Scope buyer' } })
    buyers.push(jwt.sign({ sub: buyer.id, tenantId: buyer.tenantId }))
  }
  const module = await Test.createTestingModule({ controllers: [CustomerController, LeadController], providers: [
      // Business fixture: session revocation itself is covered by auth-session.integration-spec.ts.
      { provide: AuthSessionService, useValue: { assertActive: async () => {} } },
    CustomerService, LeadService, StaffAccessService,
    { provide: PrismaService, useValue: db }, { provide: JwtService, useValue: jwt },
    { provide: ConfigService, useValue: new ConfigService({ JWT_ACCESS_SECRET: secret }) }, AuditService,
    { provide: REDIS, useValue: { incr: async () => 1, expire: async () => 1 } }
  ] }).compile()
  app = module.createNestApplication()
  app.setGlobalPrefix('api/v1'); app.useGlobalPipes(new ValidationPipe({ transform: true, whitelist: true, forbidNonWhitelisted: true }))
  app.useGlobalInterceptors(new SuccessInterceptor()); app.useGlobalFilters(new AppFilter()); await app.init()
})

afterAll(async () => {
  if (app) await app.close()
  const where = { tenantId: { in: tenants } }
  await db.user.updateMany({ where, data: { customerId: null } })
  await db.leadFollowUp.deleteMany({ where: { leadId: { in: leads } } })
  for (const model of ['auditLog', 'customerVisibleProduct', 'customerPriceRule', 'customerRepayment', 'customerLevel', 'userBrandAccess', 'userRole', 'rolePermission', 'role', 'lead', 'productSku', 'product', 'brand', 'customer', 'user'] as const) await (db[model] as any).deleteMany({ where })
  await db.permission.deleteMany({ where: { id: { in: permissionIds } } }); await db.tenant.deleteMany({ where: { id: { in: tenants } } }); await db.$disconnect()
})

it('lists only current-tenant assigned customers and rejects direct foreign or unassigned access', async () => {
  expect((await call('get', 'customers').expect(200)).body.data.items.map((x: any) => x.id)).toEqual([customers[0]])
  expect((await call('get', 'customers', undefined, admin).expect(200)).body.data.total).toBe(2)
  for (const id of customers.slice(1)) {
    await call('get', `customers/${id}`).expect(404)
    await call('patch', `customers/${id}`, { contactName: 'Forbidden change' }).expect(404)
    await call('post', `customers/${id}/approve`).expect(404)
    await call('post', `customers/${id}/reject`, { reason: 'Forbidden' }).expect(404)
    await call('get', `customers/${id}/repayments`).expect(404)
    await call('post', `customers/${id}/repayments`, { amount: '1', method: 'other' }).expect(404)
    expect((await db.customer.findUniqueOrThrow({ where: { id } })).creditUsed.toString()).toBe('10')
  }
})

it('scopes customer relations, creation, price rules and visibility changes', async () => {
  const created = (await call('post', 'customers', { customerName: 'Created scoped customer' }).expect(201)).body.data
  expect(created).toMatchObject({ tenantId: tenants[0], salesOwnerId: staffId })
  await call('patch', `customers/${customers[0]}`, { salesOwnerId: foreignAdmin }).expect(400)
  await call('post', 'customer-price-rules', { customerId: customers[0], skuId: skus[1], price: '8' }).expect(404)
  await call('post', 'customer-price-rules', { customerId: customers[2], skuId: skus[0], price: '8' }).expect(404)
  const rule = (await call('post', 'customer-price-rules', { customerId: customers[0], skuId: skus[0], price: '8' }).expect(201)).body.data
  expect(rule.tenantId).toBe(tenants[0])
  const prices = (await call('get', `customer-price-rules?customerId=${customers[0]}`).expect(200)).body.data
  expect(prices).toHaveLength(1)
  expect(prices[0].product).toMatchObject({ name: 'Real product 0', managementLabel: 'Label' })
  await call('get', `customer-price-rules?customerId=${customers[1]}`).expect(404)
  await call('put', `customers/${customers[0]}/product-visibility`, { mode: 'custom', productIds: [products[1]] }).expect(400)
  const visible = (await call('put', `customers/${customers[0]}/product-visibility`, { mode: 'custom', productIds: [products[0]] }).expect(200)).body.data
  expect(visible.products[0]).toMatchObject({ name: 'Real product 0', managementLabel: 'Label' })
  await call('put', `customers/${customers[0]}/product-visibility`, { mode: 'all' }).expect(403)
  await call('delete', `customer-price-rules/${rule.id}`).expect(200)
  expect((await db.customerPriceRule.findUniqueOrThrow({ where: { id: rule.id } })).status).toBe('disabled')
})

it('scopes lead list, counters and direct updates to the assigned lead and current tenant', async () => {
  expect((await call('get', 'leads').expect(200)).body.data.items.map((x: any) => x.id)).toEqual([leads[0]])
  expect((await call('get', 'leads/stats').expect(200)).body.data.total).toBe(1)
  expect((await call('get', 'leads', undefined, admin).expect(200)).body.data.total).toBe(2)
  expect((await call('get', `leads?assignedToId=${foreignAdmin}`).expect(200)).body.data.total).toBe(0)
  for (const id of leads.slice(1)) {
    await call('get', `leads/${id}`).expect(404)
    await call('patch', `leads/${id}`, { status: 'converted' }).expect(404)
    await call('post', `leads/${id}/follow-ups`, { content: 'Forbidden follow up' }).expect(404)
    expect((await db.lead.findUniqueOrThrow({ where: { id } })).status).toBe('new')
  }
})

it('permits a scoped follow-up, rejects invalid assignees and records correct audit tenant', async () => {
  await call('patch', `leads/${leads[0]}`, { assignedToId: foreignAdmin }).expect(400)
  await call('post', `leads/${leads[0]}/follow-ups`, { content: '   ' }).expect(400)
  await call('post', `leads/${leads[0]}/follow-ups`, { content: 'QA valid follow up', nextFollowUpAt: '2030-01-01T00:00:00.000Z' }).expect(201)
  const detail = (await call('get', `leads/${leads[0]}`).expect(200)).body.data
  expect(detail).toMatchObject({ status: 'contacted', assignedToId: staffId })
  expect(detail.followUps).toHaveLength(1)
  expect(await db.auditLog.count({ where: { tenantId: tenants[0], operatorId: staffId } })).toBeGreaterThan(0)
  for (const route of ['customers?page=0', 'customers?pageSize=100000', 'leads?page=-1', 'leads?pageSize=100000']) await call('get', route).expect(400)
})

it('keeps level and customer-specific prices inside the tenant and prevents buyer management access', async () => {
  const level = (await call('post', 'customer-levels', { brandId: brands[0], name: 'Fixture grade', code: 'fixture-grade', discountRate: '0.95' }).expect(201)).body.data
  expect(level.tenantId).toBe(tenants[0])
  expect((await call('get', 'customer-levels').expect(200)).body.data.map((x: any) => x.id)).toEqual([level.id])
  await call('post', 'customer-levels', { brandId: brands[2], name: 'Forbidden', code: 'forbidden' }).expect(404)
  const first = (await call('post', 'customer-price-rules', { customerId: customers[0], skuId: skus[0], price: '8' }).expect(201)).body.data
  const second = (await call('post', 'customer-price-rules', { customerId: customers[0], skuId: skus[0], price: '7.50' }).expect(201)).body.data
  expect(second).toMatchObject({ id: first.id, status: 'active', price: '7.5' })
  const ownPrices = (await call('get', 'customers/me/price-rules', undefined, buyers[0]).expect(200)).body.data
  expect(ownPrices).toHaveLength(1)
  expect(ownPrices[0].product).toMatchObject({ name: 'Real product 0', managementLabel: 'Label' })
  expect((await call('get', 'customers/me/price-rules', undefined, buyers[1]).expect(200)).body.data).toHaveLength(0)
  for (const token of buyers) {
    await call('get', 'customers', undefined, token).expect(403)
    await call('post', 'customer-price-rules', { customerId: customers[0], skuId: skus[0], price: '1' }, token).expect(403)
    await call('post', `leads/${leads[0]}/follow-ups`, { content: 'Forbidden buyer change' }, token).expect(403)
  }
})

it('rechecks role revocation and disabled users on the next request', async () => {
  const permission = await db.permission.findUniqueOrThrow({ where: { code: 'customer:manage' } })
  await db.rolePermission.deleteMany({ where: { tenantId: tenants[0], permissionId: permission.id } })
  await call('patch', `customers/${customers[0]}`, { contactName: 'Revoked change' }).expect(403)
  await db.user.update({ where: { id: staffId }, data: { status: 'disabled' } })
  await call('get', `leads/${leads[0]}`).expect(401)
  expect((await db.customer.findUniqueOrThrow({ where: { id: customers[0] } })).contactName).toBeNull()
})
