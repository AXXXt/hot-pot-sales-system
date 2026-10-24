import { LEGAL_VERSION } from '../src/legal/legal-consent'
import { AuthSessionService } from '../src/auth/auth-session.service'
import { randomUUID } from 'node:crypto'
import { INestApplication, ValidationPipe } from '@nestjs/common'
import { ConfigService } from '@nestjs/config'
import { JwtService } from '@nestjs/jwt'
import { Test } from '@nestjs/testing'
import { Prisma, PrismaClient } from '@prisma/client'
import request from 'supertest'
import { CustomerController } from '../src/customer/customer.controller'
import { CustomerService } from '../src/customer/customer.service'
import { StaffAccessService } from '../src/auth/staff-access.service'
import { AuthService } from '../src/auth/auth.service'
import { PrismaService } from '../src/prisma.service'
import { AuditService } from '../src/audit/audit.service'
import { SuccessInterceptor } from '../src/success.interceptor'
import { AppFilter } from '../src/app.filter'

const url = process.env.TEST_DATABASE_URL
let database: URL
try { database = new URL(url || '') } catch { throw Error('Local isolated TEST_DATABASE_URL required') }
if (database.protocol !== 'mysql:' || !['127.0.0.1', 'localhost', '[::1]'].includes(database.hostname)
  || !database.pathname.endsWith('_test')) throw Error('Local isolated TEST_DATABASE_URL required')
const db = new PrismaClient({ datasources: { db: { url } } })
const secret = randomUUID(), jwt = new JwtService({ secret }), tenants: number[] = []
const prefix = 'Customer review ' + randomUUID().slice(0, 8)
let app: INestApplication, admin: string

const call = (method: 'get' | 'post' | 'patch', route: string, body?: object) => {
  const req = request(app.getHttpServer())[method]('/api/v1/' + route).set('Authorization', 'Bearer ' + admin)
  return body ? req.send(body) : req
}

async function customer(label: string, status: 'active' | 'disabled' = 'disabled', userStatus: 'active' | 'disabled' | null = status, tenantId = tenants[0]) {
  const record = await db.customer.create({ data: { tenantId, customerName: `${prefix} ${label}`, status } })
  const user = userStatus === null ? null : await db.user.create({ data: {
    tenantId, customerId: record.id, userType: 'customer_user', status: userStatus,
    phone: randomUUID().slice(0, 20), name: 'Local review fixture'
  } })
  return { id: record.id, userId: user?.id }
}

async function decision(id: number, afterData: Prisma.InputJsonObject, tenantId = tenants[0]) {
  await db.auditLog.create({ data: {
    tenantId, action: 'update', module: 'customer', targetType: 'customer', targetId: String(id),
    requestId: randomUUID(), afterData
  } })
}

async function detail(id: number) {
  return (await call('get', `customers/${id}`).expect(200)).body.data
}

beforeAll(async () => {
  for (let i = 0; i < 2; i++) tenants.push((await db.tenant.create({ data: { code: randomUUID(), name: `${prefix} tenant ${i}` } })).id)
  const actor = await db.user.create({ data: {
    tenantId: tenants[0], userType: 'super_admin', status: 'active',
    phone: randomUUID().slice(0, 20), name: 'Local review administrator'
  } })
  admin = jwt.sign({ sub: actor.id, tenantId: actor.tenantId })
  const module = await Test.createTestingModule({ controllers: [CustomerController], providers: [
      // Business fixture: session revocation itself is covered by auth-session.integration-spec.ts.
      { provide: AuthSessionService, useValue: { assertActive: async () => {} } },
    CustomerService, StaffAccessService, AuditService,
    { provide: PrismaService, useValue: db }, { provide: JwtService, useValue: jwt },
    { provide: ConfigService, useValue: new ConfigService({ JWT_ACCESS_SECRET: secret }) }
  ] }).compile()
  app = module.createNestApplication()
  app.setGlobalPrefix('api/v1')
  app.useGlobalPipes(new ValidationPipe({ transform: true, whitelist: true, forbidNonWhitelisted: true }))
  app.useGlobalInterceptors(new SuccessInterceptor())
  app.useGlobalFilters(new AppFilter())
  await app.init()
})

afterAll(async () => {
  try {
    if (app) await app.close()
    if (tenants.length) {
      const where = { tenantId: { in: tenants } }
      // Both owned tenants are included: the intentional legacy cross-tenant link must be detached too.
      await db.user.updateMany({ where, data: { customerId: null } })
      await db.auditLog.deleteMany({ where })
      await db.user.deleteMany({ where })
      await db.customer.deleteMany({ where })
      await db.tenant.deleteMany({ where: { id: { in: tenants } } })
    }
  } finally { await db.$disconnect() }
})

it('returns actual pending/rejected/disabled/approved decisions in HTTP list and detail without related users', async () => {
  const pending = await customer('pending'), rejected = await customer('rejected'), stopped = await customer('manual disabled')
  const active = await customer('active', 'active'), withoutUser = await customer('active without user', 'active', null)
  const stoppedUser = await customer('stopped user', 'active', 'disabled'), unrecorded = await customer('no decision')
  const foreign = await customer('foreign', 'disabled', 'disabled', tenants[1])
  await db.user.create({ data: {
    tenantId: tenants[1], customerId: stoppedUser.id, userType: 'customer_user', status: 'active',
    phone: randomUUID().slice(0, 20), name: 'Foreign user must not approve local profile'
  } })
  await decision(pending.id, { action: 'submit_registration' })
  await decision(rejected.id, { action: 'submit_registration' })
  await decision(rejected.id, { action: 'reject' })
  await decision(stopped.id, { action: 'submit_registration' })
  await decision(stopped.id, { status: 'disabled' })
  // A newer decision belonging to another tenant must not override this tenant's application.
  await decision(pending.id, { action: 'reject' }, tenants[1])
  const expected = new Map([
    [pending.id, 'pending'], [rejected.id, 'rejected'], [stopped.id, 'disabled'],
    [active.id, 'approved'], [withoutUser.id, 'approved'], [stoppedUser.id, 'disabled'], [unrecorded.id, 'disabled']
  ])
  const response = (await call('get', 'customers?pageSize=500').expect(200)).body.data
  expect(response.items.some((item: any) => item.id === foreign.id)).toBe(false)
  for (const [id, reviewStatus] of expected) {
    const item = response.items.find((entry: any) => entry.id === id)
    expect(item).toMatchObject({ id, reviewStatus })
    expect(item).not.toHaveProperty('users')
    const record = await detail(id)
    expect(record).toMatchObject({ id, reviewStatus })
    expect(record).not.toHaveProperty('users')
  }
})

it('lets an explicit manual disable supersede an old submission and refuses stale review actions', async () => {
  const candidate = await customer('manually stopped application')
  await decision(candidate.id, { action: 'submit_registration' })
  expect(await detail(candidate.id)).toMatchObject({ reviewStatus: 'pending' })
  const result = (await call('patch', `customers/${candidate.id}`, { status: 'disabled' }).expect(200)).body.data
  expect(result).toMatchObject({ status: 'disabled', reviewStatus: 'disabled' })
  for (const action of ['approve', 'reject']) await call('post', `customers/${candidate.id}/${action}`, { reason: 'Must remain stopped' }).expect(400)
  expect((await db.customer.findUniqueOrThrow({ where: { id: candidate.id } })).status).toBe('disabled')
  expect((await db.user.findUniqueOrThrow({ where: { id: candidate.userId! } })).status).toBe('disabled')
  const latest = await db.auditLog.findFirstOrThrow({
    where: { tenantId: tenants[0], module: 'customer', targetId: String(candidate.id) },
    orderBy: [{ createdAt: 'desc' }, { id: 'desc' }]
  })
  expect(latest.afterData).toMatchObject({ status: 'disabled' })
  expect(latest.afterData).not.toHaveProperty('action')
})

it('refuses approve and reject for an already rejected application without changing its decision', async () => {
  const candidate = await customer('already rejected')
  await decision(candidate.id, { action: 'reject' })
  const before = await db.auditLog.count({ where: { tenantId: tenants[0], targetId: String(candidate.id) } })
  await call('post', `customers/${candidate.id}/approve`).expect(400)
  await call('post', `customers/${candidate.id}/reject`, { reason: 'Duplicate review' }).expect(400)
  expect(await detail(candidate.id)).toMatchObject({ status: 'disabled', reviewStatus: 'rejected' })
  expect(await db.auditLog.count({ where: { tenantId: tenants[0], targetId: String(candidate.id) } })).toBe(before)
})

it('approves a pending application, enables its local user and records the review under the actual tenant', async () => {
  const candidate = await customer('approve pending')
  await decision(candidate.id, { action: 'submit_registration' })
  await call('post', `customers/${candidate.id}/approve`).expect(201)
  expect(await detail(candidate.id)).toMatchObject({ status: 'active', reviewStatus: 'approved' })
  expect((await db.user.findUniqueOrThrow({ where: { id: candidate.userId! } })).status).toBe('active')
  expect(await db.auditLog.count({ where: {
    tenantId: tenants[0], module: 'customer', targetType: 'customer', targetId: String(candidate.id),
    afterData: { path: '$.action', equals: 'approve' }
  } })).toBe(1)
  await call('post', `customers/${candidate.id}/approve`).expect(400)
  await call('post', `customers/${candidate.id}/reject`, { reason: 'Already approved' }).expect(400)
})

it('rejects a pending application and leaves it available for a future registration resubmission', async () => {
  const candidate = await customer('reject pending', 'disabled', 'active')
  await decision(candidate.id, { action: 'submit_registration' })
  await call('post', `customers/${candidate.id}/reject`, { reason: 'Local fixture incomplete' }).expect(201)
  expect(await detail(candidate.id)).toMatchObject({ status: 'disabled', reviewStatus: 'rejected' })
  expect((await db.user.findUniqueOrThrow({ where: { id: candidate.userId! } })).status).toBe('disabled')
  expect(await db.auditLog.count({ where: {
    tenantId: tenants[0], module: 'customer', targetType: 'customer', targetId: String(candidate.id),
    afterData: { path: '$.action', equals: 'reject' }
  } })).toBe(1)
})

it('does not synchronize a legacy foreign-tenant user sharing customerId during either PATCH status change', async () => {
  const candidate = await customer('legacy status linkage', 'active')
  const foreignUser = await db.user.create({ data: {
    tenantId: tenants[1], customerId: candidate.id, userType: 'customer_user', status: 'active',
    phone: randomUUID().slice(0, 20), name: 'Intentionally inconsistent local fixture'
  } })
  await call('patch', `customers/${candidate.id}`, { status: 'disabled' }).expect(200)
  expect((await db.user.findUniqueOrThrow({ where: { id: candidate.userId! } })).status).toBe('disabled')
  expect((await db.user.findUniqueOrThrow({ where: { id: foreignUser.id } })).status).toBe('active')
  await db.user.update({ where: { id: foreignUser.id }, data: { status: 'disabled' } })
  await call('patch', `customers/${candidate.id}`, { status: 'active' }).expect(200)
  expect((await db.user.findUniqueOrThrow({ where: { id: candidate.userId! } })).status).toBe('active')
  expect((await db.user.findUniqueOrThrow({ where: { id: foreignUser.id } })).status).toBe('disabled')
  expect(await detail(candidate.id)).toMatchObject({ reviewStatus: 'approved' })
})

it('serializes competing approve/reject requests and commits exactly one matching review decision', async () => {
  const candidate = await customer('concurrent pending review')
  await decision(candidate.id, { action: 'submit_registration' })
  const results = await Promise.all([
    call('post', `customers/${candidate.id}/approve`),
    call('post', `customers/${candidate.id}/reject`, { reason: 'Concurrent review fixture' })
  ])
  expect(results.map(result => result.status).sort()).toEqual([201, 400])
  const record = await db.customer.findUniqueOrThrow({ where: { id: candidate.id } })
  const user = await db.user.findUniqueOrThrow({ where: { id: candidate.userId! } })
  const reviews = await db.auditLog.findMany({ where: {
    tenantId: tenants[0], module: 'customer', targetType: 'customer', targetId: String(candidate.id),
    OR: ['approve', 'reject'].map(action => ({ afterData: { path: '$.action', equals: action } }))
  } })
  expect(reviews).toHaveLength(1)
  const reviewedAction = (reviews[0].afterData as { action: string }).action
  expect(user.status).toBe(record.status)
  expect(record.status).toBe(reviewedAction === 'approve' ? 'active' : 'disabled')
  expect((await detail(candidate.id)).reviewStatus).toBe(reviewedAction === 'approve' ? 'approved' : 'rejected')
})

it('keeps a manual-disable decision effective when it races with review approval', async () => {
  const candidate = await customer('manual stop versus review')
  await decision(candidate.id, { action: 'submit_registration' })
  const [stopped, reviewed] = await Promise.all([
    call('patch', `customers/${candidate.id}`, { status: 'disabled' }),
    call('post', `customers/${candidate.id}/approve`)
  ])
  expect(stopped.status).toBe(200)
  expect([201, 400]).toContain(reviewed.status)
  expect(await detail(candidate.id)).toMatchObject({ status: 'disabled', reviewStatus: 'disabled' })
  expect((await db.user.findUniqueOrThrow({ where: { id: candidate.userId! } })).status).toBe('disabled')
})

it('rolls the customer and its linked user back when the transactional status audit cannot be inserted', async () => {
  const candidate = await customer('audit rollback', 'active')
  const actor = await db.user.create({ data: {
    tenantId: tenants[0], userType: 'super_admin', phone: randomUUID().slice(0, 20), name: 'Removed local operator'
  } })
  await db.user.delete({ where: { id: actor.id } })
  const staleActor = {
    id: actor.id, tenantId: tenants[0], userType: 'super_admin', superAdmin: true,
    permissions: new Set<string>(), brandIds: [], customerIds: null, leadIds: null, fingerprint: 'isolated-stale-actor'
  }
  // The removed operator deliberately makes the audit FK fail, without altering schema or other fixtures.
  await expect(app.get(CustomerService).update(candidate.id, { status: 'disabled' }, staleActor)).rejects.toMatchObject({ code: 'P2003' })
  expect((await db.customer.findUniqueOrThrow({ where: { id: candidate.id } })).status).toBe('active')
  expect((await db.user.findUniqueOrThrow({ where: { id: candidate.userId! } })).status).toBe('active')
  expect(await db.auditLog.count({ where: { tenantId: tenants[0], targetType: 'customer', targetId: String(candidate.id) } })).toBe(0)
})

it('does not let an in-flight rejected-registration resubmission overwrite a newer manual-disable decision', async () => {
  const candidate = await customer('registration versus manual stop')
  await decision(candidate.id, { action: 'reject' })
  const buyer = await db.user.findUniqueOrThrow({ where: { id: candidate.userId! } })
  let readDecision!: () => void
  const initialDecisionRead = new Promise<void>(resolve => { readDecision = resolve })
  const authDb = {
    user: db.user,
    auditLog: { findFirst: async (args: any) => { const result = await db.auditLog.findFirst(args); readDecision(); return result } },
    $transaction: db.$transaction.bind(db)
  }
  const auth = new AuthService(authDb as any, {} as any, {} as any, { verifyCode: async () => true } as any, {} as any, {} as any)
  let application: Promise<unknown> | undefined
  await db.$transaction(async tx => {
    await tx.$queryRaw(Prisma.sql`SELECT id FROM customers WHERE id = ${candidate.id} FOR UPDATE`)
    await tx.customer.update({ where: { id: candidate.id }, data: { status: 'disabled' } })
    await tx.auditLog.create({ data: {
      tenantId: tenants[0], action: 'update', module: 'customer', targetType: 'customer', targetId: String(candidate.id),
      requestId: randomUUID(), afterData: { status: 'disabled' }
    } })
    application = auth.registerOrLogin({ consentAccepted: true, consentVersion: LEGAL_VERSION, consentChannel: 'mini', phone: buyer.phone, code: 'fixture-code', customerName: 'Must not overwrite stopped customer' })
    application.catch(() => {})
    // A normal consistent read still sees the old reject while this newer decision is uncommitted.
    await initialDecisionRead
  })
  await expect(application).rejects.toMatchObject({ status: 403 })
  expect((await db.customer.findUniqueOrThrow({ where: { id: candidate.id } })).customerName).toBe(`${prefix} registration versus manual stop`)
  expect(await detail(candidate.id)).toMatchObject({ status: 'disabled', reviewStatus: 'disabled' })
  expect(await db.auditLog.count({ where: {
    tenantId: tenants[0], targetType: 'customer', targetId: String(candidate.id), afterData: { path: '$.action', equals: 'submit_registration' }
  } })).toBe(0)
})
