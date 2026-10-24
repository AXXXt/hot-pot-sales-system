import { randomUUID } from 'node:crypto'
import { ConfigService } from '@nestjs/config'
import { JwtService } from '@nestjs/jwt'
import { AuthService } from '../src/auth/auth.service'
import { SmsService } from '../src/auth/sms.service'
import { sessionMemory } from './helpers/session-memory'

function memory() {
  const fixture = sessionMemory()
  const { values, redis } = fixture
  const sessionEval = redis.eval
  redis.eval = jest.fn(async (script: string, count: number, ...args: any[]) => {
    if (script.includes('-- auth-session-')) return sessionEval(script, count, ...args)
    const [codeKey, attemptsKey, supplied, max] = args
    const attempts = Number(values.get(attemptsKey) || 0)
    if (attempts >= max) return -1
    if (values.get(codeKey) !== supplied) { values.set(attemptsKey, String(attempts + 1)); return 0 }
    values.delete(codeKey); values.delete(attemptsKey); return 1
  })
  return fixture
}

it('rotates distinct refresh tokens even in the same second without blacklisting the replacement', async () => {
  const { redis } = memory(), secret = randomUUID()
  const user = { id: 7, tenantId: 3, phone: 'fixture-account', status: 'active', tenant: { status: 'active' }, customer: null }
  const db = { user: { findUnique: async () => user, update: async () => user } }
  const service = new AuthService(db as any, new JwtService(), new ConfigService({ JWT_ACCESS_SECRET: secret, JWT_REFRESH_SECRET: secret }), {} as any, {} as any, redis)
  jest.spyOn(Date, 'now').mockReturnValue(1800000000000)
  try {
    const login = await service.generateTokens(user, false)
    const replacement = await service.refreshToken(login.refreshToken)
    expect(replacement.refreshToken === login.refreshToken).toBe(false)
    expect(await service.refreshToken(replacement.refreshToken)).toHaveProperty('refreshToken')
    await expect(service.refreshToken(login.refreshToken)).rejects.toMatchObject({ status: 401 })
  } finally { jest.restoreAllMocks() }
})

it('consumes the same SMS proof only once under concurrent verification', async () => {
  const { redis, values } = memory()
  values.set('sms:code:fixture', 'proof')
  const service = new SmsService(new ConfigService({ SMS_PROVIDER: 'tencentcloud' }), redis)
  expect((await Promise.all([service.verifyCode('fixture', 'proof'), service.verifyCode('fixture', 'proof')])).filter(Boolean)).toHaveLength(1)
  expect(redis.eval).toHaveBeenCalledTimes(2)
})

it('accepts an existing refresh token without jti and upgrades its replacement without forcing a new login', async () => {
  const { redis, values } = memory(), secret = randomUUID(), jwt = new JwtService()
  const user = { id: 7, tenantId: 3, status: 'active', tenant: { status: 'active' }, customer: null }
  const token = jwt.sign({ sub: 7, tenantId: 3, cv: 0 }, { secret, expiresIn: '7d' })
  values.set('refresh:7', token)
  const service = new AuthService({ user: { findUnique: async () => user } } as any, jwt, new ConfigService({ JWT_ACCESS_SECRET: secret, JWT_REFRESH_SECRET: secret }), {} as any, {} as any, redis)
  const result = await service.refreshToken(token)
  expect(typeof jwt.verify(result.refreshToken, { secret }).jti).toBe('string')
})

it('counts concurrent wrong SMS attempts atomically and enforces the existing cap', async () => {
  const { redis, values } = memory()
  const service = new SmsService(new ConfigService({ SMS_PROVIDER: 'tencentcloud' }), redis)
  const results = await Promise.allSettled(Array.from({ length: 10 }, () => service.verifyCode('fixture', 'wrong')))
  expect(values.get('sms:attempts:fixture')).toBe('5')
  expect(results.filter(result => result.status === 'rejected')).toHaveLength(5)
})

it('fails closed when the shared atomic verification store is unavailable', async () => {
  const { redis } = memory()
  redis.eval.mockRejectedValue(new Error('offline'))
  const service = new SmsService(new ConfigService({ SMS_PROVIDER: 'tencentcloud' }), redis)
  await expect(service.verifyCode('fixture', 'proof')).rejects.toMatchObject({ status: 503 })
  expect(redis.get).not.toHaveBeenCalled()
  expect(redis.del).not.toHaveBeenCalled()
})
