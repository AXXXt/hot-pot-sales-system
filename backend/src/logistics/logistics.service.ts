import { Injectable } from '@nestjs/common'
import { ConfigService } from '@nestjs/config'

export interface TrackPoint {
  time: string
  text: string
}

export interface OrderTrack {
  provider: 'manual' | 'lalamove'
  shipmentId?: string
  track: TrackPoint[]
}

interface LogisticsOrderInput {
  logisticsType?: string | null
  logisticsInfo?: unknown
  status?: string
  createdAt?: Date | string
}

@Injectable()
export class LogisticsService {
  constructor(private readonly config: ConfigService) {}

  /**
   * 货拉拉是否已配置。真实对接需在货拉拉开放平台申请企业账号与 API Key，
   * 并依据其 API 文档在此扩展 createShipment / queryTrack。
   */
  private get lalamoveConfigured(): boolean {
    return Boolean(this.config.get<string>('LALAMOVE_API_KEY') && this.config.get<string>('LALAMOVE_ENDPOINT'))
  }

  /** 订单物流轨迹（手动物流信息；货拉拉接入后可扩展为实时轨迹） */
  async getOrderTrack(order: LogisticsOrderInput): Promise<OrderTrack> {
    const track: TrackPoint[] = []
    const info = (order.logisticsInfo || {}) as Record<string, unknown>
    const fmt = (d?: Date | string | null) => (d ? new Date(d).toLocaleString('zh-CN') : '')

    if (order.createdAt) {
      track.push({ time: fmt(order.createdAt), text: '订单已创建' })
    }

    const logisticsType = (info.logisticsType as string) || order.logisticsType
    if (logisticsType) {
      track.push({ time: '', text: `配送方式：${this.typeText(logisticsType)}` })
    }
    if (info.driverName) track.push({ time: '', text: `司机：${info.driverName}` })
    if (info.driverPhone) track.push({ time: '', text: `司机电话：${info.driverPhone}` })
    if (info.plateNumber) track.push({ time: '', text: `车牌：${info.plateNumber}` })
    if (order.status === 'shipped') track.push({ time: '', text: '货物已发出' })
    if (order.status === 'completed') track.push({ time: '', text: '客户已确认收货' })

    // 货拉拉接入占位：若配置且订单有运单号，可在此调用 Lalamove 开放平台查询实时轨迹
    if (this.lalamoveConfigured && info.shipmentId) {
      return { provider: 'lalamove', shipmentId: info.shipmentId as string, track }
    }
    return { provider: 'manual', track }
  }

  private typeText(type: string): string {
    const map: Record<string, string> = { tricycle: '三轮车（同城）', 'cold-chain': '冷链配送', regular: '普货物流' }
    return map[type] || type
  }
}