import { BadRequestException, ConflictException, HttpException, Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common'
import { ConfigService } from '@nestjs/config'
import { Queue, Worker } from 'bullmq'
import { randomUUID } from 'node:crypto'
import { Prisma } from '@prisma/client'
import { PrismaService } from '../prisma.service'
import { StaffAccessService, StaffActor } from '../auth/staff-access.service'
import { AiDataService } from './ai-data.service'
import { AiSettingsService, DEFAULT_FEATURES } from './ai-settings.service'
import { AiScheduleDto } from './ai.dto'
import { shanghaiDay } from './ai.metrics'
import { ProductImageStorageService } from '../upload/product-image-storage.service'

const LEASE_MS = 5 * 60_000
interface ScheduleRun { version: 1; scheduledAt: string; identity: string; token: string; state: 'running' | 'completed' | 'paused'; resultScheduledAt?: string }
function stateOf(value: unknown): { run: ScheduleRun | null; value: unknown } {
  const saved = value as { _schedule?: ScheduleRun; value?: unknown } | null
  const run = saved && !Array.isArray(saved) ? saved._schedule : null
  if (run?.version === 1 && Number.isFinite(Date.parse(run.scheduledAt)) && typeof run.token === 'string') return { run, value: saved!.value ?? null }
  return { run: null, value: value ?? null }
}
const json = (value: unknown): Prisma.InputJsonValue => JSON.parse(JSON.stringify(value))

export function nextScheduleAt(hour: number, weekly: boolean, now = new Date()) {
  let next = new Date(`${shanghaiDay(now)}T${String(hour).padStart(2, '0')}:00:00+08:00`)
  while (next <= now || (weekly && new Date(next.getTime() + 8 * 3600000).getUTCDay() !== 1)) next = new Date(next.getTime() + 86400000)
  return next
}

@Injectable()
export class AiScheduleService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(AiScheduleService.name)
  private queue?: Queue
  private worker?: Worker
  constructor(private readonly prisma: PrismaService, private readonly access: StaffAccessService, private readonly data: AiDataService,
    private readonly settings: AiSettingsService, private readonly config: ConfigService, private readonly storage: ProductImageStorageService) {}

  async onModuleInit() {
    if (this.config.get<string>('NODE_ENV') === 'test') return
    const redis = new URL(this.config.getOrThrow<string>('REDIS_URL'))
    const connection = { host: redis.hostname, port: Number(redis.port || 6379), username: decodeURIComponent(redis.username) || undefined, password: decodeURIComponent(redis.password) || undefined,
      db: Number(redis.pathname.slice(1) || 0), ...(redis.protocol === 'rediss:' ? { tls: {} } : {}) }
    const prefix = this.config.get<string>('AI_QUEUE_PREFIX') || 'bull'
    if (!/^[a-zA-Z0-9_-]{1,100}$/.test(prefix)) throw new Error('AI_QUEUE_PREFIX格式无效')
    this.queue = new Queue('ai-operations-maintenance', { prefix, connection: { ...connection, maxRetriesPerRequest: 1 } })
    this.worker = new Worker('ai-operations-maintenance', () => this.tick(), { prefix, connection, concurrency: 1 })
    this.queue.on('error', () => this.logger.warn('AI任务队列暂不可用'))
    this.worker.on('error', () => this.logger.warn('AI任务处理器暂不可用'))
    try { await this.queue.upsertJobScheduler('maintenance-minute', { every: 60000 }, { name: 'tick', data: {}, opts: { removeOnComplete: 5, removeOnFail: 10 } }) }
    catch { this.logger.warn('AI自动任务暂未启动，请检查Redis连接') }
  }

  async onModuleDestroy() { await this.worker?.close(); await this.queue?.close() }

  async list(actor: StaffActor) {
    this.access.require(actor, 'task:manage_own')
    const rows = await this.prisma.aiSchedule.findMany({ where: { tenantId: actor.tenantId, ownerId: actor.id, fingerprint: actor.fingerprint }, orderBy: { createdAt: 'desc' }, take: 30 })
    const visible: unknown[] = []
    for (const row of rows) {
      const state = stateOf(row.lastResult)
      const resultReference = state.run?.resultScheduledAt || row.lastRunAt?.toISOString()
      visible.push({ ...row, running: row.enabled && state.run?.state === 'running', scheduledAt: state.run?.scheduledAt || null,
        lastResult: state.value ? (row.kind === 'weekly_metrics' ? await this.data.metrics(actor, 'last_week', resultReference ? new Date(resultReference) : new Date()) : await this.data.todos(actor)) : null })
    }
    return visible
  }

  async create(actor: StaffActor, input: AiScheduleDto) {
    this.access.require(actor, 'task:manage_own', 'ai:use')
    if (input.kind === 'weekly_metrics') this.access.require(actor, 'analytics:view', 'order:read')
    if (typeof input.name !== 'string' || !input.name.trim() || input.name.trim().length > 100 || !['daily_todos', 'weekly_metrics'].includes(input.kind) || !Number.isInteger(input.hour) || input.hour < 0 || input.hour > 23 || typeof input.enabled !== 'boolean') throw new BadRequestException('请填写有效任务名称、类型及北京时间')
    return this.prisma.$transaction(async tx => {
      // Serialize the enabled-task quota for this tenant/owner, including concurrent requests.
      const owners = await tx.$queryRaw<Array<{ id: number }>>(Prisma.sql`SELECT id FROM users WHERE id = ${actor.id} AND tenant_id = ${actor.tenantId} FOR UPDATE`)
      if (!owners.length) throw new BadRequestException('任务所属账号不存在')
      const fresh = await new StaffAccessService(tx as unknown as PrismaService).actor(actor.id)
      if (fresh.fingerprint !== actor.fingerprint) throw new ConflictException('账号权限已变化，请刷新页面后重新添加任务')
      // Old-scope tasks are intentionally hidden from list(); do not let them silently occupy all ten slots.
      await tx.aiSchedule.updateMany({ where: { tenantId: actor.tenantId, ownerId: actor.id, enabled: true, fingerprint: { not: actor.fingerprint } }, data: { enabled: false, error: '账号权限范围已变化，旧任务已暂停；请按当前权限重新创建' } })
      if (input.enabled && await tx.aiSchedule.count({ where: { tenantId: actor.tenantId, ownerId: actor.id, enabled: true } }) >= 10) throw new BadRequestException('最多启用10个自动任务')
      return tx.aiSchedule.create({ data: { tenantId: actor.tenantId, ownerId: actor.id, name: input.name.trim(), kind: input.kind, hour: input.hour,
        weekday: input.kind === 'weekly_metrics' ? 1 : null, enabled: input.enabled, fingerprint: actor.fingerprint, nextRunAt: nextScheduleAt(input.hour, input.kind === 'weekly_metrics') } })
    }, { isolationLevel: Prisma.TransactionIsolationLevel.ReadCommitted, timeout: 15000 })
  }

  async tick() {
    const schedules = await this.prisma.aiSchedule.findMany({ where: { enabled: true, nextRunAt: { lte: new Date() } }, orderBy: { nextRunAt: 'asc' }, take: 20 })
    for (const schedule of schedules) {
      // Keep the original cycle identity across a crashed worker's lease recovery.
      const saved = stateOf(schedule.lastResult), scheduledAt = saved.run?.state === 'running' ? saved.run.scheduledAt : schedule.nextRunAt.toISOString()
      const resultScheduledAt = saved.run?.resultScheduledAt || (saved.run?.state === 'completed' ? saved.run.scheduledAt : schedule.lastRunAt?.toISOString())
      const run: ScheduleRun = { version: 1, scheduledAt, identity: `${schedule.id}:${scheduledAt}`, token: randomUUID(), state: 'running', resultScheduledAt }
      const leaseUntil = new Date(Date.now() + LEASE_MS)
      const claimed = await this.prisma.aiSchedule.updateMany({ where: { id: schedule.id, enabled: true, nextRunAt: schedule.nextRunAt }, data: { nextRunAt: leaseUntil, lastResult: json({ _schedule: run, value: saved.value }) } })
      if (!claimed.count) continue
      // The claim token fences an old worker after its lease has expired and another worker recovered it.
      const claimWhere = { id: schedule.id, enabled: true, nextRunAt: leaseUntil, lastResult: { path: '$._schedule.token', equals: run.token }, AND: [{ lastResult: { path: '$._schedule.state', equals: 'running' } }] }
      try {
        const actor = await this.access.actor(schedule.ownerId)
        this.access.require(actor, 'ai:use', 'task:manage_own')
        if (actor.tenantId !== schedule.tenantId || actor.fingerprint !== schedule.fingerprint) throw new Error('权限变化')
        const config = await this.settings.configFor(actor.tenantId)
        const features = { ...DEFAULT_FEATURES, ...(config?.features as object ?? {}) }
        if (!config?.enabled || features.tasks !== true || (schedule.kind === 'weekly_metrics' && features.analytics !== true)) throw new Error('助手能力已关闭')
        const result = schedule.kind === 'weekly_metrics' ? await this.data.metrics(actor, 'last_week', new Date(scheduledAt)) : await this.data.todos(actor)
        const fresh = await this.access.actor(actor.id)
        if (fresh.fingerprint !== actor.fingerprint) throw new Error('权限变化')
        const freshConfig = await this.settings.configFor(actor.tenantId), freshFeatures = { ...DEFAULT_FEATURES, ...(freshConfig?.features as object ?? {}) }
        if (!freshConfig?.enabled || freshFeatures.tasks !== true || (schedule.kind === 'weekly_metrics' && freshFeatures.analytics !== true)) throw new Error('助手能力已关闭')
        await this.prisma.aiSchedule.updateMany({ where: claimWhere, data: { lastRunAt: new Date(), nextRunAt: nextScheduleAt(schedule.hour, schedule.kind === 'weekly_metrics'), error: null, lastResult: json({ _schedule: { ...run, state: 'completed', resultScheduledAt: scheduledAt }, value: result }) } })
      } catch (error) {
        const revoked = (error instanceof HttpException && [401, 403, 404].includes(error.getStatus())) || (error instanceof Error && ['权限变化', '助手能力已关闭'].includes(error.message))
        // A transient SQL/report failure retains the same cycle for lease recovery.
        // Only confirmed account/capability changes permanently pause it.
        await this.prisma.aiSchedule.updateMany({ where: claimWhere, data: { ...(revoked ? { enabled: false } : {}), lastResult: json({ _schedule: { ...run, state: revoked ? 'paused' : 'running' }, value: saved.value }),
          error: revoked ? '账号、权限或功能配置已变化，请检查后重新创建任务' : '报告暂未生成完成，将在数分钟内自动重试；可手动暂停任务' } })
      }
    }
    const expired = await this.prisma.aiAttachment.findMany({ where: { expiresAt: { lt: new Date() } }, take: 30 })
    for (const file of expired) {
      try { await this.storage.removeAiImage(file.objectKey); await this.prisma.aiAttachment.delete({ where: { id: file.id } }) }
      catch { this.logger.warn('识别附件清理失败，将在下次重试') }
    }
  }
}
