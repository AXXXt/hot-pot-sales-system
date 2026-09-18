import { Inject, Injectable, Logger } from '@nestjs/common'
import { ConfigService } from '@nestjs/config'
import { REDIS } from '../redis.provider'

const TOKEN_PREFIX = 'wx:access_token:'

interface RedisClient {
  get: (key: string) => Promise<string | null>
  set: (key: string, value: string, mode?: string, ttl?: number) => Promise<'OK' | null>
}

@Injectable()
export class WxService {
  private readonly logger = new Logger(WxService.name)

  constructor(
    private readonly config: ConfigService,
    @Inject(REDIS) private readonly redis: RedisClient
  ) {}

  private get appid(): string | undefined {
    return this.config.get<string>('WX_APPID')
  }

  private get secret(): string | undefined {
    return this.config.get<string>('WX_SECRET')
  }

  private isConfigured(): boolean {
    return Boolean(this.appid && this.secret)
  }

  /** 订单状态变更的订阅消息模板 ID（可配置，未配置则跳过） */
  get orderTemplateId(): string | undefined {
    return this.config.get<string>('WX_SUBSCRIBE_TPL_ORDER')
  }

  /** 获取微信 access_token（Redis 缓存，提前 5 分钟过期） */
  async getAccessToken(): Promise<string | null> {
    if (!this.isConfigured()) return null
    const cacheKey = TOKEN_PREFIX + this.appid
    const cached = await this.redis.get(cacheKey)
    if (cached) return cached
    try {
      const url = `https://api.weixin.qq.com/cgi-bin/token?grant_type=client_credential&appid=${this.appid}&secret=${this.secret}`
      const res = await fetch(url)
      const data = await res.json() as { access_token?: string; expires_in?: number; errcode?: number; errmsg?: string }
      if (data.access_token) {
        const ttl = Math.max(60, (data.expires_in || 7200) - 300)
        await this.redis.set(cacheKey, data.access_token, 'EX', ttl)
        return data.access_token
      }
      this.logger.warn(`获取微信 access_token 失败: ${JSON.stringify(data)}`)
      return null
    } catch (error) {
      this.logger.error('获取微信 access_token 异常', error as Error)
      return null
    }
  }

  /** 小程序 code 换 openid */
  async codeToOpenid(code: string): Promise<string | null> {
    if (!this.isConfigured()) return null
    try {
      const url = `https://api.weixin.qq.com/sns/jscode2session?appid=${this.appid}&secret=${this.secret}&js_code=${encodeURIComponent(code)}&grant_type=authorization_code`
      const res = await fetch(url)
      const data = await res.json() as { openid?: string; errcode?: number; errmsg?: string }
      if (data.openid) return data.openid
      this.logger.warn(`code2session 失败: ${JSON.stringify(data)}`)
      return null
    } catch (error) {
      this.logger.error('code2session 异常', error as Error)
      return null
    }
  }

  /** 发送订阅消息；未配置微信或发送失败时静默返回 false，不阻断业务 */
  async sendSubscribeMessage(input: {
    openid: string
    templateId: string
    data: Record<string, { value: string }>
    page?: string
  }): Promise<boolean> {
    const accessToken = await this.getAccessToken()
    if (!accessToken) return false
    try {
      const url = `https://api.weixin.qq.com/cgi-bin/message/subscribe/send?access_token=${accessToken}`
      const res = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          touser: input.openid,
          template_id: input.templateId,
          page: input.page,
          data: input.data,
          miniprogram_state: 'formal'
        })
      })
      const data = await res.json() as { errcode?: number; errmsg?: string }
      if (data.errcode === 0) return true
      this.logger.warn(`订阅消息发送失败: ${JSON.stringify(data)}`)
      return false
    } catch (error) {
      this.logger.error('订阅消息发送异常', error as Error)
      return false
    }
  }
}