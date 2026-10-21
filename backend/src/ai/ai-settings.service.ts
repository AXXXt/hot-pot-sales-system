import { BadRequestException, Injectable, ServiceUnavailableException } from '@nestjs/common'
import { ConfigService } from '@nestjs/config'
import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto'
import { PrismaService } from '../prisma.service'
import { StaffAccessService, StaffActor } from '../auth/staff-access.service'

export const DEFAULT_FEATURES = { products: true, vision: true, analytics: true, tasks: true }
const PROVIDER_HOSTS = ['dashscope.aliyuncs.com', 'dashscope-intl.aliyuncs.com', 'api.deepseek.com']

export function validateModelEndpoint(value: string) {
  let url: URL
  try { url = new URL(value) } catch { throw new BadRequestException('模型服务地址无效') }
  const approved = PROVIDER_HOSTS.includes(url.hostname) || /^[a-z0-9-]+\.(cn-beijing|ap-southeast-1|cn-hongkong)\.maas\.aliyuncs\.com$/.test(url.hostname)
  if (!approved || url.protocol !== 'https:' || (url.port && url.port !== '443') || url.username || url.password || url.search || url.hash || !/^\/(compatible-mode\/)?v1\/?$/.test(url.pathname)) {
    throw new BadRequestException('仅支持已批准的百炼或 DeepSeek HTTPS API 地址（以 /v1 结尾）')
  }
  return url.toString().replace(/\/$/, '')
}

@Injectable()
export class AiSettingsService {
  constructor(private readonly prisma: PrismaService, private readonly config: ConfigService, private readonly access: StaffAccessService) {}

  async configFor(tenantId: number) {
    return this.prisma.aiConfig.findUnique({ where: { tenantId } })
  }

  async publicSettings(actor: StaffActor) {
    this.access.require(actor, 'ai:configure')
    const value = await this.configFor(actor.tenantId)
    return { enabled: value?.enabled ?? false, baseUrl: value?.baseUrl ?? '', textModel: value?.textModel ?? '', visionModel: value?.visionModel ?? '',
      allowWrites: value?.allowWrites ?? false, dailyRequests: value?.dailyRequests ?? 100,
      features: value?.features ?? DEFAULT_FEATURES, hasKey: Boolean(value?.encryptedKey), encryptionReady: Buffer.from(this.config.get<string>('AI_ENCRYPTION_KEY') || '', 'base64').length === 32 }
  }

  async save(actor: StaffActor, input: { enabled: boolean; baseUrl: string; textModel: string; visionModel: string; allowWrites: boolean; dailyRequests: number; features: typeof DEFAULT_FEATURES; apiKey?: string }) {
    this.access.require(actor, 'ai:configure')
    const baseUrl = input.baseUrl ? validateModelEndpoint(input.baseUrl) : ''
    if (input.enabled && (!baseUrl || !input.textModel)) throw new BadRequestException('启用前请配置模型服务地址和文本模型')
    const apiKey = input.apiKey?.trim()
    const encryptedKey = apiKey ? this.encrypt(apiKey) : undefined
    const previous = await this.configFor(actor.tenantId)
    if (previous?.baseUrl && baseUrl && new URL(previous.baseUrl).hostname !== new URL(baseUrl).hostname && !encryptedKey) throw new BadRequestException('更换模型供应商时请重新输入API Key')
    if (input.enabled && !encryptedKey && !previous?.encryptedKey) throw new BadRequestException('启用前请保存模型 API Key')
    await this.prisma.$transaction(async tx => {
      const data = { enabled: input.enabled, baseUrl, textModel: input.textModel, visionModel: input.visionModel,
        allowWrites: input.allowWrites, dailyRequests: input.dailyRequests, features: input.features, ...(encryptedKey ? { encryptedKey } : {}) }
      await tx.aiConfig.upsert({ where: { tenantId: actor.tenantId }, create: { tenantId: actor.tenantId, ...data }, update: data })
      await tx.auditLog.create({ data: { tenantId: actor.tenantId, operatorId: actor.id, action: 'update', module: 'ai', targetType: 'ai_config', targetId: String(actor.tenantId),
        requestId: `ai-config-${randomBytes(16).toString('hex')}`, afterData: { enabled: data.enabled, textModel: data.textModel, allowWrites: data.allowWrites, keyChanged: Boolean(encryptedKey) } } })
    })
    return this.publicSettings(actor)
  }

  private key() {
    const key = Buffer.from(this.config.get<string>('AI_ENCRYPTION_KEY') || '', 'base64')
    if (key.length !== 32) throw new ServiceUnavailableException('请先在服务器配置32字节 Base64 格式的 AI_ENCRYPTION_KEY')
    return key
  }

  encrypt(value: string) {
    const iv = randomBytes(12)
    const cipher = createCipheriv('aes-256-gcm', this.key(), iv)
    const ciphertext = Buffer.concat([cipher.update(value, 'utf8'), cipher.final()])
    return [iv, cipher.getAuthTag(), ciphertext].map(x => x.toString('base64')).join('.')
  }

  decrypt(value: string) {
    try {
      const [iv, tag, data] = value.split('.').map(x => Buffer.from(x, 'base64'))
      const cipher = createDecipheriv('aes-256-gcm', this.key(), iv)
      cipher.setAuthTag(tag)
      return Buffer.concat([cipher.update(data), cipher.final()]).toString('utf8')
    } catch { throw new ServiceUnavailableException('模型密钥不可读取，请检查服务器密钥配置') }
  }
}
