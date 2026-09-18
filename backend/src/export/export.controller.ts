import { Controller, Get, Query, Res, UseGuards } from '@nestjs/common'
import { Response } from 'express'
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger'
import { JwtAuthGuard } from '../auth/auth.guard'
import { PermissionsGuard } from '../auth/permissions.guard'
import { RequirePermissions } from '../auth/require-permissions.decorator'
import { ExportService } from './export.service'

const XLSX_MIME = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'

@ApiTags('exports')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, PermissionsGuard)
@Controller('exports')
export class ExportController {
  constructor(private readonly service: ExportService) {}

  @Get('orders')
  @RequirePermissions('order:read')
  @ApiOperation({ summary: '导出订单报表（xlsx）' })
  async exportOrders(
    @Res() res: Response,
    @Query('status') status?: string,
    @Query('customerId') customerId?: string
  ) {
    const customerIdNum = customerId ? parseInt(customerId, 10) : undefined
    const buffer = await this.service.exportOrders({
      status,
      customerId: customerIdNum && customerIdNum > 0 ? customerIdNum : undefined
    })
    res.setHeader('Content-Type', XLSX_MIME)
    res.setHeader('Content-Disposition', `attachment; filename="orders-${Date.now()}.xlsx"`)
    res.send(Buffer.from(buffer))
  }

  @Get('customers')
  @RequirePermissions('customer:manage')
  @ApiOperation({ summary: '导出客户报表（xlsx）' })
  async exportCustomers(
    @Res() res: Response,
    @Query('keyword') keyword?: string,
    @Query('status') status?: string
  ) {
    const buffer = await this.service.exportCustomers({ keyword, status })
    res.setHeader('Content-Type', XLSX_MIME)
    res.setHeader('Content-Disposition', `attachment; filename="customers-${Date.now()}.xlsx"`)
    res.send(Buffer.from(buffer))
  }

  @Get('inventory')
  @RequirePermissions('inventory:read')
  @ApiOperation({ summary: '导出库存报表（xlsx）' })
  async exportInventory(@Res() res: Response) {
    const buffer = await this.service.exportInventory()
    res.setHeader('Content-Type', XLSX_MIME)
    res.setHeader('Content-Disposition', `attachment; filename="inventory-${Date.now()}.xlsx"`)
    res.send(Buffer.from(buffer))
  }
}