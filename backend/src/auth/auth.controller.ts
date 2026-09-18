import { Controller, Post, Get, Body, Req, UseGuards, Ip } from '@nestjs/common'
import { ApiTags, ApiOperation, ApiBearerAuth } from '@nestjs/swagger'
import { AuthService } from './auth.service'
import { SendCodeDto } from './dto/send-code.dto'
import { LoginDto } from './dto/login.dto'
import { RefreshTokenDto } from './dto/refresh-token.dto'
import { JwtAuthGuard } from './auth.guard'

@ApiTags('auth')
@Controller('auth')
export class AuthController {
  constructor(private readonly auth: AuthService) {}

  @Post('send-code')
  @ApiOperation({ summary: '发送登录验证码' })
  async sendCode(@Body() dto: SendCodeDto, @Ip() ip: string) {
    return this.auth.sendCode(dto.phone, ip)
  }

  @Post('check-status')
  @ApiOperation({ summary: '查询注册审核状态（公开接口，无鉴权）' })
  async checkStatus(@Body('phone') phone: string) {
    return this.auth.checkStatus(phone)
  }

  @Post('register-or-login')
  @ApiOperation({ summary: '小程序注册或登录（新用户自动注册）' })
  async registerOrLogin(@Body() dto: LoginDto & { customerName?: string; contactName?: string; province?: string; city?: string; district?: string; address?: string }) {
    return this.auth.registerOrLogin(dto)
  }

  @Post('login')
  @ApiOperation({ summary: '验证码登录（管理后台用）' })
  async login(@Body() dto: LoginDto) {
    return this.auth.login(dto)
  }

  @Post('refresh-token')
  @ApiOperation({ summary: '刷新令牌' })
  async refreshToken(@Body() dto: RefreshTokenDto) {
    return this.auth.refreshToken(dto.refreshToken)
  }

  @Post('logout')
  @UseGuards(JwtAuthGuard) @ApiBearerAuth()
  @ApiOperation({ summary: '退出登录' })
  async logout(@Req() req: any) { return this.auth.logout(req.user.sub) }

  @Post('bind-openid')
  @UseGuards(JwtAuthGuard) @ApiBearerAuth()
  @ApiOperation({ summary: '绑定微信 openid（小程序 code2session）' })
  async bindOpenid(@Body() body: { code: string }, @Req() req: any) {
    return this.auth.bindOpenid(body.code, req.user.sub)
  }

  @Get('subscribe-template')
  @UseGuards(JwtAuthGuard) @ApiBearerAuth()
  @ApiOperation({ summary: '获取订阅消息模板 ID' })
  async subscribeTemplate() { return this.auth.getSubscribeTemplate() }

  @Get('profile')
  @UseGuards(JwtAuthGuard) @ApiBearerAuth()
  @ApiOperation({ summary: '获取当前用户信息' })
  async profile(@Req() req: any) { return this.auth.getProfile(req.user.sub) }
}
