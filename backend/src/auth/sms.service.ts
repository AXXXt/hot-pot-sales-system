import { HttpException, HttpStatus, Injectable, Logger } from '@nestjs/common'
import { ConfigService } from '@nestjs/config'
import { REDIS } from '../redis.provider'
import { Inject } from '@nestjs/common'

const RATE_LIMIT_PREFIX = 'sms:rate:'
const CODE_PREFIX = 'sms:code:'
const ATTEMPTS_PREFIX = 'sms:attempts:'
const CODE_TTL = 300
const RATE_TTL = 60
const RATE_TTL_DEV = 5
const IP_RATE_TTL = 60
const IP_RATE_TTL_DEV = 10
const MAX_ATTEMPTS = 5

@Injectable()
export class SmsService {
  private readonly logger = new Logger(SmsService.name)
  private readonly memoryStore = new Map<string, { value: string; expiresAt: number }>()
  private redisDown = false

  constructor(
    private readonly config: ConfigService,
    @Inject(REDIS) private readonly redis: { get: (key: string) => Promise<string | null>; set: (key: string, value: string, mode?: string, ttl?: number) => Promise<'OK' | null>; del: (key: string) => Promise<number> }
  ) {}

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
      this.redisDown = true
      this.logger.warn('Redis unavailable, falling back to in-memory store')
      this.memoryStore.set(key, { value, expiresAt: Date.now() + ttl * 1000 })
    }
  }

  private async redisDel(key: string): Promise<void> {
    if (this.redisDown) { this.memoryStore.delete(key); return }
    try { await this.redis.del(key) } catch { this.memoryStore.delete(key) }
  }

  async sendCode(phone: string, ip: string): Promise<void> {
    const provider = this.config.get<string>('SMS_PROVIDER', 'development')
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
    if (provider === 'development') {
      code = this.config.get<string>('SMS_DEV_CODE', '123456')
      this.logger.warn(`[DEV_SMS] phone=${phone} code=${code}`)
    } else {
      code = String(Math.floor(100000 + Math.random() * 900000))
      this.logger.log(`[SMS] code sent to ${phone}`)
    }

    const codeKey = `${CODE_PREFIX}${phone}`
    await Promise.all([
      this.redisSet(codeKey, code, CODE_TTL),
      this.redisSet(rateKey, '1', isDev ? RATE_TTL_DEV : RATE_TTL),
      this.redisSet(ipRateKey, '1', isDev ? IP_RATE_TTL_DEV : IP_RATE_TTL)
    ])
  }

  async verifyCode(phone: string, code: string): Promise<boolean> {
    const attemptsKey = `${ATTEMPTS_PREFIX}${phone}`
    const attempts = parseInt((await this.redisGet(attemptsKey)) || '0', 10)
    if (attempts >= MAX_ATTEMPTS) {
      throw new HttpException(
        { message: '验证码错误次数过多，请稍后再试', errorCode: 'SMS_4292' },
        HttpStatus.TOO_MANY_REQUESTS
      )
    }

    const codeKey = `${CODE_PREFIX}${phone}`
    const stored = await this.redisGet(codeKey)
    if (!stored || stored !== code) {
      await this.redisSet(attemptsKey, String(attempts + 1), CODE_TTL)
      return false
    }

    await this.redisDel(codeKey)
    await this.redisDel(attemptsKey)
    return true
  }
}