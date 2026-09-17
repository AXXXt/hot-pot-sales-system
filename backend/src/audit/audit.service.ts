import { Injectable, Logger, NotFoundException } from '@nestjs/common'
import { AuditAction, Prisma } from '@prisma/client'
import { randomUUID } from 'node:crypto'
import { PrismaService } from '../prisma.service'
import { getAuditContext } from './audit-context'

export interface AuditWriteInput {
  action: AuditAction
  module?: string
  targetType: string
  targetId?: string | number
  beforeData?: unknown
  afterData?: unknown
  operatorId?: number
}

@Injectable()
export class AuditService {
  private readonly logger = new Logger(AuditService.name)

  constructor(private readonly prisma: PrismaService) {}

  async list(query: { operatorId?: number; module?: string; action?: string; page: number; pageSize: number }) {
    const { operatorId, module, action, page, pageSize } = query
    const where: any = { tenantId: 1 }
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

  async detail(id: number) {
    const log = await this.prisma.auditLog.findUnique({
      where: { id },
      include: { operator: { select: { id: true, name: true } } }
    })
    if (!log) throw new NotFoundException({ message: '审计日志不存在', errorCode: 'AUD_1001' })
    return log
  }

  /**
   * 写入审计日志。requestId/IP/UA 从请求上下文自动获取，业务只需传入动作与前后值。
   * 审计失败不阻断业务，仅记录错误日志。
   */
  async write(input: AuditWriteInput): Promise<void> {
    const ctx = getAuditContext()
    try {
      await this.prisma.auditLog.create({
        data: {
          tenantId: 1,
          operatorId: input.operatorId ?? ctx?.userId ?? null,
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
      this.logger.error(`写入审计日志失败: ${(error as Error)?.message}`, (error as Error)?.stack)
    }
  }
}