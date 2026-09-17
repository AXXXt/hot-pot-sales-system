import { Injectable, NotFoundException } from '@nestjs/common'
import { PrismaService } from '../prisma.service'
import { UpdateSystemConfigDto } from './dto/system-config.dto'

@Injectable()
export class SystemService {
  constructor(private readonly prisma: PrismaService) {}

  async list() {
    return this.prisma.systemConfig.findMany({
      where: { tenantId: 1 },
      orderBy: { configKey: 'asc' }
    })
  }

  async update(key: string, dto: UpdateSystemConfigDto) {
    const config = await this.prisma.systemConfig.findFirst({ where: { tenantId: 1, configKey: key } })
    if (!config) throw new NotFoundException({ message: '配置不存在', errorCode: 'SYS_1001' })
    return this.prisma.systemConfig.update({
      where: { id: config.id },
      data: { configValue: dto.configValue, remark: dto.remark }
    })
  }
}
