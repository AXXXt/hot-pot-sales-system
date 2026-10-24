import { BadRequestException, Injectable, Logger, NotFoundException } from '@nestjs/common'
import { AuditAction, Prisma } from '@prisma/client'
import { randomUUID } from 'node:crypto'
import { PrismaService } from '../prisma.service'
import { AuditRequestContext, getAuditContext } from './audit-context'
import { StaffActor } from '../auth/staff-access.service'

export interface AuditWriteInput {
  tenantId?: number
  action: AuditAction
  module?: string
  targetType: string
  targetId?: string | number
  beforeData?: unknown
  afterData?: unknown
  operatorId?: number
}

class AuditAttributionError extends Error {}

function isPositiveId(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value > 0
}

@Injectable()
export class AuditService {
  private readonly logger = new Logger(AuditService.name)

  constructor(private readonly prisma: PrismaService) {}

  async list(query: { operatorId?: number; module?: string; action?: string; page: number; pageSize: number }, actor: StaffActor) {
    const { operatorId, module, action, page, pageSize } = query
    if (page < 1 || pageSize < 1 || pageSize > 500 || (action && !Object.values(AuditAction).includes(action as AuditAction))) throw new BadRequestException('查询参数无效')
    const where: any = { tenantId: actor.tenantId }
    if (operatorId) where.operatorId = operatorId
    if (module) where.module = module
    if (action) where.action = action

    const [items, total] = await Promise.all([
      this.prisma.auditLog.findMany({
        where,
        include: { operator: { select: { id: true, name: true, phone: true } } },
        orderBy: { createdAt: 'desc' },
        skip: (page - 1) * pageSize,
        take: pageSize
      }),
      this.prisma.auditLog.count({ where })
    ])
    return { items, page, pageSize, total }
  }

  async detail(id: number, actor: StaffActor) {
    const log = await this.prisma.auditLog.findFirst({
      where: { id, tenantId: actor.tenantId },
      include: { operator: { select: { id: true, name: true } } }
    })
    if (!log) throw new NotFoundException({ message: '审计日志不存在', errorCode: 'AUD_1001' })
    return log
  }

  /**
   * HTTP 请求继承已认证的数据库租户；后台任务显式传入租户或从操作人记录确定归属。
   * 无法确定归属时不写入其他租户。requestId/IP/UA 仍从请求上下文自动获取。
   * 审计失败不阻断业务，仅记录错误日志。
   */
  async write(input: AuditWriteInput): Promise<void> {
    const ctx = getAuditContext()
    try {
      const operatorId = input.operatorId ?? ctx?.userId ?? null
      if (operatorId !== null && !isPositiveId(operatorId)) throw new AuditAttributionError('操作人标识无效')
      const tenantId = await this.resolveTenantId(input.tenantId, ctx, operatorId)
      await this.prisma.auditLog.create({
        data: {
          tenantId,
          operatorId,
          action: input.action,
          module: input.module ?? null,
          targetType: input.targetType,
          targetId: input.targetId != null ? String(input.targetId) : null,
          beforeData: (input.beforeData as Prisma.InputJsonValue) ?? undefined,
          afterData: (input.afterData as Prisma.InputJsonValue) ?? undefined,
          ipAddress: ctx?.ip ?? null,
          userAgent: ctx?.userAgent ?? null,
          requestId: ctx?.requestId ?? `local-${randomUUID()}`
        }
      })
    } catch (error) {
      // Prisma errors can include SQL arguments and business payloads; do not log them here.
      this.logger.error(`写入审计日志失败: ${error instanceof AuditAttributionError ? error.message : '审计存储不可用'}`)
    }
  }

  private async resolveTenantId(explicitTenantId: number | undefined, ctx: AuditRequestContext | undefined, operatorId: number | null) {
    if (explicitTenantId !== undefined) {
      if (!isPositiveId(explicitTenantId)) throw new AuditAttributionError('租户标识无效')
      if (isPositiveId(ctx?.tenantId) && ctx.tenantId !== explicitTenantId) throw new AuditAttributionError('审计租户与已认证上下文不一致')
      return explicitTenantId
    }
    if (isPositiveId(ctx?.tenantId)) return ctx.tenantId
    if (operatorId !== null && typeof this.prisma.user?.findUnique === 'function') {
      const user = await this.prisma.user.findUnique({ where: { id: operatorId }, select: { tenantId: true } })
      if (isPositiveId(user?.tenantId)) return user.tenantId
    }
    throw new AuditAttributionError('缺少可信租户归属，已跳过写入')
  }
}
