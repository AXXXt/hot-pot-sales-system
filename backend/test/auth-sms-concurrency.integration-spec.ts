import { randomUUID } from 'node:crypto'
import { ConfigService } from '@nestjs/config'
import Redis from 'ioredis'
import { SmsService } from '../src/auth/sms.service'

const redisUrl = process.env.TEST_REDIS_URL || 'redis://127.0.0.1:6379'
let target: URL
try { target = new URL(redisUrl) } catch { throw Error('Local isolated Redis required') }
if (!['redis:', 'rediss:'].includes(target.protocol) || !['localhost', '127.0.0.1', '[::1]'].includes(target.hostname)) throw Error('Local isolated Redis required')
const prefix = `sms-concurrency-test:${randomUUID()}:`
const redis = new Redis(redisUrl, { keyPrefix: prefix })
const service = new SmsService(new ConfigService({ SMS_PROVIDER: 'tencentcloud' }), redis as any)
const phone = 'isolated-fixture', codeKey = `sms:code:${phone}`, attemptsKey = `sms:attempts:${phone}`

beforeEach(async () => { await redis.del(codeKey, attemptsKey) })
afterAll(async () => {
  try { await redis.del(codeKey, attemptsKey) } finally { await redis.quit() }
})

it('executes real Redis Lua so only one concurrent verification consumes a valid proof', async () => {
  await redis.set(codeKey, 'fixture-proof', 'EX', 300)
  const results = await Promise.all([service.verifyCode(phone, 'fixture-proof'), service.verifyCode(phone, 'fixture-proof')])
  expect(results.filter(Boolean)).toHaveLength(1)
  expect(await redis.get(codeKey)).toBeNull()
})

it('atomically counts wrong attempts and preserves the five-attempt lockout under concurrency', async () => {
  await redis.set(codeKey, 'fixture-proof', 'EX', 300)
  const results = await Promise.allSettled(Array.from({ length: 10 }, () => service.verifyCode(phone, 'wrong-proof')))
  expect(results.filter(result => result.status === 'fulfilled' && result.value === false)).toHaveLength(5)
  expect(results.filter(result => result.status === 'rejected' && result.reason.status === 429)).toHaveLength(5)
  expect(await redis.get(attemptsKey)).toBe('5')
  expect(await redis.ttl(attemptsKey)).toBeGreaterThan(0)
  expect(await redis.ttl(attemptsKey)).toBeLessThanOrEqual(300)
  await expect(service.verifyCode(phone, 'fixture-proof')).rejects.toMatchObject({ status: 429 })
})

it('does not consume the valid proof on a wrong attempt and clears the counter on success', async () => {
  await redis.set(codeKey, 'fixture-proof', 'EX', 300)
  expect(await service.verifyCode(phone, 'wrong-proof')).toBe(false)
  expect(await redis.get(codeKey)).toBe('fixture-proof')
  expect(await service.verifyCode(phone, 'fixture-proof')).toBe(true)
  expect(await redis.get(codeKey)).toBeNull()
  expect(await redis.get(attemptsKey)).toBeNull()
})

it('retains the existing five-minute attempt-window renewal after a wrong verification', async () => {
  await redis.set(attemptsKey, '1', 'EX', 20)
  expect(await service.verifyCode(phone, 'wrong-proof')).toBe(false)
  expect(await redis.get(attemptsKey)).toBe('2')
  expect(await redis.ttl(attemptsKey)).toBeGreaterThan(290)
  expect(await redis.ttl(attemptsKey)).toBeLessThanOrEqual(300)
})
