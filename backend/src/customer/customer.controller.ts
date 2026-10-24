import { Controller, Delete, Get, Post, Put, Patch, Param, Query, Body, ParseIntPipe, ParseBoolPipe, DefaultValuePipe, UseGuards, Req } from '@nestjs/common'
import { ApiTags, ApiOperation, ApiQuery, ApiBearerAuth } from '@nestjs/swagger'
import { CustomerService } from './customer.service'
import { CreateCustomerDto, UpdateCustomerDto, CreateCustomerLevelDto, UpdateCustomerLevelDto, CreatePriceRuleDto, CreateRepaymentDto } from './dto/create-customer.dto'
import { JwtAuthGuard } from '../auth/auth.guard'
import { PermissionsGuard } from '../auth/permissions.guard'
import { RequirePermissions } from '../auth/require-permissions.decorator'
import { UpdateProductVisibilityDto } from './dto/update-product-visibility.dto'
import { StaffAccessService } from '../auth/staff-access.service'

@ApiTags('customers')
@Controller()
@UseGuards(JwtAuthGuard, PermissionsGuard)
@ApiBearerAuth()
export class CustomerController {
  constructor(private readonly service: CustomerService, private readonly access: StaffAccessService) {}

  private actor(req: any) { return this.access.actor(Number(req.user?.sub)) }

  @Get('customers')
  @ApiOperation({ summary: '客户列表' })
  @ApiQuery({ name: 'keyword', required: false })
  @ApiQuery({ name: 'status', required: false })
  @ApiQuery({ name: 'page', required: false, type: Number })
  @ApiQuery({ name: 'pageSize', required: false, type: Number })
  @RequirePermissions('customer:manage')
  async list(
    @Req() req: any,
    @Query('keyword') keyword?: string,
    @Query('status') status?: string,
    @Query('page', new DefaultValuePipe(1), ParseIntPipe) page: number = 1,
    @Query('pageSize', new DefaultValuePipe(10), ParseIntPipe) pageSize: number = 10
  ) {
    return this.service.list({ keyword, status, page, pageSize }, await this.actor(req))
  }

  @Post('customers')
  @ApiOperation({ summary: '创建客户' })
  @RequirePermissions('customer:manage')
  async create(@Body() dto: CreateCustomerDto, @Req() req: any) {
    return this.service.create(dto, await this.actor(req))
  }

  @Get('customers/me/price-rules')
  @ApiOperation({ summary: '当前客户协议价格' })
  async myPriceRules(@Req() req: any) {
    return this.service.myPriceRules(req.user?.sub)
  }

  @Get('customers/sales-owners')
  @RequirePermissions('customer:manage')
  async salesOwners(@Req() req: any) { return this.service.salesOwners(await this.actor(req)) }

  @Get('customers/:id')
  @ApiOperation({ summary: '客户详情' })
  @RequirePermissions('customer:manage')
  async detail(@Param('id', ParseIntPipe) id: number, @Req() req: any) {
    return this.service.detail(id, await this.actor(req))
  }

  @Get('customers/:id/product-visibility')
  @ApiOperation({ summary: '查询客户可见商品配置' })
  @RequirePermissions('customer:manage')
  async productVisibility(@Param('id', ParseIntPipe) id: number, @Req() req: any) {
    return this.service.getProductVisibility(id, await this.actor(req))
  }

  @Put('customers/:id/product-visibility')
  @ApiOperation({ summary: '更新客户可见商品配置' })
  @RequirePermissions('customer:manage')
  async updateProductVisibility(
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: UpdateProductVisibilityDto,
    @Req() req: any
  ) {
    return this.service.updateProductVisibility(id, dto, await this.actor(req))
  }

  @Patch('customers/:id')
  @ApiOperation({ summary: '更新客户' })
  @RequirePermissions('customer:manage')
  async update(@Param('id', ParseIntPipe) id: number, @Body() dto: UpdateCustomerDto, @Req() req: any) {
    return this.service.update(id, dto, await this.actor(req))
  }

  // Approval endpoint
  @Post('customers/:id/approve')
  @ApiOperation({ summary: '审核通过客户' })
  @RequirePermissions('customer:manage')
  async approve(@Param('id', ParseIntPipe) id: number, @Req() req: any) {
    return this.service.approve(id, await this.actor(req))
  }

  @Post('customers/:id/reject')
  @ApiOperation({ summary: '驳回客户' })
  @RequirePermissions('customer:manage')
  async reject(@Param('id', ParseIntPipe) id: number, @Req() req: any, @Body('reason') reason?: string) {
    return this.service.reject(id, reason, await this.actor(req))
  }

  @Get('customer-levels')
  @ApiQuery({ name: 'brandId', required: false, type: Number })
  @RequirePermissions('customer:manage')
  async levels(@Req() req: any, @Query('brandId', new ParseIntPipe({ optional: true })) brandId?: number,
    @Query('includeDisabled', new DefaultValuePipe(false), ParseBoolPipe) includeDisabled = false) {
    return this.service.levels(brandId, await this.actor(req), includeDisabled)
  }

  @Get('customer-levels/readiness')
  @RequirePermissions('customer:manage')
  async levelReadiness(@Req() req: any) { return this.service.levelReadiness(await this.actor(req)) }

  @Post('customer-levels')
  @RequirePermissions('customer:manage')
  async createLevel(@Body() dto: CreateCustomerLevelDto, @Req() req: any) { return this.service.createLevel(dto, await this.actor(req)) }

  @Patch('customer-levels/:id')
  @RequirePermissions('customer:manage')
  async updateLevel(@Param('id', ParseIntPipe) id: number, @Body() dto: UpdateCustomerLevelDto, @Req() req: any) { return this.service.updateLevel(id, dto, await this.actor(req)) }

  @Get('customer-price-rules')
  @ApiQuery({ name: 'customerId', required: true })
  @RequirePermissions('customer:manage')
  async priceRules(@Query('customerId', ParseIntPipe) customerId: number, @Req() req: any) { return this.service.priceRules(customerId, await this.actor(req)) }

  @Post('customer-price-rules')
  @RequirePermissions('customer:manage')
  async createPriceRule(@Body() dto: CreatePriceRuleDto, @Req() req: any) { return this.service.createPriceRule(dto, await this.actor(req)) }

  @Delete('customer-price-rules/:id')
  @RequirePermissions('customer:manage')
  async deletePriceRule(@Param('id', ParseIntPipe) id: number, @Req() req: any) { return this.service.deletePriceRule(id, await this.actor(req)) }

  @Get('customers/:id/repayments')
  @RequirePermissions('customer:manage')
  @ApiOperation({ summary: '客户还款记录' })
  async repayments(@Param('id', ParseIntPipe) id: number, @Req() req: any) { return this.service.repayments(id, await this.actor(req)) }

  @Post('customers/:id/repayments')
  @RequirePermissions('customer:manage')
  @ApiOperation({ summary: '登记客户还款' })
  async createRepayment(@Param('id', ParseIntPipe) id: number, @Body() dto: CreateRepaymentDto, @Req() req: any) {
    return this.service.createRepayment(id, dto, Number(req.user?.sub), await this.actor(req))
  }
}
