import { Controller, Get, Post, Param, Query, Body, ParseIntPipe, DefaultValuePipe, UseGuards, Req } from '@nestjs/common'
import { ApiTags, ApiOperation, ApiQuery, ApiBearerAuth } from '@nestjs/swagger'
import { OrderService } from './order.service'
import { CreateOrderDto, AdjustPriceDto, SubmitFinanceDto, CreateRefundDto } from './dto/order.dto'
import { JwtAuthGuard } from '../auth/auth.guard'
import { PermissionsGuard } from '../auth/permissions.guard'
import { RequirePermissions } from '../auth/require-permissions.decorator'

@ApiTags('orders')
@Controller()
@UseGuards(JwtAuthGuard, PermissionsGuard)
@ApiBearerAuth()
export class OrderController {
  constructor(private readonly service: OrderService) {}

  // === Query ===
  @Get('orders')
  @ApiOperation({ summary: '订单列表' })
  @ApiQuery({ name: 'status', required: false })
  @ApiQuery({ name: 'customerId', required: false })
  @ApiQuery({ name: 'page', required: false, type: Number })
  @ApiQuery({ name: 'pageSize', required: false, type: Number })
  async list(
    @Query('status') status?: string,
    @Query('customerId') customerId?: string,
    @Query('page', new DefaultValuePipe(1), ParseIntPipe) page: number = 1,
    @Query('pageSize', new DefaultValuePipe(10), ParseIntPipe) pageSize: number = 10
  ) {
    return this.service.list({ status, customerId: customerId ? parseInt(customerId, 10) : undefined, page, pageSize })
  }

  @Get('orders/:id')
  @ApiOperation({ summary: '订单详情' })
  async detail(@Param('id', ParseIntPipe) id: number) {
    return this.service.detail(id)
  }

  @Get('orders/price-history/:customerId')
  @ApiOperation({ summary: '客户历史价格（用于报价回填）' })
  @RequirePermissions('order:read')
  async getPriceHistory(@Param('customerId', ParseIntPipe) customerId: number, @Query('skuIds') skuIds: string) {
    return this.service.getPriceHistory(customerId, (skuIds || '').split(',').map(Number).filter(Boolean))
  }

  @Get('orders/:id/logistics')
  @ApiOperation({ summary: '订单物流轨迹' })
  async getLogistics(@Param('id', ParseIntPipe) id: number) {
    return this.service.getLogistics(id)
  }

  // === Create ===
  @Post('orders')
  @ApiOperation({ summary: '创建订单 (draft)' })
  async create(@Body() dto: CreateOrderDto, @Req() req: any) {
    return this.service.create(dto, req.user?.sub)
  }

  // === State transitions ===

  // draft -> pending_quote
  @Post('orders/:id/submit')
  @ApiOperation({ summary: '提交订单 (draft -> pending_quote)' })
  async submit(@Param('id', ParseIntPipe) id: number, @Req() req: any) {
    return this.service.transition(id, 'pending_quote', req.user?.sub)
  }

  // pending_quote -> pending_confirm (admin submits quote for customer confirmation)
  @Post('orders/:id/quote')
  @ApiOperation({ summary: '管理端报价 (pending_quote -> pending_confirm)' })
  @RequirePermissions('order:confirm')
  async quote(
    @Param('id', ParseIntPipe) id: number,
    @Body() body: { items: Array<{ skuId: number; quotedPrice: number }>; note?: string },
    @Req() req: any
  ) {
    return this.service.quote(id, body.items, body.note, req.user?.sub)
  }

  // pending_confirm -> pending_finance (customer confirms & submits payment)
  @Post('orders/:id/submit-finance')
  @ApiOperation({ summary: '提交付款凭证或申请账期 (pending_confirm -> pending_finance)' })
  async submitFinance(
    @Param('id', ParseIntPipe) id: number,
    @Body() body: SubmitFinanceDto,
    @Req() req: any
  ) {
    return this.service.submitFinance(
      id,
      body.paymentProof,
      body.creditRequested,
      req.user?.sub
    )
  }

  // pending_finance -> pending_shipment (admin approves & deducts stock)
  @Post('orders/:id/approve-finance')
  @ApiOperation({ summary: '财务审核通过并扣减库存 (pending_finance -> pending_shipment)' })
  @RequirePermissions('order:confirm')
  async approveFinance(@Param('id', ParseIntPipe) id: number, @Req() req: any) {
    return this.service.approveFinance(id, req.user?.sub)
  }

  // pending_shipment -> shipped (admin enters logistics)
  @Post('orders/:id/ship')
  @ApiOperation({ summary: '录入物流并发货 (pending_shipment -> shipped)' })
  @RequirePermissions('order:confirm')
  async ship(
    @Param('id', ParseIntPipe) id: number,
    @Body() body: { logisticsType: string; driverName?: string; driverPhone?: string; plateNumber?: string },
    @Req() req: any
  ) {
    return this.service.ship(id, body, req.user?.sub)
  }

  // shipped -> completed
  @Post('orders/:id/complete')
  @ApiOperation({ summary: '确认收货 (shipped -> completed)' })
  async complete(@Param('id', ParseIntPipe) id: number, @Req() req: any) {
    return this.service.complete(id, req.user?.sub)
  }

  // -> cancelled (any cancellable state)
  @Post('orders/:id/cancel')
  @ApiOperation({ summary: '取消订单（自动退还已扣库存）' })
  async cancel(@Param('id', ParseIntPipe) id: number, @Req() req: any) {
    return this.service.cancel(id, req.user?.sub)
  }

  // Price adjustment
  @Post('orders/:id/adjust-price')
  @ApiOperation({ summary: '订单改价' })
  @RequirePermissions('order:confirm')
  async adjustPrice(@Param('id', ParseIntPipe) id: number, @Body() dto: AdjustPriceDto, @Req() req: any) {
    return this.service.adjustPrice(id, dto, req.user?.sub)
  }

  @Post('orders/:id/refund')
  @ApiOperation({ summary: '退款登记（仅已取消订单）' })
  @RequirePermissions('order:confirm')
  async refund(@Param('id', ParseIntPipe) id: number, @Body() dto: CreateRefundDto, @Req() req: any) {
    return this.service.refund(id, dto, req.user?.sub)
  }
}
