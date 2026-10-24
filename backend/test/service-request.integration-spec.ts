import { randomUUID } from 'node:crypto'
import { INestApplication, ValidationPipe } from '@nestjs/common'
import { ConfigService } from '@nestjs/config'
import { JwtService } from '@nestjs/jwt'
import { Test } from '@nestjs/testing'
import { PrismaClient } from '@prisma/client'
import request from 'supertest'
import { ServiceRequestController } from '../src/service-request/service-request.controller'
import { ServiceRequestService } from '../src/service-request/service-request.service'
import { AuthSessionService } from '../src/auth/auth-session.service'
import { StaffAccessService } from '../src/auth/staff-access.service'
import { PrismaService } from '../src/prisma.service'

const database = new URL(process.env.TEST_DATABASE_URL || 'invalid://missing')
if (database.protocol !== 'mysql:' || !['127.0.0.1', 'localhost', '::1', '[::1]'].includes(database.hostname) || !database.pathname.endsWith('_test') || [...database.searchParams.keys()].some(key => /host|port|url|path|socket|database/i.test(key))) throw new Error('Isolated loopback _test database required')
const db = new PrismaClient({ datasources: { db: { url: database.toString() } } })
const secret = randomUUID(), jwt = new JwtService({ secret })
const tenants: number[] = [], createdPermissions: number[] = [], customers: any[] = [], buyers: any[] = [], brands: any[] = [], orders: any[] = []
let app: INestApplication, admin: any, sales: any, secondBuyer: any, salesRoleId: number, permissionId: number
const token = (user: any) => jwt.sign({ sub: user.id, tenantId: user.tenantId })
const call = (method: 'get' | 'post' | 'patch', path = '', user = buyers[0], body?: object) => {
  const req = request(app.getHttpServer())[method]('/api/v1/service-requests' + path).auth(token(user), { type: 'bearer' })
  return body ? req.send(body) : req
}
const input = (extra: object = {}) => ({ clientKey: randomUUID(), type: 'profile_change', subject: '更正门店资料', description: '本地隔离测试，无真实更改', ...extra })
const create = async (extra: object = {}, user = buyers[0]) => (await call('post', '/mine', user, input(extra)).expect(201)).body

beforeAll(async () => {
  for (let i = 0; i < 2; i++) tenants.push((await db.tenant.create({ data: { code: randomUUID(), name: 'Service request fixture' } })).id)
  admin = await db.user.create({ data: { tenantId: tenants[0], phone: randomUUID().slice(0, 20), name: 'Service administrator', userType: 'super_admin' } })
  sales = await db.user.create({ data: { tenantId: tenants[0], phone: randomUUID().slice(0, 20), name: 'Service sales', userType: 'sales' } })
  const role = await db.role.create({ data: { tenantId: tenants[0], code: randomUUID(), name: 'Service role' } }); salesRoleId = role.id
  await db.userRole.create({ data: { tenantId: tenants[0], userId: sales.id, roleId: role.id } })
  let permission = await db.permission.findUnique({ where: { code: 'customer:manage' } })
  if (!permission) { permission = await db.permission.create({ data: { code: 'customer:manage', name: 'Customer manage', type: 'api' } }); createdPermissions.push(permission.id) }
  permissionId = permission.id
  await db.rolePermission.create({ data: { tenantId: tenants[0], roleId: role.id, permissionId } })
  for (let i = 0; i < 3; i++) {
    const tenantId = tenants[i === 2 ? 1 : 0]
    customers.push(await db.customer.create({ data: { tenantId, customerName: 'Service customer ' + i, ...(i === 0 ? { salesOwnerId: sales.id } : {}) } }))
    buyers.push(await db.user.create({ data: { tenantId, customerId: customers[i].id, phone: randomUUID().slice(0, 20), name: 'Service buyer ' + i, userType: 'customer_user' } }))
    brands.push(await db.brand.create({ data: { tenantId, code: randomUUID().slice(0, 20), name: 'Service brand ' + i } }))
    orders.push(await db.order.create({ data: { tenantId, customerId: customers[i].id, brandId: brands[i].id, userId: buyers[i].id, orderNo: randomUUID(), totalAmount: '1', payableAmount: '1' } }))
  }
  secondBuyer = await db.user.create({ data: { tenantId: tenants[0], customerId: customers[0].id, phone: randomUUID().slice(0, 20), name: 'Same customer separate user', userType: 'customer_user' } })
  await db.userBrandAccess.create({ data: { tenantId: tenants[0], userId: sales.id, brandId: brands[0].id } })
  const module = await Test.createTestingModule({ controllers: [ServiceRequestController], providers: [ServiceRequestService, StaffAccessService,
    { provide: PrismaService, useValue: db }, { provide: JwtService, useValue: jwt },
    { provide: ConfigService, useValue: new ConfigService({ JWT_ACCESS_SECRET: secret }) },
    // This suite tests real DB/business scopes; real Redis session guards have their own integration suite.
    { provide: AuthSessionService, useValue: { assertActive: async () => {} } }
  ] }).compile()
  app = module.createNestApplication(); app.setGlobalPrefix('api/v1')
  app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true, forbidNonWhitelisted: true })); await app.init()
})

afterAll(async () => {
  await app?.close()
  const where = { tenantId: { in: tenants } }
  for (const model of ['serviceRequest', 'auditLog', 'order', 'userBrandAccess', 'userRole', 'rolePermission', 'role'] as const) await (db[model] as any).deleteMany({ where })
  await db.customer.updateMany({ where, data: { salesOwnerId: null } })
  await db.user.deleteMany({ where }); await db.customer.deleteMany({ where }); await db.brand.deleteMany({ where })
  await db.permission.deleteMany({ where: { id: { in: createdPermissions } } }); await db.tenant.deleteMany({ where: { id: { in: tenants } } }); await db.$disconnect()
})

it('submits all five manual request types without changing account, stock, order or money', async () => {
  const before = await db.order.findUniqueOrThrow({ where: { id: orders[0].id } })
  for (const type of ['after_sales', 'profile_change', 'account_closure', 'invoice', 'delivery']) {
    expect(await create({ type, orderId: orders[0].id })).toMatchObject({ status: 'pending', version: 0 })
  }
  expect(await db.order.findUniqueOrThrow({ where: { id: orders[0].id } })).toEqual(before)
  expect((await db.user.findUniqueOrThrow({ where: { id: buyers[0].id } })).status).toBe('active')
  expect(await db.stockMovement.count({ where: { tenantId: tenants[0] } })).toBe(0)
  expect(await db.orderRefund.count({ where: { tenantId: tenants[0] } })).toBe(0)
})

it('makes repeated submissions idempotent and rejects changing an already used request key', async () => {
  const body = input()
  const first = await call('post', '/mine', buyers[0], body).expect(201)
  const second = await call('post', '/mine', buyers[0], body).expect(201)
  expect(second.body.id).toBe(first.body.id)
  await call('post', '/mine', buyers[0], { ...body, description: 'Changed retry payload' }).expect(409)
  expect(await db.auditLog.count({ where: { tenantId: tenants[0], targetType: 'service_request', targetId: String(first.body.id), action: 'create' } })).toBe(1)
})

it('keeps customer details private even between two logins of the same purchasing customer', async () => {
  const own = await create()
  for (const user of [secondBuyer, buyers[1], buyers[2]]) await call('get', `/mine/${own.id}`, user).expect(404)
  await call('get', '', buyers[0]).expect(403)
  await call('patch', `/${own.id}`, buyers[0], { status: 'processing', message: 'Not staff', expectedVersion: 0 }).expect(403)
  const reassigned = await db.user.create({ data: { tenantId: tenants[0], customerId: customers[0].id, userType: 'customer_user', name: 'Reassignment fixture', phone: randomUUID().slice(0, 20) } })
  const body = input(), old = (await call('post', '/mine', reassigned, body).expect(201)).body
  await db.user.update({ where: { id: reassigned.id }, data: { customerId: customers[1].id } })
  try {
    await call('post', '/mine', reassigned, body).expect(409)
    await call('get', `/mine/${old.id}`, reassigned).expect(404)
  } finally { await db.user.update({ where: { id: reassigned.id }, data: { customerId: customers[0].id } }) }
})

it('rejects associations with another customer or tenant order and never lists them as options', async () => {
  for (const orderId of [orders[1].id, orders[2].id]) await call('post', '/mine', buyers[0], input({ orderId })).expect(404)
  expect((await call('get', '/order-options', buyers[0]).expect(200)).body.map((row: any) => row.id)).toEqual([orders[0].id])
})

it('enforces staff customer assignments, brand access and tenant boundaries', async () => {
  const own = await create({ orderId: orders[0].id }), other = await create({}, buyers[1]), foreign = await create({}, buyers[2])
  await call('get', `/${own.id}`, sales).expect(200)
  await call('get', `/${other.id}`, sales).expect(404)
  await call('get', `/${foreign.id}`, admin).expect(404)
  await db.userBrandAccess.deleteMany({ where: { tenantId: tenants[0], userId: sales.id } })
  try { await call('get', `/${own.id}`, sales).expect(404) }
  finally { await db.userBrandAccess.create({ data: { tenantId: tenants[0], userId: sales.id, brandId: brands[0].id } }) }
})

it('records acceptance, result and customer-readable history without implementing automatic account closure', async () => {
  const own = await create({ type: 'account_closure' })
  await call('patch', `/${own.id}`, admin, { status: 'completed', message: 'Cannot skip acceptance', expectedVersion: 0 }).expect(409)
  const accepted = (await call('patch', `/${own.id}`, admin, { status: 'processing', message: '已受理，人工核实', expectedVersion: 0 }).expect(200)).body
  expect(accepted.version).toBe(1)
  const body = { status: 'completed', message: '已联系客户核实，仅记录处理结果', expectedVersion: 1 }
  await call('patch', `/${own.id}`, admin, body).expect(200)
  await call('patch', `/${own.id}`, admin, body).expect(200)
  const result = (await call('get', `/mine/${own.id}`).expect(200)).body
  expect(result.events).toHaveLength(3); expect(result.version).toBe(2)
  expect(result.status).toBe('completed')
  expect((await db.user.findUniqueOrThrow({ where: { id: buyers[0].id } })).status).toBe('active')
  await call('patch', `/${own.id}`, admin, { status: 'processing', message: 'Cannot reopen', expectedVersion: 2 }).expect(409)
})

it('serializes competing staff replies and rejects a stale version without duplicate events', async () => {
  const own = await create()
  const results = await Promise.all(['处理说明A', '处理说明B'].map(message => call('patch', `/${own.id}`, admin, { status: 'processing', message, expectedVersion: 0 })))
  expect(results.map(row => row.status).sort()).toEqual([200, 409])
  const result = (await call('get', `/mine/${own.id}`).expect(200)).body
  expect(result.events).toHaveLength(2); expect(result.version).toBe(1)
})

it('revoking assignment or customer-management permission immediately blocks staff handling', async () => {
  const own = await create()
  await db.customer.update({ where: { id: customers[0].id }, data: { salesOwnerId: null } })
  try { await call('get', `/${own.id}`, sales).expect(404) }
  finally { await db.customer.update({ where: { id: customers[0].id }, data: { salesOwnerId: sales.id } }) }
  await db.rolePermission.deleteMany({ where: { tenantId: tenants[0], roleId: salesRoleId, permissionId } })
  try { await call('patch', `/${own.id}`, sales, { status: 'processing', message: 'revoked', expectedVersion: 0 }).expect(403) }
  finally { await db.rolePermission.create({ data: { tenantId: tenants[0], roleId: salesRoleId, permissionId } }) }
})

it('validates paging, statuses and input ownership fields before reaching a mutation', async () => {
  await request(app.getHttpServer()).get('/api/v1/service-requests/mine').expect(401)
  await call('get', '/mine?page=0').expect(400)
  await call('get', '/mine?pageSize=101').expect(400)
  await call('post', '/mine', buyers[0], input({ requesterId: buyers[1].id })).expect(400)
  await call('post', '/mine', buyers[0], input({ subject: ' ' })).expect(400)
  await call('post', '/mine', buyers[0], input({ type: 'refund_money' })).expect(400)
})

it('paginates customer history without leaking another requester or duplicating a page', async () => {
  await db.serviceRequest.createMany({ data: Array.from({ length: 21 }, () => ({ tenantId: tenants[0], customerId: customers[0].id,
    requesterId: secondBuyer.id, clientKey: randomUUID(), requestNo: 'SR' + randomUUID(), type: 'delivery', subject: '分页隔离数据', description: 'Fixture only', status: 'completed' })) })
  const first = (await call('get', '/mine?page=1&pageSize=20', secondBuyer).expect(200)).body
  const second = (await call('get', '/mine?page=2&pageSize=20', secondBuyer).expect(200)).body
  expect(first.total).toBe(21); expect(first.items).toHaveLength(20); expect(second.items).toHaveLength(1)
  expect(new Set([...first.items, ...second.items].map(row => row.id)).size).toBe(21)
  expect((await call('get', '/mine?status=pending', secondBuyer).expect(200)).body.total).toBe(0)
})

it('caps outstanding requests but still permits a safe retry of an already accepted request', async () => {
  const user = await db.user.create({ data: { tenantId: tenants[0], customerId: customers[0].id, userType: 'customer_user', name: 'Queue cap fixture', phone: randomUUID().slice(0, 20) } })
  const body = input(), existing = (await call('post', '/mine', user, body).expect(201)).body
  await db.serviceRequest.createMany({ data: Array.from({ length: 19 }, () => ({ tenantId: tenants[0], customerId: customers[0].id,
    requesterId: user.id, clientKey: randomUUID(), requestNo: 'SR' + randomUUID(), type: 'delivery', subject: '限额隔离数据', description: 'Fixture only' })) })
  await call('post', '/mine', user, input()).expect(400)
  expect((await call('post', '/mine', user, body).expect(201)).body.id).toBe(existing.id)
  expect(await db.serviceRequest.count({ where: { tenantId: tenants[0], requesterId: user.id } })).toBe(20)
})

it('rolls back a new service request if its transaction audit cannot be written', async () => {
  const original = db.$transaction.bind(db), body = input()
  const transaction = jest.spyOn(db, '$transaction').mockImplementationOnce(((callback: any) => original(async tx => callback(new Proxy(tx, {
    get(target, property) {
      if (property === 'auditLog') return { ...target.auditLog, create: async () => { throw new Error('Synthetic audit outage') } }
      const value = Reflect.get(target, property)
      return typeof value === 'function' ? value.bind(target) : value
    }
  })))) as any)
  try { await expect(app.get(ServiceRequestService).create(buyers[0].id, body as any)).rejects.toThrow('Synthetic audit outage') }
  finally { transaction.mockRestore() }
  expect(await db.serviceRequest.count({ where: { tenantId: tenants[0], requesterId: buyers[0].id, clientKey: body.clientKey } })).toBe(0)
})
