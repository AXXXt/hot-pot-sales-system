import { BadRequestException, Inject, Injectable, ServiceUnavailableException } from '@nestjs/common'
import { AiSettingsService, validateModelEndpoint } from './ai-settings.service'
import { PrismaService } from '../prisma.service'
import { StaffActor } from '../auth/staff-access.service'
import { REDIS } from '../redis.provider'
import type Redis from 'ioredis'
import { shanghaiDay } from './ai.metrics'

export interface ModelTool { type: 'function'; function: { name: string; description: string; parameters: Record<string, unknown> } }
export interface ModelMessage { role: string; content?: unknown; tool_calls?: unknown[]; tool_call_id?: string }

@Injectable()
export class AiModelService {
  constructor(private readonly settings: AiSettingsService, private readonly prisma: PrismaService, @Inject(REDIS) private readonly redis: Redis) {}

  async complete(actor: StaffActor, messages: ModelMessage[], tools: ModelTool[], images = 0) {
    const config = await this.settings.configFor(actor.tenantId)
    if (!config?.enabled || !config.encryptedKey) throw new BadRequestException('AI模型尚未启用，请由管理员在AI助手配置中连接模型')
    if (images && !config.visionModel) throw new BadRequestException('尚未配置视觉模型，请先配置或使用文字建品')
    const rateKey = `ai:quota:${actor.tenantId}:${actor.id}:${shanghaiDay()}`
    const count = await this.redis.eval("local n=redis.call('INCR',KEYS[1]); if n==1 then redis.call('EXPIRE',KEYS[1],172800) end; return n", 1, rateKey) as number
    if (count > config.dailyRequests) throw new BadRequestException('已达到今日模型调用上限')
    const model = images ? config.visionModel : config.textModel
    const usage = await this.prisma.aiUsageRecord.create({ data: { tenantId: actor.tenantId, ownerId: actor.id, model, images } })
    try {
      const endpoint = validateModelEndpoint(config.baseUrl)
      const response = await fetch(`${endpoint}/chat/completions`, {
        method: 'POST', redirect: 'error', signal: AbortSignal.timeout(60000),
        headers: { Authorization: `Bearer ${this.settings.decrypt(config.encryptedKey)}`, 'Content-Type': 'application/json' },
        // The assistant stores business results, not the provider's private reasoning transcript.
        // DeepSeek enables thinking by default and requires that transcript on later tool turns.
        body: JSON.stringify({ model, temperature: 0.1, max_tokens: tools.some(tool => ['inventory_batch_draft', 'order_list_draft'].includes(tool.function.name)) ? 6000 : 2500, messages,
          ...(new URL(endpoint).hostname === 'api.deepseek.com' ? { thinking: { type: 'disabled' } } : {}),
          ...(tools.length ? { tools, tool_choice: 'auto' } : {}) })
      })
      if (!response.ok) throw new Error('provider rejected request')
      const rawText = await response.text()
      if (rawText.length > 200000) throw new Error('model response too large')
      const data = JSON.parse(rawText)
      if (data.choices?.[0]?.finish_reason === 'length') throw new Error('incomplete model response')
      const message = data.choices?.[0]?.message
      if (!message || (typeof message.content !== 'string' && !Array.isArray(message.tool_calls))) throw new Error('invalid model response')
      await this.prisma.aiUsageRecord.update({ where: { id: usage.id }, data: {
        status: 'completed', inputTokens: Math.min(2000000, Math.max(0, Number(data.usage?.prompt_tokens) || 0)), outputTokens: Math.min(2000000, Math.max(0, Number(data.usage?.completion_tokens) || 0))
      } })
      return message as { role: string; content?: string; tool_calls?: Array<{ id: string; type: string; function: { name: string; arguments: string } }> }
    } catch {
      await this.prisma.aiUsageRecord.update({ where: { id: usage.id }, data: { status: 'failed' } })
      throw new ServiceUnavailableException('模型服务暂不可用或连接配置有误；已保存的草稿和原业务页面仍可使用')
    }
  }
}
