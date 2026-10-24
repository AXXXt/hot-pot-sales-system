import { randomUUID } from 'node:crypto'
import { ConfigService } from '@nestjs/config'
import { PrismaClient } from '@prisma/client'
import { Queue } from 'bullmq'
import { AiScheduleService } from '../src/ai/ai-schedule.service'
import { AiSettingsService } from '../src/ai/ai-settings.service'
import { StaffAccessService, StaffActor } from '../src/auth/staff-access.service'
import { PrismaService } from '../src/prisma.service'

const target = new URL(process.env.TEST_DATABASE_URL || 'invalid://missing'), redis = new URL(process.env.TEST_REDIS_URL || 'redis://127.0.0.1:6379')
const loopback = ['127.0.0.1', 'localhost', '[::1]']
if (target.protocol !== 'mysql:' || !loopback.includes(target.hostname) || !target.pathname.endsWith('_test')) throw Error('Loopback mysql *_test database required')
if (!['redis:', 'rediss:'].includes(redis.protocol) || !loopback.includes(redis.hostname) || redis.search) throw Error('Loopback Redis test target without URL overrides required')
const db = new PrismaClient({ datasources: { db: { url: process.env.TEST_DATABASE_URL } } })
const connection = { host: redis.hostname, port: Number(redis.port || 6379), username: decodeURIComponent(redis.username) || undefined, password: decodeURIComponent(redis.password) || undefined, db: Number(redis.pathname.slice(1) || 0), ...(redis.protocol === 'rediss:' ? { tls: {} } : {}) }
const services: AiScheduleService[] = [], queues: Queue[] = [], held: Array<() => void> = []
let tenantId: number, actor: StaffActor, access: StaffAccessService, settings: AiSettingsService
let afterScheduleRead: ((rows: any[]) => Promise<void>) | undefined
const prisma = new Proxy(db, { get(target, property) {
  if (property === 'aiSchedule' || property === 'aiAttachment') return new Proxy(target[property], { get(model, method) {
    if (method === 'findMany') return async (args: any = {}) => {
      const rows = await (model as any).findMany({ ...args, where: { AND: [args.where || {}, { tenantId }] } })
      if (property === 'aiSchedule') await afterScheduleRead?.(rows)
      return rows
    }
    return Reflect.get(model, method)
  } })
  const value = Reflect.get(target, property)
  return typeof value === 'function' ? value.bind(target) : value
} }) as unknown as PrismaService
const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms))
async function until(check: () => Promise<boolean>, timeout = 10000) {
  const deadline = Date.now() + timeout
  while (!await check()) { if (Date.now() >= deadline) throw Error('Local schedule evidence timed out'); await sleep(30) }
}
function service(prefix: string, data = { todos: jest.fn(async () => [{ type: 'counts', title: 'Local fixture result', items: [] }]), metrics: jest.fn(async () => ({ type: 'metrics', amount: '19.90' })) }) {
  const value = new AiScheduleService(prisma, access, data as any, settings, new ConfigService({ NODE_ENV: 'qa-isolated-integration', REDIS_URL: redis.href, AI_QUEUE_PREFIX: prefix }), { removeAiImage: jest.fn() } as any)
  services.push(value); return value
}
async function control() {
  const prefix = `qa_ai_schedule_${randomUUID().replaceAll('-', '')}`
  const queue = new Queue('ai-operations-maintenance', { prefix, connection }); queues.push(queue)
  await queue.waitUntilReady(); await queue.pause()
  return { queue, prefix }
}
async function due(value: AiScheduleService, kind = 'daily_todos') {
  const schedule = await value.create(actor, { name: 'Local queue fixture', kind, hour: 9, enabled: true })
  const scheduledAt = new Date(Date.now() - 60000)
  await db.aiSchedule.update({ where: { id: schedule.id }, data: { nextRunAt: scheduledAt } })
  return { id: schedule.id, scheduledAt: scheduledAt.toISOString() }
}
async function rapidScheduler(queue: Queue) {
  await queue.upsertJobScheduler('maintenance-minute', { every: 100 }, { name: 'tick', data: {}, opts: { removeOnComplete: 5, removeOnFail: 10 } })
}

beforeAll(async () => {
  tenantId = (await db.tenant.create({ data: { code: randomUUID(), name: 'Local real BullMQ fixture' } })).id
  const user = await db.user.create({ data: { tenantId, phone: randomUUID().slice(0, 20), name: 'Local schedule owner', userType: 'super_admin' } })
  access = new StaffAccessService(db as unknown as PrismaService); actor = await access.actor(user.id)
  settings = new AiSettingsService(db as unknown as PrismaService, new ConfigService(), access)
  await db.aiConfig.create({ data: { tenantId, enabled: true, features: { tasks: true, analytics: true } } })
})

afterEach(async () => {
  afterScheduleRead = undefined
  held.splice(0).forEach(release => release())
  for (const value of services.splice(0)) await value.onModuleDestroy()
  for (const queue of queues.splice(0)) {
    if (!/^qa_ai_schedule_[a-f0-9]{32}$/.test(queue.opts.prefix || '')) throw Error('Refusing to clean a non-fixture queue')
    await queue.obliterate({ force: true }); await queue.close()
  }
  await db.aiSchedule.deleteMany({ where: { tenantId } })
})

afterAll(async () => {
  if (tenantId) {
    await db.aiSchedule.deleteMany({ where: { tenantId } }); await db.aiConfig.deleteMany({ where: { tenantId } })
    await db.userBrandAccess.deleteMany({ where: { tenantId } }); await db.brand.deleteMany({ where: { tenantId } })
    await db.user.deleteMany({ where: { tenantId } }); await db.tenant.delete({ where: { id: tenantId } })
  }
  await db.$disconnect()
})

it('enforces the ten-enabled-task quota under sixteen concurrent SQL requests', async () => {
  const value = service('unused_quota_fixture')
  const results = await Promise.allSettled(Array.from({ length: 16 }, (_, index) => value.create(actor, { name: `Local quota ${index}`, kind: 'daily_todos', hour: 9, enabled: true })))
  expect(results.filter(result => result.status === 'fulfilled')).toHaveLength(10)
  expect(results.filter(result => result.status === 'rejected')).toHaveLength(6)
  for (const result of results) if (result.status === 'rejected') expect(result.reason).toMatchObject({ status: 400 })
  expect(await db.aiSchedule.count({ where: { tenantId, ownerId: actor.id, enabled: true } })).toBe(10)
  await value.create(actor, { name: 'Local paused task', kind: 'daily_todos', hour: 9, enabled: false })
  expect(await db.aiSchedule.count({ where: { tenantId } })).toBe(11)
  const brand = await db.brand.create({ data: { tenantId, code: `LOCAL-${randomUUID().slice(0, 8)}`, name: 'Local changed scope' } })
  await db.userBrandAccess.create({ data: { tenantId, userId: actor.id, brandId: brand.id } })
  try {
    const changed = await access.actor(actor.id)
    expect(changed.fingerprint).not.toBe(actor.fingerprint)
    await expect(value.create(actor, { name: 'Stale request rejected', kind: 'daily_todos', hour: 9, enabled: true })).rejects.toMatchObject({ status: 409 })
    await value.create(changed, { name: 'Current-scope task', kind: 'daily_todos', hour: 9, enabled: true })
    expect(await db.aiSchedule.count({ where: { tenantId, enabled: true } })).toBe(1)
    expect(await db.aiSchedule.count({ where: { tenantId, enabled: true, fingerprint: actor.fingerprint } })).toBe(0)
    expect((await value.list(changed) as any[]).map(row => row.name)).toEqual(['Current-scope task'])
  } finally { await db.userBrandAccess.deleteMany({ where: { tenantId, brandId: brand.id } }); await db.brand.delete({ where: { id: brand.id } }) }
}, 30000)

it('executes a real repeating BullMQ job, persists one report per original cycle and avoids repeat publication', async () => {
  const data = { todos: jest.fn(), metrics: jest.fn(async () => ({ type: 'metrics', amount: '19.90' })) }
  const { queue, prefix } = await control(), value = service(prefix, data)
  const item = await due(value, 'weekly_metrics')
  const originalAt = new Date(Date.now() - 14 * 86400000)
  item.scheduledAt = originalAt.toISOString()
  await db.aiSchedule.update({ where: { id: item.id }, data: { nextRunAt: originalAt } })
  await value.onModuleInit(); await rapidScheduler(queue); await queue.resume()
  await until(async () => Boolean((await db.aiSchedule.findUniqueOrThrow({ where: { id: item.id } })).lastRunAt))
  const first = await db.aiSchedule.findUniqueOrThrow({ where: { id: item.id } }), result = first.lastResult as any
  expect(result._schedule).toMatchObject({ scheduledAt: item.scheduledAt, identity: `${item.id}:${item.scheduledAt}`, state: 'completed' })
  expect(result.value).toEqual({ type: 'metrics', amount: '19.90' })
  expect(data.metrics).toHaveBeenCalledWith(actor, 'last_week', originalAt)
  await sleep(350)
  const later = await db.aiSchedule.findUniqueOrThrow({ where: { id: item.id } })
  expect(later.lastRunAt).toEqual(first.lastRunAt); expect(later.lastResult).toEqual(first.lastResult)
  expect(later.nextRunAt.getTime()).toBeGreaterThan(Date.now())
  expect((await queue.getJobSchedulers()).length).toBe(1)
  const publicRow = (await value.list(actor) as any[]).find(row => row.id === item.id)
  expect(publicRow.running).toBe(false); expect(publicRow.lastResult).toEqual({ type: 'metrics', amount: '19.90' })
  expect(publicRow.lastResult).not.toHaveProperty('_schedule')
  expect(data.metrics.mock.calls.every(call => (call as unknown as [unknown, string, Date])[2].getTime() === originalAt.getTime())).toBe(true)
}, 30000)

it('recovers a force-stopped worker lease with the same cycle identity and fences the old worker result', async () => {
  const { queue, prefix } = await control()
  let release!: () => void, started = false
  const blocked = new Promise<void>(resolve => { release = resolve; held.push(resolve) })
  const old = service(prefix, { todos: jest.fn(async () => { started = true; await blocked; return [{ type: 'counts', title: 'OLD worker result', items: [] }] }), metrics: jest.fn() })
  let oldTickFinished = false
  const runOld = old.tick.bind(old)
  jest.spyOn(old, 'tick').mockImplementation(async () => { try { await runOld() } finally { oldTickFinished = true } })
  const item = await due(old)
  const beforeClaim = Date.now()
  await old.onModuleInit(); await rapidScheduler(queue); await queue.resume()
  await until(async () => started)
  const afterClaim = Date.now()
  const claimed = await db.aiSchedule.findUniqueOrThrow({ where: { id: item.id } })
  expect((claimed.lastResult as any)._schedule).toMatchObject({ state: 'running', scheduledAt: item.scheduledAt })
  expect(claimed.nextRunAt.getTime()).toBeGreaterThan(Date.now())
  expect(claimed.nextRunAt.getTime()).toBeGreaterThanOrEqual(beforeClaim + 300000)
  expect(claimed.nextRunAt.getTime()).toBeLessThanOrEqual(afterClaim + 300000)
  await (old as any).worker.close(true); await (old as any).queue.close()
  ;(old as any).worker = undefined; (old as any).queue = undefined
  // Move only this fixture's persisted lease into the past; do not wait five real minutes.
  await db.aiSchedule.update({ where: { id: item.id }, data: { nextRunAt: new Date(Date.now() - 1) } })
  const replacement = service(prefix, { todos: jest.fn(async () => [{ type: 'counts', title: 'NEW worker result', items: [] }]), metrics: jest.fn() })
  await replacement.onModuleInit(); await rapidScheduler(queue)
  await until(async () => (await db.aiSchedule.findUniqueOrThrow({ where: { id: item.id } })).lastRunAt !== null)
  const completed = await db.aiSchedule.findUniqueOrThrow({ where: { id: item.id } }), state = completed.lastResult as any
  expect(state._schedule).toMatchObject({ state: 'completed', scheduledAt: item.scheduledAt, identity: `${item.id}:${item.scheduledAt}` })
  expect(state._schedule.token).not.toBe((claimed.lastResult as any)._schedule.token)
  expect(state.value[0].title).toBe('NEW worker result')
  release(); await until(async () => oldTickFinished)
  const afterOldReturns = await db.aiSchedule.findUniqueOrThrow({ where: { id: item.id } })
  expect(afterOldReturns.lastResult).toEqual(completed.lastResult); expect(afterOldReturns.lastRunAt).toEqual(completed.lastRunAt)
}, 30000)

it('lets two real workers read the same due cycle but only one claim and publish it', async () => {
  const { queue, prefix } = await control(), data = { todos: jest.fn(async () => [{ type: 'counts', title: 'CAS fixture', items: [] }]), metrics: jest.fn() }
  const first = service(prefix, data), second = service(prefix, data), item = await due(first)
  let reads = 0, release!: () => void
  const bothRead = new Promise<void>(resolve => { release = resolve; held.push(resolve) })
  afterScheduleRead = async rows => { if (rows.some(row => row.id === item.id) && reads < 2) { if (++reads === 2) release(); await bothRead } }
  await first.onModuleInit(); await second.onModuleInit()
  await queue.add('tick', {}, { removeOnComplete: true }); await queue.add('tick', {}, { removeOnComplete: true }); await queue.resume()
  await until(async () => (await db.aiSchedule.findUniqueOrThrow({ where: { id: item.id } })).lastRunAt !== null)
  expect(reads).toBe(2); expect(data.todos).toHaveBeenCalledTimes(1)
  const row = await db.aiSchedule.findUniqueOrThrow({ where: { id: item.id } })
  expect((row.lastResult as any)._schedule).toMatchObject({ state: 'completed', identity: `${item.id}:${item.scheduledAt}` })
}, 30000)

it('keeps a transient report failure recoverable instead of misreporting it as revoked permissions', async () => {
  const { queue, prefix } = await control()
  const data = { todos: jest.fn().mockRejectedValueOnce(Error('synthetic temporary database failure')).mockResolvedValue([{ type: 'counts', title: 'Recovered transient fixture', items: [] }]), metrics: jest.fn() }
  const value = service(prefix, data), item = await due(value)
  await value.onModuleInit(); await rapidScheduler(queue); await queue.resume()
  await until(async () => Boolean((await db.aiSchedule.findUniqueOrThrow({ where: { id: item.id } })).error))
  const failed = await db.aiSchedule.findUniqueOrThrow({ where: { id: item.id } })
  expect(failed.enabled).toBe(true); expect(failed.lastRunAt).toBeNull()
  expect(failed.error).toContain('自动重试')
  expect((failed.lastResult as any)._schedule).toMatchObject({ scheduledAt: item.scheduledAt, state: 'running' })
  await db.aiSchedule.update({ where: { id: item.id }, data: { nextRunAt: new Date(Date.now() - 1) } })
  await until(async () => (await db.aiSchedule.findUniqueOrThrow({ where: { id: item.id } })).lastRunAt !== null)
  const completed = await db.aiSchedule.findUniqueOrThrow({ where: { id: item.id } })
  expect(completed.error).toBeNull(); expect(completed.enabled).toBe(true)
  expect((completed.lastResult as any)._schedule).toMatchObject({ state: 'completed', identity: `${item.id}:${item.scheduledAt}` })
  expect(data.todos).toHaveBeenCalledTimes(2)
}, 30000)
