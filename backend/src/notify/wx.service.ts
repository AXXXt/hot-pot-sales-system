import { Inject, Injectable, Logger } from '@nestjs/common'
import { ConfigService } from '@nestjs/config'
import { REDIS } from '../redis.provider'
import { SHIPMENT_TEMPLATE_ID } from './shipment-template'
import { configuredOrderTemplate, NoticeTemplate, QUOTE_TEMPLATE_ID, QUOTE_FIELDS } from './order-notification-template'

const TOKEN_PREFIX = 'wx:access_token:'

export type WxDeliveryResult = {
  status: 'sent' | 'rejected' | 'unavailable' | 'unknown'
  errorCode?: number
}

type SubscribeMessage = {
  openid: string; templateId: string; data: Record<string, { value: string }>; page?: string
}

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
    return this.config.get<string>('WX_APPID')?.trim()
  }

  private get secret(): string | undefined {
    return this.config.get<string>('WX_SECRET')?.trim()
  }

  private isConfigured(): boolean {
    return Boolean(this.appid && this.secret)
  }

  get subscriptionReady(): boolean {
    return this.isConfigured() && Boolean(this.orderTemplateId)
  }

  /** 只返回已完整配置的关键通知，兼容已有的发货模板接口。 */
  get orderNoticeTemplates(): NoticeTemplate[] {
    if (!this.isConfigured()) return []
    const templates: NoticeTemplate[] = []
    for (const [event, title, suffix] of [
      ['order.quoted', '报价完成', 'QUOTE'], ['order.approved', '审核通过', 'APPROVED']
    ] as const) {
      const id = this.config.get<string>(`WX_SUBSCRIBE_TPL_${suffix}`)?.trim()
      const fields = this.config.get<string>(`WX_SUBSCRIBE_FIELDS_${suffix}`)?.trim()
      const useConfirmedQuote = suffix === 'QUOTE' && !id && !fields
      const item = configuredOrderTemplate(event, title,
        useConfirmedQuote ? QUOTE_TEMPLATE_ID : id,
        useConfirmedQuote ? JSON.stringify(QUOTE_FIELDS) : fields)
      if (item) templates.push(item)
    }
    if (this.orderTemplateId) templates.push({
      event: 'order.shipped', title: '发货提醒', templateId: this.orderTemplateId, fields: {}
    })
    if (new Set(templates.map(item => item.templateId)).size !== templates.length) {
      throw new Error('Wechat order templates must use different template IDs')
    }
    return templates
  }

  /** 订单状态变更的订阅消息模板 ID（可配置，未配置则跳过） */
  get orderTemplateId(): string | undefined {
    return this.config.get<string>('WX_SUBSCRIBE_TPL_ORDER', SHIPMENT_TEMPLATE_ID)?.trim() || undefined
  }

  /** 获取微信 access_token（Redis 缓存，提前 5 分钟过期） */
  async getAccessToken(): Promise<string | null> {
    if (!this.isConfigured()) return null
    const cacheKey = TOKEN_PREFIX + this.appid
    try {
      const cached = await this.redis.get(cacheKey)
      if (cached) return cached
      const url = `https://api.weixin.qq.com/cgi-bin/token?grant_type=client_credential&appid=${this.appid}&secret=${this.secret}`
      const res = await fetch(url, { signal: AbortSignal.timeout(8000) })
      const data = await res.json() as { access_token?: string; expires_in?: number; errcode?: number; errmsg?: string }
      if (data.access_token) {
        const ttl = Math.max(60, (data.expires_in || 7200) - 300)
        await this.redis.set(cacheKey, data.access_token, 'EX', ttl)
        return data.access_token
      }
      this.logger.warn(`获取微信 access_token 失败，错误码${data.errcode ?? 'unknown'}`)
      return null
    } catch {
      this.logger.warn('获取微信 access_token 异常，请检查配置及网络')
      return null
    }
  }

  /** 小程序 code 换 openid */
  async codeToOpenid(code: string): Promise<string | null> {
    if (!this.isConfigured()) return null
    try {
      const url = `https://api.weixin.qq.com/sns/jscode2session?appid=${this.appid}&secret=${this.secret}&js_code=${encodeURIComponent(code)}&grant_type=authorization_code`
      const res = await fetch(url, { signal: AbortSignal.timeout(8000) })
      const data = await res.json() as { openid?: string; errcode?: number; errmsg?: string }
      if (data.openid) return data.openid
      this.logger.warn(`code2session失败，错误码${data.errcode ?? 'unknown'}`)
      return null
    } catch {
      this.logger.warn('code2session异常，请检查配置及网络')
      return null
    }
  }

  /** 发送订阅消息；未配置微信或发送失败时静默返回 false，不阻断业务 */
  async sendSubscribeMessage(input: SubscribeMessage): Promise<boolean> {
    return (await this.sendSubscribeMessageResult(input)).status === 'sent'
  }

  async sendSubscribeMessageResult(input: SubscribeMessage): Promise<WxDeliveryResult> {
    const accessToken = await this.getAccessToken()
    if (!accessToken) return { status: 'unavailable' }
    try {
      const url = `https://api.weixin.qq.com/cgi-bin/message/subscribe/send?access_token=${accessToken}`
      const res = await fetch(url, {
        method: 'POST',
        signal: AbortSignal.timeout(8000),
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          touser: input.openid,
          template_id: input.templateId,
          page: input.page,
          data: input.data,
          miniprogram_state: this.config.get<string>('WX_MINIPROGRAM_STATE', 'formal')
        })
      })
      const data = await res.json() as { errcode?: number; errmsg?: string }
      if (res.ok && data.errcode === 0) return { status: 'sent' }
      this.logger.warn(`订阅消息发送失败，错误码${data.errcode ?? 'unknown'}`)
      return Number.isSafeInteger(data.errcode)
        ? { status: 'rejected', errorCode: data.errcode }
        : { status: 'unknown' }
    } catch {
      this.logger.warn('订阅消息发送异常，结果可能不确定，请先核对再补发')
      return { status: 'unknown' }
    }
  }
}
