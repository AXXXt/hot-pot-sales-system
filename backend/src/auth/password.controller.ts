import { Body, Controller, Ip, Post, Req, UseGuards } from '@nestjs/common'
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger'
import { JwtAuthGuard } from './auth.guard'
import { PasswordService } from './password.service'
import { ChangePasswordDto, PasswordLoginDto, PasswordSetupLinkDto, PasswordTokenDto, SetPasswordDto } from './dto/password.dto'

@ApiTags('auth')
@Controller('auth/password')
export class PasswordController {
  constructor(private readonly passwords: PasswordService) {}

  @Post('login')
  @ApiOperation({ summary: '后台人员账号密码登录' })
  login(@Body() dto: PasswordLoginDto, @Ip() ip: string) { return this.passwords.login(dto.phone, dto.password, ip, dto) }

  @Post('setup-info')
  setupInfo(@Body() dto: PasswordTokenDto, @Ip() ip: string) { return this.passwords.setupInfo(dto.token, ip) }

  @Post('setup')
  setup(@Body() dto: SetPasswordDto, @Ip() ip: string) { return this.passwords.setup(dto.token, dto.password, ip) }

  @Post('setup-links')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: '超级管理员为已有后台人员生成一次性密码设置链接' })
  issue(@Body() dto: PasswordSetupLinkDto, @Req() req: any) { return this.passwords.issueSetupLink(Number(req.user.sub), dto.userId) }

  @Post('change')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  change(@Body() dto: ChangePasswordDto, @Req() req: any, @Ip() ip: string) { return this.passwords.change(Number(req.user.sub), dto.currentPassword, dto.password, ip) }
}
