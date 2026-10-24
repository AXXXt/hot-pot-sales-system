import { BadRequestException, ForbiddenException, HttpException, Inject, Injectable, Logger, ServiceUnavailableException, UnauthorizedException } from '@nestjs/common'
import { Prisma } from '@prisma/client'
import Redis from 'ioredis'
import { createHash, randomBytes, randomUUID } from 'node:crypto'
import { PrismaService } from '../prisma.service'
import { REDIS } from '../redis.provider'
import { AuditService } from '../audit/audit.service'
import { AuthService } from './auth.service'
import { hashPassword, verifyPassword } from './password-hash'
import { getAuditContext } from '../audit/audit-context'
import { ConsentInputDto } from '../legal/consent.dto'
import { assertLegalConsent, recordLegalConsent } from '../legal/legal-consent'

const TTL = 15 * 60
const digest = (value: string) => createHash('sha256').update(value).digest('hex')
const rateScript = `-- staff-password-rate
local current = tonumber(redis.call('GET', KEYS[1]) or '0')
if current >= tonumber(ARGV[1]) then return 0 end
local count = redis.call('INCR', KEYS[1])
if count == 1 then redis.call('EXPIRE', KEYS[1], ARGV[2]) end
return 1`
const issueScript = `-- staff-password-issue
redis.call('SET', KEYS[1], ARGV[1], 'EX', ARGV[3])
redis.call('SET', KEYS[2], ARGV[2], 'EX', ARGV[3])
return 1`
const consumeScript = `-- staff-password-consume
local payload = redis.call('GET', KEYS[1])
if not payload or redis.call('GET', KEYS[2]) ~= ARGV[1] then return nil end
redis.call('DEL', KEYS[1], KEYS[2])
return payload`

type SetupTicket = { userId: number; tenantId: number; version: number }

@Injectable()
export class PasswordService {
  private readonly logger = new Logger(PasswordService.name)
  constructor(
    private readonly prisma: PrismaService,
    private readonly auth: AuthService,
    private readonly audit: AuditService,
    @Inject(REDIS) private readonly redis: Redis
  ) {}

  private badLogin() { return new UnauthorizedException({ message: '账号或密码错误，或账号暂不可用', errorCode: 'AUTH_PASSWORD_INVALID' }) }
  private badLink() { return new BadRequestException({ message: '密码设置链接无效或已过期，请联系超级管理员重新生成', errorCode: 'AUTH_PASSWORD_LINK_INVALID' }) }
  private activeStaff(user: any) { return user?.status === 'active' && user.tenant?.status === 'active' && user.userType !== 'customer_user' && !user.customerId }
  private userKey(id: number) { return `staff:password:link-user:${id}` }
  private ticketKey(hash: string) { return `staff:password:link:${hash}` }

  private async shared<T>(operation: () => Promise<T>): Promise<T> {
    try { return await operation() } catch (error) {
      if (error instanceof HttpException) throw error
      throw new ServiceUnavailableException('登录服务暂不可用，请稍后重试')
    }
  }

  private async limit(scope: string, value: string, max: number) {
    const key = `staff:password:rate:${scope}:${digest(value)}`
    const accepted = await this.shared(() => this.redis.eval(rateScript, 1, key, max, TTL))
    if (Number(accepted) !== 1) throw new HttpException({ message: '尝试次数过多，请15分钟后重试', errorCode: 'AUTH_PASSWORD_RATE_LIMIT' }, 429)
    return key
  }

  async login(phone: string, password: string, ip: string, consent?: ConsentInputDto) {
    assertLegalConsent(consent, ['admin_web'])
    await this.limit('login-ip', ip, 30)
    const accountKey = await this.limit('login-account', phone, 5)
    const user = await this.prisma.user.findUnique({ where: { phone }, include: { tenant: true, customer: true, staffCredential: true } })
    const valid = await verifyPassword(password, user?.staffCredential?.passwordHash)
    if (!valid || !this.activeStaff(user)) throw this.badLogin()
    await this.shared(() => this.redis.del(accountKey))
    await recordLegalConsent(this.prisma, consent!, { tenantId: user!.tenantId, userId: user!.id })
    const result = await this.auth.generateTokens(user, false, user!.staffCredential!.version)
    await this.audit.write({ tenantId: user!.tenantId, operatorId: user!.id, action: 'login', module: 'auth', targetType: 'user', targetId: user!.id, afterData: { method: 'password' } })
    return result
  }

  async issueSetupLink(actorId: number, userId: number) {
    const actor = await this.prisma.user.findUnique({ where: { id: actorId }, include: { tenant: true } })
    if (!this.activeStaff(actor) || actor!.userType !== 'super_admin') throw new ForbiddenException('仅超级管理员可生成密码设置链接')
    const user = await this.prisma.user.findUnique({ where: { id: userId }, include: { tenant: true, staffCredential: { select: { version: true } } } })
    if (!this.activeStaff(user) || user!.tenantId !== actor!.tenantId) throw new ForbiddenException('只能为当前租户的有效后台人员设置密码')
    const token = randomBytes(32).toString('base64url')
    const hash = digest(token)
    const ticket: SetupTicket = { userId, tenantId: user!.tenantId, version: user!.staffCredential?.version || 0 }
    await this.shared(() => this.redis.eval(issueScript, 2, this.ticketKey(hash), this.userKey(userId), JSON.stringify(ticket), hash, TTL))
    await this.audit.write({ tenantId: actor!.tenantId, operatorId: actorId, action: 'create', module: 'auth', targetType: 'password_setup_link', targetId: userId, afterData: { expiresInSeconds: TTL } })
    return { path: `/password/setup#token=${token}`, expiresAt: new Date(Date.now() + TTL * 1000).toISOString() }
  }

  private async ticket(token: string): Promise<{ hash: string; ticket: SetupTicket }> {
    if (!/^[A-Za-z0-9_-]{43}$/.test(token)) throw this.badLink()
    const hash = digest(token)
    const raw = await this.shared(() => this.redis.get(this.ticketKey(hash)))
    if (!raw) throw this.badLink()
    let ticket: SetupTicket
    try { ticket = JSON.parse(raw) } catch { throw this.badLink() }
    if (!Number.isSafeInteger(ticket.userId) || !Number.isSafeInteger(ticket.version)) throw this.badLink()
    if (await this.shared(() => this.redis.get(this.userKey(ticket.userId))) !== hash) throw this.badLink()
    return { hash, ticket }
  }

  async setupInfo(token: string, ip: string) {
    await this.limit('setup-info-ip', ip, 60)
    const { ticket } = await this.ticket(token)
    const user = await this.prisma.user.findUnique({ where: { id: ticket.userId }, include: { tenant: true, staffCredential: { select: { version: true } } } })
    if (!this.activeStaff(user) || user!.tenantId !== ticket.tenantId || (user!.staffCredential?.version || 0) !== ticket.version) throw this.badLink()
    return { name: user!.name, account: user!.phone.replace(/^(\d{3})\d{4}(\d{4})$/, '$1****$2') }
  }

  private assertPassword(password: string) {
    if (typeof password !== 'string' || [...password].length < 15 || [...password].length > 128 || !/\S/.test(password)) throw new BadRequestException('密码须为15～128个字符，可使用长句，区分大小写')
  }

  private async savePassword(ticket: SetupTicket, passwordHash: string) {
    const ctx = getAuditContext()
    await this.prisma.$transaction(async tx => {
      await tx.$queryRaw(Prisma.sql`SELECT id FROM users WHERE id = ${ticket.userId} FOR UPDATE`)
      const user = await tx.user.findUnique({ where: { id: ticket.userId }, include: { tenant: true, staffCredential: { select: { version: true } } } })
      if (!this.activeStaff(user) || user!.tenantId !== ticket.tenantId || (user!.staffCredential?.version || 0) !== ticket.version ||
        (ctx?.tenantId !== undefined && ctx.tenantId !== ticket.tenantId)) throw this.badLink()
      await tx.staffCredential.upsert({ where: { userId: ticket.userId }, create: { userId: ticket.userId, passwordHash }, update: { passwordHash, version: { increment: 1 } } })
      await tx.auditLog.create({ data: { tenantId: ticket.tenantId, operatorId: ticket.userId, action: 'update', module: 'auth',
        targetType: 'staff_password', targetId: String(ticket.userId), afterData: { configured: true, sessionsRevoked: true },
        requestId: ctx?.requestId || `password-${randomUUID()}`, ipAddress: ctx?.ip ?? null, userAgent: ctx?.userAgent ?? null } })
    })
    // JWT credential versions also invalidate access tokens, including during a Redis failure.
    try { await this.redis.del(`refresh:${ticket.userId}`, this.userKey(ticket.userId)) } catch {
      // Never log the cache error: providers may attach connection credentials or command arguments.
      this.logger.warn('密码已更新，旧会话缓存清理暂不可用；凭据版本校验仍生效')
    }
  }

  async setup(token: string, password: string, ip: string) {
    await this.limit('setup-ip', ip, 10)
    this.assertPassword(password)
    const { hash, ticket } = await this.ticket(token)
    const encoded = await hashPassword(password)
    const claimed = await this.shared(() => this.redis.eval(consumeScript, 2, this.ticketKey(hash), this.userKey(ticket.userId), hash))
    if (!claimed) throw this.badLink()
    await this.savePassword(ticket, encoded)
    return { configured: true }
  }

  async change(userId: number, currentPassword: string, password: string, ip: string) {
    await this.limit('change-ip', ip, 30)
    await this.limit('change-account', String(userId), 5)
    this.assertPassword(password)
    const user = await this.prisma.user.findUnique({ where: { id: userId }, include: { tenant: true, staffCredential: true } })
    if (!this.activeStaff(user) || !await verifyPassword(currentPassword, user?.staffCredential?.passwordHash)) throw this.badLogin()
    await this.savePassword({ userId, tenantId: user!.tenantId, version: user!.staffCredential!.version }, await hashPassword(password))
    return { configured: true }
  }
}
