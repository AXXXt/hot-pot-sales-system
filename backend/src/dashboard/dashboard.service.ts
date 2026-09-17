import { Injectable } from '@nestjs/common'
import { OrderStatus } from '@prisma/client'
import { PrismaService } from '../prisma.service'

const PAID_ORDER_STATUSES: OrderStatus[] = [
  OrderStatus.pending_shipment,
  OrderStatus.shipped,
  OrderStatus.completed
]

@Injectable()
export class DashboardService {
  constructor(private readonly prisma: PrismaService) {}

  async getStats() {
    const now = new Date()
    const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate())
    const todayEnd = new Date(todayStart.getTime() + 86400000 - 1)
    const yesterdayStart = new Date(todayStart.getTime() - 86400000)
    const yesterdayEnd = new Date(todayStart.getTime() - 1)
    const sevenDaysAgo = new Date(todayStart.getTime() - 6 * 86400000)
    const monthStart = new Date(now.getFullYear(), now.getMonth(), 1)

    const [
      todayOrders, yesterdayOrders,
      todayRevenue, yesterdayRevenue,
      pendingQuotes, pendingShipments,
      lowStockCount, lowStockItems,
      orderStatuses, recentOrders, trendOrders,
      topProducts, activeCustomers, monthRevenue,
      totalCustomers, totalProducts,
    ] = await Promise.all([
      this.prisma.order.count({ where: { createdAt: { gte: todayStart, lte: todayEnd } } }),
      this.prisma.order.count({ where: { createdAt: { gte: yesterdayStart, lte: yesterdayEnd } } }),
      this.prisma.order.aggregate({ where: { createdAt: { gte: todayStart, lte: todayEnd }, status: { in: PAID_ORDER_STATUSES }, sampleFlag: false }, _sum: { payableAmount: true } }),
      this.prisma.order.aggregate({ where: { createdAt: { gte: yesterdayStart, lte: yesterdayEnd }, status: { in: PAID_ORDER_STATUSES }, sampleFlag: false }, _sum: { payableAmount: true } }),
      this.prisma.order.count({ where: { status: 'pending_quote' } }),
      this.prisma.order.count({ where: { status: 'pending_shipment' } }),
      this.prisma.productSku.count({ where: { stockNum: { lte: 10 }, status: 'active', product: { status: 'active' } } }),
      this.getLowStockItems(),
      this.prisma.order.groupBy({ by: ['status'], _count: { id: true } }),
      this.prisma.order.findMany({ where: { createdAt: { gte: sevenDaysAgo } }, orderBy: { createdAt: 'desc' }, take: 8, select: { id: true, orderNo: true, status: true, payableAmount: true, createdAt: true, customer: { select: { customerName: true } } } }),
      this.prisma.order.groupBy({ by: ['createdAt'], where: { createdAt: { gte: sevenDaysAgo }, status: { in: PAID_ORDER_STATUSES }, sampleFlag: false }, _count: { id: true }, _sum: { payableAmount: true } }),
      this.getTopProducts(),
      this.prisma.customer.count({ where: { status: 'active' } }),
      this.prisma.order.aggregate({ where: { createdAt: { gte: monthStart }, status: { in: PAID_ORDER_STATUSES }, sampleFlag: false }, _sum: { payableAmount: true } }),
      this.prisma.customer.count(),
      this.prisma.product.count({ where: { status: 'active' } }),
    ])

    const trend = this.buildTrend(sevenDaysAgo, trendOrders)
    const statusMap: Record<string, string> = { draft: '草稿', pending_quote: '待报价', pending_confirm: '待客户确认', pending_finance: '待财务审核', pending_shipment: '待发货', shipped: '已发货', completed: '已完成', cancelled: '已取消' }
    const statusColors: Record<string, string> = { draft: '#C0C4CC', pending_quote: '#909399', pending_confirm: '#E6A23C', pending_finance: '#F56C6C', pending_shipment: '#409EFF', shipped: '#67C23A', completed: '#67C23A', cancelled: '#F56C6C' }

    return {
      todayOrders, yesterdayOrders,
      todayRevenue: Number(todayRevenue._sum.payableAmount || 0),
      yesterdayRevenue: Number(yesterdayRevenue._sum.payableAmount || 0),
      monthRevenue: Number(monthRevenue._sum.payableAmount || 0),
      pendingQuotes,
      pendingOrders: pendingQuotes,
      pendingShipments,
      inventoryWarnings: lowStockCount,
      lowStockItems,
      activeCustomers, totalCustomers, totalProducts,
      orderStatuses: orderStatuses.map((s: { status: string; _count: { id: number } }) => ({ name: statusMap[s.status] || s.status, value: s._count.id, color: statusColors[s.status] || '#909399' })),
      recentOrders: recentOrders.map((o: any) => ({ id: o.id, orderNo: o.orderNo, status: o.status, payableAmount: Number(o.payableAmount), customerName: o.customer?.customerName || '', createdAt: o.createdAt })),
      trend,
      topProducts,
    }
  }

  private buildTrend(start: Date, raw: Array<{ createdAt: Date; _count: { id: number }; _sum: { payableAmount: any } }>) {
    const days: Array<{ date: string; orders: number; revenue: number }> = []
    const cur = new Date(start)
    const map = new Map<string, { orders: number; revenue: number }>()
    raw.forEach(r => {
      const key = this.localDateKey(r.createdAt)
      const e = map.get(key) || { orders: 0, revenue: 0 }
      e.orders += r._count.id
      e.revenue += Number(r._sum.payableAmount || 0)
      map.set(key, e)
    })
    for (let i = 0; i < 7; i++) {
      const key = this.localDateKey(cur)
      const e = map.get(key) || { orders: 0, revenue: 0 }
      days.push({ date: key, orders: e.orders, revenue: Math.round(e.revenue * 100) / 100 })
      cur.setDate(cur.getDate() + 1)
    }
    return days
  }

  private localDateKey(date: Date) {
    const pad = (value: number) => String(value).padStart(2, '0')
    return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`
  }

  private async getLowStockItems() {
    try {
      const items = await this.prisma.productSku.findMany({
        where: { stockNum: { lte: 10 }, status: 'active', product: { status: 'active' } },
        orderBy: { stockNum: 'asc' },
        take: 8,
        select: {
          id: true,
          productId: true,
          name: true,
          skuCode: true,
          stockNum: true,
          product: { select: { name: true } }
        }
      })
      return items.map(i => ({
        id: i.id,
        productId: i.productId,
        productName: i.product.name,
        skuName: i.name || i.skuCode || '',
        warehouse: '',
        availableQty: i.stockNum,
        warningQty: 10
      }))
    } catch { return [] }
  }

  private async getTopProducts() {
    try {
      const items = await this.prisma.orderItem.groupBy({ where: { order: { status: { in: PAID_ORDER_STATUSES }, sampleFlag: false } }, by: ['productId'], _sum: { quantity: true, amount: true }, orderBy: { _sum: { amount: 'desc' } }, take: 5 })
      if (!items.length) return []
      const ids = items.map(i => i.productId).filter(Boolean) as number[]
      const products = await this.prisma.product.findMany({ where: { id: { in: ids } }, select: { id: true, name: true } })
      const nm = new Map(products.map(p => [p.id, p.name]))
      return items.map(i => ({ id: i.productId, name: nm.get(i.productId!) || '未知', quantity: i._sum.quantity || 0, revenue: Math.round(Number(i._sum.amount || 0) * 100) / 100 }))
    } catch { return [] }
  }
}
