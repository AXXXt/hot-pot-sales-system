import { LEGAL_VERSION } from '../src/legal/legal-consent'
import { AuthSessionService } from '../src/auth/auth-session.service'
import { randomInt, randomUUID } from 'node:crypto'
import { INestApplication, ValidationPipe } from '@nestjs/common'
import { ConfigService } from '@nestjs/config'
import { JwtService } from '@nestjs/jwt'
import { Test } from '@nestjs/testing'
import { PrismaClient } from '@prisma/client'
import Redis from 'ioredis'
import request from 'supertest'
import { PasswordController } from '../src/auth/password.controller'
import { PasswordService } from '../src/auth/password.service'
import { AuthController } from '../src/auth/auth.controller'
import { AuthService } from '../src/auth/auth.service'
import { JwtAuthGuard } from '../src/auth/auth.guard'
import { SmsService } from '../src/auth/sms.service'
import { WxService } from '../src/notify/wx.service'
import { PrismaService } from '../src/prisma.service'
import { AuditService } from '../src/audit/audit.service'
import { REDIS } from '../src/redis.provider'
import { SuccessInterceptor } from '../src/success.interceptor'
import { AppFilter } from '../src/app.filter'
import { requestIdMiddleware } from '../src/request-id.middleware'
import { StaffAccessService } from '../src/auth/staff-access.service'

const url = process.env.TEST_DATABASE_URL
if (!url || !new URL(url).pathname.endsWith('_test')) throw new Error('Isolated TEST_DATABASE_URL required')
const db = new PrismaClient({ datasources: { db: { url } } })
const prefix = `password-test:${randomUUID()}:`
const redis = new Redis(process.env.TEST_REDIS_URL || 'redis://127.0.0.1:6379', { keyPrefix: prefix })
const consent = { consentAccepted: true, consentVersion: LEGAL_VERSION, consentChannel: 'admin_web' as const }
const password = 'Test fixture passphrase 2026!'
const secondPassword = 'Another fixture passphrase 2026!'
const jwt = new JwtService()
const accessSecret = 'isolated-access-secret-at-least-32-bytes'
const refreshSecret = 'isolated-refresh-secret-at-least-32-bytes'
let app: INestApplication, service: PasswordService
const tenants: number[] = []
const users: any[] = []
const phone = () => '1' + randomInt(3000000000, 9999999999)
const bootstrapToken = (user: any) => jwt.sign({ sub: user.id, tenantId: user.tenantId }, { secret: accessSecret, expiresIn: '5m' })
const api = (path: string) => request(app.getHttpServer()).post('/api/v1/auth/password/' + path)

beforeAll(async () => {
  for (let i = 0; i < 2; i++) {
    const tenant = await db.tenant.create({ data: { code: randomUUID(), name: 'Password fixture' } }); tenants.push(tenant.id)
  }
  for (const [tenantId, userType, status] of [[tenants[0], 'super_admin', 'active'], [tenants[0], 'admin', 'active'], [tenants[1], 'admin', 'active'], [tenants[0], 'customer_user', 'active'], [tenants[0], 'warehouse', 'disabled']] as const) {
    users.push(await db.user.create({ data: { tenantId, userType: userType as any, status: status as any, phone: phone(), name: 'Password fixture' } }))
  }
  const module = await Test.createTestingModule({ controllers: [PasswordController, AuthController], providers: [
      AuthSessionService,PasswordService, AuthService, AuditService, JwtAuthGuard,
    { provide: PrismaService, useValue: db }, { provide: JwtService, useValue: jwt }, { provide: REDIS, useValue: redis },
    { provide: ConfigService, useValue: new ConfigService({ JWT_ACCESS_SECRET: accessSecret, JWT_REFRESH_SECRET: refreshSecret }) },
    { provide: SmsService, useValue: { verifyCode: async () => true } }, { provide: WxService, useValue: {} }
  ] }).compile()
  service = module.get(PasswordService)
  app = module.createNestApplication(); app.use(requestIdMiddleware)
  app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true, forbidNonWhitelisted: true }))
  app.useGlobalInterceptors(new SuccessInterceptor()); app.useGlobalFilters(new AppFilter()); app.setGlobalPrefix('api/v1'); await app.init()
})

afterAll(async () => {
  await app?.close()
  const keys = await redis.keys(prefix + '*')
  if (keys.length) await redis.eval('for _,k in ipairs(ARGV) do redis.call("DEL",k) end return 1', 0, ...keys)
  await redis.quit()
  await db.auditLog.deleteMany({ where: { tenantId: { in: tenants } } })
  await db.legalConsent.deleteMany({ where: { tenantId: { in: tenants } } })
  await db.user.deleteMany({ where: { tenantId: { in: tenants } } })
  await db.tenant.deleteMany({ where: { id: { in: tenants } } }); await db.$disconnect()
})

it('allows only an active super administrator to issue same-tenant staff setup links', async () => {
  await api('setup-links').send({ userId: users[1].id }).expect(401)
  await api('setup-links').auth(bootstrapToken(users[1]), { type: 'bearer' }).send({ userId: users[0].id }).expect(403)
  for (const target of [users[2], users[3], users[4]]) await api('setup-links').auth(bootstrapToken(users[0]), { type: 'bearer' }).send({ userId: target.id }).expect(403)
  expect(await db.staffCredential.count()).toBe(0)
})

it('supports one-time setup, keeps hashes out of responses and audits, and logs in with the existing identity', async () => {
  const issued = await api('setup-links').auth(bootstrapToken(users[0]), { type: 'bearer' }).send({ userId: users[1].id }).expect(201)
  const token = new URL('https://example.test' + issued.body.data.path).hash.slice(7)
  const info = await api('setup-info').send({ token }).expect(201)
  expect(info.body.data.account).toContain('****')
  await api('setup').send({ token, password: 'short' }).expect(400)
  await api('setup').send({ token, password }).expect(201)
  await api('setup').send({ token, password }).expect(400)
  const stored = await db.staffCredential.findUniqueOrThrow({ where: { userId: users[1].id } })
  expect(stored.passwordHash).not.toContain(password); expect(stored.version).toBe(1)
  const loggedIn = await api('login').send({ ...consent, phone: users[1].phone, password }).expect(201)
  expect(loggedIn.body.data.user.id).toBe(users[1].id)
  expect(jwt.verify(loggedIn.body.data.accessToken, { secret: accessSecret }).cv).toBe(1)
  expect(JSON.stringify(loggedIn.body)).not.toContain('passwordHash')
  expect(JSON.stringify(await db.auditLog.findMany({ where: { tenantId: tenants[0] } }))).not.toContain(token)
  expect(JSON.stringify(await db.auditLog.findMany({ where: { tenantId: tenants[0] } }))).not.toContain(password)
})

it('revokes superseded links and makes concurrent confirmations execute only once', async () => {
  const first = await service.issueSetupLink(users[0].id, users[1].id)
  const second = await service.issueSetupLink(users[0].id, users[1].id)
  const token = (path: string) => new URL('https://example.test' + path).hash.slice(7)
  await api('setup-info').send({ token: token(first.path) }).expect(400)
  const results = await Promise.all([1, 2].map(() => api('setup').send({ token: token(second.path), password })))
  expect(results.map(x => x.status).sort()).toEqual([201, 400])
  expect((await db.staffCredential.findUniqueOrThrow({ where: { userId: users[1].id } })).version).toBe(2)
})

it('rejects wrong passwords and customer accounts, locks after five failures, and fails closed on Redis loss', async () => {
  const invalidPhone = phone()
  for (let i = 0; i < 5; i++) await api('login').send({ ...consent, phone: invalidPhone, password }).expect(401)
  await api('login').send({ ...consent, phone: invalidPhone, password }).expect(429)
  for (const user of [users[3], users[4]]) await api('login').send({ ...consent, phone: user.phone, password }).expect(401)
  const isolated = new PasswordService(db as unknown as PrismaService, {} as any, {} as any, { eval: async () => { throw new Error('down') } } as any)
  await expect(isolated.login(users[1].phone, password, 'redis-down-test', consent)).rejects.toMatchObject({ status: 503 })
})

it('changes a password only after verifying the old one, revoking both access and refresh tokens', async () => {
  const access = new StaffAccessService(db as unknown as PrismaService)
  const originalFingerprint = (await access.actor(users[1].id)).fingerprint
  const login = await api('login').send({ ...consent, phone: users[1].phone, password }).expect(201)
  const credentials = login.body.data
  await api('change').auth(credentials.accessToken, { type: 'bearer' }).send({ currentPassword: 'wrong', password: secondPassword }).expect(401)
  await api('change').auth(credentials.accessToken, { type: 'bearer' }).send({ currentPassword: password, password: secondPassword }).expect(201)
  expect((await access.actor(users[1].id)).fingerprint).not.toBe(originalFingerprint)
  await request(app.getHttpServer()).get('/api/v1/auth/profile').auth(credentials.accessToken, { type: 'bearer' }).expect(401)
  await request(app.getHttpServer()).post('/api/v1/auth/refresh-token').send({ refreshToken: credentials.refreshToken }).expect(401)
  await api('login').send({ ...consent, phone: users[1].phone, password }).expect(401)
  await api('login').send({ ...consent, phone: users[1].phone, password: secondPassword }).expect(201)
  const sms = await request(app.getHttpServer()).post('/api/v1/auth/login').send({ ...consent, phone: users[1].phone, code: '123456' }).expect(201)
  expect(jwt.verify(sms.body.data.accessToken, { secret: accessSecret }).cv).toBe(3)
})

it('commits a password and its security audit even if post-commit Redis cleanup fails, while old credentials stay revoked', async () => {
  const nextPassword = 'Third synthetic fixture passphrase 2026!'
  const loggedIn = await api('login').send({ ...consent, phone: users[1].phone, password: secondPassword }).expect(201)
  const credentials = loggedIn.body.data
  const oldVersion = jwt.verify(credentials.accessToken, { secret: accessSecret }).cv
  const where = { tenantId: tenants[0], targetType: 'staff_password', targetId: String(users[1].id) }
  const count = await db.auditLog.count({ where })
  const cleanup = jest.spyOn(redis, 'del').mockRejectedValueOnce(new Error('isolated post-commit cleanup unavailable'))
  try {
    await api('change').auth(credentials.accessToken, { type: 'bearer' }).set('x-request-id', 'password-cleanup-fixture')
      .set('user-agent', 'isolated-password-audit').send({ currentPassword: secondPassword, password: nextPassword }).expect(201)
  } finally { cleanup.mockRestore() }
  expect(await db.auditLog.count({ where })).toBe(count + 1)
  const audit = await db.auditLog.findFirstOrThrow({ where, orderBy: { id: 'desc' } })
  expect(audit).toMatchObject({ requestId: 'password-cleanup-fixture', userAgent: 'isolated-password-audit', operatorId: users[1].id,
    afterData: { configured: true, sessionsRevoked: true } })
  expect(JSON.stringify(audit)).not.toContain(nextPassword)
  expect(JSON.stringify(audit)).not.toContain('passwordHash')
  await request(app.getHttpServer()).get('/api/v1/auth/profile').auth(credentials.accessToken, { type: 'bearer' }).expect(401)
  await request(app.getHttpServer()).post('/api/v1/auth/refresh-token').send({ refreshToken: credentials.refreshToken }).expect(401)
  await api('login').send({ ...consent, phone: users[1].phone, password: secondPassword }).expect(401)
  const next = await api('login').send({ ...consent, phone: users[1].phone, password: nextPassword }).expect(201)
  expect(jwt.verify(next.body.data.accessToken, { secret: accessSecret }).cv).toBe(oldVersion + 1)
  // Reusing an existing unique audit request ID forces audit persistence to fail inside the same transaction.
  await api('change').auth(next.body.data.accessToken, { type: 'bearer' }).set('x-request-id', 'password-cleanup-fixture')
    .send({ currentPassword: nextPassword, password: 'Uncommitted synthetic fixture password 2026!' }).expect(500)
  expect((await db.staffCredential.findUniqueOrThrow({ where: { userId: users[1].id } })).version).toBe(oldVersion + 1)
  expect(await db.auditLog.count({ where })).toBe(count + 1)
  await api('login').send({ ...consent, phone: users[1].phone, password: nextPassword }).expect(201)
})
