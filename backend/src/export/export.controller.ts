import { BadRequestException, Controller, Get, Query, Req, Res, UseGuards } from '@nestjs/common'
import { CustomerStatus, OrderStatus } from '@prisma/client'
import { Response } from 'express'
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger'
import { JwtAuthGuard } from '../auth/auth.guard'
import { PermissionsGuard } from '../auth/permissions.guard'
import { RequirePermissions } from '../auth/require-permissions.decorator'
import { ExportService } from './export.service'
import { StaffAccessService } from '../auth/staff-access.service'

const XLSX_MIME = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'

@ApiTags('exports')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, PermissionsGuard)
@Controller('exports')
export class ExportController {
  constructor(private readonly service: ExportService, private readonly access: StaffAccessService) {}

  @Get('orders')
  @RequirePermissions('order:read')
  @ApiOperation({ summary: '导出订单报表（xlsx）' })
  async exportOrders(
    @Res() res: Response,
    @Req() req: any,
    @Query('status') status?: string,
    @Query('customerId') customerId?: string
  ) {
    if (status && status !== 'all' && !Object.values(OrderStatus).includes(status as OrderStatus)) throw new BadRequestException('订单状态无效')
    const customerIdNum = customerId ? Number(customerId) : undefined
    if (customerId && (!/^\d+$/.test(customerId) || !Number.isSafeInteger(customerIdNum) || customerIdNum! <= 0)) throw new BadRequestException('customerId须为正整数')
    const buffer = await this.service.exportOrders({
      status,
      customerId: customerIdNum
    }, this.access.orderWhere(await this.access.actor(Number(req.user.sub))))
    res.setHeader('Content-Type', XLSX_MIME)
    res.setHeader('Content-Disposition', `attachment; filename="orders-${Date.now()}.xlsx"`)
    res.send(Buffer.from(buffer))
  }

  @Get('customers')
  @RequirePermissions('customer:manage')
  @ApiOperation({ summary: '导出客户报表（xlsx）' })
  async exportCustomers(
    @Res() res: Response,
    @Req() req: any,
    @Query('keyword') keyword?: string,
    @Query('status') status?: string
  ) {
    if (status && status !== 'all' && !Object.values(CustomerStatus).includes(status as CustomerStatus)) throw new BadRequestException('客户状态无效')
    const buffer = await this.service.exportCustomers({ keyword, status }, this.access.customerWhere(await this.access.actor(Number(req.user.sub))))
    res.setHeader('Content-Type', XLSX_MIME)
    res.setHeader('Content-Disposition', `attachment; filename="customers-${Date.now()}.xlsx"`)
    res.send(Buffer.from(buffer))
  }

  @Get('inventory')
  @RequirePermissions('inventory:read')
  @ApiOperation({ summary: '导出库存报表（xlsx）' })
  async exportInventory(@Res() res: Response, @Req() req: any) {
    const buffer = await this.service.exportInventory(this.access.productWhere(await this.access.actor(Number(req.user.sub))))
    res.setHeader('Content-Type', XLSX_MIME)
    res.setHeader('Content-Disposition', `attachment; filename="inventory-${Date.now()}.xlsx"`)
    res.send(Buffer.from(buffer))
  }
}
