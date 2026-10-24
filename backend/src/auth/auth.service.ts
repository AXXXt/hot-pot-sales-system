import { BadRequestException, ConflictException, Injectable, UnauthorizedException, ForbiddenException, HttpException, ServiceUnavailableException } from '@nestjs/common'
import { JwtService } from '@nestjs/jwt'
import { ConfigService } from '@nestjs/config'
import { PrismaService } from '../prisma.service'
import { SmsService } from './sms.service'
import { LoginDto } from './dto/login.dto'
import { REDIS } from '../redis.provider'
import { Inject } from '@nestjs/common'
import { WxService } from '../notify/wx.service'
import { bindVerifiedWechat } from './wechat-binding'
import { createHash, randomUUID } from 'node:crypto'
import { registrationDecisionWhere, reviewStatusFromState } from './registration-review'
import { hasMismatchedCustomerTenant } from './customer-tenant'
import { Prisma } from '@prisma/client'
import { AuthSessionService, SessionRedis } from './auth-session.service'
import { ConsentInputDto } from '../legal/consent.dto'
import { assertLegalConsent, recordLegalConsent } from '../legal/legal-consent'
import { currentLegalPolicy } from '../legal/legal-policy'

@Injectable()
export class AuthService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly jwt: JwtService,
    private readonly config: ConfigService,
    private readonly sms: SmsService,
    private readonly wx: WxService,
    @Inject(REDIS) private readonly redis: SessionRedis,
    private readonly sessions: AuthSessionService = new AuthSessionService(redis)
  ) {}

  async sendCode(phone: string, ip: string, purpose?: 'login' | 'register') {
    await this.sms.sendCode(phone, ip, purpose)
    return { sent: true }
  }

  private issueStatusTicket(userId: number, tenantId: number, phone: string) {
    return this.jwt.sign({ sub: userId, tenantId, ph: createHash('sha256').update(phone).digest('hex'), tokenUse: 'registration_status', jti: randomUUID() }, {
      secret: this.config.get<string>('JWT_REFRESH_SECRET'), expiresIn: '24h'
    })
  }

  // A phone number alone must not disclose whether an account/application exists.
  async checkStatus(phone: string, statusTicket?: string) {
    if (!statusTicket) return { verificationRequired: true }
    let ticket: { sub: number; tenantId: number; ph: string; tokenUse: string }
    try {
      ticket = this.jwt.verify(statusTicket, { secret: this.config.get<string>('JWT_REFRESH_SECRET') })
      if (ticket.tokenUse !== 'registration_status' || !Number.isSafeInteger(ticket.sub) || ticket.sub <= 0 ||
        !Number.isSafeInteger(ticket.tenantId) || ticket.tenantId <= 0 || ticket.ph !== createHash('sha256').update(phone).digest('hex')) throw new Error('Invalid status subject')
    } catch { throw new UnauthorizedException({ message: '申请查询凭证已过期，请重新验证手机号', errorCode: 'AUTH_STATUS_TICKET_EXPIRED' }) }
    const key = `auth:status-rate:${createHash('sha256').update(statusTicket).digest('hex')}`
    let count: unknown
    try {
      count = await (this.redis as SessionRedis).eval(`-- auth-status-rate-v1
local count = redis.call('INCR', KEYS[1])
if redis.call('TTL', KEYS[1]) < 0 then redis.call('EXPIRE', KEYS[1], 3600) end
return count`, 1, key)
    } catch { throw new ServiceUnavailableException({ message: '申请查询暂不可用，请稍后重试', errorCode: 'AUTH_STATUS_UNAVAILABLE' }) }
    if (typeof count !== 'number' || !Number.isSafeInteger(count) || count < 1) throw new ServiceUnavailableException('申请查询暂不可用，请稍后重试')
    if (count > 120) throw new HttpException({ message: '查询过于频繁，请稍后重试', errorCode: 'AUTH_STATUS_RATE_LIMIT' }, 429)
    const user = await this.prisma.user.findUnique({
      where: { phone },
      include: { tenant: true, customer: true }
    })
    if (!user || user.id !== ticket.sub || user.tenantId !== ticket.tenantId) {
      return { exists: false, userStatus: null, customerStatus: null, customerName: null, reviewStatus: 'not_registered' }
    }
    if (hasMismatchedCustomerTenant(user)) return { exists: true, userStatus: user.status, customerStatus: null, customerName: null, reviewStatus: 'disabled' }
    const reviewStatus = await this.registrationReview(user)
    return {
      exists: true,
      userStatus: user.status,
      customerStatus: user.customer?.status || null,
      customerName: user.customer?.customerName || null,
      reviewStatus
    }
  }

  // Restores an expired/lost application ticket only after a fresh SMS proof.
  async registrationStatus(dto: LoginDto) {
    assertLegalConsent(dto, ['mini', 'buyer_web'])
    const valid = await this.sms.verifyCode(dto.phone, dto.code)
    if (!valid) throw new UnauthorizedException({ message: '验证码错误', errorCode: 'AUTH_3002' })
    const user = await this.prisma.user.findUnique({ where: { phone: dto.phone }, include: { tenant: true, customer: true } })
    if (!user) return { exists: false, userStatus: null, customerStatus: null, customerName: null, reviewStatus: 'not_registered', statusTicket: '' }
    if (user.userType !== 'customer_user' || !user.customerId || !user.customer) throw new ForbiddenException({ message: '请使用已有账号的登录入口', errorCode: 'AUTH_REGISTRATION_NOT_CUSTOMER' })
    if (user.tenant?.status !== 'active') throw new ForbiddenException({ message: '账号暂不可用，请联系管理员', errorCode: 'AUTH_TENANT_DISABLED' })
    await recordLegalConsent(this.prisma, dto, { tenantId: user.tenantId, userId: user.id })
    const statusTicket = this.issueStatusTicket(user.id, user.tenantId, dto.phone)
    return { ...await this.checkStatus(dto.phone, statusTicket), statusTicket }
  }

  private async registrationReview(user: { tenantId: number; status: string; userType: string; customerId?: number | null; customer?: { status: string } | null; tenant?: { status: string } }, client: Pick<Prisma.TransactionClient, 'auditLog'> = this.prisma) {
    const state = { userStatus: user.status, customerStatus: user.customer?.status, tenantActive: !user.tenant || user.tenant.status === 'active' }
    if (!state.tenantActive || user.customer?.status === 'active' || user.userType !== 'customer_user' || !user.customerId) return reviewStatusFromState(state)
    const decision = await client.auditLog.findFirst({
      where: registrationDecisionWhere(user.tenantId, user.customerId),
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }], select: { afterData: true }
    })
    const lastAction = (decision?.afterData as { action?: string } | null)?.action
    return reviewStatusFromState({ ...state, lastAction })
  }

  // Mini-program registration with full customer profile
  async registerOrLogin(dto: ConsentInputDto & {
    phone: string; code: string;
    contactName?: string; customerName?: string;
    province?: string; city?: string; district?: string; address?: string;
  }) {
    assertLegalConsent(dto, ['mini', 'buyer_web'])
    const { phone, code, contactName, customerName, province, city, district, address } = dto
    const user = await this.prisma.user.findUnique({
      where: { phone },
      include: { tenant: true, customer: true, staffCredential: { select: { version: true } } }
    })

    const normalLevel = !user ? await this.prisma.customerLevel.findFirst({
      where: { tenantId: 1, code: 'normal', status: 'active' },
      orderBy: { id: 'asc' },
      select: { id: true }
    }) : null
    if (!user && !normalLevel) {
      throw new BadRequestException({
        message: '注册服务尚未配置完成，请联系管理员配置普通客户等级',
        errorCode: 'CUS_1005'
      })
    }
    const valid = await this.sms.verifyCode(phone, code)
    if (!valid) throw new UnauthorizedException({ message: '验证码错误', errorCode: 'AUTH_3002' })

    if (user && (user.userType !== 'customer_user' || !user.customerId || !user.customer)) throw new ForbiddenException({ message: '请使用已有账号的登录入口', errorCode: 'AUTH_REGISTRATION_NOT_CUSTOMER' })
    if (user?.tenant && user.tenant.status !== 'active') throw new ForbiddenException({ message: '账号暂不可用，请联系管理员', errorCode: 'AUTH_TENANT_DISABLED' })
    if (user?.customer && user.customer.tenantId !== user.tenantId) throw new ForbiddenException({ message: '账号资料异常，请联系管理员', errorCode: 'AUTH_3001' })

    if (!user) {
      const name = customerName || contactName || ('用户' + phone.slice(-4))
      const fullAddress = [province, city, district, address].filter(Boolean).join(' ')
      const customer = await this.prisma.$transaction(async tx => {
        const createdCustomer = await tx.customer.create({
          data: {
            tenantId: 1,
            customerLevelId: normalLevel!.id,
            productVisibilityMode: 'factory',
            customerName: name,
            contactPhone: phone,
            contactName: contactName || name,
            address: fullAddress || undefined,
            status: 'disabled'
          }
        })
        const createdUser = await tx.user.create({
          data: {
            tenantId: 1,
            phone,
            name: contactName || name,
            userType: 'customer_user',
            customerId: createdCustomer.id,
            status: 'disabled'
          }
        })
        await recordLegalConsent(tx, dto, { tenantId: 1, userId: createdUser.id })
        await this.recordRegistration(tx, createdCustomer.id, 1)
        return { ...createdCustomer, userId: createdUser.id }
      }).catch((error: unknown) => {
        if (typeof error === 'object' && error !== null && 'code' in error && error.code === 'P2002') {
          throw new ConflictException({ message: '本次申请未能重复提交，请刷新状态后重试', errorCode: 'AUTH_REGISTRATION_CONFLICT' })
        }
        throw error
      })

      return {
        accessToken: '', refreshToken: '', isNew: true, pending: true,
        statusTicket: this.issueStatusTicket(customer.userId, 1, phone),
        user: null,
        customer: { id: customer.id, customerName: customer.customerName, status: customer.status }
      }
    }

    const isUserActive = user.status === 'active'
    const isCustomerActive = user.customer?.status === 'active'

    if (!isUserActive || !isCustomerActive) {
      const reviewStatus = await this.registrationReview(user)
      if (reviewStatus === 'disabled') throw new ForbiddenException({ message: '账号已停用，请联系管理员', errorCode: 'AUTH_ACCOUNT_DISABLED' })
      const fullAddress = [province, city, district, address].filter(Boolean).join(' ')
      if (user.customerId && (customerName || contactName || fullAddress)) {
        const customerId = user.customerId
        await this.prisma.$transaction(async tx => {
          await tx.$queryRaw(Prisma.sql`SELECT id FROM customers WHERE id = ${customerId} FOR UPDATE`)
          const current = await tx.customer.findUnique({ where: { id: customerId }, select: { id: true, tenantId: true, status: true } })
          if (!current || current.tenantId !== user.tenantId || current.status === 'active') throw new ConflictException({ message: '申请状态已变化，请刷新状态后重试', errorCode: 'AUTH_REGISTRATION_STATE_CHANGED' })
          const currentUser = await tx.user.findUnique({ where: { id: user.id }, select: {
            status: true, userType: true, tenantId: true, customerId: true, tenant: { select: { status: true } }
          } })
          if (!currentUser || currentUser.tenantId !== user.tenantId || currentUser.customerId !== customerId) throw new ConflictException({ message: '申请状态已变化，请刷新状态后重试', errorCode: 'AUTH_REGISTRATION_STATE_CHANGED' })
          const currentReview = await this.registrationReview({ ...currentUser, customer: current }, tx)
          if (currentReview === 'disabled') throw new ForbiddenException({ message: '账号已停用，请联系管理员', errorCode: 'AUTH_ACCOUNT_DISABLED' })
          if (currentReview !== 'rejected') throw new ConflictException({ message: '申请状态已变化，请刷新状态后重试', errorCode: 'AUTH_REGISTRATION_STATE_CHANGED' })
          const changed = await tx.customer.updateMany({
            where: { id: customerId, tenantId: user.tenantId, status: 'disabled' },
            data: {
              ...(customerName ? { customerName } : {}),
              ...(contactName ? { contactName } : {}),
              ...(fullAddress ? { address: fullAddress } : {}),
              contactPhone: phone,
              status: 'disabled',
            }
          })
          if (changed.count !== 1) throw new ConflictException({ message: '申请状态已变化，请刷新状态后重试', errorCode: 'AUTH_REGISTRATION_STATE_CHANGED' })
          await this.recordRegistration(tx, customerId, user.tenantId)
          await recordLegalConsent(tx, dto, { tenantId: user.tenantId, userId: user.id })
        })
      } else {
        await recordLegalConsent(this.prisma, dto, { tenantId: user.tenantId, userId: user.id })
      }
      return {
        accessToken: '', refreshToken: '', isNew: false, pending: true,
        statusTicket: this.issueStatusTicket(user.id, user.tenantId, phone),
        user: null,
        customer: user.customer ? { id: user.customer.id, customerName: user.customer.customerName, status: 'disabled' } : null
      }
    }

    if (customerName || contactName) {
      await this.prisma.customer.update({
        where: { id: user.customerId! },
        data: {
          ...(customerName ? { customerName } : {}),
          ...(contactName ? { contactName } : {}),
          ...(address ? { address: [province, city, district, address].filter(Boolean).join(' ') } : {}),
        }
      })
    }

    await recordLegalConsent(this.prisma, dto, { tenantId: user.tenantId, userId: user.id })
    return this.generateTokens(user, false)
  }

  private async recordRegistration(tx: any, customerId: number, tenantId: number) {
    await tx.auditLog.create({ data: {
      tenantId, action: 'create', module: 'customer', targetType: 'customer',
      targetId: String(customerId), requestId: `registration-${randomUUID()}`,
      afterData: { action: 'submit_registration', status: 'disabled' }
    } })
  }

  async generateTokens(user: any, isNew: boolean, credentialVersion = user.staffCredential?.version || 0) {
    await this.prisma.user.update({ where: { id: user.id }, data: { lastLoginAt: new Date() } })

    const sid = this.sessions.newId()
    const payload = { sub: user.id, phone: user.phone, tenantId: user.tenantId, cv: credentialVersion, sid }
    const accessToken = this.jwt.sign({ ...payload, tokenUse: 'access' }, { secret: this.config.get<string>('JWT_ACCESS_SECRET'), expiresIn: '15m' })
    const refreshToken = this.jwt.sign({ ...payload, tokenUse: 'refresh', jti: randomUUID() }, { secret: this.config.get<string>('JWT_REFRESH_SECRET'), expiresIn: '7d' })

    await this.sessions.create(user.id, sid, refreshToken)

    return {
      accessToken, refreshToken, isNew, pending: false,
      user: { id: user.id, name: user.name, phone: user.phone, userType: user.userType, status: user.status },
      customer: user.customer ? { id: user.customer.id, customerName: user.customer.customerName, status: user.customer.status } : null
    }
  }

  async login(dto: LoginDto) {
    assertLegalConsent(dto)
    const { phone, code } = dto
    const valid = await this.sms.verifyCode(phone, code)
    if (!valid) throw new UnauthorizedException({ message: '验证码错误', errorCode: 'AUTH_3002' })

    const user = await this.prisma.user.findUnique({ where: { phone }, include: { tenant: true, customer: true, staffCredential: { select: { version: true } } } })
    if (!user || user.status !== 'active') throw new ForbiddenException({ message: '账号不存在或已禁用', errorCode: 'AUTH_3001' })
    if (hasMismatchedCustomerTenant(user)) throw new ForbiddenException({ message: '账号资料异常，请联系管理员', errorCode: 'AUTH_3001' })
    if (user.tenant && user.tenant.status !== 'active') throw new ForbiddenException({ message: '账号暂不可用，请联系管理员', errorCode: 'AUTH_TENANT_DISABLED' })
    if (user.customer && user.customer.status !== 'active') throw new ForbiddenException({ message: '账号尚未通过审核', errorCode: 'AUTH_3006' })

    await recordLegalConsent(this.prisma, dto, { tenantId: user.tenantId, userId: user.id })
    return this.generateTokens(user, false)
  }

  async refreshToken(token: string) {
    let payload: { sub: number; phone: string; tenantId: number; cv?: number; sid?: string; tokenUse?: string }
    try {
      payload = this.jwt.verify(token, { secret: this.config.get<string>('JWT_REFRESH_SECRET') })
      if (payload.tokenUse !== undefined && payload.tokenUse !== 'refresh') throw new Error('Invalid token purpose')
      if (!Number.isSafeInteger(payload.sub) || payload.sub <= 0) throw new Error('Invalid token subject')
    }
    catch { throw new UnauthorizedException({ message: '刷新令牌无效', errorCode: 'AUTH_3003' }) }

    const user = await this.prisma.user.findUnique({
      where: { id: payload.sub },
      select: { status: true, tenantId: true, tenant: { select: { status: true } }, customer: { select: { status: true, tenantId: true } }, staffCredential: { select: { version: true } } }
    })
    if (!user || user.status !== 'active' || hasMismatchedCustomerTenant(user) || (user.tenant && user.tenant.status !== 'active')
      || (Number.isSafeInteger(user.tenantId) && user.tenantId !== Number(payload.tenantId))
      || (user.customer && user.customer.status !== 'active') || (payload.cv || 0) !== (user.staffCredential?.version || 0)) {
      await this.sessions.revoke(Number(payload.sub), payload.sid)
      throw new UnauthorizedException({ message: '账号不存在或已禁用', errorCode: 'AUTH_3003' })
    }

    const sid = payload.sid === undefined ? this.sessions.newId() : payload.sid
    const newPayload = { sub: payload.sub, phone: payload.phone, tenantId: payload.tenantId, cv: payload.cv || 0, sid }
    const accessToken = this.jwt.sign({ ...newPayload, tokenUse: 'access' }, { secret: this.config.get<string>('JWT_ACCESS_SECRET'), expiresIn: '15m' })
    const refreshToken = this.jwt.sign({ ...newPayload, tokenUse: 'refresh', jti: randomUUID() }, { secret: this.config.get<string>('JWT_REFRESH_SECRET'), expiresIn: '7d' })

    await this.sessions.rotate(Number(payload.sub), payload.sid, sid, token, refreshToken)
    return { accessToken, refreshToken }
  }

  async logout(userId: number, sid?: string) { await this.sessions.revoke(Number(userId), sid); return { loggedOut: true } }

  async bindOpenid(code: string, userId: number, confirmTransfer = false) {
    return bindVerifiedWechat(this.prisma, this.wx, code, userId, confirmTransfer)
  }

  async getSubscribeTemplate() {
    const templates = this.wx.orderNoticeTemplates || []
    return {
      templateId: this.wx.subscriptionReady ? this.wx.orderTemplateId : '', event: 'order.shipped',
      templates: templates.map(({ event, title, templateId }) => ({ event, title, templateId }))
    }
  }

  async getProfile(userId: number) {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      include: { tenant: true, customer: { include: { level: true } },
        userRoles: { include: { role: { include: { permissions: { include: { permission: true } } } } } },
        brandAccess: { include: { brand: true } }
      }
    })
    if (!user) throw new UnauthorizedException({ message: '用户不存在', errorCode: 'AUTH_3004' })
    if (hasMismatchedCustomerTenant(user)) throw new ForbiddenException({ message: '账号资料异常，请联系管理员', errorCode: 'AUTH_3001' })

    const roleLinks = user.userRoles.filter(ur => ur.tenantId === user.tenantId && ur.role.tenantId === user.tenantId && ur.role.status === 'active')
    const grants = roleLinks.flatMap(ur => ur.role.permissions.filter(rp => rp.tenantId === user.tenantId && rp.permission.status === 'active'))
    const roles = roleLinks.map(ur => ({ id: ur.role.id, name: ur.role.name, code: ur.role.code }))
    const permissions = [...new Set(grants.map(rp => rp.permission.code))]
    const brands = user.brandAccess.filter(ba => ba.tenantId === user.tenantId && ba.brand.tenantId === user.tenantId && ba.brand.status === 'active')
      .map(ba => ({ id: ba.brand.id, name: ba.brand.name, code: ba.brand.code, logoUrl: ba.brand.logoUrl }))
    const menus = grants.filter(rp => rp.permission.type === 'menu').map(rp => ({ code: rp.permission.code, name: rp.permission.name, path: rp.permission.path }))
      .filter((m, i, arr) => arr.findIndex(x => x.code === m.code) === i)

    const creditLimit = Number(user.customer?.creditLimit || 0)
    const creditUsed = Number(user.customer?.creditUsed || 0)
    const customerProfile = user.customer ? {
      id: user.customer.id,
      customerName: user.customer.customerName,
      customerType: user.customer.customerType,
      status: user.customer.status,
      address: user.customer.address,
      contactName: user.customer.contactName,
      contactPhone: user.customer.contactPhone,
      creditLimit: user.customer.creditLimit,
      creditUsed: user.customer.creditUsed,
      creditRemaining: Math.max(0, creditLimit - creditUsed).toFixed(2),
      creditDays: user.customer.creditDays,
      customerLevelId: user.customer.customerLevelId,
      customerLevelName: user.customer.level?.status === 'active' ? user.customer.level.name : null
    } : null

    return {
      user: { id: user.id, name: user.name, phone: user.phone, userType: user.userType, status: user.status },
      customer: customerProfile,
      tenant: { id: user.tenant.id, name: user.tenant.name, code: user.tenant.code },
      brands, roles, permissions, menus,
      support: {
        phone: (this.config.get<string>('SUPPORT_PHONE', '') || '').trim() || currentLegalPolicy.phone,
        hours: this.config.get<string>('SUPPORT_HOURS', '')
      }
    }
  }
}
