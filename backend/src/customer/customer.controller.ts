import { Controller, Delete, Get, Post, Put, Patch, Param, Query, Body, ParseIntPipe, DefaultValuePipe, UseGuards, Req } from '@nestjs/common'
import { ApiTags, ApiOperation, ApiQuery, ApiBearerAuth } from '@nestjs/swagger'
import { CustomerService } from './customer.service'
import { CreateCustomerDto, UpdateCustomerDto, CreateCustomerLevelDto, UpdateCustomerLevelDto, CreatePriceRuleDto, CreateRepaymentDto } from './dto/create-customer.dto'
import { JwtAuthGuard } from '../auth/auth.guard'
import { PermissionsGuard } from '../auth/permissions.guard'
import { RequirePermissions } from '../auth/require-permissions.decorator'
import { UpdateProductVisibilityDto } from './dto/update-product-visibility.dto'

@ApiTags('customers')
@Controller()
@UseGuards(JwtAuthGuard, PermissionsGuard)
@ApiBearerAuth()
export class CustomerController {
  constructor(private readonly service: CustomerService) {}

  @Get('customers')
  @ApiOperation({ summary: '客户列表' })
  @ApiQuery({ name: 'keyword', required: false })
  @ApiQuery({ name: 'status', required: false })
  @ApiQuery({ name: 'page', required: false, type: Number })
  @ApiQuery({ name: 'pageSize', required: false, type: Number })
  @RequirePermissions('customer:manage')
  async list(
    @Query('keyword') keyword?: string,
    @Query('status') status?: string,
    @Query('page', new DefaultValuePipe(1), ParseIntPipe) page: number = 1,
    @Query('pageSize', new DefaultValuePipe(10), ParseIntPipe) pageSize: number = 10
  ) {
    return this.service.list({ keyword, status, page, pageSize })
  }

  @Post('customers')
  @ApiOperation({ summary: '创建客户' })
  @RequirePermissions('customer:manage')
  async create(@Body() dto: CreateCustomerDto) {
    return this.service.create(dto)
  }

  @Get('customers/me/price-rules')
  @ApiOperation({ summary: '当前客户协议价格' })
  async myPriceRules(@Req() req: any) {
    return this.service.myPriceRules(req.user?.sub)
  }

  @Get('customers/:id')
  @ApiOperation({ summary: '客户详情' })
  @RequirePermissions('customer:manage')
  async detail(@Param('id', ParseIntPipe) id: number) {
    return this.service.detail(id)
  }

  @Get('customers/:id/product-visibility')
  @ApiOperation({ summary: '查询客户可见商品配置' })
  @RequirePermissions('customer:manage')
  async productVisibility(@Param('id', ParseIntPipe) id: number) {
    return this.service.getProductVisibility(id)
  }

  @Put('customers/:id/product-visibility')
  @ApiOperation({ summary: '更新客户可见商品配置' })
  @RequirePermissions('customer:manage')
  async updateProductVisibility(
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: UpdateProductVisibilityDto
  ) {
    return this.service.updateProductVisibility(id, dto)
  }

  @Patch('customers/:id')
  @ApiOperation({ summary: '更新客户' })
  @RequirePermissions('customer:manage')
  async update(@Param('id', ParseIntPipe) id: number, @Body() dto: UpdateCustomerDto) {
    return this.service.update(id, dto)
  }

  // Approval endpoint
  @Post('customers/:id/approve')
  @ApiOperation({ summary: '审核通过客户' })
  @RequirePermissions('customer:manage')
  async approve(@Param('id', ParseIntPipe) id: number) {
    return this.service.approve(id)
  }

  @Post('customers/:id/reject')
  @ApiOperation({ summary: '驳回客户' })
  @RequirePermissions('customer:manage')
  async reject(@Param('id', ParseIntPipe) id: number, @Body('reason') reason?: string) {
    return this.service.reject(id, reason)
  }

  @Get('customer-levels')
  @ApiQuery({ name: 'brandId', required: false, type: Number })
  @RequirePermissions('customer:manage')
  async levels(@Query('brandId', new DefaultValuePipe(1), ParseIntPipe) brandId: number) {
    return this.service.levels(brandId)
  }

  @Post('customer-levels')
  @RequirePermissions('customer:manage')
  async createLevel(@Body() dto: CreateCustomerLevelDto) { return this.service.createLevel(dto) }

  @Patch('customer-levels/:id')
  @RequirePermissions('customer:manage')
  async updateLevel(@Param('id', ParseIntPipe) id: number, @Body() dto: UpdateCustomerLevelDto) { return this.service.updateLevel(id, dto) }

  @Get('customer-price-rules')
  @ApiQuery({ name: 'customerId', required: true })
  @RequirePermissions('customer:manage')
  async priceRules(@Query('customerId', ParseIntPipe) customerId: number) { return this.service.priceRules(customerId) }

  @Post('customer-price-rules')
  @RequirePermissions('customer:manage')
  async createPriceRule(@Body() dto: CreatePriceRuleDto) { return this.service.createPriceRule(dto) }

  @Delete('customer-price-rules/:id')
  @RequirePermissions('customer:manage')
  async deletePriceRule(@Param('id', ParseIntPipe) id: number) { return this.service.deletePriceRule(id) }

  @Get('customers/:id/repayments')
  @RequirePermissions('customer:manage')
  @ApiOperation({ summary: '客户还款记录' })
  async repayments(@Param('id', ParseIntPipe) id: number) { return this.service.repayments(id) }

  @Post('customers/:id/repayments')
  @RequirePermissions('customer:manage')
  @ApiOperation({ summary: '登记客户还款' })
  async createRepayment(@Param('id', ParseIntPipe) id: number, @Body() dto: CreateRepaymentDto, @Req() req: any) {
    return this.service.createRepayment(id, dto, req.user?.sub)
  }
}
