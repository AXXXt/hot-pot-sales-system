import { Controller, Get, Query, DefaultValuePipe, ParseIntPipe, UseGuards, Req, ForbiddenException } from '@nestjs/common'
import { ApiTags, ApiOperation, ApiBearerAuth, ApiQuery } from '@nestjs/swagger'
import { MetricsService } from './metrics.service'
import { JwtAuthGuard } from '../auth/auth.guard'
import { PermissionsGuard } from '../auth/permissions.guard'
import { RequirePermissions } from '../auth/require-permissions.decorator'
import { StaffAccessService } from '../auth/staff-access.service'

@ApiTags('monitor')
@Controller('monitor')
@RequirePermissions('monitor:read')
@UseGuards(JwtAuthGuard, PermissionsGuard)
@ApiBearerAuth()
export class MonitorController {
  constructor(private readonly metrics: MetricsService, private readonly access: StaffAccessService) {}

  private async requireGlobalMonitor(userId: number) {
    const actor = await this.access.actor(userId)
    this.access.require(actor, 'monitor:read')
    if (!actor.superAdmin) throw new ForbiddenException('系统级监控仅限超级管理员查看')
  }

  @Get('summary')
  @ApiOperation({ summary: '查询近 5 分钟监控摘要' })
  async summary(@Req() req: any) {
    await this.requireGlobalMonitor(Number(req.user?.sub))
    return this.metrics.getSummary()
  }

  @Get('alerts')
  @ApiOperation({ summary: '查询最近告警历史' })
  @ApiQuery({ name: 'limit', required: false, type: Number })
  async alerts(
    @Req() req: any,
    @Query('limit', new DefaultValuePipe(20), ParseIntPipe) limit: number = 20
  ) {
    await this.requireGlobalMonitor(Number(req.user?.sub))
    return this.metrics.getAlerts(limit)
  }
}
