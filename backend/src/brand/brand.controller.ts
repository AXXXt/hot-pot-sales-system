import { BadRequestException, Body, Controller, Delete, Get, Param, ParseIntPipe, Patch, Post, Query, Req, UseGuards } from '@nestjs/common'
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger'
import { JwtAuthGuard } from '../auth/auth.guard'
import { PermissionsGuard } from '../auth/permissions.guard'
import { RequirePermissions } from '../auth/require-permissions.decorator'
import { BrandService } from './brand.service'
import { CreateBrandDto, UpdateBrandDto } from './dto/brand.dto'

@ApiTags('brand-management')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, PermissionsGuard)
@Controller('admin/brands')
@RequirePermissions('brand:manage')
export class BrandController {
  constructor(private readonly brands: BrandService) {}

  @Get()
  @ApiOperation({ summary: '品牌管理列表' })
  list(@Req() request: any, @Query('status') status?: string) {
    if (status && !['active', 'disabled'].includes(status)) {
      throw new BadRequestException({ message: '无效品牌状态', errorCode: 'BRD_1003' })
    }
    return this.brands.list(request.user?.tenantId || 1, status as 'active' | 'disabled' | undefined)
  }

  @Get('code-suggestion')
  @ApiOperation({ summary: '生成品牌编码前缀建议' })
  suggestCode(@Query('name') name: string) {
    return this.brands.suggestCode(name || '')
  }

  @Post()
  @ApiOperation({ summary: '创建品牌' })
  create(@Req() request: any, @Body() dto: CreateBrandDto) {
    return this.brands.create(request.user?.tenantId || 1, dto)
  }

  @Patch(':id')
  @ApiOperation({ summary: '编辑品牌' })
  update(@Req() request: any, @Param('id', ParseIntPipe) id: number, @Body() dto: UpdateBrandDto) {
    return this.brands.update(request.user?.tenantId || 1, id, dto)
  }

  @Delete(':id')
  @ApiOperation({ summary: '安全删除品牌' })
  delete(@Req() request: any, @Param('id', ParseIntPipe) id: number) {
    return this.brands.delete(request.user?.tenantId || 1, id)
  }

  @Patch(':id/restore')
  @ApiOperation({ summary: '恢复品牌' })
  restore(@Req() request: any, @Param('id', ParseIntPipe) id: number) {
    return this.brands.restore(request.user?.tenantId || 1, id)
  }
}
