import { Controller, Get, Req, UseGuards } from '@nestjs/common'
import { ApiTags, ApiOperation, ApiBearerAuth } from '@nestjs/swagger'
import { DashboardService } from './dashboard.service'
import { JwtAuthGuard } from '../auth/auth.guard'
import { PermissionsGuard } from '../auth/permissions.guard'
import { RequirePermissions } from '../auth/require-permissions.decorator'
import { StaffAccessService } from '../auth/staff-access.service'

@ApiTags('dashboard')
@Controller('dashboard')
@RequirePermissions('dashboard:view')
@UseGuards(JwtAuthGuard, PermissionsGuard)
@ApiBearerAuth()
export class DashboardController {
  constructor(private readonly service: DashboardService, private readonly access: StaffAccessService) {}

  @Get('stats')
  @ApiOperation({ summary: 'Dashboard 聚合数据' })
  async stats(@Req() req: any) {
    const actor = await this.access.actor(Number(req.user.sub))
    const visibility = { orders: this.access.has(actor, 'order:read'), inventory: this.access.has(actor, 'inventory:read'), products: this.access.has(actor, 'product:read'), customers: this.access.has(actor, 'customer:manage') }
    const deny = { tenantId: actor.tenantId, id: -1 }
    const result = await this.service.getStats({
      order: visibility.orders ? this.access.orderWhere(actor) : deny,
      product: visibility.products ? this.access.productWhere(actor) : deny,
      inventory: visibility.inventory ? this.access.productWhere(actor) : deny,
      customer: visibility.customers ? this.access.customerWhere(actor) : deny
    }, actor)
    return { ...result, visibility, metricDefinition: '有效订单金额（按下单时间、排除样品），不是实收或利润；仅统计当前账号可见范围。' }
  }
}
