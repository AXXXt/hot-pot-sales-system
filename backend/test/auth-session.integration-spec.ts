import { randomInt, randomUUID } from 'node:crypto'
import { Body, Controller, Get, INestApplication, Post, Req, UseGuards } from '@nestjs/common'
import { ConfigService } from '@nestjs/config'
import { JwtService } from '@nestjs/jwt'
import { Test } from '@nestjs/testing'
import { PrismaClient } from '@prisma/client'
import Redis from 'ioredis'
import request from 'supertest'
import { AuthService } from '../src/auth/auth.service'
import { JwtAuthGuard } from '../src/auth/auth.guard'
import { AuthSessionService, legacyRevokedKey, sessionKey } from '../src/auth/auth-session.service'
import { SmsService } from '../src/auth/sms.service'
import { PrismaService } from '../src/prisma.service'
import { REDIS } from '../src/redis.provider'
import { WxService } from '../src/notify/wx.service'

const database = new URL(process.env.TEST_DATABASE_URL || 'invalid://missing')
const redisUrl = new URL(process.env.TEST_REDIS_URL || 'redis://127.0.0.1:6379')
if (database.protocol !== 'mysql:' || !['127.0.0.1', 'localhost', '::1', '[::1]'].includes(database.hostname) || !database.pathname.endsWith('_test') || [...database.searchParams.keys()].some(key => /host|port|url|path|socket|database/i.test(key))) throw new Error('Isolated loopback _test database required')
if (!['redis:', 'rediss:'].includes(redisUrl.protocol) || !['127.0.0.1', 'localhost', '::1', '[::1]'].includes(redisUrl.hostname) || [...redisUrl.searchParams.keys()].some(key => /host|port|url|path|socket/i.test(key))) throw new Error('Isolated loopback Redis required')
const prefix = `auth-session-it:${randomUUID()}:`
const db = new PrismaClient({ datasources: { db: { url: database.toString() } } })
const redis = new Redis(redisUrl.toString(), { keyPrefix: prefix })
const jwt = new JwtService()
const accessSecret = randomUUID(), refreshSecret = randomUUID()
let app: INestApplication, auth: AuthService, user: any, tenantId: number

@Controller('session-fixture')
class SessionFixture {
  constructor(private readonly auth: AuthService) {}
  @Get() @UseGuards(JwtAuthGuard)
  current(@Req() req: any) { return { id: req.user.sub } }
  @Post('logout') @UseGuards(JwtAuthGuard)
  logout(@Req() req: any) { return this.auth.logout(req.user.sub, req.user.sid) }
  @Post('refresh')
  refresh(@Body() body: { refreshToken: string }) { return this.auth.refreshToken(body.refreshToken) }
}

const get = (token: string) => request(app.getHttpServer()).get('/session-fixture').auth(token, { type: 'bearer' })
const logout = (token: string) => request(app.getHttpServer()).post('/session-fixture/logout').auth(token, { type: 'bearer' })
const refresh = (refreshToken: string) => request(app.getHttpServer()).post('/session-fixture/refresh').send({ refreshToken })

beforeAll(async () => {
  tenantId = (await db.tenant.create({ data: { code: randomUUID(), name: 'Session isolated fixture' } })).id
  user = await db.user.create({ data: { tenantId, phone: '1' + randomInt(3000000000, 9999999999), name: 'Session fixture', userType: 'admin', status: 'active' } })
  const module = await Test.createTestingModule({ controllers: [SessionFixture], providers: [AuthService, AuthSessionService, JwtAuthGuard,
    { provide: PrismaService, useValue: db }, { provide: REDIS, useValue: redis }, { provide: JwtService, useValue: jwt },
    { provide: ConfigService, useValue: new ConfigService({ JWT_ACCESS_SECRET: accessSecret, JWT_REFRESH_SECRET: refreshSecret }) },
    { provide: SmsService, useValue: {} }, { provide: WxService, useValue: {} }
  ] }).compile()
  auth = module.get(AuthService)
  app = module.createNestApplication(); await app.init()
})

afterAll(async () => {
  await app?.close()
  // Read only this test's UUID namespace; ioredis prefixes EVAL KEYS again.
  const keys = await redis.keys(prefix + '*')
  if (keys.length) await redis.eval('for _,k in ipairs(ARGV) do redis.call("DEL",k) end return 1', 0, ...keys)
  await redis.quit()
  if (tenantId) {
    await db.user.deleteMany({ where: { tenantId } })
    await db.tenant.delete({ where: { id: tenantId } })
  }
  await db.$disconnect()
})

it('HTTP logout immediately rejects the current access/refresh but preserves another device', async () => {
  const first = await auth.generateTokens(user, false), other = await auth.generateTokens(user, false)
  await get(first.accessToken).expect(200)
  await logout(first.accessToken).expect(201)
  await get(first.accessToken).expect(401)
  await refresh(first.refreshToken).expect(401)
  await get(other.accessToken).expect(200)
  await refresh(other.refreshToken).expect(201)
})

it('real Redis Lua allows only one concurrent refresh', async () => {
  const initial = await auth.generateTokens(user, false)
  const results = await Promise.all([refresh(initial.refreshToken), refresh(initial.refreshToken)])
  expect(results.map(result => result.status).sort()).toEqual([201, 401])
  const winner = results.find(result => result.status === 201)!.body
  await get(winner.accessToken).expect(200)
  await refresh(initial.refreshToken).expect(401)
})

it('a logout/refresh race cannot resurrect a deleted session', async () => {
  const initial = await auth.generateTokens(user, false)
  const results = await Promise.all([refresh(initial.refreshToken), logout(initial.accessToken)])
  expect(results[1].status).toBe(201)
  await get(initial.accessToken).expect(401)
  if (results[0].status === 201) {
    await get(results[0].body.accessToken).expect(401)
    await refresh(results[0].body.refreshToken).expect(401)
  }
})

it('upgrades a legacy refresh atomically, creates an expiring session and revokes legacy access', async () => {
  await redis.del(legacyRevokedKey(user.id))
  const payload = { sub: user.id, tenantId, cv: 0 }
  const oldAccess = jwt.sign(payload, { secret: accessSecret, expiresIn: '15m' })
  const oldRefresh = jwt.sign(payload, { secret: refreshSecret, expiresIn: '7d' })
  await redis.set(`refresh:${user.id}`, oldRefresh, 'EX', 3600)
  await get(oldAccess).expect(200)
  const result = await refresh(oldRefresh).expect(201)
  const sid = jwt.decode(result.body.accessToken).sid
  expect(await redis.ttl(sessionKey(user.id, sid))).toBeGreaterThan(0)
  expect(await redis.get(sessionKey(user.id, sid))).toMatch(/^[a-f0-9]{64}$/)
  expect(await redis.get(`refresh:${user.id}`)).toBeNull()
  await get(oldAccess).expect(401)
  await get(result.body.accessToken).expect(200)
})

it('legacy logout revokes legacy access without touching an independent modern session', async () => {
  await redis.del(legacyRevokedKey(user.id))
  const oldAccess = jwt.sign({ sub: user.id, tenantId, cv: 0 }, { secret: accessSecret, expiresIn: '15m' })
  const other = await auth.generateTokens(user, false)
  await logout(oldAccess).expect(201)
  await get(oldAccess).expect(401)
  await get(other.accessToken).expect(200)
})

it('a database disablement rejects existing tokens on their next request', async () => {
  const initial = await auth.generateTokens(user, false)
  await db.user.update({ where: { id: user.id }, data: { status: 'disabled' } })
  try {
    await get(initial.accessToken).expect(401)
    await refresh(initial.refreshToken).expect(401)
  } finally { await db.user.update({ where: { id: user.id }, data: { status: 'active' } }) }
})

it('an expired session rejects access and refresh and cannot be extended by replay', async () => {
  const initial = await auth.generateTokens(user, false)
  const sid = jwt.decode(initial.accessToken).sid
  await redis.expire(sessionKey(user.id, sid), 0)
  await get(initial.accessToken).expect(401)
  await refresh(initial.refreshToken).expect(401)
  expect(await redis.exists(sessionKey(user.id, sid))).toBe(0)
})
