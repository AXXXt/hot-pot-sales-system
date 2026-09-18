import { Controller, Get, Post, Patch, Query, Param, Body, ParseIntPipe, DefaultValuePipe, UseGuards, Req } from '@nestjs/common'
import { ApiTags, ApiOperation, ApiQuery, ApiBearerAuth } from '@nestjs/swagger'
import { InventoryService } from './inventory.service'
import { CreateAdjustmentDto, CreateStocktakeDto, UpdateStocktakeItemsDto, CompleteStocktakeDto } from './dto/inventory.dto'
import { JwtAuthGuard } from '../auth/auth.guard'
import { PermissionsGuard } from '../auth/permissions.guard'
import { RequirePermissions } from '../auth/require-permissions.decorator'

@ApiTags('inventory')
@Controller('inventory')
@UseGuards(JwtAuthGuard, PermissionsGuard)
@ApiBearerAuth()
export class InventoryController {
  constructor(private readonly inventory: InventoryService) {}

  @Get('stock')
  @RequirePermissions('inventory:read')
  @ApiOperation({ summary: '库存列表（按SKU）' })
  @ApiQuery({ name: 'keyword', required: false })
  @ApiQuery({ name: 'brandId', required: false, type: Number })
  @ApiQuery({ name: 'categoryId', required: false, type: Number })
  @ApiQuery({ name: 'lowStock', required: false })
  @ApiQuery({ name: 'lowStockThreshold', required: false, type: Number })
  @ApiQuery({ name: 'page', required: false, type: Number })
  @ApiQuery({ name: 'pageSize', required: false, type: Number })
  async stock(
    @Query('keyword') keyword?: string,
    @Query('brandId') brandId?: string,
    @Query('categoryId') categoryId?: string,
    @Query('lowStock') lowStock?: string,
    @Query('lowStockThreshold') lowStockThreshold?: string,
    @Query('page', new DefaultValuePipe(1), ParseIntPipe) page = 1,
    @Query('pageSize', new DefaultValuePipe(10), ParseIntPipe) pageSize = 10
  ) {
    return this.inventory.stock({
      keyword,
      brandId: brandId ? parseInt(brandId, 10) : undefined,
      categoryId: categoryId ? parseInt(categoryId, 10) : undefined,
      lowStock: lowStock === 'true',
      lowStockThreshold: lowStockThreshold ? parseInt(lowStockThreshold, 10) : undefined,
      page,
      pageSize
    })
  }

  @Get('movements')
  @RequirePermissions('inventory:read')
  @ApiOperation({ summary: '库存流水' })
  @ApiQuery({ name: 'skuId', required: false, type: Number })
  @ApiQuery({ name: 'type', required: false })
  @ApiQuery({ name: 'sourceType', required: false })
  @ApiQuery({ name: 'dateFrom', required: false })
  @ApiQuery({ name: 'dateTo', required: false })
  @ApiQuery({ name: 'page', required: false, type: Number })
  @ApiQuery({ name: 'pageSize', required: false, type: Number })
  async movements(
    @Query('skuId') skuId?: string,
    @Query('type') type?: string,
    @Query('sourceType') sourceType?: string,
    @Query('dateFrom') dateFrom?: string,
    @Query('dateTo') dateTo?: string,
    @Query('page', new DefaultValuePipe(1), ParseIntPipe) page = 1,
    @Query('pageSize', new DefaultValuePipe(10), ParseIntPipe) pageSize = 10
  ) {
    return this.inventory.movements({
      skuId: skuId ? parseInt(skuId, 10) : undefined,
      type,
      sourceType,
      dateFrom,
      dateTo,
      page,
      pageSize
    })
  }

  @Get('adjustments')
  @RequirePermissions('inventory:read')
  @ApiOperation({ summary: '手动出入库单列表' })
  @ApiQuery({ name: 'page', required: false, type: Number })
  @ApiQuery({ name: 'pageSize', required: false, type: Number })
  async adjustments(
    @Query('page', new DefaultValuePipe(1), ParseIntPipe) page = 1,
    @Query('pageSize', new DefaultValuePipe(10), ParseIntPipe) pageSize = 10
  ) {
    return this.inventory.adjustments(page, pageSize)
  }

  @Get('adjustments/:id')
  @RequirePermissions('inventory:read')
  @ApiOperation({ summary: '手动出入库单详情' })
  async adjustmentDetail(@Param('id', ParseIntPipe) id: number) {
    return this.inventory.adjustmentDetail(id)
  }

  @Post('adjustments')
  @RequirePermissions('inventory:adjust')
  @ApiOperation({ summary: '创建手动出入库单' })
  async createAdjustment(@Body() dto: CreateAdjustmentDto, @Req() req: any) {
    return this.inventory.createAdjustment(dto, req.user?.sub)
  }

  @Get('stocktakes')
  @RequirePermissions('inventory:read')
  @ApiOperation({ summary: '盘点单列表' })
  @ApiQuery({ name: 'page', required: false, type: Number })
  @ApiQuery({ name: 'pageSize', required: false, type: Number })
  async stocktakes(
    @Query('page', new DefaultValuePipe(1), ParseIntPipe) page = 1,
    @Query('pageSize', new DefaultValuePipe(10), ParseIntPipe) pageSize = 10
  ) {
    return this.inventory.stocktakes(page, pageSize)
  }

  @Get('stocktakes/:id')
  @RequirePermissions('inventory:read')
  @ApiOperation({ summary: '盘点单详情' })
  async stocktakeDetail(@Param('id', ParseIntPipe) id: number) {
    return this.inventory.stocktakeDetail(id)
  }

  @Post('stocktakes')
  @RequirePermissions('inventory:adjust')
  @ApiOperation({ summary: '创建盘点单' })
  async createStocktake(@Body() dto: CreateStocktakeDto, @Req() req: any) {
    return this.inventory.createStocktake(dto, req.user?.sub)
  }

  @Patch('stocktakes/:id/items')
  @RequirePermissions('inventory:adjust')
  @ApiOperation({ summary: '填写/更新盘点实盘数' })
  async updateStocktakeItems(
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: UpdateStocktakeItemsDto,
    @Req() req: any
  ) {
    return this.inventory.updateStocktakeItems(id, dto, req.user?.sub)
  }

  @Post('stocktakes/:id/complete')
  @RequirePermissions('inventory:adjust')
  @ApiOperation({ summary: '完成盘点并生成盘盈盘亏调整' })
  async completeStocktake(
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: CompleteStocktakeDto,
    @Req() req: any
  ) {
    return this.inventory.completeStocktake(id, dto, req.user?.sub)
  }

  @Post('stocktakes/:id/cancel')
  @RequirePermissions('inventory:adjust')
  @ApiOperation({ summary: '取消盘点单' })
  async cancelStocktake(@Param('id', ParseIntPipe) id: number, @Req() req: any) {
    return this.inventory.cancelStocktake(id, req.user?.sub)
  }
}