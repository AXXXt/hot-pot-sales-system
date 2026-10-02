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

    // Configuration alone does not establish a live provider integration.
    return { provider: 'manual', track }
  }

  private typeText(type: string): string {
    const map: Record<string, string> = { tricycle: '三轮车（同城）', 'cold-chain': '冷链配送', regular: '普货物流' }
    return map[type] || type
  }
}
