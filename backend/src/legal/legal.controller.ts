import { Body, Controller, Get, Post, Req, UseGuards } from '@nestjs/common'
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger'
import { PrismaService } from '../prisma.service'
import { JwtAuthGuard } from '../auth/auth.guard'
import { ConsentInputDto } from './consent.dto'
import { assertLegalConsent, LEGAL_DOCUMENT_HASH, LEGAL_VERSION, recordLegalConsent } from './legal-consent'
import { currentLegalPolicy } from './legal-policy'

@ApiTags('legal')
@Controller('legal')
export class LegalController {
  constructor(private readonly prisma: PrismaService) {}

  @Get('current')
  @ApiOperation({ summary: '公开读取当前协议版本和内容' })
  current() { return { ...currentLegalPolicy, documentHash: LEGAL_DOCUMENT_HASH } }

  @Get('consent')
  @UseGuards(JwtAuthGuard) @ApiBearerAuth()
  async consent(@Req() req: any) {
    const record = await this.prisma.legalConsent.findFirst({
      where: { tenantId: Number(req.user.tenantId), userId: Number(req.user.sub), version: LEGAL_VERSION, documentHash: LEGAL_DOCUMENT_HASH },
      select: { acceptedAt: true }, orderBy: { acceptedAt: 'desc' }
    })
    return { version: LEGAL_VERSION, documentHash: LEGAL_DOCUMENT_HASH, accepted: Boolean(record), acceptedAt: record?.acceptedAt || null }
  }

  @Post('consent')
  @UseGuards(JwtAuthGuard) @ApiBearerAuth()
  @ApiOperation({ summary: '已登录用户主动确认当前协议，不追溯补造历史记录' })
  async accept(@Body() dto: ConsentInputDto, @Req() req: any) {
    assertLegalConsent(dto)
    await recordLegalConsent(this.prisma, dto, { tenantId: Number(req.user.tenantId), userId: Number(req.user.sub) })
    return this.consent(req)
  }
}
