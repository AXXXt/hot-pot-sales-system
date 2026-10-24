import { randomUUID } from 'node:crypto'
import { ConfigService } from '@nestjs/config'
import { Prisma, PrismaClient } from '@prisma/client'
import { PrismaService } from '../src/prisma.service'
import { StaffAccessService, StaffActor } from '../src/auth/staff-access.service'
import { AiSettingsService, DEFAULT_FEATURES } from '../src/ai/ai-settings.service'

// Never use DATABASE_URL: this suite owns only the isolated tenant it creates.
const url = process.env.TEST_DATABASE_URL
if (!url || !new URL(url).pathname.endsWith('_test')) throw new Error('Isolated TEST_DATABASE_URL ending in _test required')
const db = new PrismaClient({ datasources: { db: { url } } })
const config = new ConfigService({ AI_ENCRYPTION_KEY: Buffer.alloc(32, 11).toString('base64') })
const input = { enabled: true, baseUrl: 'https://api.deepseek.com/v1', textModel: 'integration-fixture-model', visionModel: '', allowWrites: true, dailyRequests: 10, features: DEFAULT_FEATURES }
const alternateUrl = 'https://dashscope.aliyuncs.com/compatible-mode/v1'
const originalKey = 'integration-original-fixture-not-a-real-key'
const replacementKey = 'integration-replacement-fixture-not-a-real-key'
let tenantId = -1, actor: StaffActor, service: AiSettingsService
let fetch: jest.SpyInstance

function settings(client: unknown = db) {
  return new AiSettingsService(client as PrismaService, config, new StaffAccessService(db as unknown as PrismaService))
}

function gate() {
  let open!: () => void
  const promise = new Promise<void>(resolve => { open = resolve })
  return { promise, open }
}

async function bounded(promise: Promise<void>) {
  let timer: ReturnType<typeof setTimeout> | undefined
  try {
    await Promise.race([promise, new Promise<never>((_, reject) => { timer = setTimeout(() => reject(new Error('AI settings concurrency barrier timed out')), 5000) })])
  } finally { if (timer) clearTimeout(timer) }
}

beforeAll(async () => {
  fetch = jest.spyOn(global, 'fetch').mockRejectedValue(new Error('Live model calls are forbidden in this suite'))
  tenantId = (await db.tenant.create({ data: { code: randomUUID(), name: 'AI settings lock integration' } })).id
  const user = await db.user.create({ data: { tenantId, userType: 'super_admin', name: 'AI fixture administrator', phone: 'ai-' + randomUUID().slice(0, 16) } })
  actor = { id: user.id, tenantId, userType: 'super_admin', superAdmin: true, permissions: new Set(['ai:configure']), brandIds: [], customerIds: null, leadIds: null, fingerprint: 'ai-settings-lock-fixture' }
  service = settings()
})

beforeEach(async () => {
  await db.tenant.update({ where: { id: tenantId }, data: { status: 'active' } })
  await db.auditLog.deleteMany({ where: { tenantId } })
  await db.aiConfig.deleteMany({ where: { tenantId } })
  fetch.mockClear()
})

afterAll(async () => {
  if (tenantId > 0) {
    await db.auditLog.deleteMany({ where: { tenantId } })
    await db.aiConfig.deleteMany({ where: { tenantId } })
    await db.user.deleteMany({ where: { tenantId } })
    await db.tenant.delete({ where: { id: tenantId } })
  }
  await db.$disconnect()
  fetch?.mockRestore()
})

afterEach(() => { expect(fetch).not.toHaveBeenCalled() })

it('commits real encrypted settings and a key-free audit, then preserves the key for same-provider edits', async () => {
  const publicValue = await service.save(actor, { ...input, apiKey: originalKey })
  const saved = await db.aiConfig.findUniqueOrThrow({ where: { tenantId } })
  expect(service.decrypt(saved.encryptedKey!)).toBe(originalKey)
  expect(publicValue).toMatchObject({ enabled: true, hasKey: true })
  expect(publicValue).not.toHaveProperty('encryptedKey')
  expect(publicValue).not.toHaveProperty('apiKey')
  await service.save(actor, { ...input, dailyRequests: 11, apiKey: '  ' })
  expect((await db.aiConfig.findUniqueOrThrow({ where: { tenantId } })).encryptedKey).toBe(saved.encryptedKey)
  const audits = await db.auditLog.findMany({ where: { tenantId }, orderBy: { id: 'asc' } })
  expect(audits).toHaveLength(2)
  expect(audits[0].afterData).toMatchObject({ keyChanged: true })
  expect(audits[1].afterData).toMatchObject({ keyChanged: false })
  expect(JSON.stringify({ publicValue, audits })).not.toContain(originalKey)
  expect(JSON.stringify(audits)).not.toContain(saved.encryptedKey!)
})

it('rejects direct provider changes and restoring an unbound saved credential without a replacement key', async () => {
  await service.save(actor, { ...input, apiKey: originalKey })
  await expect(service.save(actor, { ...input, baseUrl: alternateUrl })).rejects.toThrow('重新输入')
  expect((await db.aiConfig.findUniqueOrThrow({ where: { tenantId } })).baseUrl).toBe(input.baseUrl)
  await service.save(actor, { ...input, enabled: false, baseUrl: '' })
  await expect(service.save(actor, { ...input, baseUrl: alternateUrl })).rejects.toThrow('重新输入')
  const saved = await db.aiConfig.findUniqueOrThrow({ where: { tenantId } })
  expect(saved.baseUrl).toBe('')
  expect(service.decrypt(saved.encryptedKey!)).toBe(originalKey)
  expect(await db.auditLog.count({ where: { tenantId } })).toBe(2)
})

it('serializes two administrator saves so a stale provider form cannot inherit the newly saved key', async () => {
  await service.save(actor, { ...input, apiKey: originalKey })
  const firstWritten = gate(), releaseFirst = gate(), secondLockStarted = gate()
  let staleReads = 0
  const concurrentSettings = (first: boolean) => settings({
    aiConfig: db.aiConfig,
    $transaction: (callback: (tx: Prisma.TransactionClient) => Promise<unknown>) => db.$transaction(async tx => {
      const wrapped = new Proxy(tx, { get(target, key) {
        if (key === '$queryRaw') return (...args: unknown[]) => {
          if (!first) secondLockStarted.open()
          return (target.$queryRaw as (...values: unknown[]) => unknown).apply(target, args)
        }
        if (key === 'aiConfig' && !first) return { ...target.aiConfig, findUnique: (...args: Parameters<typeof target.aiConfig.findUnique>) => { staleReads++; return target.aiConfig.findUnique(...args) } }
        if (key === 'auditLog' && first) return { ...target.auditLog, create: async (...args: Parameters<typeof target.auditLog.create>) => {
          const result = await target.auditLog.create(...args)
          firstWritten.open()
          await bounded(releaseFirst.promise)
          return result
        } }
        return Reflect.get(target, key)
      } })
      return callback(wrapped)
    }, { maxWait: 10000, timeout: 15000 })
  })
  const first = concurrentSettings(true).save(actor, { ...input, baseUrl: alternateUrl, apiKey: replacementKey })
  void first.catch(() => undefined) // Surface the original error below after releasing any waiting transaction.
  const settled: Promise<unknown>[] = [first]
  try {
    await bounded(firstWritten.promise)
    const stale = concurrentSettings(false).save(actor, input)
    // Attach the rejection handler immediately; the stale save is expected to fail after the lock releases.
    const staleResult = stale.then(value => ({ value, error: null }), error => ({ value: null, error }))
    settled.push(staleResult)
    await bounded(secondLockStarted.promise)
    expect(staleReads).toBe(0)
    releaseFirst.open()
    await first
    const outcome = await staleResult
    expect(outcome.error).toHaveProperty('message', expect.stringContaining('重新输入'))
    const saved = await db.aiConfig.findUniqueOrThrow({ where: { tenantId } })
    expect(saved.baseUrl).toBe(alternateUrl)
    expect(service.decrypt(saved.encryptedKey!)).toBe(replacementKey)
    expect(await db.auditLog.count({ where: { tenantId } })).toBe(2)
  } finally {
    releaseFirst.open()
    await Promise.allSettled(settled)
  }
})

it('rolls back settings and the new key when the real audit foreign-key insert fails', async () => {
  await service.save(actor, { ...input, apiKey: originalKey })
  const before = await db.aiConfig.findUniqueOrThrow({ where: { tenantId } })
  await expect(service.save({ ...actor, id: -1 }, { ...input, baseUrl: alternateUrl, dailyRequests: 99, apiKey: replacementKey })).rejects.toMatchObject({ code: 'P2003' })
  expect(await db.aiConfig.findUniqueOrThrow({ where: { tenantId } })).toEqual(before)
  expect(await db.auditLog.count({ where: { tenantId } })).toBe(1)
})

it('rejects saves after the tenant is disabled without changing the config or audit', async () => {
  await service.save(actor, { ...input, apiKey: originalKey })
  const before = await db.aiConfig.findUniqueOrThrow({ where: { tenantId } })
  await db.tenant.update({ where: { id: tenantId }, data: { status: 'disabled' } })
  await expect(service.save(actor, { ...input, dailyRequests: 99 })).rejects.toThrow('租户状态已变化')
  expect(await db.aiConfig.findUniqueOrThrow({ where: { tenantId } })).toEqual(before)
  expect(await db.auditLog.count({ where: { tenantId } })).toBe(1)
})
