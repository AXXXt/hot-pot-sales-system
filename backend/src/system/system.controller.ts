import { Controller, Get, Put, Param, Body, UseGuards, Req } from '@nestjs/common'
import { ApiTags, ApiOperation, ApiBearerAuth } from '@nestjs/swagger'
import { SystemService } from './system.service'
import { UpdateSystemConfigDto } from './dto/system-config.dto'
import { JwtAuthGuard } from '../auth/auth.guard'
import { PermissionsGuard } from '../auth/permissions.guard'
import { RequirePermissions } from '../auth/require-permissions.decorator'
import { StaffAccessService } from '../auth/staff-access.service'

@ApiTags('system')
@Controller()
@RequirePermissions('role:manage')
@UseGuards(JwtAuthGuard, PermissionsGuard)
@ApiBearerAuth()
export class SystemController {
  constructor(private readonly service: SystemService, private readonly access: StaffAccessService) {}

  @Get('system-configs')
  @ApiOperation({ summary: '系统配置列表' })
  async list(@Req() req: any) { return this.service.list(await this.access.actor(Number(req.user.sub))) }

  @Put('system-configs/:key')
  @ApiOperation({ summary: '更新系统配置' })
  async update(@Param('key') key: string, @Body() dto: UpdateSystemConfigDto, @Req() req: any) {
    return this.service.update(key, dto, await this.access.actor(Number(req.user.sub)))
  }
}
