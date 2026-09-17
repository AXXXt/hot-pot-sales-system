import { BadRequestException, Controller, Get, Post, Patch, Delete, Param, Query, Body, ParseIntPipe, DefaultValuePipe, UseGuards, Req } from '@nestjs/common'
import { ApiTags, ApiOperation, ApiQuery, ApiBearerAuth } from '@nestjs/swagger'
import { ProductService } from './product.service'
import { BatchArchiveProductsDto, BatchUpdateProductStatusDto, CreateProductDto, UpdateProductDto, UpdateProductStatusDto } from './dto/create-product.dto'
import { CreateSkuDto, UpdateSkuDto, UpdateSkuStatusDto } from './dto/create-sku.dto'
import { CreateCategoryDto, UpdateCategoryDto } from './dto/create-category.dto'
import { JwtAuthGuard, OptionalJwtAuthGuard } from '../auth/auth.guard'
import { ValidateCartDto } from './dto/validate-cart.dto'

@ApiTags('products')
@Controller()
export class ProductController {
  constructor(private readonly product: ProductService) {}

  @Get('products')
  @UseGuards(OptionalJwtAuthGuard)
  @ApiOperation({ summary: '商品列表' })
  @ApiQuery({ name: 'brandId', required: false, type: Number })
  @ApiQuery({ name: 'categoryId', required: false })
  @ApiQuery({ name: 'keyword', required: false })
  @ApiQuery({ name: 'feed', required: false, enum: ['frequent', 'new', 'hot'] })
  @ApiQuery({ name: 'sortBy', required: false })
  @ApiQuery({ name: 'inStock', required: false })
  @ApiQuery({ name: 'includeDisabled', required: false })
  @ApiQuery({ name: 'page', required: false, type: Number })
  @ApiQuery({ name: 'pageSize', required: false, type: Number })
  async list(
    @Query('brandId') brandId?: string,
    @Query('categoryId') categoryId?: string,
    @Query('keyword') keyword?: string,
    @Query('feed') feed?: string,
    @Query('sortBy') sortBy?: string,
    @Query('inStock') inStock?: string,
    @Query('includeDisabled') includeDisabled?: string,
    @Query('page', new DefaultValuePipe(1), ParseIntPipe) page: number = 1,
    @Query('pageSize', new DefaultValuePipe(10), ParseIntPipe) pageSize: number = 10,
    @Req() req?: any
  ) {
    const categoryIdNum = categoryId && categoryId !== 'all' ? parseInt(categoryId, 10) : undefined
    const includeDisabledBool = includeDisabled === 'true'
    const brandIdNum = brandId && brandId !== 'all' ? parseInt(brandId, 10) : undefined
    if (brandId && brandId !== 'all' && Number.isNaN(brandIdNum)) throw new BadRequestException('brandId 必须是数字')
    const inStockBool = inStock === 'true' ? true : inStock === 'false' ? false : undefined
    return this.product.list({ brandId: brandIdNum, categoryId: categoryIdNum, keyword, feed, sortBy, inStock: inStockBool, includeDisabled: includeDisabledBool, page, pageSize }, req?.user?.sub)
  }

  @Post('products')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: '创建商品' })
  async create(@Body() dto: CreateProductDto, @Req() req: any) {
    return this.product.create(dto, req.user?.tenantId || 1)
  }

  @Post('products/cart-validation')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: '批量校验购物车商品' })
  async validateCart(@Body() dto: ValidateCartDto, @Req() req: any) {
    return this.product.validateCart(dto.skuIds, req.user.sub)
  }

  @Get('products/:id')
  @UseGuards(OptionalJwtAuthGuard)
  @ApiOperation({ summary: '商品详情' })
  async detail(@Param('id', ParseIntPipe) id: number, @Req() req: any) {
    return this.product.detail(id, req.user?.sub)
  }

  @Patch('products/batch-status')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: '批量更新商品上下架状态' })
  async batchUpdateStatus(@Body() dto: BatchUpdateProductStatusDto) {
    return this.product.batchUpdateStatus(dto.productIds, dto.status)
  }

  @Patch('products/batch-archive')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: '批量安全删除商品' })
  async batchArchiveProducts(@Body() dto: BatchArchiveProductsDto) {
    return this.product.batchArchiveProducts(dto.productIds)
  }

  @Patch('products/:id')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: '更新商品' })
  async update(@Param('id', ParseIntPipe) id: number, @Body() dto: UpdateProductDto, @Req() req: any) {
    return this.product.update(id, dto, req.user?.sub)
  }

  @Patch('products/:id/status')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: '商品上下架' })
  async updateStatus(@Param('id', ParseIntPipe) id: number, @Body() dto: UpdateProductStatusDto) {
    return this.product.updateStatus(id, dto.status)
  }

  @Delete('products/:id')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: '安全删除商品' })
  async archiveProduct(@Param('id', ParseIntPipe) id: number) {
    return this.product.archiveProduct(id)
  }

  @Get('products/:id/skus')
  @UseGuards(OptionalJwtAuthGuard)
  @ApiOperation({ summary: '商品SKU列表' })
  async skus(@Param('id', ParseIntPipe) id: number, @Req() req: any) {
    return this.product.skus(id, req.user?.sub)
  }

  @Post('products/:id/skus')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: '创建SKU' })
  async createSku(@Param('id', ParseIntPipe) id: number, @Body() dto: CreateSkuDto) {
    return this.product.createSku(id, dto)
  }

  @Patch('skus/:id')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: '更新SKU' })
  async updateSku(@Param('id', ParseIntPipe) id: number, @Body() dto: UpdateSkuDto) {
    return this.product.updateSku(id, dto)
  }

  @Patch('skus/:id/status')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'SKU启用/禁用' })
  async updateSkuStatus(@Param('id', ParseIntPipe) id: number, @Body() dto: UpdateSkuStatusDto) {
    return this.product.updateSkuStatus(id, dto.status)
  }

  @Get('product-categories')
  @UseGuards(OptionalJwtAuthGuard)
  @ApiOperation({ summary: '商品分类列表' })
  async categories(@Req() req: any) {
    return this.product.categories(req.user?.sub)
  }

  @Get('admin/product-categories')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: '商品分类管理列表' })
  async managedCategories(@Req() req: any) {
    return this.product.managedCategories(req.user?.tenantId || 1)
  }

  @Post('product-categories')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: '创建分类' })
  async createCategory(@Req() req: any, @Body() dto: CreateCategoryDto) {
    return this.product.createCategory(dto, req.user?.tenantId || 1)
  }

  @Patch('product-categories/:id')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: '更新分类' })
  async updateCategory(@Req() req: any, @Param('id', ParseIntPipe) id: number, @Body() dto: UpdateCategoryDto) {
    return this.product.updateCategory(id, dto, req.user?.tenantId || 1)
  }

  @Delete('product-categories/:id')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: '安全删除分类' })
  async deleteCategory(@Req() req: any, @Param('id', ParseIntPipe) id: number) {
    return this.product.deleteCategory(id, req.user?.tenantId || 1)
  }

  @Patch('admin/product-categories/:id/restore')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: '恢复分类' })
  async restoreCategory(@Req() req: any, @Param('id', ParseIntPipe) id: number) {
    return this.product.restoreCategory(id, req.user?.tenantId || 1)
  }

  @Get('brands')
  @ApiOperation({ summary: '品牌列表' })
  async brands() {
    return this.product.brands()
  }
}
