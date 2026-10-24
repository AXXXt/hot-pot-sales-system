import { AuthSessionService } from '../src/auth/auth-session.service'
import { randomUUID } from 'node:crypto'
import { INestApplication, ValidationPipe } from '@nestjs/common'
import { ConfigService } from '@nestjs/config'
import { JwtService } from '@nestjs/jwt'
import { Test } from '@nestjs/testing'
import { PrismaClient } from '@prisma/client'
import request from 'supertest'
import { UserController } from '../src/user/user.controller'
import { UserService } from '../src/user/user.service'
import { CustomerController } from '../src/customer/customer.controller'
import { CustomerService } from '../src/customer/customer.service'
import { StaffAccessService } from '../src/auth/staff-access.service'
import { SmsService } from '../src/auth/sms.service'
import { PrismaService } from '../src/prisma.service'
import { AuditService } from '../src/audit/audit.service'
import { SuccessInterceptor } from '../src/success.interceptor'
import { AppFilter } from '../src/app.filter'

const url = process.env.TEST_DATABASE_URL
let target: URL
try { target = new URL(url || '') } catch { throw Error('Local isolated TEST_DATABASE_URL required') }
if (target.protocol !== 'mysql:' || !['localhost', '127.0.0.1', '[::1]'].includes(target.hostname) || !target.pathname.endsWith('_test')) throw Error('Local isolated TEST_DATABASE_URL required')
const db = new PrismaClient({ datasources: { db: { url } } })
const secret = randomUUID(), jwt = new JwtService({ secret }), tenants: number[] = [], createdPermissions: number[] = []
let app: INestApplication, managementId: number
const token = (user: { id: number; tenantId: number }) => jwt.sign({ sub: user.id, tenantId: user.tenantId })
const call = (authorization: string, method: 'get' | 'post' | 'patch', route: string, body?: object) => {
  const req = request(app.getHttpServer())[method]('/api/v1/' + route).set('Authorization', 'Bearer ' + authorization)
  return body ? req.send(body) : req
}

async function fixture(backup = false) {
  const tenantId = (await db.tenant.create({ data: { code: randomUUID(), name: 'Admin recovery fixture' } })).id
  tenants.push(tenantId)
  const user = (userType: 'super_admin' | 'admin' | 'sales') => db.user.create({ data: { tenantId, userType, phone: randomUUID().slice(0, 20), name: 'Local recovery ' + userType } })
  const owner = await user('super_admin'), manager = await user('admin'), staff = await user('sales')
  const second = backup ? await user('super_admin') : null
  const customer = await db.customer.create({ data: { tenantId, customerName: 'Local associated customer' } })
  const role = await db.role.create({ data: { tenantId, code: randomUUID(), name: 'Local management role' } })
  await db.rolePermission.create({ data: { tenantId, roleId: role.id, permissionId: managementId } })
  await db.userRole.createMany({ data: [owner, manager].map(person => ({ tenantId, roleId: role.id, userId: person.id })) })
  return { tenantId, owner, manager, staff, second, customer, role, ownerToken: token(owner), managerToken: token(manager) }
}

beforeAll(async () => {
  let permission = await db.permission.findUnique({ where: { code: 'role:manage' } })
  if (!permission) { permission = await db.permission.create({ data: { code: 'role:manage', name: 'Local role management', type: 'api' } }); createdPermissions.push(permission.id) }
  if (permission.status !== 'active') throw Error('Active role:manage permission required for isolated HTTP fixture')
  managementId = permission.id
  const module = await Test.createTestingModule({ controllers: [UserController, CustomerController], providers: [
      // Business fixture: session revocation itself is covered by auth-session.integration-spec.ts.
      { provide: AuthSessionService, useValue: { assertActive: async () => {} } },
    UserService, CustomerService, StaffAccessService, AuditService,
    { provide: PrismaService, useValue: db }, { provide: JwtService, useValue: jwt },
    { provide: ConfigService, useValue: new ConfigService({ JWT_ACCESS_SECRET: secret }) },
    { provide: SmsService, useValue: { verifyCode: async () => true } }
  ] }).compile()
  app = module.createNestApplication()
  app.setGlobalPrefix('api/v1'); app.useGlobalPipes(new ValidationPipe({ transform: true, whitelist: true, forbidNonWhitelisted: true }))
  app.useGlobalInterceptors(new SuccessInterceptor()); app.useGlobalFilters(new AppFilter()); await app.init()
})

afterAll(async () => {
  try {
    if (app) await app.close()
    if (tenants.length) {
      const where = { tenantId: { in: tenants } }
      await db.user.updateMany({ where, data: { customerId: null } })
      for (const model of ['auditLog', 'userRole', 'rolePermission', 'role', 'user', 'customer'] as const) await (db[model] as any).deleteMany({ where })
      await db.tenant.deleteMany({ where: { id: { in: tenants } } })
    }
    if (createdPermissions.length) await db.permission.deleteMany({ where: { id: { in: createdPermissions } } })
  } finally { await db.$disconnect() }
})

it('rejects self-disable, self-demotion and self-customer linkage while preserving the only recovery administrator', async () => {
  const f = await fixture()
  for (const body of [{ status: 'disabled' }, { userType: 'sales' }, { customerId: f.customer.id }]) await call(f.ownerToken, 'patch', `users/${f.owner.id}`, body).expect(403)
  expect((await db.user.findUniqueOrThrow({ where: { id: f.owner.id } }))).toMatchObject({ status: 'active', userType: 'super_admin', customerId: null })
  await call(f.ownerToken, 'get', 'users').expect(200)
})

it('does not let a delegated role manager create, promote, demote or disable super administrators', async () => {
  const f = await fixture()
  for (const body of [{ status: 'disabled' }, { userType: 'admin' }]) await call(f.managerToken, 'patch', `users/${f.owner.id}`, body).expect(403)
  await call(f.managerToken, 'patch', `users/${f.manager.id}`, { userType: 'super_admin' }).expect(403)
  await call(f.managerToken, 'post', 'users', { phone: randomUUID().slice(0, 20), name: 'Forbidden promotion', code: 'fixture', userType: 'super_admin' }).expect(403)
  expect(await db.user.count({ where: { tenantId: f.tenantId, userType: 'super_admin', status: 'active' } })).toBe(1)
})

it('preserves super-admin recovery after all their roles and role permissions are deliberately removed', async () => {
  const f = await fixture()
  await call(f.ownerToken, 'patch', `users/${f.owner.id}`, { roleIds: [] }).expect(200)
  await call(f.ownerToken, 'post', `roles/${f.role.id}/permissions`, { permissionIds: [] }).expect(201)
  await call(f.ownerToken, 'get', 'users').expect(200)
  await call(f.ownerToken, 'post', `roles/${f.role.id}/permissions`, { permissionIds: [managementId] }).expect(201)
  await call(f.managerToken, 'get', 'users').expect(200)
})

it('prevents non-super operators from removing their own last management role or permission', async () => {
  const f = await fixture()
  await call(f.managerToken, 'patch', `users/${f.manager.id}`, { roleIds: [] }).expect(403)
  await call(f.managerToken, 'post', `roles/${f.role.id}/permissions`, { permissionIds: [] }).expect(403)
  await call(f.managerToken, 'get', 'users').expect(200)
})

it('serializes two super administrators trying to disable each other and retains a working recovery account', async () => {
  const f = await fixture(true), secondToken = token(f.second!)
  const responses = await Promise.all([
    call(f.ownerToken, 'patch', `users/${f.second!.id}`, { status: 'disabled' }),
    call(secondToken, 'patch', `users/${f.owner.id}`, { status: 'disabled' })
  ])
  expect(responses.filter(response => response.status === 200)).toHaveLength(1)
  expect(responses.every(response => [200, 401, 403].includes(response.status))).toBe(true)
  const survivors = await db.user.findMany({ where: { tenantId: f.tenantId, userType: 'super_admin', status: 'active', customerId: null } })
  expect(survivors).toHaveLength(1)
  await call(token(survivors[0]), 'get', 'users').expect(200)
})

it('allows a super administrator to retire another super administrator when a recovery administrator remains', async () => {
  const f = await fixture(true)
  await call(f.ownerToken, 'patch', `users/${f.second!.id}`, { userType: 'admin' }).expect(200)
  await call(f.ownerToken, 'patch', `users/${f.second!.id}`, { status: 'disabled' }).expect(200)
  await call(f.ownerToken, 'get', 'roles').expect(200)
})

it('retains ordinary staff management and customer-linked suspension without affecting recovery users', async () => {
  const f = await fixture()
  await call(f.managerToken, 'patch', `users/${f.staff.id}`, { name: 'Legitimate edit', customerId: f.customer.id }).expect(200)
  await call(f.ownerToken, 'patch', `users/${f.staff.id}`, { userType: 'super_admin' }).expect(403)
  await call(f.ownerToken, 'patch', `customers/${f.customer.id}`, { status: 'disabled' }).expect(200)
  expect((await db.user.findUniqueOrThrow({ where: { id: f.staff.id } })).status).toBe('disabled')
  expect((await db.user.findUniqueOrThrow({ where: { id: f.owner.id } })).status).toBe('active')
  await call(f.ownerToken, 'get', 'users').expect(200)
})

it('does not touch a foreign tenant user or permit a role status mutation through the DTO', async () => {
  const f = await fixture(), foreign = await fixture()
  await call(f.ownerToken, 'patch', `users/${foreign.owner.id}`, { status: 'disabled' }).expect(404)
  await call(f.ownerToken, 'patch', `roles/${f.role.id}`, { status: 'disabled' }).expect(400)
  expect((await db.user.findUniqueOrThrow({ where: { id: foreign.owner.id } })).status).toBe('active')
})
