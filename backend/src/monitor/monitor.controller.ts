import { Controller, Get, Query, DefaultValuePipe, ParseIntPipe, UseGuards } from '@nestjs/common'
import { ApiTags, ApiOperation, ApiBearerAuth, ApiQuery } from '@nestjs/swagger'
import { MetricsService } from './metrics.service'
import { JwtAuthGuard } from '../auth/auth.guard'
import { PermissionsGuard } from '../auth/permissions.guard'
import { RequirePermissions } from '../auth/require-permissions.decorator'

@ApiTags('monitor')
@Controller('monitor')
@RequirePermissions('monitor:read')
@UseGuards(JwtAuthGuard, PermissionsGuard)
@ApiBearerAuth()
export class MonitorController {
  constructor(private readonly metrics: MetricsService) {}

  @Get('summary')
  @ApiOperation({ summary: '查询近 5 分钟监控摘要' })
  async summary() {
    return this.metrics.getSummary()
  }

  @Get('alerts')
  @ApiOperation({ summary: '查询最近告警历史' })
  @ApiQuery({ name: 'limit', required: false, type: Number })
  async alerts(
    @Query('limit', new DefaultValuePipe(20), ParseIntPipe) limit: number = 20
  ) {
    return this.metrics.getAlerts(limit)
  }
}