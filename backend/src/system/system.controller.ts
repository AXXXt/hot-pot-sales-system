import { Controller, Get, Put, Param, Body, UseGuards } from '@nestjs/common'
import { ApiTags, ApiOperation, ApiBearerAuth } from '@nestjs/swagger'
import { SystemService } from './system.service'
import { UpdateSystemConfigDto } from './dto/system-config.dto'
import { JwtAuthGuard } from '../auth/auth.guard'

@ApiTags('system')
@Controller()
@UseGuards(JwtAuthGuard)
@ApiBearerAuth()
export class SystemController {
  constructor(private readonly service: SystemService) {}

  @Get('system-configs')
  @ApiOperation({ summary: '系统配置列表' })
  async list() { return this.service.list() }

  @Put('system-configs/:key')
  @ApiOperation({ summary: '更新系统配置' })
  async update(@Param('key') key: string, @Body() dto: UpdateSystemConfigDto) {
    return this.service.update(key, dto)
  }
}
