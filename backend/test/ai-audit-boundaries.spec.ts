import { ConfigService } from '@nestjs/config'
import sharp from 'sharp'
import { StaffAccessService, StaffActor } from '../src/auth/staff-access.service'
import { AiSettingsService, DEFAULT_FEATURES } from '../src/ai/ai-settings.service'
import { AiAttachmentService } from '../src/ai/ai-attachment.service'
import { AiModelService } from '../src/ai/ai-model.service'
import { AiScheduleService } from '../src/ai/ai-schedule.service'
import { AiDraftService, normalizeProductDraft } from '../src/ai/ai-draft.service'
import { normalizeWorkflow } from '../src/ai/ai-workflows.service'

const actor: StaffActor = { id: 8, tenantId: 7, userType: 'admin', superAdmin: false,
  permissions: new Set(['ai:use', 'ai:configure', 'ai:execute', 'product:create', 'task:manage_own', 'analytics:view', 'order:read']),
  brandIds: [3], customerIds: null, leadIds: null, fingerprint: 'ai-audit-scope' }
const access = new StaffAccessService({} as any)
const settingsInput = { enabled: true, baseUrl: 'https://api.deepseek.com/v1', textModel: 'fixture-model', visionModel: '', allowWrites: true, dailyRequests: 10, features: DEFAULT_FEATURES }

function settingsFixture() {
  let value: any = { tenantId: actor.tenantId, ...settingsInput, encryptedKey: 'opaque-encrypted-fixture' }
  const tx: any = { aiConfig: { findUnique: jest.fn(async () => value), upsert: jest.fn(async ({ update }) => { value = { ...value, ...update }; return value }) }, auditLog: { create: jest.fn() }, $queryRaw: jest.fn().mockResolvedValue([{ id: actor.tenantId }]) }
  const db: any = { aiConfig: { findUnique: jest.fn(async () => value) }, $transaction: jest.fn(async (callback: any) => callback(tx)) }
  const config = new ConfigService({ AI_ENCRYPTION_KEY: Buffer.alloc(32, 7).toString('base64') })
  return { service: new AiSettingsService(db, config, access), db, tx,
    replace: (next: object) => { value = { ...value, ...next } } }
}

describe('AI settings, credentials and quotas', () => {
  it('does not reuse a provider credential after clearing its previous endpoint', async () => {
    const { service, tx } = settingsFixture()
    await service.save(actor, { ...settingsInput, enabled: false, baseUrl: '' })
    await expect(service.save(actor, { ...settingsInput, baseUrl: 'https://dashscope.aliyuncs.com/compatible-mode/v1' })).rejects.toThrow('重新输入')
    expect(tx.aiConfig.upsert).toHaveBeenCalledTimes(1)
  })

  it('returns only a key-presence flag and writes no plaintext or encrypted key to the audit payload', async () => {
    const { service, tx } = settingsFixture()
    const fixtureCredential = 'fixture-credential-not-a-real-key'
    const result = await service.save(actor, { ...settingsInput, apiKey: fixtureCredential })
    const saved = tx.aiConfig.upsert.mock.calls[0][0].update.encryptedKey
    expect(saved).not.toBe(fixtureCredential)
    expect(service.decrypt(saved)).toBe(fixtureCredential)
    expect(result.hasKey).toBe(true)
    expect(result).not.toHaveProperty('apiKey'); expect(result).not.toHaveProperty('encryptedKey')
    const serialized = JSON.stringify({ result, audit: tx.auditLog.create.mock.calls })
    expect(serialized).not.toContain(fixtureCredential); expect(serialized).not.toContain(saved)
    expect(tx.auditLog.create).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ tenantId: 7, operatorId: 8, afterData: expect.objectContaining({ keyChanged: true }) }) }))
  })

  it('does not read or write settings without configuration permission', async () => {
    const { service, db } = settingsFixture()
    const denied = { ...actor, permissions: new Set(['ai:use']) }
    await expect(service.publicSettings(denied)).rejects.toThrow('权限')
    await expect(service.save(denied, settingsInput)).rejects.toThrow('权限')
    expect(db.aiConfig.findUnique).not.toHaveBeenCalled(); expect(db.$transaction).not.toHaveBeenCalled()
  })

  it('allows a same-provider blank-key edit without replacing the existing encrypted credential', async () => {
    const { service, tx } = settingsFixture()
    await service.save(actor, { ...settingsInput, apiKey: '   ', dailyRequests: 11 })
    expect(tx.aiConfig.upsert.mock.calls[0][0].update).not.toHaveProperty('encryptedKey')
  })

  it('does not bind another concurrent administrator update credential to a stale provider form', async () => {
    const { service, db, tx, replace } = settingsFixture()
    db.$transaction.mockImplementation(async (callback: any) => {
      replace({ baseUrl: 'https://dashscope.aliyuncs.com/compatible-mode/v1', encryptedKey: 'concurrent-provider-fixture' })
      return callback(tx)
    })
    await expect(service.save(actor, settingsInput)).rejects.toThrow('重新输入')
    expect(tx.aiConfig.upsert).not.toHaveBeenCalled()
  })

  it('stops excess model calls before fetch and before creating a paid-call usage record', async () => {
    const fetch = jest.spyOn(global, 'fetch').mockRejectedValue(new Error('No live model calls in this test'))
    try {
      const usage = { create: jest.fn(), update: jest.fn() }
      const settings = { configFor: async () => ({ ...settingsInput, encryptedKey: 'opaque', dailyRequests: 1 }), decrypt: jest.fn() }
      const model = new AiModelService(settings as any, { aiUsageRecord: usage } as any, { eval: async () => 2 } as any)
      await expect(model.complete(actor, [{ role: 'user', content: 'fixture' }], [])).rejects.toThrow('今日模型调用上限')
      expect(fetch).not.toHaveBeenCalled(); expect(usage.create).not.toHaveBeenCalled(); expect(settings.decrypt).not.toHaveBeenCalled()
    } finally { fetch.mockRestore() }
  })

  it('sanitizes model-provider failures and records failure without exposing the provider credential or body', async () => {
    const fetch = jest.spyOn(global, 'fetch').mockResolvedValue({ ok: false, text: async () => 'private-provider-body-fixture' } as Response)
    try {
      const usage = { create: jest.fn().mockResolvedValue({ id: 'usage-fixture' }), update: jest.fn() }
      const settings = { configFor: async () => ({ ...settingsInput, encryptedKey: 'opaque' }), decrypt: () => 'provider-fixture-not-a-real-key' }
      const model = new AiModelService(settings as any, { aiUsageRecord: usage } as any, { eval: async () => 1 } as any)
      await expect(model.complete(actor, [{ role: 'user', content: 'fixture' }], [])).rejects.toMatchObject({ response: { message: expect.stringContaining('模型服务暂不可用') } })
      expect(usage.update).toHaveBeenCalledWith({ where: { id: 'usage-fixture' }, data: { status: 'failed' } })
      expect(JSON.stringify(usage.update.mock.calls)).not.toMatch(/provider-fixture-not-a-real-key|private-provider-body-fixture/)
    } finally { fetch.mockRestore() }
  })
})

describe('AI private attachment boundaries', () => {
  let image: Buffer
  beforeAll(async () => { image = await sharp({ create: { width: 4, height: 3, channels: 3, background: '#a34224' } }).png().toBuffer() })
  function fixture() {
    const storage = { uploadAiImage: jest.fn().mockResolvedValue({ objectKey: 'ai-private/fixture.jpg' }), removeAiImage: jest.fn(), readAiImage: jest.fn() }
    const db: any = { aiAttachment: { findFirst: jest.fn().mockResolvedValue(null), create: jest.fn().mockResolvedValue({ id: 'attachment-fixture', fileSize: 20, expiresAt: new Date() }) } }
    return { service: new AiAttachmentService(db, access, storage as any), db, storage }
  }

  it('re-encodes uploaded content to private JPEG and stores only the current tenant and owner', async () => {
    const { service, db, storage } = fixture()
    const result = await service.upload(actor, { buffer: image, size: image.length, mimetype: 'image/png' })
    const jpeg = storage.uploadAiImage.mock.calls[0][0] as Buffer
    expect((await sharp(jpeg).metadata()).format).toBe('jpeg')
    expect(db.aiAttachment.create).toHaveBeenCalledWith({ data: expect.objectContaining({ tenantId: 7, ownerId: 8, mimeType: 'image/jpeg' }), select: { id: true, fileSize: true, expiresAt: true } })
    expect(result).not.toHaveProperty('objectKey'); expect(result).not.toHaveProperty('url')
  })

  it('requires matching tenant, owner and future expiry before reading any attachment bytes', async () => {
    const { service, db, storage } = fixture()
    await expect(service.bytes(actor, 'foreign-or-expired')).rejects.toThrow('不存在、已过期或不可访问')
    expect(db.aiAttachment.findFirst).toHaveBeenCalledWith({ where: { id: 'foreign-or-expired', tenantId: 7, ownerId: 8, expiresAt: { gt: expect.any(Date) } } })
    expect(storage.readAiImage).not.toHaveBeenCalled()
  })

  it('removes the private object when storing its ownership record fails', async () => {
    const { service, db, storage } = fixture()
    db.aiAttachment.create.mockRejectedValue(new Error('fixture transaction failure'))
    await expect(service.upload(actor, { buffer: image, size: image.length, mimetype: 'image/png' })).rejects.toThrow('fixture transaction failure')
    expect(storage.removeAiImage).toHaveBeenCalledWith('ai-private/fixture.jpg')
  })
})

describe('AI draft editing and scheduled reports', () => {
  it('refuses excess product specifications instead of silently losing the twenty-first one', () => {
    const skus = Array.from({ length: 21 }, (_, index) => ({ specText: `规格${index + 1}`, saleUnit: '袋', basePrice: '10', minOrderQty: 1 }))
    expect(() => normalizeProductDraft({ skus })).toThrow('20个规格')
  })

  it.each(['inventory.batch', 'order.create'])('refuses oversized %s lists without silently truncating source rows', action => {
    expect(() => normalizeWorkflow(action, { lines: Array.from({ length: 51 }, () => ({})) })).toThrow('1～50行')
  })

  it('edits a product draft with a new server digest and version while discarding injected identity and stock', async () => {
    let current: any = { id: 'draft-fixture', tenantId: 7, ownerId: 8, action: 'product.create', status: 'draft', version: 1, digest: 'old-digest', fingerprint: actor.fingerprint }
    const db: any = { aiActionDraft: { findFirst: jest.fn(async () => current), updateMany: jest.fn(async ({ data }) => { current = { ...current, ...data, version: current.version + 1 }; return { count: 1 } }) } }
    const service = new AiDraftService(db, access, {} as any, {} as any)
    const result = await service.update(actor, current.id, 1, { brandId: 3, categoryId: 4, subtitle: '人工修正名称', tenantId: 99, status: 'active', code: 'INJECTED', skus: [{ specText: '500克/袋', saleUnit: '袋', basePrice: '19.90', minOrderQty: 1, stockNum: 999 }] })
    expect(result.version).toBe(2); expect(result.digest).not.toBe('old-digest'); expect(result.missing).toEqual([])
    expect(result.payload.subtitle).toBe('人工修正名称'); expect(result.payload).not.toHaveProperty('tenantId'); expect(result.payload).not.toHaveProperty('status')
    expect(result.payload.skus[0]).not.toHaveProperty('stockNum')
    expect(db.aiActionDraft.updateMany.mock.calls[0][0].where).toMatchObject({ tenantId: 7, ownerId: 8, version: 1, status: 'draft' })
  })

  function scheduleFixture(features: unknown = DEFAULT_FEATURES, revoked = false) {
    const schedule = { id: 'schedule-fixture', tenantId: 7, ownerId: 8, kind: 'weekly_metrics', hour: 9, enabled: true, nextRunAt: new Date(0), fingerprint: actor.fingerprint }
    const db: any = { aiSchedule: { findMany: jest.fn().mockResolvedValue([schedule]), updateMany: jest.fn().mockResolvedValue({ count: 1 }), update: jest.fn() }, aiAttachment: { findMany: jest.fn().mockResolvedValue([]) } }
    const scoped = { actor: jest.fn().mockResolvedValueOnce(actor).mockResolvedValue({ ...actor, fingerprint: revoked ? 'revoked' : actor.fingerprint }), require: access.require.bind(access) }
    const data = { metrics: jest.fn().mockResolvedValue({ type: 'metrics', amount: '10.00' }), todos: jest.fn() }
    const service = new AiScheduleService(db, scoped as any, data as any, { configFor: async () => ({ enabled: true, features }) } as any, new ConfigService({ NODE_ENV: 'test' }), {} as any)
    return { service, db, data }
  }

  it('uses the same default feature policy for a legacy scheduled report as public settings and capabilities', async () => {
    const { service, db, data } = scheduleFixture({})
    await service.tick()
    expect(data.metrics).toHaveBeenCalledWith(actor, 'last_week', new Date(0))
    expect(db.aiSchedule.updateMany).toHaveBeenCalledWith({ where: expect.objectContaining({ id: 'schedule-fixture', lastResult: { path: '$._schedule.token', equals: expect.any(String) } }), data: expect.objectContaining({ error: null, lastResult: expect.objectContaining({ _schedule: expect.objectContaining({ state: 'completed' }), value: { type: 'metrics', amount: '10.00' } }) }) })
  })

  it.each([{ tasks: false }, { tasks: true, analytics: false }])('does not run explicitly disabled report capabilities %j', async features => {
    const { service, db, data } = scheduleFixture(features)
    await service.tick()
    expect(data.metrics).not.toHaveBeenCalled()
    expect(db.aiSchedule.updateMany).toHaveBeenCalledWith({ where: expect.objectContaining({ id: 'schedule-fixture' }), data: expect.objectContaining({ enabled: false, error: expect.any(String) }) })
  })

  it('does not persist a computed report after the staff scope has been revoked mid-run', async () => {
    const { service, db } = scheduleFixture(DEFAULT_FEATURES, true)
    await service.tick()
    expect(db.aiSchedule.updateMany).toHaveBeenCalledWith({ where: expect.objectContaining({ id: 'schedule-fixture' }), data: expect.objectContaining({ enabled: false }) })
    expect(db.aiSchedule.updateMany.mock.calls[1][0].data.lastResult.value).toBeNull()
  })
})
