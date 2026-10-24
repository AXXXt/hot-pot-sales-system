import { Injectable, Logger } from '@nestjs/common'
import { Prisma } from '@prisma/client'
import { PrismaService } from '../prisma.service'
import { WxService } from './wx.service'
import { shipmentTemplateData } from './shipment-template'

@Injectable()
export class ShipmentNotificationService {
  private readonly logger = new Logger(ShipmentNotificationService.name)

  constructor(private readonly prisma: PrismaService, private readonly wx: WxService) {}

  /** 唯一审计记录先占位再发送；不确定的网络结果不自动重发，避免重复消耗订阅。 */
  async notify(orderId: number): Promise<void> {
    if (!this.wx.subscriptionReady) return
    try {
      const order = await this.prisma.order.findUnique({
        where: { id: orderId },
        include: {
          user: { select: { id: true, tenantId: true, customerId: true, status: true, userType: true, openid: true } },
          customer: { select: { status: true } },
          items: { select: { productName: true }, orderBy: { id: 'asc' } },
          statusLogs: { where: { toStatus: 'shipped' }, orderBy: { id: 'asc' }, take: 1 }
        }
      })
      const user = order?.user
      if (!order || order.status !== 'shipped' || !user?.openid || user.status !== 'active' ||
          user.userType !== 'customer_user' || user.tenantId !== order.tenantId ||
          user.customerId !== order.customerId || order.customer.status !== 'active' || !order.statusLogs[0]) return
      const requestId = `wx-shipment-${order.tenantId}-${order.id}`
      const meta = { event: 'order.shipped', templateId: this.wx.orderTemplateId, userId: user.id }
      try {
        await this.prisma.auditLog.create({ data: {
          tenantId: order.tenantId, action: 'create', module: 'wechat_notification',
          targetType: 'order_shipment_notification', targetId: String(order.id), requestId,
          afterData: { ...meta, status: 'sending' }
        } })
      } catch (error) {
        if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') return
        throw error
      }
      let status = 'unknown'
      let errorCode: number | undefined
      try {
        const data = shipmentTemplateData({
          orderNo: order.orderNo, shippedAt: order.statusLogs[0].createdAt,
          productNames: order.items.map(item => item.productName), logisticsType: order.logisticsType
        })
        const result = await this.wx.sendSubscribeMessageResult({
          openid: user.openid, templateId: this.wx.orderTemplateId!, data,
          page: `pages/order-detail/order-detail?id=${order.id}`
        })
        status = result.status
        errorCode = result.errorCode
      } finally {
        await this.prisma.auditLog.update({ where: { requestId }, data: {
          afterData: { ...meta, status, ...(errorCode !== undefined ? { errorCode } : {}), finishedAt: new Date().toISOString() }
        } })
      }
    } catch {
      // 不记录异常对象，避免请求URL中的微信密钥进入日志；通知不影响已提交的发货。
      this.logger.warn(`订单${orderId}发货提醒未完成，请核对消息审计与微信配置`)
    }
  }
}
