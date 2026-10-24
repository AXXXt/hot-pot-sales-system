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
import { AuditController } from '../src/audit/audit.controller'
import { AuditService } from '../src/audit/audit.service'
import { SystemController } from '../src/system/system.controller'
import { SystemService } from '../src/system/system.service'
import { PrismaService } from '../src/prisma.service'
import { SmsService } from '../src/auth/sms.service'
import { StaffAccessService } from '../src/auth/staff-access.service'
import { SuccessInterceptor } from '../src/success.interceptor'
import { AppFilter } from '../src/app.filter'

const url = process.env.TEST_DATABASE_URL
if (!url || !new URL(url).pathname.endsWith('_test')) throw Error('Isolated TEST_DATABASE_URL required')
const db = new PrismaClient({ datasources: { db: { url } } })
const tenants: number[] = [], users: number[] = [], roles: number[] = [], customers: number[] = [], logs: number[] = []
const secret = randomUUID(), jwt = new JwtService({ secret }), tokens: string[] = []
const permissionCode = 'qa-management-' + randomUUID()
let app: INestApplication, permissionId: number
const call = (method: 'get' | 'post' | 'patch' | 'put', route: string, body?: object, token = tokens[0]) => {
  const req = request(app.getHttpServer())[method]('/api/v1/' + route).set('Authorization', 'Bearer ' + token)
  return body ? req.send(body) : req
}

beforeAll(async () => {
  permissionId = (await db.permission.create({ data: { code: permissionCode, name: 'QA scope permission', type: 'api' } })).id
  for (let i = 0; i < 2; i++) {
    const tenantId = (await db.tenant.create({ data: { code: randomUUID(), name: 'Management scope fixture' } })).id
    tenants.push(tenantId)
    const user = await db.user.create({ data: { tenantId, userType: 'super_admin', phone: randomUUID().slice(0, 20), name: 'Scope owner ' + i, openid: 'private-fixture-' + i + randomUUID() } })
    users.push(user.id); tokens.push(jwt.sign({ sub: user.id, tenantId }))
    customers.push((await db.customer.create({ data: { tenantId, customerName: 'Scope customer' } })).id)
    roles.push((await db.role.create({ data: { tenantId, code: 'scope-role', name: 'Scope role ' + i } })).id)
    await db.userRole.create({ data: { tenantId, userId: user.id, roleId: roles[i] } })
    await db.rolePermission.create({ data: { tenantId, roleId: roles[i], permissionId } })
    logs.push((await db.auditLog.create({ data: { tenantId, action: 'create', module: 'scope-fixture', targetType: 'qa', requestId: randomUUID(), operatorId: user.id } })).id)
    await db.systemConfig.create({ data: { tenantId, configKey: 'qa-scope-config', configValue: 'tenant-' + i } })
  }
  const module = await Test.createTestingModule({ controllers: [UserController, AuditController, SystemController], providers: [
      // Business fixture: session revocation itself is covered by auth-session.integration-spec.ts.
      { provide: AuthSessionService, useValue: { assertActive: async () => {} } },
    UserService, AuditService, SystemService, StaffAccessService, { provide: PrismaService, useValue: db }, { provide: JwtService, useValue: jwt },
    { provide: ConfigService, useValue: new ConfigService({ JWT_ACCESS_SECRET: secret }) },
    { provide: SmsService, useValue: { verifyCode: async () => true } }
  ] }).compile()
  app = module.createNestApplication(); app.setGlobalPrefix('api/v1')
  app.useGlobalPipes(new ValidationPipe({ transform: true, whitelist: true, forbidNonWhitelisted: true }))
  app.useGlobalInterceptors(new SuccessInterceptor()); app.useGlobalFilters(new AppFilter()); await app.init()
})

afterAll(async () => {
  if (app) await app.close()
  const where = { tenantId: { in: tenants } }
  await db.user.updateMany({ where, data: { customerId: null } })
  for (const name of ['auditLog', 'systemConfig', 'userRole', 'rolePermission', 'role', 'user', 'customer'] as const) await (db[name] as any).deleteMany({ where })
  await db.permission.deleteMany({ where: { id: permissionId } }); await db.tenant.deleteMany({ where: { id: { in: tenants } } }); await db.$disconnect()
})

it('scopes management lists and omits WeChat identity and credentials from user responses', async () => {
  for (const i of [0, 1]) {
    const userList = (await call('get', 'users', undefined, tokens[i]).expect(200)).body.data
    expect(userList.items.map((x: any) => x.id)).toEqual([users[i]])
    expect(userList.items[0]).not.toHaveProperty('openid')
    expect(userList.items[0]).not.toHaveProperty('staffCredential')
    expect((await call('get', 'roles', undefined, tokens[i]).expect(200)).body.data.map((x: any) => x.id)).toEqual([roles[i]])
    const audit = (await call('get', 'audit-logs?module=scope-fixture', undefined, tokens[i]).expect(200)).body.data
    expect(audit.items.map((x: any) => x.id)).toEqual([logs[i]])
    expect((await call('get', 'system-configs', undefined, tokens[i]).expect(200)).body.data).toEqual([expect.objectContaining({ tenantId: tenants[i], configValue: 'tenant-' + i })])
  }
})

it('rejects foreign IDs for users, roles and audit detail without mutations', async () => {
  await call('get', `users/${users[1]}`).expect(404)
  await call('patch', `users/${users[1]}`, { name: 'Forbidden' }).expect(404)
  await call('patch', `roles/${roles[1]}`, { name: 'Forbidden' }).expect(404)
  await call('post', `roles/${roles[1]}/permissions`, { permissionIds: [] }).expect(404)
  await call('get', `audit-logs/${logs[1]}`).expect(404)
  expect((await db.user.findUniqueOrThrow({ where: { id: users[1] } })).name).toBe('Scope owner 1')
  expect((await db.role.findUniqueOrThrow({ where: { id: roles[1] } })).name).toBe('Scope role 1')
  expect(await db.rolePermission.count({ where: { roleId: roles[1] } })).toBe(1)
})

it('does not expose a foreign role through an inconsistent legacy link', async () => {
  const link = await db.userRole.create({ data: { tenantId: tenants[0], userId: users[0], roleId: roles[1] } })
  try {
    const detail = (await call('get', `users/${users[0]}`).expect(200)).body.data
    expect(detail.roles.map((x: any) => x.id)).toEqual([roles[0]])
    expect((await call('get', 'roles', undefined, tokens[1]).expect(200)).body.data[0]._count.userRoles).toBe(1)
  } finally { await db.userRole.delete({ where: { id: link.id } }) }
})

it('validates relations before writing and keeps existing assignments on invalid input', async () => {
  await call('patch', `users/${users[0]}`, { name: 'Must roll back', roleIds: [roles[1]] }).expect(400)
  await call('patch', `users/${users[0]}`, { customerId: customers[1] }).expect(400)
  await call('post', `roles/${roles[0]}/permissions`, { permissionIds: [2147483647] }).expect(400)
  expect((await db.user.findUniqueOrThrow({ where: { id: users[0] } })).name).toBe('Scope owner 0')
  expect(await db.userRole.count({ where: { userId: users[0], roleId: roles[0] } })).toBe(1)
  expect(await db.rolePermission.count({ where: { roleId: roles[0], permissionId } })).toBe(1)
})

it('writes valid users, roles and permission changes atomically inside the actor tenant', async () => {
  const created = (await call('post', 'users', { phone: randomUUID().slice(0, 20), name: 'QA staff', code: 'fixture', userType: 'sales', roleIds: [roles[0], roles[0]] }).expect(201)).body.data
  expect(created).toMatchObject({ tenantId: tenants[0], name: 'QA staff' }); expect(created.roles).toHaveLength(1)
  const role = (await call('post', 'roles', { code: 'new-role', name: 'QA role' }).expect(201)).body.data
  expect(role.tenantId).toBe(tenants[0])
  const assigned = (await call('post', `roles/${role.id}/permissions`, { permissionIds: [permissionId, permissionId] }).expect(201)).body.data
  expect(assigned).toHaveLength(1)
  await call('patch', `users/${created.id}`, { roleIds: [role.id], name: 'QA updated' }).expect(200)
  const audit = await db.auditLog.findFirstOrThrow({ where: { tenantId: tenants[0], targetType: 'user', targetId: String(created.id), action: 'update' } })
  expect(audit.operatorId).toBe(users[0])
})

it('updates only own configuration and records scoped audit with the current operator', async () => {
  const changed = (await call('put', 'system-configs/qa-scope-config', { configValue: 'QA changed' }).expect(200)).body.data
  expect(changed).toMatchObject({ tenantId: tenants[0], configValue: 'QA changed' })
  expect((await db.systemConfig.findFirstOrThrow({ where: { tenantId: tenants[1], configKey: 'qa-scope-config' } })).configValue).toBe('tenant-1')
  const audit = await db.auditLog.findFirstOrThrow({ where: { tenantId: tenants[0], module: 'system', targetType: 'system_config' } })
  expect(audit.operatorId).toBe(users[0])
  await call('put', 'system-configs/missing', { configValue: 'no' }).expect(404)
})

it('rejects invalid pagination and unauthorized customer management access', async () => {
  for (const route of ['users?page=0', 'users?pageSize=501', 'audit-logs?page=-1', 'audit-logs?pageSize=100000', 'audit-logs?operatorId=bad']) await call('get', route).expect(400)
  const customer = await db.user.create({ data: { tenantId: tenants[0], phone: randomUUID().slice(0,20), name: 'QA buyer', userType: 'customer_user', customerId: customers[0] } })
  const token = jwt.sign({ sub: customer.id, tenantId: tenants[0] })
  for (const route of ['users', 'roles', 'permissions', 'audit-logs', 'system-configs']) await call('get', route, undefined, token).expect(403)
})
