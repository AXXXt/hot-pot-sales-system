import { BadRequestException, Injectable, UnauthorizedException, ForbiddenException } from '@nestjs/common'
import { JwtService } from '@nestjs/jwt'
import { ConfigService } from '@nestjs/config'
import { PrismaService } from '../prisma.service'
import { SmsService } from './sms.service'
import { LoginDto } from './dto/login.dto'
import { REDIS } from '../redis.provider'
import { Inject } from '@nestjs/common'

const REFRESH_PREFIX = 'refresh:'
const REFRESH_BLACKLIST_PREFIX = 'refresh:bl:'

@Injectable()
export class AuthService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly jwt: JwtService,
    private readonly config: ConfigService,
    private readonly sms: SmsService,
    @Inject(REDIS) private readonly redis: { get: (key: string) => Promise<string | null>; set: (key: string, value: string, mode?: string, ttl?: number) => Promise<'OK' | null>; del: (key: string) => Promise<number> }
  ) {}

  async sendCode(phone: string, ip: string) {
    await this.sms.sendCode(phone, ip)
    return { sent: true }
  }

  // Public: check registration/audit status by phone
  async checkStatus(phone: string) {
    const user = await this.prisma.user.findUnique({
      where: { phone },
      include: { customer: true }
    })
    if (!user) {
      return { exists: false, userStatus: null, customerStatus: null, customerName: null }
    }
    return {
      exists: true,
      userStatus: user.status,
      customerStatus: user.customer?.status || null,
      customerName: user.customer?.customerName || null
    }
  }

  // Mini-program registration with full customer profile
  async registerOrLogin(dto: {
    phone: string; code: string;
    contactName?: string; customerName?: string;
    province?: string; city?: string; district?: string; address?: string;
  }) {
    const { phone, code, contactName, customerName, province, city, district, address } = dto
    const valid = await this.sms.verifyCode(phone, code)
    if (!valid) {
      throw new UnauthorizedException({ message: '验证码错误', errorCode: 'AUTH_3002' })
    }

    const user = await this.prisma.user.findUnique({
      where: { phone },
      include: { tenant: true, customer: true }
    })

    if (!user) {
      const name = customerName || contactName || ('用户' + phone.slice(-4))
      const fullAddress = [province, city, district, address].filter(Boolean).join(' ')
      const normalLevel = await this.prisma.customerLevel.findFirst({
        where: { tenantId: 1, code: 'normal', status: 'active' },
        select: { id: true }
      })
      if (!normalLevel) {
        throw new BadRequestException({
          message: '系统未配置普通客户等级，请联系管理员',
          errorCode: 'CUS_1005'
        })
      }

      const customer = await this.prisma.$transaction(async tx => {
        const createdCustomer = await tx.customer.create({
          data: {
            tenantId: 1,
            customerLevelId: normalLevel.id,
            productVisibilityMode: 'factory',
            customerName: name,
            contactPhone: phone,
            contactName: contactName || name,
            address: fullAddress || undefined,
            status: 'disabled'
          }
        })
        await tx.user.create({
          data: {
            tenantId: 1,
            phone,
            name: contactName || name,
            userType: 'customer_user',
            customerId: createdCustomer.id,
            status: 'disabled'
          }
        })
        return createdCustomer
      })

      return {
        accessToken: '', refreshToken: '', isNew: true, pending: true,
        user: null,
        customer: { id: customer.id, customerName: customer.customerName, status: customer.status }
      }
    }

    const isUserActive = user.status === 'active'
    const isCustomerActive = user.customer?.status === 'active'

    if (!isUserActive || !isCustomerActive) {
      const fullAddress = [province, city, district, address].filter(Boolean).join(' ')
      if (user.customerId && (customerName || contactName || fullAddress)) {
        await this.prisma.customer.update({
          where: { id: user.customerId },
          data: {
            ...(customerName ? { customerName } : {}),
            ...(contactName ? { contactName } : {}),
            ...(fullAddress ? { address: fullAddress } : {}),
            contactPhone: phone,
            status: 'disabled',
          }
        })
      }
      return {
        accessToken: '', refreshToken: '', isNew: false, pending: true,
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

    return this.generateTokens(user, false)
  }

  private async generateTokens(user: any, isNew: boolean) {
    await this.prisma.user.update({ where: { id: user.id }, data: { lastLoginAt: new Date() } })

    const payload = { sub: user.id, phone: user.phone, tenantId: user.tenantId }
    const accessToken = this.jwt.sign(payload, { secret: this.config.get<string>('JWT_ACCESS_SECRET'), expiresIn: '15m' })
    const refreshToken = this.jwt.sign(payload, { secret: this.config.get<string>('JWT_REFRESH_SECRET'), expiresIn: '7d' })

    await this.redis.set(`${REFRESH_PREFIX}${user.id}`, refreshToken, 'EX', 7 * 24 * 3600)

    return {
      accessToken, refreshToken, isNew, pending: false,
      user: { id: user.id, name: user.name, phone: user.phone, userType: user.userType, status: user.status },
      customer: user.customer ? { id: user.customer.id, customerName: user.customer.customerName, status: user.customer.status } : null
    }
  }

  async login(dto: LoginDto) {
    const { phone, code } = dto
    const valid = await this.sms.verifyCode(phone, code)
    if (!valid) throw new UnauthorizedException({ message: '验证码错误', errorCode: 'AUTH_3002' })

    const user = await this.prisma.user.findUnique({ where: { phone }, include: { tenant: true, customer: true } })
    if (!user || user.status !== 'active') throw new ForbiddenException({ message: '账号不存在或已禁用', errorCode: 'AUTH_3001' })
    if (user.customer && user.customer.status !== 'active') throw new ForbiddenException({ message: '账号尚未通过审核', errorCode: 'AUTH_3006' })

    return this.generateTokens(user, false)
  }

  async refreshToken(token: string) {
    let payload: { sub: number; phone: string; tenantId: number }
    try { payload = this.jwt.verify(token, { secret: this.config.get<string>('JWT_REFRESH_SECRET') }) }
    catch { throw new UnauthorizedException({ message: '刷新令牌无效', errorCode: 'AUTH_3003' }) }

    const blacklisted = await this.redis.get(`${REFRESH_BLACKLIST_PREFIX}${token}`)
    if (blacklisted) throw new UnauthorizedException({ message: '刷新令牌已失效', errorCode: 'AUTH_3003' })

    const stored = await this.redis.get(`${REFRESH_PREFIX}${payload.sub}`)
    if (stored !== token) throw new UnauthorizedException({ message: '刷新令牌不匹配', errorCode: 'AUTH_3003' })

    const user = await this.prisma.user.findUnique({
      where: { id: payload.sub },
      select: { status: true, customer: { select: { status: true } } }
    })
    if (!user || user.status !== 'active' || (user.customer && user.customer.status !== 'active')) {
      await this.redis.del(`${REFRESH_PREFIX}${payload.sub}`)
      throw new UnauthorizedException({ message: '账号不存在或已禁用', errorCode: 'AUTH_3003' })
    }

    const newPayload = { sub: payload.sub, phone: payload.phone, tenantId: payload.tenantId }
    const accessToken = this.jwt.sign(newPayload, { secret: this.config.get<string>('JWT_ACCESS_SECRET'), expiresIn: '15m' })
    const refreshToken = this.jwt.sign(newPayload, { secret: this.config.get<string>('JWT_REFRESH_SECRET'), expiresIn: '7d' })

    await this.redis.set(`${REFRESH_BLACKLIST_PREFIX}${token}`, '1', 'EX', 7 * 24 * 3600)
    await this.redis.set(`${REFRESH_PREFIX}${payload.sub}`, refreshToken, 'EX', 7 * 24 * 3600)
    return { accessToken, refreshToken }
  }

  async logout(userId: number) { await this.redis.del(`${REFRESH_PREFIX}${userId}`); return { loggedOut: true } }

  async getProfile(userId: number) {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      include: { tenant: true, customer: true,
        userRoles: { include: { role: { include: { permissions: { include: { permission: true } } } } } },
        brandAccess: { include: { brand: true } }
      }
    })
    if (!user) throw new UnauthorizedException({ message: '用户不存在', errorCode: 'AUTH_3004' })

    const roles = user.userRoles.map(ur => ({ id: ur.role.id, name: ur.role.name, code: ur.role.code }))
    const permissions = [...new Set(user.userRoles.flatMap(ur => ur.role.permissions.map(rp => rp.permission.code)))]
    const brands = user.brandAccess.map(ba => ({ id: ba.brand.id, name: ba.brand.name, code: ba.brand.code, logoUrl: ba.brand.logoUrl }))
    const menus = user.userRoles.flatMap(ur => ur.role.permissions.filter(rp => rp.permission.type === 'menu').map(rp => ({ code: rp.permission.code, name: rp.permission.name, path: rp.permission.path }))).filter((m, i, arr) => arr.findIndex(x => x.code === m.code) === i)

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
      customerLevelId: user.customer.customerLevelId
    } : null

    return {
      user: { id: user.id, name: user.name, phone: user.phone, userType: user.userType, status: user.status },
      customer: customerProfile,
      tenant: { id: user.tenant.id, name: user.tenant.name, code: user.tenant.code },
      brands, roles, permissions, menus
    }
  }
}
