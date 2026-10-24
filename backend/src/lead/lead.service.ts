import { BadRequestException, ConflictException, ForbiddenException, HttpException, HttpStatus, Injectable, Inject, Logger, NotFoundException, ServiceUnavailableException } from '@nestjs/common'
import { LeadStatus, Prisma } from '@prisma/client'
import { PrismaService } from '../prisma.service'
import { AuditService } from '../audit/audit.service'
import { CreateFollowUpDto, CreatePublicLeadDto, UpdateLeadDto } from './dto/lead.dto'
import { REDIS } from '../redis.provider'
import { StaffActor } from '../auth/staff-access.service'
import { assertLegalConsent, LEGAL_DOCUMENT_HASH, recordLegalConsent } from '../legal/legal-consent'
import { createHash, randomUUID } from 'node:crypto'
import { getAuditContext } from '../audit/audit-context'

const TENANT_ID = 1
const IP_RATE_LIMIT = 5
const PHONE_RATE_LIMIT = 3
const RATE_WINDOW_SECONDS = 3600
const IP_RATE_PREFIX = 'lead:rate:ip:'
const PHONE_RATE_PREFIX = 'lead:rate:phone:'

interface RateRedisClient {
  eval: (script: string, keyCount: number, key: string, ttlSeconds: number) => Promise<unknown>
}

const rateScript = `-- public-lead-rate
local count = redis.call('INCR', KEYS[1])
if redis.call('TTL', KEYS[1]) < 0 then
  if redis.call('EXPIRE', KEYS[1], ARGV[1]) ~= 1 then
    return redis.error_reply('rate expiry unavailable')
  end
end
return count`

@Injectable()
export class LeadService {
  private readonly logger = new Logger(LeadService.name)
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    @Inject(REDIS) private readonly redis: RateRedisClient
  ) {}

  /** 公开留资：限流 + 蜜罐反垃圾，命中蜜罐时静默成功，不给机器人反馈 */
  async submitPublicLead(dto: CreatePublicLeadDto, ip: string, userAgent: string | undefined) {
    if (dto.website && dto.website.trim().length > 0) {
      return { success: true }
    }

    assertLegalConsent(dto, ['official_site'])
    if (typeof dto.requestId !== 'string' || !/^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i.test(dto.requestId)) {
      throw new BadRequestException({ message: '提交标识无效，请刷新页面后重试', errorCode: 'LEAD_REQUEST_ID_REQUIRED' })
    }
    const submissionKey = createHash('sha256').update(`${TENANT_ID}:${dto.requestId}`).digest('hex')
    const normalized = { phone: dto.phone, name: dto.name?.trim() || null, storeName: dto.storeName?.trim() || null,
      storeScale: dto.storeScale?.trim() || null, interestedItems: dto.interestedItems?.trim() || null, consentVersion: dto.consentVersion, documentHash: LEGAL_DOCUMENT_HASH }
    const submissionDigest = createHash('sha256').update(JSON.stringify(normalized)).digest('hex')
    const prior = await this.prisma.lead.findUnique({ where: { submissionKey }, select: { id: true, tenantId: true, submissionDigest: true } })
    const replay = (record: { id: number; tenantId: number; submissionDigest: string | null }) => {
      if (record.tenantId !== TENANT_ID || record.submissionDigest !== submissionDigest) throw new ConflictException({ message: '本次提交内容已变化，请刷新页面后重新提交', errorCode: 'LEAD_IDEMPOTENCY_CONFLICT' })
      return { success: true, id: record.id }
    }
    const priorSubmission = await this.prisma.leadSubmission.findUnique({ where: { key: submissionKey }, select: { leadId: true, tenantId: true, digest: true } })
    if (priorSubmission) return replay({ id: priorSubmission.leadId, tenantId: priorSubmission.tenantId, submissionDigest: priorSubmission.digest })
    if (prior) return replay(prior)

    const limited = await this.isRateLimited(IP_RATE_PREFIX + (ip || 'unknown'), IP_RATE_LIMIT)
      || await this.isRateLimited(PHONE_RATE_PREFIX + dto.phone, PHONE_RATE_LIMIT)
    if (limited) {
      throw new HttpException('提交过于频繁，请稍后再试或直接电话联系', HttpStatus.TOO_MANY_REQUESTS)
    }

    let lead: { id: number }
    let wasCreated = false
    try { lead = await this.prisma.$transaction(async tx => {
      // 公开咨询低频入口：按租户串行复查，跨nonce并发也不会在短窗内生成相同咨询。
      await tx.$queryRaw(Prisma.sql`SELECT id FROM tenants WHERE id = ${TENANT_ID} FOR UPDATE`)
      const accepted = await tx.leadSubmission.findUnique({ where: { key: submissionKey }, select: { leadId: true, tenantId: true, digest: true } })
      if (accepted) { replay({ id: accepted.leadId, tenantId: accepted.tenantId, submissionDigest: accepted.digest }); return { id: accepted.leadId } }
      const duplicate = await tx.lead.findFirst({ where: { tenantId: TENANT_ID, phone: dto.phone, submissionDigest,
        createdAt: { gte: new Date(Date.now() - 5 * 60 * 1000) } }, select: { id: true, submissionDigest: true } })
      if (duplicate?.submissionDigest === submissionDigest) {
        await tx.leadSubmission.create({ data: { key: submissionKey, digest: submissionDigest, leadId: duplicate.id, tenantId: TENANT_ID } })
        return duplicate
      }
      const created = await tx.lead.create({
      data: {
        tenantId: TENANT_ID,
        submissionKey, submissionDigest,
        phone: dto.phone,
        name: dto.name?.trim() || null,
        storeName: dto.storeName?.trim() || null,
        storeScale: dto.storeScale?.trim() || null,
        interestedItems: dto.interestedItems?.trim() || null,
        source: 'official_site',
        status: 'new',
        ipAddress: ip || null,
        userAgent: userAgent ? userAgent.slice(0, 250) : null
      }
      })
      await recordLegalConsent(tx, dto, { tenantId: TENANT_ID, leadId: created.id })
      await tx.leadSubmission.create({ data: { key: submissionKey, digest: submissionDigest, leadId: created.id, tenantId: TENANT_ID } })
      wasCreated = true
      return created
    }) } catch (error) {
      if (typeof error === 'object' && error !== null && 'code' in error && error.code === 'P2002') {
        const accepted = await this.prisma.leadSubmission.findUnique({ where: { key: submissionKey }, select: { leadId: true, tenantId: true, digest: true } })
        if (accepted) return replay({ id: accepted.leadId, tenantId: accepted.tenantId, submissionDigest: accepted.digest })
        const existing = await this.prisma.lead.findUnique({ where: { submissionKey }, select: { id: true, tenantId: true, submissionDigest: true } })
        if (existing) return replay(existing)
      }
      throw error
    }
    if (wasCreated) this.logger.log(`新获客线索: id=${lead.id}`)
    return { success: true, id: lead.id }
  }

  private async isRateLimited(redisKey: string, limit: number): Promise<boolean> {
    try {
      // 单次原子操作也修复历史无TTL计数；超限请求仍先补有效期，避免永久锁住。
      const result = await this.redis.eval(rateScript, 1, redisKey, RATE_WINDOW_SECONDS)
      const count = typeof result === 'number' || (typeof result === 'string' && /^\d+$/.test(result)) ? Number(result) : NaN
      if (!Number.isSafeInteger(count) || count < 1) throw new Error('invalid rate result')
      return count > limit
    } catch {
      // 不记录Redis异常对象、键或参数，其中可能包含连接凭据、手机号或IP。
      this.logger.warn('公开留资限流暂不可用，已拒绝本次提交')
      throw new ServiceUnavailableException({ message: '留资提交服务暂不可用，请稍后重试或电话联系', errorCode: 'LEAD_RATE_UNAVAILABLE' })
    }
  }

  /** 状态统计：供工作台/侧边栏新线索提醒 */
  private scope(actor?: StaffActor): Prisma.LeadWhereInput {
    return { tenantId: actor?.tenantId ?? TENANT_ID, ...(actor?.leadIds ? { id: { in: actor.leadIds } } : {}) }
  }

  async stats(actor?: StaffActor) {
    const group = await this.prisma.lead.groupBy({
      by: ['status'],
      where: this.scope(actor),
      _count: { _all: true }
    })
    const countOf = (status: LeadStatus) => group.find((g) => g.status === status)?._count._all || 0
    const total = group.reduce((sum, g) => sum + g._count._all, 0)
    return {
      total,
      new: countOf('new'),
      contacted: countOf('contacted'),
      converted: countOf('converted'),
      invalid: countOf('invalid'),
      newCount: countOf('new')
    }
  }

  /** 可分配的跟进人（销售/管理员） */
  async assignees(actor?: StaffActor) {
    const users = await this.prisma.user.findMany({
      where: {
        tenantId: actor?.tenantId ?? TENANT_ID,
        ...(actor?.leadIds ? { id: actor.id } : {}),
        status: 'active',
        userType: { in: ['sales', 'admin', 'super_admin'] }
      },
      select: { id: true, name: true, phone: true, userType: true },
      orderBy: { id: 'asc' },
      take: 100
    })
    return users
  }

  async list(query: {
    status?: string
    keyword?: string
    assignedToId?: number
    page: number
    pageSize: number
  }, actor?: StaffActor) {
    const { status, keyword, assignedToId, page, pageSize } = query
    if (page < 1 || pageSize < 1 || pageSize > 500 || (assignedToId !== undefined && (!Number.isSafeInteger(assignedToId) || assignedToId <= 0))) throw new BadRequestException('分页或跟进人参数无效')
    const where: Prisma.LeadWhereInput = this.scope(actor)
    if (status && status !== 'all') {
      if (!['new', 'contacted', 'converted', 'invalid'].includes(status)) {
        throw new BadRequestException({ message: '无效的线索状态', errorCode: 'LEAD_4001' })
      }
      where.status = status as LeadStatus
    }
    if (assignedToId) where.assignedToId = assignedToId
    if (keyword) {
      where.OR = [
        { phone: { contains: keyword } },
        { name: { contains: keyword } },
        { storeName: { contains: keyword } }
      ]
    }

    const [items, total] = await Promise.all([
      this.prisma.lead.findMany({
        where,
        include: {
          assignedTo: { select: { id: true, name: true } },
          _count: { select: { followUps: true } }
        },
        orderBy: { createdAt: 'desc' },
        skip: (page - 1) * pageSize,
        take: pageSize
      }),
      this.prisma.lead.count({ where })
    ])
    return { items, page, pageSize, total }
  }

  async detail(id: number, actor?: StaffActor) {
    const lead = await this.prisma.lead.findFirst({
      where: { AND: [this.scope(actor), { id }] },
      include: {
        assignedTo: { select: { id: true, name: true, phone: true } },
        followUps: {
          include: { operator: { select: { id: true, name: true } } },
          orderBy: { createdAt: 'desc' }
        }
      }
    })
    if (!lead) throw new NotFoundException({ message: '线索不存在', errorCode: 'LEAD_1001' })
    return lead
  }

  async update(id: number, dto: UpdateLeadDto, operatorId?: number, actor?: StaffActor) {
    return this.prisma.$transaction(async tx => {
      const tenantId = actor?.tenantId ?? TENANT_ID
      await tx.$queryRaw(Prisma.sql`SELECT id FROM leads WHERE id = ${id} AND tenant_id = ${tenantId} FOR UPDATE`)
      const lead = await tx.lead.findFirst({ where: { AND: [this.scope(actor), { id }] } })
      if (!lead) throw new NotFoundException({ message: '线索不存在', errorCode: 'LEAD_1001' })
      if (dto.assignedToId) {
        const user = await tx.user.findFirst({ where: { id: dto.assignedToId, tenantId, status: 'active', userType: { in: ['sales', 'admin', 'super_admin'] } } })
        if (!user) throw new BadRequestException({ message: '跟进人不存在或已停用', errorCode: 'LEAD_4002' })
        if (actor?.leadIds && dto.assignedToId !== actor.id) throw new ForbiddenException('不可将线索分配到当前负责人范围外')
      }
      const nextStatus = dto.status || lead.status
      const data: Prisma.LeadUncheckedUpdateInput = {}
      if (nextStatus === 'converted' && (lead.status !== 'converted' || dto.customerId !== undefined || (dto.status === 'converted' && !lead.customerId))) {
        const customerId = dto.customerId ?? lead.customerId
        if (!Number.isSafeInteger(customerId) || !customerId) throw new BadRequestException({ message: '请先选择已开户且启用的客户，再确认关联转化', errorCode: 'LEAD_CUSTOMER_REQUIRED' })
        await tx.$queryRaw(Prisma.sql`SELECT id FROM customers WHERE id = ${customerId} AND tenant_id = ${tenantId} FOR UPDATE`)
        const customer = await tx.customer.findFirst({ where: { AND: [{ id: customerId, tenantId, status: 'active' },
          ...(actor?.customerIds != null ? [{ id: { in: actor.customerIds } }] : [])] }, select: { id: true } })
        if (!customer) throw new NotFoundException({ message: '客户不存在、已停用或不可访问', errorCode: 'LEAD_CUSTOMER_UNAVAILABLE' })
        data.customerId = customer.id
      } else if (nextStatus !== 'converted') {
        if (dto.customerId !== undefined) throw new BadRequestException('仅转化线索可以关联客户')
        if (lead.customerId != null) data.customerId = null
      }
      if (dto.status && dto.status !== lead.status) {
        data.status = dto.status
        if (dto.status === 'contacted' && !lead.lastContactAt) data.lastContactAt = new Date()
      }
      if (dto.assignedToId !== undefined) data.assignedToId = dto.assignedToId
      if (dto.remark !== undefined) data.remark = dto.remark?.trim() || null
      if (dto.nextFollowUpAt !== undefined) data.nextFollowUpAt = dto.nextFollowUpAt ? new Date(dto.nextFollowUpAt) : null
      const updated = await tx.lead.update({ where: { id }, data })
      const context = getAuditContext()
      if (context?.tenantId && context.tenantId !== tenantId) throw new ForbiddenException('审计租户与当前账号不一致')
      await tx.auditLog.create({ data: {
        tenantId, operatorId: operatorId ?? context?.userId ?? null, action: 'update', module: 'lead', targetType: 'lead', targetId: String(id),
        beforeData: { status: lead.status, customerId: lead.customerId, assignedToId: lead.assignedToId, remark: lead.remark, nextFollowUpAt: lead.nextFollowUpAt?.toISOString() || null },
        afterData: { status: updated.status, customerId: updated.customerId, assignedToId: updated.assignedToId, remark: updated.remark, nextFollowUpAt: updated.nextFollowUpAt?.toISOString() || null },
        requestId: context?.requestId || `lead-${randomUUID()}`, ipAddress: context?.ip || null, userAgent: context?.userAgent || null
      } })
      return updated
    })
  }

  async conversionCustomers(keyword: string | undefined, actor: StaffActor) {
    if (keyword !== undefined && (typeof keyword !== 'string' || keyword.length > 100)) throw new BadRequestException('搜索内容无效')
    return this.prisma.customer.findMany({ where: { tenantId: actor.tenantId, status: 'active',
      ...(actor.customerIds != null ? { id: { in: actor.customerIds } } : {}),
      ...(keyword?.trim() ? { customerName: { contains: keyword.trim() } } : {}) },
      select: { id: true, customerName: true }, orderBy: { id: 'desc' }, take: 30 })
  }

  async addFollowUp(id: number, dto: CreateFollowUpDto, operatorId?: number, actor?: StaffActor) {
    if (!dto.content.trim()) throw new BadRequestException('跟进内容不能为空')
    return this.prisma.$transaction(async tx => {
      const tenantId = actor?.tenantId ?? TENANT_ID
      await tx.$queryRaw(Prisma.sql`SELECT id FROM leads WHERE id = ${id} AND tenant_id = ${tenantId} FOR UPDATE`)
      const lead = await tx.lead.findFirst({ where: { AND: [this.scope(actor), { id }] } })
      if (!lead) throw new NotFoundException({ message: '线索不存在', errorCode: 'LEAD_1001' })
      const nextFollowUpAt = dto.nextFollowUpAt ? new Date(dto.nextFollowUpAt) : undefined
      const followUp = await tx.leadFollowUp.create({
        data: {
          leadId: id,
          operatorId: operatorId ?? null,
          content: dto.content.trim(),
          nextFollowUpAt: nextFollowUpAt ?? null
        }
      })
      const updated = await tx.lead.update({
        where: { id },
        data: {
          status: lead.status === 'new' ? 'contacted' : lead.status,
          lastContactAt: new Date(),
          nextFollowUpAt: nextFollowUpAt ?? lead.nextFollowUpAt
        }
      })
      const context = getAuditContext()
      if (context?.tenantId && context.tenantId !== tenantId) throw new ForbiddenException('审计租户与当前账号不一致')
      await tx.auditLog.create({ data: {
        tenantId, operatorId: operatorId ?? context?.userId ?? null, action: 'create', module: 'lead', targetType: 'lead_follow_up', targetId: String(followUp.id),
        afterData: { leadId: id, content: followUp.content, nextFollowUpAt: followUp.nextFollowUpAt?.toISOString() || null },
        requestId: context?.requestId || `lead-follow-up-${randomUUID()}`, ipAddress: context?.ip || null, userAgent: context?.userAgent || null
      } })
      return updated
    })
  }
}
