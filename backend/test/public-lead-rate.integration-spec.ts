import { AuthSessionService } from '../src/auth/auth-session.service'
import { randomInt, randomUUID } from 'node:crypto'
import { INestApplication, ValidationPipe } from '@nestjs/common'
import { Test } from '@nestjs/testing'
import { ConfigService } from '@nestjs/config'
import { JwtService } from '@nestjs/jwt'
import { PrismaClient } from '@prisma/client'
import Redis from 'ioredis'
import request from 'supertest'
import { LeadController } from '../src/lead/lead.controller'
import { LeadService } from '../src/lead/lead.service'
import { PrismaService } from '../src/prisma.service'
import { AuditService } from '../src/audit/audit.service'
import { StaffAccessService } from '../src/auth/staff-access.service'
import { JwtAuthGuard } from '../src/auth/auth.guard'
import { PermissionsGuard } from '../src/auth/permissions.guard'
import { REDIS } from '../src/redis.provider'
import { AppFilter } from '../src/app.filter'
import { SuccessInterceptor } from '../src/success.interceptor'
import { LEGAL_DOCUMENT_HASH, LEGAL_VERSION } from '../src/legal/legal-consent'
const leadConsent = { consentAccepted: true, consentVersion: LEGAL_VERSION, consentChannel: 'official_site' as const }

const databaseUrl = process.env.TEST_DATABASE_URL
const redisUrl = process.env.TEST_REDIS_URL || 'redis://127.0.0.1:6379'
function target(value: string | undefined, label: string) {
  try { return new URL(value || '') } catch { throw new Error(`Valid loopback ${label} required`) }
}
const databaseTarget = target(databaseUrl, 'TEST_DATABASE_URL')
const redisTarget = target(redisUrl, 'TEST_REDIS_URL')
const loopback = ['localhost', '127.0.0.1', '[::1]']
if (databaseTarget.protocol !== 'mysql:' || !loopback.includes(databaseTarget.hostname) || !databaseTarget.pathname.endsWith('_test')) {
  throw new Error('Isolated loopback mysql TEST_DATABASE_URL ending in _test required')
}
if (!['redis:', 'rediss:'].includes(redisTarget.protocol) || !loopback.includes(redisTarget.hostname) ||
  [...redisTarget.searchParams.keys()].some(key => ['host', 'hostname', 'port', 'path', 'sentinels'].includes(key.toLowerCase()))) {
  throw new Error('Isolated loopback redis/rediss TEST_REDIS_URL required')
}
const db = new PrismaClient({ datasources: { db: { url: databaseUrl } } })
const namespace = `public-lead-rate-test:${randomUUID()}:`
const redis = new Redis(redisUrl, { keyPrefix: namespace })
const marker = 'Public lead rate fixture ' + randomUUID()
const phone = () => '139' + String(randomInt(0, 100_000_000)).padStart(8, '0')
const ipKey = (ip: string) => 'lead:rate:ip:' + ip
const phoneKey = (value: string) => 'lead:rate:phone:' + value
const count = () => db.lead.count({ where: { tenantId: 1, storeName: marker } })
let app: INestApplication, createdPublicTenant = false
const submit = (value: string, ip: string, website?: string, requestId = randomUUID(), interestedItems = requestId) => request(app.getHttpServer()).post('/api/v1/leads/public')
  .set('x-forwarded-for', ip).send({ ...leadConsent, requestId, phone: value, storeName: marker, interestedItems, website })

beforeAll(async () => {
  // The public website intentionally uses tenant1. Never alter an existing tenant or clean another fixture's rows.
  if (!await db.tenant.findUnique({ where: { id: 1 } })) {
    await db.tenant.create({ data: { id: 1, code: randomUUID(), name: marker } }); createdPublicTenant = true
  }
  const module = await Test.createTestingModule({ controllers: [LeadController], providers: [
      // Business fixture: session revocation itself is covered by auth-session.integration-spec.ts.
      { provide: AuthSessionService, useValue: { assertActive: async () => {} } },LeadService,
    { provide: PrismaService, useValue: db }, { provide: AuditService, useValue: { write: jest.fn() } },
    { provide: StaffAccessService, useValue: { actor: jest.fn() } }, { provide: REDIS, useValue: redis },
    { provide: JwtService, useValue: {} }, { provide: ConfigService, useValue: {} }
  ] }).overrideGuard(JwtAuthGuard).useValue({ canActivate: () => false }).overrideGuard(PermissionsGuard).useValue({ canActivate: () => false }).compile()
  app = module.createNestApplication(); app.setGlobalPrefix('api/v1')
  app.useGlobalPipes(new ValidationPipe({ transform: true, whitelist: true, forbidNonWhitelisted: true }))
  app.useGlobalInterceptors(new SuccessInterceptor()); app.useGlobalFilters(new AppFilter()); await app.init()
})

afterAll(async () => {
  await app?.close()
  const leads = await db.lead.findMany({ where: { tenantId: 1, storeName: marker }, select: { id: true } })
  if (leads.length) await db.legalConsent.deleteMany({ where: { leadId: { in: leads.map(lead => lead.id) } } })
  await db.lead.deleteMany({ where: { tenantId: 1, storeName: marker } })
  if (createdPublicTenant) await db.tenant.delete({ where: { id: 1 } })
  const keys = await redis.keys(namespace + '*')
  if (keys.length) await redis.eval('for _,key in ipairs(ARGV) do redis.call("DEL",key) end return 1', 0, ...keys)
  await redis.quit(); await db.$disconnect()
})

it('atomically gives both rate keys an hour TTL before accepting a public lead', async () => {
  const value = phone(), ip = '192.0.2.1', before = await count()
  const response = await submit(value, ip).expect(201)
  expect(await count()).toBe(before + 1)
  expect(await db.legalConsent.findUnique({ where: { leadId: response.body.data.id } })).toMatchObject({
    tenantId: 1, userId: null, leadId: response.body.data.id, version: LEGAL_VERSION, documentHash: LEGAL_DOCUMENT_HASH, channel: 'official_site', acceptedAt: expect.any(Date)
  })
  for (const key of [ipKey(ip), phoneKey(value)]) {
    expect(await redis.get(key)).toBe('1')
    expect(await redis.ttl(key)).toBeGreaterThan(0)
    expect(await redis.ttl(key)).toBeLessThanOrEqual(3600)
  }
})

it('repairs exhausted legacy IP and phone keys without TTL even when rejecting the attempt', async () => {
  const value = phone(), ip = '192.0.2.2', before = await count()
  await redis.set(ipKey(ip), '5')
  expect(await redis.ttl(ipKey(ip))).toBe(-1)
  await submit(value, ip).expect(429)
  expect(await redis.get(ipKey(ip))).toBe('6')
  expect(await redis.ttl(ipKey(ip))).toBeGreaterThan(0)
  await redis.set(phoneKey(value), '3')
  await submit(value, '192.0.2.3').expect(429)
  expect(await redis.get(phoneKey(value))).toBe('4')
  expect(await redis.ttl(phoneKey(value))).toBeGreaterThan(0)
  expect(await count()).toBe(before)
})

it('keeps three-per-phone and five-per-IP acceptance limits', async () => {
  const value = phone(), before = await count()
  for (let index = 10; index < 13; index++) await submit(value, '192.0.2.' + index).expect(201)
  await submit(value, '192.0.2.13').expect(429)
  expect(await count()).toBe(before + 3)
  for (let index = 0; index < 5; index++) await submit(phone(), '192.0.2.20').expect(201)
  await submit(phone(), '192.0.2.20').expect(429)
  expect(await count()).toBe(before + 8)
})

it('returns a readable503 and no database write when the atomic rate operation fails', async () => {
  const before = await count(), operation = jest.spyOn(redis, 'eval').mockRejectedValueOnce(new Error('synthetic Redis operation unavailable'))
  try {
    const response = await submit(phone(), '192.0.2.30').expect(503)
    expect(response.body).toMatchObject({ errorCode: 'LEAD_RATE_UNAVAILABLE' })
    expect(response.body.message).toContain('暂不可用')
    expect(JSON.stringify(response.body)).not.toContain('synthetic Redis')
  } finally { operation.mockRestore() }
  expect(await count()).toBe(before)
})

it('drops honeypot traffic without touching Redis or inserting a lead', async () => {
  const before = await count(), operation = jest.spyOn(redis, 'eval')
  try {
    await submit(phone(), '192.0.2.40', 'https://example.invalid/bot').expect(201)
    expect(operation).not.toHaveBeenCalled()
  } finally { operation.mockRestore() }
  expect(await count()).toBe(before)
})

it('rejects absent, refused, stale or wrong-channel consent before rate counters or lead writes', async () => {
  const before = await count(), operation = jest.spyOn(redis, 'eval')
  try {
    for (const consent of [{}, { ...leadConsent, consentAccepted: false }, { ...leadConsent, consentVersion: 'obsolete' }, { ...leadConsent, consentChannel: 'mini' }]) {
      await request(app.getHttpServer()).post('/api/v1/leads/public').send({ phone: phone(), storeName: marker, ...consent }).expect(400)
    }
    expect(operation).not.toHaveBeenCalled()
  } finally { operation.mockRestore() }
  expect(await count()).toBe(before)
})

it('rolls back a new lead when its consent persistence fails in the same real transaction', async () => {
  const before = await count(), realTransaction = db.$transaction.bind(db)
  const operation = jest.spyOn(db, '$transaction').mockImplementationOnce((async (callback: unknown) => realTransaction(async tx => {
    return (callback as any)(new Proxy(tx, { get(target, key) {
      if (key === 'legalConsent') return { createMany: async () => { throw new Error('synthetic consent write failed') } }
      return Reflect.get(target, key)
    } }))
  })) as any)
  try { await submit(phone(), '192.0.2.90').expect(500) } finally { operation.mockRestore() }
  expect(await count()).toBe(before)
})

it('keeps a retried or concurrently replayed request to one lead and one consent, and rejects changed content', async () => {
  const value = phone(), id = randomUUID(), before = await count()
  const responses = await Promise.all([submit(value, '192.0.2.100', undefined, id), submit(value, '192.0.2.100', undefined, id)])
  expect(responses.map(response => response.status)).toEqual([201, 201])
  expect(responses[0].body.data.id).toBe(responses[1].body.data.id)
  const leadId = responses[0].body.data.id
  expect(await count()).toBe(before + 1)
  expect(await db.legalConsent.count({ where: { leadId } })).toBe(1)
  const rateCount = await redis.get(phoneKey(value))
  await submit(value, '192.0.2.100', undefined, id).expect(201)
  expect(await redis.get(phoneKey(value))).toBe(rateCount)
  await request(app.getHttpServer()).post('/api/v1/leads/public').send({ ...leadConsent, requestId: id, phone: value,
    storeName: marker, interestedItems: id, consentAccepted: false }).expect(400)
  await request(app.getHttpServer()).post('/api/v1/leads/public').send({ ...leadConsent, requestId: id, phone: value,
    storeName: marker, interestedItems: id, consentVersion: 'obsolete' }).expect(400)
  expect(await redis.get(phoneKey(value))).toBe(rateCount)
  await request(app.getHttpServer()).post('/api/v1/leads/public').send({ ...leadConsent, requestId: id, phone: value, storeName: 'Changed payload' }).expect(409)
  expect(await count()).toBe(before + 1)
})

it('deduplicates equal consultations with different nonces for five minutes, including concurrent requests', async () => {
  const value = phone(), purpose = randomUUID(), firstNonce = randomUUID(), mergedNonce = randomUUID(), before = await count()
  const replies = await Promise.all([
    submit(value, '192.0.2.110', undefined, firstNonce, purpose),
    submit(value, '192.0.2.111', undefined, mergedNonce, purpose)
  ])
  expect(replies.map(reply => reply.status)).toEqual([201, 201])
  expect(replies[0].body.data.id).toBe(replies[1].body.data.id)
  expect(await count()).toBe(before + 1)
  const leadId = replies[0].body.data.id
  expect(await db.legalConsent.count({ where: { leadId } })).toBe(1)
  expect(await db.leadSubmission.count({ where: { leadId } })).toBe(2)
  await db.lead.update({ where: { id: leadId }, data: { createdAt: new Date(Date.now() - 6 * 60 * 1000) } })
  const replay = await submit(value, '192.0.2.111', undefined, mergedNonce, purpose).expect(201)
  expect(replay.body.data.id).toBe(leadId)
  expect(await count()).toBe(before + 1)
  const next = await submit(value, '192.0.2.112', undefined, randomUUID(), purpose).expect(201)
  expect(next.body.data.id).not.toBe(leadId)
  expect(await count()).toBe(before + 2)
})

it('keeps the three-per-phone quota during ten concurrent equal consultations while accepting only one lead', async () => {
  const value = phone(), purpose = randomUUID(), before = await count()
  const replies = await Promise.all(Array.from({ length: 10 }, (_, index) => submit(value, `192.0.2.${140 + index}`, undefined, randomUUID(), purpose)))
  expect(replies.filter(reply => reply.status === 201)).toHaveLength(3)
  expect(replies.filter(reply => reply.status === 429)).toHaveLength(7)
  expect(new Set(replies.filter(reply => reply.status === 201).map(reply => reply.body.data.id)).size).toBe(1)
  expect(await count()).toBe(before + 1)
  expect(await db.legalConsent.count({ where: { leadId: replies.find(reply => reply.status === 201)!.body.data.id } })).toBe(1)
})

it('rolls back the lead and its consent when saving the accepted request alias fails', async () => {
  const before = await count(), realTransaction = db.$transaction.bind(db)
  let insertedLead = 0
  const operation = jest.spyOn(db, '$transaction').mockImplementationOnce((async (callback: unknown) => realTransaction(async tx =>
    (callback as any)(new Proxy(tx, { get(target, key) {
      if (key === 'leadSubmission') return { findUnique: (args: any) => target.leadSubmission.findUnique(args), create: async ({ data }: any) => { insertedLead = data.leadId; throw new Error('synthetic request alias write failed') } }
      return Reflect.get(target, key)
    } }))
  )) as any)
  try { await submit(phone(), '192.0.2.160').expect(500) } finally { operation.mockRestore() }
  expect(insertedLead).toBeGreaterThan(0)
  expect(await count()).toBe(before)
  expect(await db.legalConsent.count({ where: { leadId: insertedLead } })).toBe(0)
})
