import { Injectable } from '@nestjs/common'
import { OrderStatus, Prisma } from '@prisma/client'
import { PrismaService } from '../prisma.service'
import { shanghaiDay } from '../ai/ai.metrics'

const PAID_ORDER_STATUSES: OrderStatus[] = [
  OrderStatus.pending_shipment,
  OrderStatus.shipped,
  OrderStatus.completed
]

@Injectable()
export class DashboardService {
  constructor(private readonly prisma: PrismaService) {}

  async getStats(scope?: { order: Prisma.OrderWhereInput; product: Prisma.ProductWhereInput; inventory: Prisma.ProductWhereInput; customer: Prisma.CustomerWhereInput }) {
    const scoped = (filter: any, where: any) => filter ? { AND: [filter, where] } : where
    const orderWhere = (where: any = {}) => scoped(scope?.order, where)
    const customerWhere = (where: any = {}) => scoped(scope?.customer, where)
    const productWhere = (where: any = {}) => scoped(scope?.product, where)
    const inventoryProduct = scope ? scoped(scope.inventory, { status: 'active' }) : { status: 'active' }
    const now = new Date()
    const todayStart = new Date(`${shanghaiDay(now)}T00:00:00+08:00`)
    const todayEnd = new Date(todayStart.getTime() + 86400000 - 1)
    const yesterdayStart = new Date(todayStart.getTime() - 86400000)
    const yesterdayEnd = new Date(todayStart.getTime() - 1)
    const sevenDaysAgo = new Date(todayStart.getTime() - 6 * 86400000)
    const monthStart = new Date(`${shanghaiDay(now).slice(0, 7)}-01T00:00:00+08:00`)

    const [
      todayOrders, yesterdayOrders,
      todayRevenue, yesterdayRevenue,
      pendingQuotes, pendingShipments,
      lowStockCount, lowStockItems,
      orderStatuses, recentOrders, trendOrders,
      topProducts, activeCustomers, monthRevenue,
      totalCustomers, totalProducts,
    ] = await Promise.all([
      this.prisma.order.count({ where: orderWhere({ createdAt: { gte: todayStart, lte: todayEnd } }) }),
      this.prisma.order.count({ where: orderWhere({ createdAt: { gte: yesterdayStart, lte: yesterdayEnd } }) }),
      this.prisma.order.aggregate({ where: orderWhere({ createdAt: { gte: todayStart, lte: todayEnd }, status: { in: PAID_ORDER_STATUSES }, sampleFlag: false }), _sum: { payableAmount: true } }),
      this.prisma.order.aggregate({ where: orderWhere({ createdAt: { gte: yesterdayStart, lte: yesterdayEnd }, status: { in: PAID_ORDER_STATUSES }, sampleFlag: false }), _sum: { payableAmount: true } }),
      this.prisma.order.count({ where: orderWhere({ status: 'pending_quote' }) }),
      this.prisma.order.count({ where: orderWhere({ status: 'pending_shipment' }) }),
      this.prisma.productSku.count({ where: { stockNum: { lte: 10 }, status: 'active', product: inventoryProduct } }),
      this.getLowStockItems(scope?.inventory),
      this.prisma.order.groupBy({ ...(scope ? { where: orderWhere() } : {}), by: ['status'], _count: { id: true } }),
      this.prisma.order.findMany({ where: orderWhere({ createdAt: { gte: sevenDaysAgo } }), orderBy: { createdAt: 'desc' }, take: 8, select: { id: true, orderNo: true, status: true, payableAmount: true, createdAt: true, customer: { select: { customerName: true } } } }),
      this.prisma.order.groupBy({ by: ['createdAt'], where: orderWhere({ createdAt: { gte: sevenDaysAgo }, status: { in: PAID_ORDER_STATUSES }, sampleFlag: false }), _count: { id: true }, _sum: { payableAmount: true } }),
      this.getTopProducts(scope?.order, scope?.product),
      this.prisma.customer.count({ where: customerWhere({ status: 'active' }) }),
      this.prisma.order.aggregate({ where: orderWhere({ createdAt: { gte: monthStart }, status: { in: PAID_ORDER_STATUSES }, sampleFlag: false }), _sum: { payableAmount: true } }),
      this.prisma.customer.count(scope ? { where: customerWhere() } : undefined),
      this.prisma.product.count({ where: productWhere({ status: 'active' }) }),
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
      cur.setTime(cur.getTime() + 86400000)
    }
    return days
  }

  private localDateKey(date: Date) {
    return shanghaiDay(date)
  }

  private async getLowStockItems(scope?: Prisma.ProductWhereInput) {
    try {
      const items = await this.prisma.productSku.findMany({
        where: { stockNum: { lte: 10 }, status: 'active', product: scope ? { AND: [scope, { status: 'active' }] } : { status: 'active' } },
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

  private async getTopProducts(orderScope?: Prisma.OrderWhereInput, productScope?: Prisma.ProductWhereInput) {
    try {
      const items = await this.prisma.orderItem.groupBy({ where: { order: orderScope ? { AND: [orderScope, { status: { in: PAID_ORDER_STATUSES }, sampleFlag: false }] } : { status: { in: PAID_ORDER_STATUSES }, sampleFlag: false } }, by: ['productId'], _sum: { quantity: true, amount: true }, orderBy: { _sum: { amount: 'desc' } }, take: 5 })
      if (!items.length) return []
      const ids = items.map(i => i.productId).filter(Boolean) as number[]
      const products = await this.prisma.product.findMany({ where: productScope ? { AND: [productScope, { id: { in: ids } }] } : { id: { in: ids } }, select: { id: true, name: true } })
      const nm = new Map(products.map(p => [p.id, p.name]))
      return items.map(i => ({ id: i.productId, name: nm.get(i.productId!) || '未知', quantity: i._sum.quantity || 0, revenue: Math.round(Number(i._sum.amount || 0) * 100) / 100 }))
    } catch { return [] }
  }
}
