import { Body, Controller, Get, Param, ParseIntPipe, Patch, Post, Query, Req, UseGuards, DefaultValuePipe } from '@nestjs/common'
import { ApiBearerAuth, ApiOperation, ApiQuery, ApiTags } from '@nestjs/swagger'
import { LeadService } from './lead.service'
import { CreateFollowUpDto, CreatePublicLeadDto, UpdateLeadDto } from './dto/lead.dto'
import { JwtAuthGuard } from '../auth/auth.guard'
import { PermissionsGuard } from '../auth/permissions.guard'
import { RequirePermissions } from '../auth/require-permissions.decorator'
import { StaffAccessService } from '../auth/staff-access.service'

@ApiTags('leads')
@Controller()
export class LeadController {
  constructor(private readonly service: LeadService, private readonly access: StaffAccessService) {}

  private actor(req: any) { return this.access.actor(Number(req.user?.sub)) }

  /** 官网公开留资入口（无需登录） */
  @Post('leads/public')
  @ApiOperation({ summary: '官网留资提交（公开）' })
  async submitPublic(
    @Body() dto: CreatePublicLeadDto,
    @Req() req: any
  ) {
    const ip = (req.headers?.['x-forwarded-for'] as string)?.split(',')[0]?.trim() || req.ip || ''
    return this.service.submitPublicLead(dto, ip, req.headers?.['user-agent'])
  }

  @Get('leads/stats')
  @ApiOperation({ summary: '线索状态统计（新线索提醒）' })
  @RequirePermissions('lead:read')
  @UseGuards(JwtAuthGuard, PermissionsGuard)
  @ApiBearerAuth()
  async stats(@Req() req: any) {
    return this.service.stats(await this.actor(req))
  }

  @Get('leads/assignees')
  @ApiOperation({ summary: '可分配跟进人列表' })
  @RequirePermissions('lead:read')
  @UseGuards(JwtAuthGuard, PermissionsGuard)
  @ApiBearerAuth()
  async assignees(@Req() req: any) {
    return this.service.assignees(await this.actor(req))
  }

  @Get('leads')
  @ApiOperation({ summary: '线索列表' })
  @ApiQuery({ name: 'status', required: false })
  @ApiQuery({ name: 'keyword', required: false })
  @ApiQuery({ name: 'assignedToId', required: false, type: Number })
  @ApiQuery({ name: 'page', required: false, type: Number })
  @ApiQuery({ name: 'pageSize', required: false, type: Number })
  @RequirePermissions('lead:read')
  @UseGuards(JwtAuthGuard, PermissionsGuard)
  @ApiBearerAuth()
  async list(
    @Req() req: any,
    @Query('status') status?: string,
    @Query('keyword') keyword?: string,
    @Query('assignedToId') assignedToId?: string,
    @Query('page', new DefaultValuePipe(1), ParseIntPipe) page: number = 1,
    @Query('pageSize', new DefaultValuePipe(10), ParseIntPipe) pageSize: number = 10
  ) {
    return this.service.list({
      status,
      keyword,
      assignedToId: assignedToId ? parseInt(assignedToId, 10) : undefined,
      page,
      pageSize
    }, await this.actor(req))
  }

  @Get('leads/conversion-customers')
  @ApiOperation({ summary: '搜索可关联转化的已开户客户，不自动开户或开通登录权限' })
  @RequirePermissions('lead:manage')
  @UseGuards(JwtAuthGuard, PermissionsGuard)
  @ApiBearerAuth()
  async conversionCustomers(@Req() req: any, @Query('keyword') keyword?: string) {
    return this.service.conversionCustomers(keyword, await this.actor(req))
  }

  @Get('leads/:id')
  @ApiOperation({ summary: '线索详情（含跟进记录）' })
  @RequirePermissions('lead:read')
  @UseGuards(JwtAuthGuard, PermissionsGuard)
  @ApiBearerAuth()
  async detail(@Param('id', ParseIntPipe) id: number, @Req() req: any) {
    return this.service.detail(id, await this.actor(req))
  }

  @Patch('leads/:id')
  @ApiOperation({ summary: '更新线索（状态/跟进人/备注/下次跟进）' })
  @RequirePermissions('lead:manage')
  @UseGuards(JwtAuthGuard, PermissionsGuard)
  @ApiBearerAuth()
  async update(
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: UpdateLeadDto,
    @Req() req: any
  ) {
    return this.service.update(id, dto, Number(req.user?.sub), await this.actor(req))
  }

  @Post('leads/:id/follow-ups')
  @ApiOperation({ summary: '添加跟进记录' })
  @RequirePermissions('lead:manage')
  @UseGuards(JwtAuthGuard, PermissionsGuard)
  @ApiBearerAuth()
  async addFollowUp(
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: CreateFollowUpDto,
    @Req() req: any
  ) {
    return this.service.addFollowUp(id, dto, Number(req.user?.sub), await this.actor(req))
  }
}
