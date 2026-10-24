import { Injectable, CanActivate, ExecutionContext, UnauthorizedException, ForbiddenException } from '@nestjs/common'
import { JwtService } from '@nestjs/jwt'
import { ConfigService } from '@nestjs/config'
import { PrismaService } from '../prisma.service'
import { setAuditIdentity } from '../audit/audit-context'
import { hasMismatchedCustomerTenant } from './customer-tenant'
import { AuthSessionService } from './auth-session.service'

async function ensureActiveUser(prisma: PrismaService, userId: number, credentialVersion = 0, tokenTenantId?: number) {
  if (!Number.isSafeInteger(userId) || userId <= 0) throw new UnauthorizedException({ message: '账号无效', errorCode: 'AUTH_3005' })
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { tenantId: true, tenant: { select: { status: true } }, status: true, customer: { select: { status: true, tenantId: true } }, staffCredential: { select: { version: true } } }
  })
  if (!user || user.status !== 'active' || hasMismatchedCustomerTenant(user) || (user.customer && user.customer.status !== 'active') || credentialVersion !== (user.staffCredential?.version || 0)) {
    throw new UnauthorizedException({ message: '账号不存在或已禁用', errorCode: 'AUTH_3005' })
  }
  if (user.tenant && user.tenant.status !== 'active') throw new ForbiddenException({ message: '账号暂不可用，请联系管理员', errorCode: 'AUTH_TENANT_DISABLED' })
  if (Number.isSafeInteger(user.tenantId) && user.tenantId > 0 && tokenTenantId !== user.tenantId) {
    throw new UnauthorizedException({ message: '账号归属已变化，请重新登录', errorCode: 'AUTH_3005' })
  }
  return user
}

@Injectable()
export class JwtAuthGuard implements CanActivate {
  constructor(
    private readonly jwt: JwtService,
    private readonly config: ConfigService,
    private readonly prisma: PrismaService,
    private readonly sessions: AuthSessionService
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    setAuditIdentity()
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

    if (payload.tokenUse !== undefined && payload.tokenUse !== 'access') throw new UnauthorizedException('令牌用途不匹配')

    const user = await ensureActiveUser(this.prisma, Number(payload.sub), Number(payload.cv || 0), Number(payload.tenantId))
    await this.sessions.assertActive({ sub: Number(payload.sub), sid: payload.sid })
    request.user = payload
    setAuditIdentity(Number(payload.sub), user.tenantId)
    return true
  }
}

@Injectable()
export class OptionalJwtAuthGuard implements CanActivate {
  constructor(
    private readonly jwt: JwtService,
    private readonly config: ConfigService,
    private readonly prisma: PrismaService,
    private readonly sessions: AuthSessionService
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    setAuditIdentity()
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

    if (payload.tokenUse !== undefined && payload.tokenUse !== 'access') throw new UnauthorizedException('令牌用途不匹配')

    const user = await ensureActiveUser(this.prisma, Number(payload.sub), Number(payload.cv || 0), Number(payload.tenantId))
    await this.sessions.assertActive({ sub: Number(payload.sub), sid: payload.sid })
    request.user = payload
    setAuditIdentity(Number(payload.sub), user.tenantId)
    return true
  }
}
