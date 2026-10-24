import { HttpException, HttpStatus, Injectable, Logger } from '@nestjs/common'
import { ConfigService } from '@nestjs/config'
import { randomInt } from 'crypto'
import { REDIS } from '../redis.provider'
import { Inject } from '@nestjs/common'
import { EXPERIENCE_SMS_CODE, experienceSmsSettings } from './sms-experience.config'
import {
  SmsPurpose,
  TencentSmsClient,
  TencentSmsError,
  tencentSmsSettings
} from './tencent-sms.client'

const RATE_LIMIT_PREFIX = 'sms:rate:'
const CODE_PREFIX = 'sms:code:'
const ATTEMPTS_PREFIX = 'sms:attempts:'
const CODE_TTL = 300
const RATE_TTL = 60
const RATE_TTL_DEV = 5
const IP_RATE_TTL = 60
const IP_RATE_TTL_DEV = 10
const MAX_ATTEMPTS = 5
const verifyScript = `-- sms-verify-once
local attempts = tonumber(redis.call('GET', KEYS[2]) or '0')
if attempts >= tonumber(ARGV[2]) then return -1 end
local stored = redis.call('GET', KEYS[1])
if not stored or stored ~= ARGV[1] then
  local count = redis.call('INCR', KEYS[2])
  redis.call('EXPIRE', KEYS[2], ARGV[3])
  return 0
end
redis.call('DEL', KEYS[1], KEYS[2])
return 1`

@Injectable()
export class SmsService {
  private readonly logger = new Logger(SmsService.name)
  private readonly memoryStore = new Map<string, { value: string; expiresAt: number }>()
  private redisDown = false
  private tencentClient?: TencentSmsClient

  constructor(
    private readonly config: ConfigService,
    @Inject(REDIS) private readonly redis: { get: (key: string) => Promise<string | null>; set: (key: string, value: string, mode?: string, ttl?: number) => Promise<'OK' | null>; del: (key: string) => Promise<number>; eval?: (...args: any[]) => Promise<unknown> }
  ) {}

  private isExperience() {
    return this.config.get<string>('SMS_PROVIDER') === 'experience'
  }

  private isTencent() {
    return this.config.get<string>('SMS_PROVIDER') === 'tencentcloud'
  }

  private requiresSharedStore() {
    return this.isExperience() || this.isTencent()
  }

  private getTencentClient() {
    if (!this.tencentClient) {
      const settings = tencentSmsSettings(this.config)
      if (!settings.secretId || !settings.secretKey || !settings.sdkAppId ||
          !settings.signName || !settings.loginTemplateId || !settings.registerTemplateId) {
        throw this.unavailable()
      }
      this.tencentClient = new TencentSmsClient(settings)
    }
    return this.tencentClient
  }

  private assertExperienceAccess(phone: string) {
    const settings = experienceSmsSettings(this.config)
    if (!settings.active) {
      throw new HttpException({ message: '体验验证码已关闭或到期，请联系管理员', errorCode: 'SMS_TEST_EXPIRED' }, HttpStatus.SERVICE_UNAVAILABLE)
    }
    if (!settings.phones.includes(phone)) {
      throw new HttpException({ message: '该手机号未加入体验测试名单，请联系管理员', errorCode: 'SMS_TEST_FORBIDDEN' }, HttpStatus.FORBIDDEN)
    }
  }

  private codeKey(phone: string) {
    // Keep test codes isolated from any future real SMS provider.
    return `${this.isExperience() ? 'sms:experience:code:' : CODE_PREFIX}${phone}`
  }

  private unavailable() {
    return new HttpException({ message: '验证码服务暂不可用，请稍后重试', errorCode: 'SMS_UNAVAILABLE' }, HttpStatus.SERVICE_UNAVAILABLE)
  }

  private async redisGet(key: string): Promise<string | null> {
    if (this.redisDown) {
      const entry = this.memoryStore.get(key)
      if (!entry) return null
      if (Date.now() > entry.expiresAt) { this.memoryStore.delete(key); return null }
      return entry.value
    }
    try {
      return await this.redis.get(key)
    } catch {
      if (this.requiresSharedStore()) throw this.unavailable()
      this.redisDown = true
      this.logger.warn('Redis unavailable, falling back to in-memory store')
      return this.redisGet(key)
    }
  }

  private async redisSet(key: string, value: string, ttl: number): Promise<void> {
    if (this.redisDown) {
      this.memoryStore.set(key, { value, expiresAt: Date.now() + ttl * 1000 })
      return
    }
    try {
      await this.redis.set(key, value, 'EX', ttl)
    } catch {
      if (this.requiresSharedStore()) throw this.unavailable()
      this.redisDown = true
      this.logger.warn('Redis unavailable, falling back to in-memory store')
      this.memoryStore.set(key, { value, expiresAt: Date.now() + ttl * 1000 })
    }
  }

  async sendCode(phone: string, ip: string, purpose: SmsPurpose = 'login'): Promise<void> {
    const provider = this.config.get<string>('SMS_PROVIDER', 'development')
    if (provider === 'disabled') {
      throw new HttpException({ message: '短信登录暂未开放，请联系工作人员', errorCode: 'SMS_DISABLED' }, HttpStatus.SERVICE_UNAVAILABLE)
    }
    if (!['development', 'experience', 'tencentcloud'].includes(provider)) throw this.unavailable()
    if (this.isExperience()) this.assertExperienceAccess(phone)
    const isDev = provider === 'development'
    const rateKey = `${RATE_LIMIT_PREFIX}${phone}`
    const ipRateKey = `${RATE_LIMIT_PREFIX}ip:${ip}`
    const [phoneRate, ipRate] = await Promise.all([
      this.redisGet(rateKey),
      this.redisGet(ipRateKey)
    ])
    if (phoneRate) {
      throw new HttpException(
        { message: '验证码发送过于频繁，请稍后再试', errorCode: 'SMS_4290' },
        HttpStatus.TOO_MANY_REQUESTS
      )
    }
    if (ipRate) {
      throw new HttpException(
        { message: '操作过于频繁，请稍后再试', errorCode: 'SMS_4291' },
        HttpStatus.TOO_MANY_REQUESTS
      )
    }

    let code: string
    if (this.isExperience()) {
      code = EXPERIENCE_SMS_CODE
    } else if (provider === 'development') {
      code = this.config.get<string>('SMS_DEV_CODE', '123456')
      this.logger.warn(`[DEV_SMS] phone=${phone} code=${code}`)
    } else {
      code = String(randomInt(100000, 1000000))
    }

    if (this.isTencent()) {
      try {
        await this.getTencentClient().send(phone, code, purpose)
        this.logger.log(`Tencent SMS sent for ${purpose}`)
      } catch (error) {
        const providerError = error instanceof TencentSmsError ? error.code : 'PROVIDER_ERROR'
        this.logger.error(`Tencent SMS send failed: ${providerError}`)
        throw new HttpException(
          { message: '验证码发送失败，请稍后重试', errorCode: 'SMS_PROVIDER_ERROR' },
          HttpStatus.BAD_GATEWAY
        )
      }
    }

    const codeKey = this.codeKey(phone)
    await Promise.all([
      this.redisSet(codeKey, code, CODE_TTL),
      this.redisSet(rateKey, '1', isDev ? RATE_TTL_DEV : RATE_TTL),
      this.redisSet(ipRateKey, '1', isDev ? IP_RATE_TTL_DEV : IP_RATE_TTL)
    ])
  }

  private verificationResult(result: number) {
    if (result === -1) throw new HttpException({ message: '验证码错误次数过多，请稍后再试', errorCode: 'SMS_4292' }, HttpStatus.TOO_MANY_REQUESTS)
    if (result !== 0 && result !== 1) throw this.unavailable()
    return result === 1
  }

  /** Development-only fallback executes synchronously, with the same one-use and attempt-cap semantics. */
  private verifyMemory(codeKey: string, attemptsKey: string, supplied: string) {
    const now = Date.now()
    const attemptEntry = this.memoryStore.get(attemptsKey)
    const attempts = attemptEntry && attemptEntry.expiresAt > now ? Number(attemptEntry.value) : 0
    if (attempts >= MAX_ATTEMPTS) return this.verificationResult(-1)
    const stored = this.memoryStore.get(codeKey)
    if (stored && stored.expiresAt > now && stored.value === supplied) {
      this.memoryStore.delete(codeKey); this.memoryStore.delete(attemptsKey)
      return true
    }
    this.memoryStore.set(attemptsKey, { value: String(attempts + 1), expiresAt: now + CODE_TTL * 1000 })
    return false
  }

  async verifyCode(phone: string, code: string): Promise<boolean> {
    if (this.config.get<string>('SMS_PROVIDER') === 'disabled') return false
    if (this.isExperience()) this.assertExperienceAccess(phone)
    const codeKey = this.codeKey(phone), attemptsKey = `${ATTEMPTS_PREFIX}${phone}`
    if (this.redisDown) {
      if (this.requiresSharedStore()) throw this.unavailable()
      return this.verifyMemory(codeKey, attemptsKey, code)
    }
    let result: number
    try {
      if (typeof this.redis.eval !== 'function') throw this.unavailable()
      result = Number(await this.redis.eval(verifyScript, 2, codeKey, attemptsKey, code, MAX_ATTEMPTS, CODE_TTL))
    } catch {
      if (this.requiresSharedStore()) throw this.unavailable()
      this.redisDown = true
      this.logger.warn('Redis unavailable, falling back to in-memory store')
      return this.verifyMemory(codeKey, attemptsKey, code)
    }
    return this.verificationResult(result)
  }
}
