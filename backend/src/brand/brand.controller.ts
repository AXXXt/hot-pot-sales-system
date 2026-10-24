import { BadRequestException, Body, Controller, Delete, Get, Param, ParseIntPipe, Patch, Post, Query, Req, UseGuards } from '@nestjs/common'
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger'
import { JwtAuthGuard } from '../auth/auth.guard'
import { PermissionsGuard } from '../auth/permissions.guard'
import { RequirePermissions } from '../auth/require-permissions.decorator'
import { BrandService } from './brand.service'
import { CreateBrandDto, UpdateBrandDto } from './dto/brand.dto'
import { StaffAccessService } from '../auth/staff-access.service'

@ApiTags('brand-management')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, PermissionsGuard)
@Controller('admin/brands')
@RequirePermissions('brand:manage')
export class BrandController {
  constructor(private readonly brands: BrandService, private readonly access: StaffAccessService) {}

  @Get()
  @ApiOperation({ summary: '品牌管理列表' })
  async list(@Req() request: any, @Query('status') status?: string) {
    if (status && !['active', 'disabled'].includes(status)) {
      throw new BadRequestException({ message: '无效品牌状态', errorCode: 'BRD_1003' })
    }
    const actor = await this.access.actor(Number(request.user?.sub))
    return this.brands.list(actor.tenantId, status as 'active' | 'disabled' | undefined, actor)
  }

  @Get('code-suggestion')
  @ApiOperation({ summary: '生成品牌编码前缀建议' })
  suggestCode(@Query('name') name: string) {
    return this.brands.suggestCode(name || '')
  }

  @Post()
  @ApiOperation({ summary: '创建品牌' })
  async create(@Req() request: any, @Body() dto: CreateBrandDto) {
    const actor = await this.access.actor(Number(request.user?.sub))
    return this.brands.create(actor.tenantId, dto, actor)
  }

  @Patch(':id')
  @ApiOperation({ summary: '编辑品牌' })
  async update(@Req() request: any, @Param('id', ParseIntPipe) id: number, @Body() dto: UpdateBrandDto) {
    const actor = await this.access.actor(Number(request.user?.sub))
    return this.brands.update(actor.tenantId, id, dto, actor)
  }

  @Delete(':id')
  @ApiOperation({ summary: '安全删除品牌' })
  async delete(@Req() request: any, @Param('id', ParseIntPipe) id: number) {
    const actor = await this.access.actor(Number(request.user?.sub))
    return this.brands.delete(actor.tenantId, id, actor)
  }

  @Patch(':id/restore')
  @ApiOperation({ summary: '恢复品牌' })
  async restore(@Req() request: any, @Param('id', ParseIntPipe) id: number) {
    const actor = await this.access.actor(Number(request.user?.sub))
    return this.brands.restore(actor.tenantId, id, actor)
  }
}
