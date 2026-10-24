import { Injectable, NotFoundException } from '@nestjs/common'
import { PrismaService } from '../prisma.service'
import { UpdateSystemConfigDto } from './dto/system-config.dto'
import { StaffActor } from '../auth/staff-access.service'
import { AuditService } from '../audit/audit.service'

@Injectable()
export class SystemService {
  constructor(private readonly prisma: PrismaService, private readonly audit: AuditService) {}

  async list(actor: StaffActor) {
    return this.prisma.systemConfig.findMany({
      where: { tenantId: actor.tenantId },
      orderBy: { configKey: 'asc' }
    })
  }

  async update(key: string, dto: UpdateSystemConfigDto, actor: StaffActor) {
    const config = await this.prisma.systemConfig.findFirst({ where: { tenantId: actor.tenantId, configKey: key } })
    if (!config) throw new NotFoundException({ message: '配置不存在', errorCode: 'SYS_1001' })
    const updated = await this.prisma.systemConfig.update({
      where: { id: config.id, tenantId: actor.tenantId },
      data: { configValue: dto.configValue, remark: dto.remark }
    })
    await this.audit.write({ tenantId: actor.tenantId, operatorId: actor.id, action: 'update', module: 'system', targetType: 'system_config', targetId: config.id,
      beforeData: { configKey: key, configValue: config.configValue, remark: config.remark }, afterData: { configKey: key, configValue: updated.configValue, remark: updated.remark } })
    return updated
  }
}
