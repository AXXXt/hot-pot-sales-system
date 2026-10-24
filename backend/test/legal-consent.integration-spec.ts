import { randomUUID } from 'node:crypto'
import { INestApplication, ValidationPipe } from '@nestjs/common'
import { Test } from '@nestjs/testing'
import { ConfigService } from '@nestjs/config'
import { JwtService } from '@nestjs/jwt'
import { PrismaClient } from '@prisma/client'
import Redis from 'ioredis'
import request from 'supertest'
import { LegalController } from '../src/legal/legal.controller'
import { LEGAL_DOCUMENT_HASH, LEGAL_VERSION } from '../src/legal/legal-consent'
import { PrismaService } from '../src/prisma.service'
import { AuthSessionService } from '../src/auth/auth-session.service'
import { JwtAuthGuard } from '../src/auth/auth.guard'
import { AppFilter } from '../src/app.filter'
import { SuccessInterceptor } from '../src/success.interceptor'

function target(value: string | undefined) { try { return new URL(value || '') } catch { throw Error('Valid isolated loopback test target required') } }
const databaseTarget = target(process.env.TEST_DATABASE_URL), redisTarget = target(process.env.TEST_REDIS_URL || 'redis://127.0.0.1:6379')
const loopback = ['127.0.0.1', 'localhost', '[::1]']
if (databaseTarget.protocol !== 'mysql:' || !loopback.includes(databaseTarget.hostname) || !databaseTarget.pathname.endsWith('_test')) throw Error('Isolated loopback mysql *_test database required')
if (!['redis:', 'rediss:'].includes(redisTarget.protocol) || !loopback.includes(redisTarget.hostname) ||
  [...redisTarget.searchParams.keys()].some(key => ['host', 'hostname', 'port', 'path', 'sentinels'].includes(key.toLowerCase()))) throw Error('Isolated loopback redis required')
const db = new PrismaClient({ datasources: { db: { url: process.env.TEST_DATABASE_URL } } })
const namespace = `legal-consent-test:${randomUUID()}:`, redis = new Redis(redisTarget.href, { keyPrefix: namespace })
const sessions = new AuthSessionService(redis), jwt = new JwtService(), secret = randomUUID()
const accepted = { consentAccepted: true, consentVersion: LEGAL_VERSION, consentChannel: 'mini' }
const tenants: number[] = [], users: number[] = [], tokens: string[] = []
let app: INestApplication

beforeAll(async () => {
  for (let i = 0; i < 2; i++) {
    const tenant = await db.tenant.create({ data: { code: randomUUID(), name: 'Local legal consent fixture' } }); tenants.push(tenant.id)
    const user = await db.user.create({ data: { tenantId: tenant.id, phone: randomUUID().slice(0, 20), name: 'Local consent fixture', userType: 'admin', status: 'active' } }); users.push(user.id)
    const sid = sessions.newId(); await sessions.create(user.id, sid, randomUUID())
    tokens.push(jwt.sign({ sub: user.id, tenantId: tenant.id, sid, tokenUse: 'access' }, { secret, expiresIn: '10m' }))
  }
  const module = await Test.createTestingModule({ controllers: [LegalController], providers: [
    { provide: PrismaService, useValue: db }, { provide: JwtService, useValue: jwt },
    { provide: ConfigService, useValue: new ConfigService({ JWT_ACCESS_SECRET: secret }) },
    { provide: AuthSessionService, useValue: sessions }, JwtAuthGuard
  ] }).compile()
  app = module.createNestApplication(); app.setGlobalPrefix('api/v1')
  app.useGlobalPipes(new ValidationPipe({ transform: true, whitelist: true, forbidNonWhitelisted: true }))
  app.useGlobalInterceptors(new SuccessInterceptor()); app.useGlobalFilters(new AppFilter()); await app.init()
})

afterAll(async () => {
  await app?.close()
  if (tenants.length) { await db.legalConsent.deleteMany({ where: { tenantId: { in: tenants } } }); await db.user.deleteMany({ where: { id: { in: users } } }); await db.tenant.deleteMany({ where: { id: { in: tenants } } }) }
  const keys = await redis.keys(namespace + '*')
  if (keys.length) await redis.eval('for _,key in ipairs(ARGV) do redis.call("DEL",key) end return 1', 0, ...keys)
  await redis.quit(); await db.$disconnect()
})

it('exposes the current review document publicly but requires authentication for personal consent records', async () => {
  const response = await request(app.getHttpServer()).get('/api/v1/legal/current').expect(200)
  expect(response.body.data).toMatchObject({ version: LEGAL_VERSION, documentHash: LEGAL_DOCUMENT_HASH, readiness: { status: 'draft' } })
  expect(response.body.data.documents.privacy.sections.length).toBeGreaterThan(0)
  await request(app.getHttpServer()).get('/api/v1/legal/consent').expect(401)
})

it('rejects implicit, stale, malformed or forged-subject acceptance without creating records', async () => {
  for (const body of [{}, { ...accepted, consentAccepted: false }, { ...accepted, consentVersion: 'obsolete' },
    { ...accepted, consentAccepted: 'true' }, { ...accepted, consentChannel: 'official_site' }, { ...accepted, userId: users[1] }]) {
    await request(app.getHttpServer()).post('/api/v1/legal/consent').set('Authorization', `Bearer ${tokens[0]}`).send(body).expect(400)
  }
  expect(await db.legalConsent.count({ where: { tenantId: tenants[0] } })).toBe(0)
})

it('records the first explicit acceptance using database time and does not fabricate historical records or rewrite that time on repeat', async () => {
  const before = (await request(app.getHttpServer()).get('/api/v1/legal/consent').set('Authorization', `Bearer ${tokens[0]}`).expect(200)).body.data
  expect(before).toMatchObject({ accepted: false, acceptedAt: null })
  const earliest = Date.now() - 1000
  const first = (await request(app.getHttpServer()).post('/api/v1/legal/consent').set('Authorization', `Bearer ${tokens[0]}`).send(accepted).expect(201)).body.data
  expect(first.accepted).toBe(true)
  expect(new Date(first.acceptedAt).getTime()).toBeGreaterThanOrEqual(earliest)
  const second = (await request(app.getHttpServer()).post('/api/v1/legal/consent').set('Authorization', `Bearer ${tokens[0]}`).send(accepted).expect(201)).body.data
  expect(second.acceptedAt).toBe(first.acceptedAt)
  const records = await db.legalConsent.findMany({ where: { userId: users[0] } })
  expect(records).toHaveLength(1)
  expect(records[0]).toMatchObject({ tenantId: tenants[0], userId: users[0], leadId: null, version: LEGAL_VERSION, documentHash: LEGAL_DOCUMENT_HASH, channel: 'mini' })
})

it('keeps another customer and tenant acceptance separate', async () => {
  const response = await request(app.getHttpServer()).get('/api/v1/legal/consent').set('Authorization', `Bearer ${tokens[1]}`).expect(200)
  expect(response.body.data).toMatchObject({ accepted: false, acceptedAt: null })
  expect(Object.keys(response.body.data).sort()).toEqual(['accepted', 'acceptedAt', 'documentHash', 'version'])
  expect(await db.legalConsent.count({ where: { tenantId: tenants[1] } })).toBe(0)
})

it('supports separately acknowledged channels without changing a previously recorded document', async () => {
  await request(app.getHttpServer()).post('/api/v1/legal/consent').set('Authorization', `Bearer ${tokens[0]}`).send({ ...accepted, consentChannel: 'buyer_web' }).expect(201)
  const records = await db.legalConsent.findMany({ where: { userId: users[0] }, orderBy: { id: 'asc' } })
  expect(records.map(record => record.channel)).toEqual(['mini', 'buyer_web'])
  expect(records.every(record => record.documentHash === LEGAL_DOCUMENT_HASH)).toBe(true)
})
