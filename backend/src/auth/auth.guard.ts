import { Injectable, CanActivate, ExecutionContext, UnauthorizedException } from '@nestjs/common'
import { JwtService } from '@nestjs/jwt'
import { ConfigService } from '@nestjs/config'
import { PrismaService } from '../prisma.service'

async function ensureActiveUser(prisma: PrismaService, userId: number) {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { status: true, customer: { select: { status: true } } }
  })
  if (!user || user.status !== 'active' || (user.customer && user.customer.status !== 'active')) {
    throw new UnauthorizedException({ message: '账号不存在或已禁用', errorCode: 'AUTH_3005' })
  }
}

@Injectable()
export class JwtAuthGuard implements CanActivate {
  constructor(
    private readonly jwt: JwtService,
    private readonly config: ConfigService,
    private readonly prisma: PrismaService
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest()
    const authHeader = request.headers?.authorization
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      throw new UnauthorizedException({ message: '未登录', errorCode: 'AUTH_3005' })
    }

    let payload: any
    try {
      payload = this.jwt.verify(authHeader.slice(7), {
        secret: this.config.get<string>('JWT_ACCESS_SECRET')
      })
    } catch {
      throw new UnauthorizedException({ message: '令牌无效或已过期', errorCode: 'AUTH_3005' })
    }

    await ensureActiveUser(this.prisma, Number(payload.sub))
    request.user = payload
    return true
  }
}

@Injectable()
export class OptionalJwtAuthGuard implements CanActivate {
  constructor(
    private readonly jwt: JwtService,
    private readonly config: ConfigService,
    private readonly prisma: PrismaService
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest()
    const authHeader = request.headers?.authorization
    if (!authHeader || !authHeader.startsWith('Bearer ')) return true

    let payload: any
    try {
      payload = this.jwt.verify(authHeader.slice(7), {
        secret: this.config.get<string>('JWT_ACCESS_SECRET')
      })
    } catch {
      throw new UnauthorizedException({ message: '令牌无效或已过期', errorCode: 'AUTH_3005' })
    }

    await ensureActiveUser(this.prisma, Number(payload.sub))
    request.user = payload
    return true
  }
}
