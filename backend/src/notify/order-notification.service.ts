import { ForbiddenException, Injectable, Logger, NotFoundException } from '@nestjs/common'
import { Prisma } from '@prisma/client'
import { PrismaService } from '../prisma.service'
import { WxService } from './wx.service'
import { orderNoticeData } from './order-notification-template'

const EVENTS: Record<string, { event: string; title: string; content: string }> = {
  pending_quote: { event: 'order.submitted', title: '订单已提交', content: '采购订单已提交，等待报价。' },
  pending_confirm: { event: 'order.quoted', title: '报价已完成', content: '报价已完成，请查看价格并确认采购。' },
  pending_finance: { event: 'order.confirmed', title: '订单已确认', content: '采购信息已确认，等待审核；审核结果以订单进度为准。' },
  finance_rejected: { event: 'order.finance_rejected', title: '付款审核已退回', content: '付款审核未通过，请进入订单查看退回原因并重新提交。' },
  pending_shipment: { event: 'order.approved', title: '订单审核通过', content: '订单已审核通过，请等待发货。' },
  shipped: { event: 'order.shipped', title: '订单已发货', content: '订单已发货，请留意收货。' },
  completed: { event: 'order.completed', title: '订单已完成', content: '订单已确认收货，感谢采购。' },
  cancelled: { event: 'order.cancelled', title: '订单已取消', content: '订单已取消，请进入订单查看处理结果。' }
}

@Injectable()
export class OrderNotificationService {
  private readonly logger = new Logger(OrderNotificationService.name)
  constructor(private readonly prisma: PrismaService, private readonly wx: WxService) {}

  /** 站内消息与状态日志在同一事务写入，拒绝微信订阅不影响站内进度。 */
  async record(tx: Prisma.TransactionClient, orderId: number, status: string, log: { id: number; createdAt: Date }) {
    const event = EVENTS[status]
    if (!event) return
    const order = await tx.order.findUnique({ where: { id: orderId }, include: { user: true, customer: true } })
    if (!this.isRecipient(order)) return
    await tx.customerNotification.create({ data: {
      tenantId: order!.tenantId, userId: order!.userId!, orderId,
      eventKey: `order-${orderId}-${log.id}`, ...event, createdAt: log.createdAt
    } })
  }

  private isRecipient(order: any): boolean {
    return Boolean(order?.user && order.user.status === 'active' && order.user.userType === 'customer_user' &&
      order.customer?.status === 'active' && order.user.tenantId === order.tenantId && order.user.customerId === order.customerId)
  }

  /** 只给报价/审核关键事件发送独立模板；发货沿用原有审计键，避免升级后重复发货提醒。 */
  async notify(orderId: number, status: string): Promise<void> {
    if (!['pending_confirm', 'pending_shipment'].includes(status)) return
    try {
      const event = EVENTS[status].event
      const template = this.wx.orderNoticeTemplates.find(item => item.event === event)
      if (!template) return
      const order = await this.prisma.order.findUnique({ where: { id: orderId }, include: {
        user: true, customer: true, items: { select: { productName: true }, orderBy: { id: 'asc' } },
        statusLogs: { where: { toStatus: status }, orderBy: { id: 'desc' }, take: 1 }
      } })
      if (!this.isRecipient(order) || order!.status !== status || !order!.user!.openid || !order!.statusLogs[0]) return
      const log = order!.statusLogs[0], user = order!.user!
      if (status === 'pending_confirm' && log.fromStatus === 'pending_finance') return
      const requestId = `wx-order-${order!.tenantId}-${log.id}`
      const meta = { event, userId: user.id, templateId: template.templateId }
      const data = orderNoticeData(template, {
        orderNo: order!.orderNo, eventTime: log.createdAt, productNames: order!.items.map(x => x.productName),
        amount: order!.payableAmount.toFixed(2), paymentMethod: order!.paymentMethod
      })
      try {
        await this.prisma.auditLog.create({ data: {
          tenantId: order!.tenantId, action: 'create', module: 'wechat_notification',
          targetType: 'order_key_notification', targetId: String(orderId), requestId, afterData: { ...meta, status: 'sending' }
        } })
      } catch (error) {
        if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') return
        throw error
      }
      let result: { status: string; errorCode?: number } = { status: 'unknown' }
      try {
        result = await this.wx.sendSubscribeMessageResult({
          openid: user.openid!, templateId: template.templateId, data, page: `pages/order-detail/order-detail?id=${orderId}`
        })
      } finally {
        await this.prisma.auditLog.update({ where: { requestId }, data: {
          afterData: { ...meta, ...result, finishedAt: new Date().toISOString() }
        } })
      }
    } catch { this.logger.warn(`订单${orderId}关键消息投递未完成，请核对消息审计`) }
  }

  private async scope(userId: number) {
    const user = await this.prisma.user.findUnique({ where: { id: userId }, include: { customer: true } })
    if (!user || user.status !== 'active' || (user.customer && user.customer.status !== 'active')) throw new ForbiddenException('账号不可用')
    return {
      tenantId: user.tenantId, userId,
      order: { tenantId: user.tenantId, userId, customerId: user.userType === 'customer_user' ? (user.customerId || -1) : -1 }
    }
  }

  async list(userId: number, page: number, pageSize: number) {
    const where = await this.scope(userId)
    const [items, total, unreadCount] = await Promise.all([
      this.prisma.customerNotification.findMany({ where, select: {
        id: true, orderId: true, event: true, title: true, content: true, createdAt: true, readAt: true,
        order: { select: { orderNo: true } }
      }, orderBy: [{ createdAt: 'desc' }, { id: 'desc' }], skip: (page - 1) * pageSize, take: pageSize }),
      this.prisma.customerNotification.count({ where }),
      this.prisma.customerNotification.count({ where: { ...where, readAt: null } })
    ])
    return { items, total, unreadCount, page, pageSize }
  }

  async read(userId: number, id: number) {
    const result = await this.prisma.customerNotification.updateMany({ where: { ...await this.scope(userId), id }, data: { readAt: new Date() } })
    if (!result.count) throw new NotFoundException('消息不存在或不可访问')
    return { read: true }
  }

  async readAll(userId: number) {
    const result = await this.prisma.customerNotification.updateMany({
      where: { ...await this.scope(userId), readAt: null, createdAt: { lte: new Date() } }, data: { readAt: new Date() }
    })
    return { updated: result.count }
  }
}
