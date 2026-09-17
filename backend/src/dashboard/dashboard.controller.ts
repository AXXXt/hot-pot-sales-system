import { Controller, Get, UseGuards } from '@nestjs/common'
import { ApiTags, ApiOperation, ApiBearerAuth } from '@nestjs/swagger'
import { DashboardService } from './dashboard.service'
import { JwtAuthGuard } from '../auth/auth.guard'
import { PermissionsGuard } from '../auth/permissions.guard'
import { RequirePermissions } from '../auth/require-permissions.decorator'

@ApiTags('dashboard')
@Controller('dashboard')
@RequirePermissions('dashboard:view')
@UseGuards(JwtAuthGuard, PermissionsGuard)
@ApiBearerAuth()
export class DashboardController {
  constructor(private readonly service: DashboardService) {}

  @Get('stats')
  @ApiOperation({ summary: 'Dashboard 聚合数据' })
  async stats() {
    return this.service.getStats()
  }
}
