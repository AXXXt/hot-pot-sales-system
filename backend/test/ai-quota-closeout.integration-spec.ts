import { randomUUID } from 'node:crypto'
import { PrismaClient } from '@prisma/client'
import Redis from 'ioredis'
import { AiModelService } from '../src/ai/ai-model.service'
import { shanghaiDay } from '../src/ai/ai.metrics'

const dbTarget = new URL(process.env.TEST_DATABASE_URL || 'invalid://missing'), redisTarget = new URL(process.env.TEST_REDIS_URL || 'redis://127.0.0.1:6379')
const loopback = ['127.0.0.1', 'localhost', '[::1]']
if (dbTarget.protocol !== 'mysql:' || !loopback.includes(dbTarget.hostname) || !dbTarget.pathname.endsWith('_test')) throw Error('Loopback mysql *_test database required')
if (!['redis:', 'rediss:'].includes(redisTarget.protocol) || !loopback.includes(redisTarget.hostname) || [...redisTarget.searchParams.keys()].some(key => ['host', 'hostname', 'port', 'path', 'sentinels'].includes(key.toLowerCase()))) throw Error('Loopback Redis test target required')
const db = new PrismaClient({ datasources: { db: { url: process.env.TEST_DATABASE_URL } } })
const namespace = `ai-quota-test:${randomUUID()}:`, redis = new Redis(redisTarget.href, { keyPrefix: namespace })
let tenantId: number, userId: number, service: AiModelService, quotaKey: string, fetch: jest.SpyInstance
const settings = { configFor: async () => ({ enabled: true, encryptedKey: 'local-fake-ciphertext', dailyRequests: 3, textModel: 'local-fake-model', baseUrl: 'https://api.deepseek.com/v1' }), decrypt: jest.fn(() => 'local-fake-key-never-sent') }

beforeAll(async () => {
  tenantId = (await db.tenant.create({ data: { code: randomUUID(), name: 'Local quota fixture' } })).id
  userId = (await db.user.create({ data: { tenantId, phone: randomUUID().slice(0, 20), name: 'Local quota user', userType: 'super_admin' } })).id
  quotaKey = `ai:quota:${tenantId}:${userId}:${shanghaiDay()}`
  service = new AiModelService(settings as any, db as any, redis)
})

beforeEach(async () => {
  await redis.del(quotaKey); await db.aiUsageRecord.deleteMany({ where: { tenantId } }); settings.decrypt.mockClear()
  fetch = jest.spyOn(global, 'fetch').mockResolvedValue({ ok: true, text: async () => JSON.stringify({ choices: [{ message: { role: 'assistant', content: 'Deterministic fixture reply' } }], usage: { prompt_tokens: 1, completion_tokens: 1 } }) } as Response)
})

afterEach(() => { fetch?.mockRestore() })
afterAll(async () => {
  if (tenantId) { await db.aiUsageRecord.deleteMany({ where: { tenantId } }); await db.user.deleteMany({ where: { tenantId } }); await db.tenant.delete({ where: { id: tenantId } }) }
  const keys = await redis.keys(namespace + '*')
  if (keys.length) await redis.eval('for _,key in ipairs(ARGV) do redis.call("DEL",key) end return 1', 0, ...keys)
  await redis.quit(); await db.$disconnect()
})

it('atomically limits eight concurrent requests to three usage records and three mocked provider calls', async () => {
  const results = await Promise.allSettled(Array.from({ length: 8 }, () => service.complete({ tenantId, id: userId } as any, [{ role: 'user', content: 'Local fixture' }], [])))
  expect(results.filter(result => result.status === 'fulfilled')).toHaveLength(3)
  expect(results.filter(result => result.status === 'rejected')).toHaveLength(5)
  expect(fetch).toHaveBeenCalledTimes(3)
  expect(await db.aiUsageRecord.count({ where: { tenantId, status: 'completed' } })).toBe(3)
  expect(await redis.ttl(quotaKey)).toBeGreaterThan(0)
})

it('repairs an exhausted legacy quota without a TTL before rejecting another model attempt', async () => {
  await redis.set(quotaKey, '3'); expect(await redis.ttl(quotaKey)).toBe(-1)
  await expect(service.complete({ tenantId, id: userId } as any, [], [])).rejects.toThrow('今日模型调用上限')
  expect(await redis.ttl(quotaKey)).toBeGreaterThan(0)
  expect(fetch).not.toHaveBeenCalled(); expect(await db.aiUsageRecord.count({ where: { tenantId } })).toBe(0)
})

it('does not insert usage or contact any provider if quota verification fails', async () => {
  const operation = jest.spyOn(redis, 'eval').mockRejectedValueOnce(Error('synthetic Redis quota fault'))
  try { await expect(service.complete({ tenantId, id: userId } as any, [], [])).rejects.toMatchObject({ response: { errorCode: 'AI_QUOTA_UNAVAILABLE' } }) }
  finally { operation.mockRestore() }
  expect(fetch).not.toHaveBeenCalled(); expect(settings.decrypt).not.toHaveBeenCalled()
  expect(await db.aiUsageRecord.count({ where: { tenantId } })).toBe(0)
})
