import { BadRequestException, Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common'
import { ConfigService } from '@nestjs/config'
import { Queue, Worker } from 'bullmq'
import { PrismaService } from '../prisma.service'
import { StaffAccessService, StaffActor } from '../auth/staff-access.service'
import { AiDataService } from './ai-data.service'
import { AiSettingsService } from './ai-settings.service'
import { AiScheduleDto } from './ai.dto'
import { shanghaiDay } from './ai.metrics'
import { ProductImageStorageService } from '../upload/product-image-storage.service'

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
    this.queue = new Queue('ai-operations-maintenance', { connection: { ...connection, maxRetriesPerRequest: 1 } })
    this.worker = new Worker('ai-operations-maintenance', () => this.tick(), { connection, concurrency: 1 })
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
    for (const row of rows) visible.push({ ...row, lastResult: row.lastResult ? (row.kind === 'weekly_metrics' ? await this.data.metrics(actor, 'last_week') : await this.data.todos(actor)) : null })
    return visible
  }

  async create(actor: StaffActor, input: AiScheduleDto) {
    this.access.require(actor, 'task:manage_own', 'ai:use')
    if (input.kind === 'weekly_metrics') this.access.require(actor, 'analytics:view', 'order:read')
    if (!input.name.trim()) throw new BadRequestException('请填写任务名称')
    const count = await this.prisma.aiSchedule.count({ where: { tenantId: actor.tenantId, ownerId: actor.id, enabled: true } })
    if (count >= 10) throw new BadRequestException('最多启用10个自动任务')
    return this.prisma.aiSchedule.create({ data: { tenantId: actor.tenantId, ownerId: actor.id, name: input.name.trim(), kind: input.kind, hour: input.hour,
      weekday: input.kind === 'weekly_metrics' ? 1 : null, enabled: input.enabled, fingerprint: actor.fingerprint, nextRunAt: nextScheduleAt(input.hour, input.kind === 'weekly_metrics') } })
  }

  async tick() {
    const schedules = await this.prisma.aiSchedule.findMany({ where: { enabled: true, nextRunAt: { lte: new Date() } }, orderBy: { nextRunAt: 'asc' }, take: 20 })
    for (const schedule of schedules) {
      // Compare-and-set claims prevent several API replicas producing the same report.
      const claimed = await this.prisma.aiSchedule.updateMany({ where: { id: schedule.id, enabled: true, nextRunAt: schedule.nextRunAt }, data: { nextRunAt: nextScheduleAt(schedule.hour, schedule.kind === 'weekly_metrics') } })
      if (!claimed.count) continue
      try {
        const actor = await this.access.actor(schedule.ownerId)
        this.access.require(actor, 'ai:use', 'task:manage_own')
        if (actor.tenantId !== schedule.tenantId || actor.fingerprint !== schedule.fingerprint) throw new Error('权限变化')
        const config = await this.settings.configFor(actor.tenantId)
        const features = config?.features as Record<string, unknown> | undefined
        if (!config?.enabled || features?.tasks !== true || (schedule.kind === 'weekly_metrics' && features?.analytics !== true)) throw new Error('助手能力已关闭')
        const result = schedule.kind === 'weekly_metrics' ? await this.data.metrics(actor, 'last_week') : await this.data.todos(actor)
        const fresh = await this.access.actor(actor.id)
        if (fresh.fingerprint !== actor.fingerprint) throw new Error('权限变化')
        await this.prisma.aiSchedule.update({ where: { id: schedule.id }, data: { lastRunAt: new Date(), error: null, lastResult: JSON.parse(JSON.stringify(result)) } })
      } catch {
        await this.prisma.aiSchedule.update({ where: { id: schedule.id }, data: { enabled: false, lastResult: undefined, error: '账号、权限或功能配置已变化，请检查后重新创建任务' } })
      }
    }
    const expired = await this.prisma.aiAttachment.findMany({ where: { expiresAt: { lt: new Date() } }, take: 30 })
    for (const file of expired) {
      try { await this.storage.removeAiImage(file.objectKey); await this.prisma.aiAttachment.delete({ where: { id: file.id } }) }
      catch { this.logger.warn('识别附件清理失败，将在下次重试') }
    }
  }
}
