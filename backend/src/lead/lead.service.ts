import { BadRequestException, HttpException, HttpStatus, Injectable, Inject, Logger, NotFoundException } from '@nestjs/common'
import { LeadStatus, Prisma } from '@prisma/client'
import { PrismaService } from '../prisma.service'
import { AuditService } from '../audit/audit.service'
import { CreateFollowUpDto, CreatePublicLeadDto, UpdateLeadDto } from './dto/lead.dto'
import { REDIS } from '../redis.provider'

const TENANT_ID = 1
const IP_RATE_LIMIT = 5
const PHONE_RATE_LIMIT = 3
const RATE_WINDOW_SECONDS = 3600
const IP_RATE_PREFIX = 'lead:rate:ip:'
const PHONE_RATE_PREFIX = 'lead:rate:phone:'

interface RateRedisClient {
  incr: (key: string) => Promise<number>
  expire: (key: string, ttl: number) => Promise<number>
}

interface RateCounter { count: number; expiresAt: number }

@Injectable()
export class LeadService {
  private readonly logger = new Logger(LeadService.name)
  /** Redis 不可用时的进程内降级计数器 */
  private readonly memoryCounters = new Map<string, RateCounter>()

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

    const limited = await this.isRateLimited(`ip:${ip}`, ip ? IP_RATE_PREFIX + ip : null, IP_RATE_LIMIT)
      || await this.isRateLimited(`phone:${dto.phone}`, PHONE_RATE_PREFIX + dto.phone, PHONE_RATE_LIMIT)
    if (limited) {
      throw new HttpException('提交过于频繁，请稍后再试或直接电话联系', HttpStatus.TOO_MANY_REQUESTS)
    }

    const lead = await this.prisma.lead.create({
      data: {
        tenantId: TENANT_ID,
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
    this.logger.log(`新获客线索: id=${lead.id} phone=${dto.phone}`)
    return { success: true, id: lead.id }
  }

  private async isRateLimited(memoryKey: string, redisKey: string | null, limit: number): Promise<boolean> {
    if (redisKey) {
      try {
        const count = await this.redis.incr(redisKey)
        if (count === 1) await this.redis.expire(redisKey, RATE_WINDOW_SECONDS).catch(() => undefined)
        return count > limit
      } catch (error) {
        this.logger.warn(`Redis 限流不可用，降级为进程内限流: ${(error as Error)?.message}`)
      }
    }
    const now = Date.now()
    const entry = this.memoryCounters.get(memoryKey)
    if (!entry || now > entry.expiresAt) {
      this.memoryCounters.set(memoryKey, { count: 1, expiresAt: now + RATE_WINDOW_SECONDS * 1000 })
      return false
    }
    entry.count += 1
    return entry.count > limit
  }

  /** 状态统计：供工作台/侧边栏新线索提醒 */
  async stats() {
    const group = await this.prisma.lead.groupBy({
      by: ['status'],
      where: { tenantId: TENANT_ID },
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
  async assignees() {
    const users = await this.prisma.user.findMany({
      where: {
        tenantId: TENANT_ID,
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
  }) {
    const { status, keyword, assignedToId, page, pageSize } = query
    const where: Prisma.LeadWhereInput = { tenantId: TENANT_ID }
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

  async detail(id: number) {
    const lead = await this.prisma.lead.findFirst({
      where: { id, tenantId: TENANT_ID },
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

  async update(id: number, dto: UpdateLeadDto, operatorId?: number) {
    const lead = await this.prisma.lead.findFirst({ where: { id, tenantId: TENANT_ID } })
    if (!lead) throw new NotFoundException({ message: '线索不存在', errorCode: 'LEAD_1001' })

    if (dto.assignedToId) {
      const user = await this.prisma.user.findFirst({
        where: { id: dto.assignedToId, tenantId: TENANT_ID, status: 'active' }
      })
      if (!user) throw new BadRequestException({ message: '跟进人不存在或已停用', errorCode: 'LEAD_4002' })
    }

    const data: Prisma.LeadUpdateInput = {}
    if (dto.status && dto.status !== lead.status) {
      data.status = dto.status
      if (dto.status === 'contacted' && !lead.lastContactAt) data.lastContactAt = new Date()
    }
    if (dto.assignedToId !== undefined) data.assignedTo = { connect: { id: dto.assignedToId } }
    if (dto.remark !== undefined) data.remark = dto.remark?.trim() || null
    if (dto.nextFollowUpAt !== undefined) data.nextFollowUpAt = dto.nextFollowUpAt ? new Date(dto.nextFollowUpAt) : null

    const updated = await this.prisma.lead.update({ where: { id }, data })
    await this.audit.write({
      action: 'update',
      module: 'lead',
      targetType: 'lead',
      targetId: id,
      beforeData: { status: lead.status, assignedToId: lead.assignedToId, remark: lead.remark, nextFollowUpAt: lead.nextFollowUpAt },
      afterData: { status: updated.status, assignedToId: updated.assignedToId, remark: updated.remark, nextFollowUpAt: updated.nextFollowUpAt },
      operatorId
    })
    return updated
  }

  async addFollowUp(id: number, dto: CreateFollowUpDto, operatorId?: number) {
    const lead = await this.prisma.lead.findFirst({ where: { id, tenantId: TENANT_ID } })
    if (!lead) throw new NotFoundException({ message: '线索不存在', errorCode: 'LEAD_1001' })

    const nextFollowUpAt = dto.nextFollowUpAt ? new Date(dto.nextFollowUpAt) : undefined
    const [followUp, updated] = await this.prisma.$transaction([
      this.prisma.leadFollowUp.create({
        data: {
          leadId: id,
          operatorId: operatorId ?? null,
          content: dto.content.trim(),
          nextFollowUpAt: nextFollowUpAt ?? null
        }
      }),
      this.prisma.lead.update({
        where: { id },
        data: {
          status: lead.status === 'new' ? 'contacted' : lead.status,
          lastContactAt: new Date(),
          nextFollowUpAt: nextFollowUpAt ?? lead.nextFollowUpAt
        }
      })
    ])

    await this.audit.write({
      action: 'create',
      module: 'lead',
      targetType: 'lead_follow_up',
      targetId: followUp.id,
      afterData: { leadId: id, content: followUp.content, nextFollowUpAt: followUp.nextFollowUpAt },
      operatorId
    })
    return updated
  }
}
