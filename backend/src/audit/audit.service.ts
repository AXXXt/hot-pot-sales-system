import { Injectable, NotFoundException } from '@nestjs/common'
import { PrismaService } from '../prisma.service'

@Injectable()
export class AuditService {
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
}
