import { Controller, Get, Param, Query, ParseIntPipe, DefaultValuePipe, UseGuards } from '@nestjs/common'
import { ApiTags, ApiOperation, ApiQuery, ApiBearerAuth } from '@nestjs/swagger'
import { AuditService } from './audit.service'
import { JwtAuthGuard } from '../auth/auth.guard'

@ApiTags('audit-logs')
@Controller()
@UseGuards(JwtAuthGuard)
@ApiBearerAuth()
export class AuditController {
  constructor(private readonly service: AuditService) {}

  @Get('audit-logs')
  @ApiOperation({ summary: '审计日志列表' })
  @ApiQuery({ name: 'operatorId', required: false })
  @ApiQuery({ name: 'module', required: false })
  @ApiQuery({ name: 'action', required: false })
  @ApiQuery({ name: 'page', required: false, type: Number })
  @ApiQuery({ name: 'pageSize', required: false, type: Number })
  async list(
    @Query('operatorId') operatorId?: string,
    @Query('module') module?: string,
    @Query('action') action?: string,
    @Query('page', new DefaultValuePipe(1), ParseIntPipe) page: number = 1,
    @Query('pageSize', new DefaultValuePipe(10), ParseIntPipe) pageSize: number = 10
  ) {
    return this.service.list({
      operatorId: operatorId ? parseInt(operatorId, 10) : undefined,
      module, action, page, pageSize
    })
  }

  @Get('audit-logs/:id')
  @ApiOperation({ summary: '审计日志详情' })
  async detail(@Param('id', ParseIntPipe) id: number) {
    return this.service.detail(id)
  }
}
