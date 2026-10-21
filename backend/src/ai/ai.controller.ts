import { Body, Controller, Delete, Get, Param, ParseIntPipe, ParseUUIDPipe, Patch, Post, Query, Req, Res, UploadedFile, UseGuards, UseInterceptors } from '@nestjs/common'
import { FileInterceptor } from '@nestjs/platform-express'
import { randomUUID } from 'node:crypto'
import { Response } from 'express'
import { JwtAuthGuard } from '../auth/auth.guard'
import { RequirePermissions } from '../auth/require-permissions.decorator'
import { StaffActor } from '../auth/staff-access.service'
import { AiAccessGuard } from './ai-access.guard'
import { AiService } from './ai.service'
import { AiSettingsService } from './ai-settings.service'
import { AiDraftService } from './ai-draft.service'
import { AiAttachmentService } from './ai-attachment.service'
import { AiDataService } from './ai-data.service'
import { AiModelService } from './ai-model.service'
import { AiScheduleService } from './ai-schedule.service'
import { AiBrandAccessDto, AiRoleAccessDto, AiRunDto, AiScheduleDto, AiSettingsDto, ConfirmAiDraftDto, TaskStatusDto, UpdateAiDraftDto } from './ai.dto'
import { AiAuthorizationService } from './ai-authorization.service'
import ExcelJS from 'exceljs'
import { ProductImageFile } from '../upload/product-image.validation'
import { PrismaService } from '../prisma.service'

type StaffRequest = { actor: StaffActor }

@Controller('admin/ai')
@UseGuards(JwtAuthGuard, AiAccessGuard)
export class AiController {
  constructor(private readonly service: AiService, private readonly settings: AiSettingsService, private readonly drafts: AiDraftService,
    private readonly attachments: AiAttachmentService, private readonly data: AiDataService, private readonly model: AiModelService,
    private readonly schedules: AiScheduleService, private readonly prisma: PrismaService, private readonly authorization: AiAuthorizationService) {}

  @Get('authorization') @RequirePermissions('ai:configure', 'role:manage')
  authorizationList(@Req() req: StaffRequest) { return this.authorization.list(req.actor) }

  @Patch('authorization/roles/:id') @RequirePermissions('ai:configure', 'role:manage')
  authorizationRole(@Req() req: StaffRequest, @Param('id', ParseIntPipe) id: number, @Body() dto: AiRoleAccessDto) { return this.authorization.role(req.actor, id, dto.codes) }

  @Patch('authorization/users/:id/brands') @RequirePermissions('ai:configure', 'role:manage')
  authorizationBrands(@Req() req: StaffRequest, @Param('id', ParseIntPipe) id: number, @Body() dto: AiBrandAccessDto) { return this.authorization.brands(req.actor, id, dto.brandIds) }

  @Get('report') @RequirePermissions('ai:use', 'analytics:view', 'order:read', 'export:create')
  async report(@Req() req: StaffRequest, @Query('period') period: string | undefined, @Res() res: Response) {
    const metrics = await this.data.metrics(req.actor, period)
    const workbook = new ExcelJS.Workbook()
    const sheet = workbook.addWorksheet('经营统计')
    sheet.addRow(['指标口径', metrics.definition]); sheet.addRow(['时区', metrics.timezone])
    sheet.addRow(['起始时间', metrics.start.toISOString()]); sheet.addRow(['截止时间', metrics.end.toISOString()])
    sheet.addRow(['有效订单金额（元）', metrics.amount]); sheet.addRow(['有效订单数', metrics.orders]); sheet.addRow([])
    sheet.addRow(['商品', '销售单位', '数量', '明细金额（元）'])
    for (const item of metrics.top) sheet.addRow([item.name, item.unit, item.quantity, item.amount])
    sheet.columns.forEach(column => { column.width = 28 })
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet')
    res.setHeader('Content-Disposition', 'attachment; filename="operations-report.xlsx"')
    res.setHeader('Cache-Control', 'private, no-store')
    res.send(Buffer.from(await workbook.xlsx.writeBuffer()))
  }

  @Get('capabilities') @RequirePermissions('ai:use')
  capabilities(@Req() req: StaffRequest) { return this.service.capabilities(req.actor) }

  @Get('conversations') @RequirePermissions('ai:use')
  list(@Req() req: StaffRequest) { return this.service.list(req.actor) }

  @Post('conversations') @RequirePermissions('ai:use')
  create(@Req() req: StaffRequest) { return this.service.create(req.actor) }

  @Get('conversations/:id') @RequirePermissions('ai:use')
  conversation(@Req() req: StaffRequest, @Param('id', ParseUUIDPipe) id: string) { return this.service.conversation(req.actor, id) }

  @Delete('conversations/:id') @RequirePermissions('ai:use')
  archive(@Req() req: StaffRequest, @Param('id', ParseUUIDPipe) id: string) { return this.service.archive(req.actor, id) }

  @Post('conversations/:id/runs') @RequirePermissions('ai:use')
  async run(@Req() req: StaffRequest, @Param('id', ParseUUIDPipe) id: string, @Body() dto: AiRunDto, @Res() res: Response) {
    res.setHeader('Content-Type', 'text/event-stream; charset=utf-8')
    res.setHeader('Cache-Control', 'no-store')
    res.setHeader('X-Accel-Buffering', 'no')
    res.flushHeaders()
    const send = (event: string, data: unknown) => { if (!res.destroyed) res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`) }
    const heartbeat = setInterval(() => { if (!res.destroyed) res.write(': heartbeat\n\n') }, 15000)
    try { send('result', await this.service.run(req.actor, id, dto, text => send('progress', { text }))) }
    catch (error: any) {
      const response = typeof error.getResponse === 'function' ? error.getResponse() : null
      send('error', { message: typeof response === 'string' ? response : response?.message || '处理失败，请检查历史和草稿后重试' })
    } finally { clearInterval(heartbeat); res.end() }
  }

  @Post('attachments') @RequirePermissions('ai:use')
  @UseInterceptors(FileInterceptor('file', { limits: { fileSize: 5 * 1024 * 1024 } }))
  upload(@Req() req: StaffRequest, @UploadedFile() file?: ProductImageFile) { return this.attachments.upload(req.actor, file) }

  @Get('attachments/:id') @RequirePermissions('ai:use')
  async image(@Req() req: StaffRequest, @Param('id', ParseUUIDPipe) id: string, @Res() res: Response) {
    const buffer = await this.attachments.bytes(req.actor, id)
    res.setHeader('Content-Type', 'image/jpeg'); res.setHeader('Cache-Control', 'private, no-store'); res.send(buffer)
  }

  @Get('catalog-options') @RequirePermissions('ai:use', 'product:create')
  options(@Req() req: StaffRequest) { return this.data.options(req.actor) }

  @Patch('drafts/:id') @RequirePermissions('ai:use')
  updateDraft(@Req() req: StaffRequest, @Param('id', ParseUUIDPipe) id: string, @Body() dto: UpdateAiDraftDto) { return this.drafts.update(req.actor, id, dto.version, dto.payload) }

  @Post('drafts/:id/confirm') @RequirePermissions('ai:use', 'ai:execute')
  confirm(@Req() req: StaffRequest, @Param('id', ParseUUIDPipe) id: string, @Body() dto: ConfirmAiDraftDto) { return this.drafts.confirm(req.actor, id, dto.version, dto.digest) }

  @Get('tasks') @RequirePermissions('ai:use', 'task:manage_own')
  tasks(@Req() req: StaffRequest) { return this.data.tasks(req.actor) }

  @Patch('tasks/:id') @RequirePermissions('ai:use', 'task:manage_own')
  async updateTask(@Req() req: StaffRequest, @Param('id', ParseUUIDPipe) id: string, @Body() dto: TaskStatusDto) {
    return this.prisma.$transaction(async tx => {
      const changed = await tx.opsTask.updateMany({ where: { id, tenantId: req.actor.tenantId, ownerId: req.actor.id }, data: { status: dto.status } })
      if (changed.count) await tx.auditLog.create({ data: { tenantId: req.actor.tenantId, operatorId: req.actor.id, action: 'update', module: 'ai', targetType: 'ops_task', targetId: id, requestId: `ai-task-${randomUUID()}`, afterData: { status: dto.status } } })
      return { updated: changed.count }
    })
  }

  @Get('schedules') @RequirePermissions('ai:use', 'task:manage_own')
  scheduleList(@Req() req: StaffRequest) { return this.schedules.list(req.actor) }

  @Post('schedules') @RequirePermissions('ai:use', 'task:manage_own')
  scheduleCreate(@Req() req: StaffRequest, @Body() dto: AiScheduleDto) { return this.schedules.create(req.actor, dto) }

  @Delete('schedules/:id') @RequirePermissions('ai:use', 'task:manage_own')
  disableSchedule(@Req() req: StaffRequest, @Param('id', ParseUUIDPipe) id: string) {
    return this.prisma.aiSchedule.updateMany({ where: { id, tenantId: req.actor.tenantId, ownerId: req.actor.id }, data: { enabled: false } })
  }

  @Get('settings') @RequirePermissions('ai:configure')
  getSettings(@Req() req: StaffRequest) { return this.settings.publicSettings(req.actor) }

  @Patch('settings') @RequirePermissions('ai:configure')
  saveSettings(@Req() req: StaffRequest, @Body() dto: AiSettingsDto) { return this.settings.save(req.actor, dto) }

  @Post('settings/test') @RequirePermissions('ai:configure')
  async testSettings(@Req() req: StaffRequest) {
    const response = await this.model.complete(req.actor, [{ role: 'user', content: '仅回复：连接成功' }], [])
    return { ok: true, message: response.content?.slice(0, 100), note: '已验证文本连接；图片识别和业务工具请使用代表样本验证' }
  }

  @Get('usage') @RequirePermissions('ai:usage:read')
  async usage(@Req() req: StaffRequest) {
    const records = await this.prisma.aiUsageRecord.findMany({ where: { tenantId: req.actor.tenantId, ownerId: req.actor.id }, orderBy: { createdAt: 'desc' }, take: 100 })
    return { records, note: '仅显示本人最近100次调用；费用以供应商账单为准' }
  }
}
