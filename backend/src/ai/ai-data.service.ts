import { Injectable, NotFoundException } from '@nestjs/common'
import { PrismaService } from '../prisma.service'
import { StaffAccessService, StaffActor } from '../auth/staff-access.service'
import { metricRange } from './ai.metrics'
import { EFFECTIVE_ORDER_STATUSES } from './ai.types'
import { presentProduct } from '../product/product-presentation'

@Injectable()
export class AiDataService {
  constructor(private readonly prisma: PrismaService, private readonly access: StaffAccessService) {}

  async options(actor: StaffActor) {
    this.access.require(actor, 'product:create')
    const [brands, categories] = await Promise.all([
      this.prisma.brand.findMany({ where: { tenantId: actor.tenantId, status: 'active', ...(actor.superAdmin ? {} : { id: { in: actor.brandIds } }) }, select: { id: true, name: true }, orderBy: { name: 'asc' } }),
      this.prisma.productCategory.findMany({ where: { tenantId: actor.tenantId, status: 'active' }, select: { id: true, name: true }, orderBy: { name: 'asc' } })
    ])
    return { brands, categories, canCreateBrand: this.access.has(actor, 'brand:manage'), canCreateCategory: this.access.has(actor, 'product:update') }
  }

  async orders(actor: StaffActor, keyword = '', status?: string) {
    this.access.require(actor, 'order:read')
    const statuses = ['draft', 'pending_quote', 'pending_confirm', 'pending_finance', 'pending_shipment', 'shipped', 'completed', 'cancelled']
    const items = await this.prisma.order.findMany({
      where: { AND: [this.access.orderWhere(actor), ...(keyword ? [{ orderNo: { contains: keyword.slice(0, 100) } }] : []), ...(status && statuses.includes(status) ? [{ status: status as any }] : [])] },
      select: { id: true, orderNo: true, status: true, createdAt: true }, orderBy: { createdAt: 'desc' }, take: 20
    })
    return { type: 'orders', title: '订单查询', items, note: '仅展示当前权限范围内最近20条订单' }
  }

  async lowStock(actor: StaffActor) {
    this.access.require(actor, 'inventory:read')
    const items = await this.prisma.productSku.findMany({
      where: { tenantId: actor.tenantId, stockNum: { lte: 10 }, status: 'active', product: { AND: [this.access.productWhere(actor), { status: 'active' }] } },
      select: { id: true, productId: true, specText: true, saleUnit: true, stockNum: true, product: { select: { name: true, subtitle: true } } },
      orderBy: { stockNum: 'asc' }, take: 20
    })
    return { type: 'inventory', title: '库存预警', items, note: '预警线10个销售单位；按SKU分别显示，不混加箱、袋等单位' }
  }

  async tasks(actor: StaffActor) {
    this.access.require(actor, 'task:manage_own')
    return { type: 'tasks', title: '我的事务', items: await this.prisma.opsTask.findMany({ where: { tenantId: actor.tenantId, ownerId: actor.id, status: 'pending' }, orderBy: { dueAt: 'asc' }, take: 30 }) }
  }

  async todos(actor: StaffActor) {
    const result: unknown[] = []
    if (this.access.has(actor, 'order:read')) {
      const base = this.access.orderWhere(actor)
      const [quotes, shipments] = await Promise.all([
        this.prisma.order.count({ where: { AND: [base, { status: 'pending_quote' }] } }),
        this.prisma.order.count({ where: { AND: [base, { status: 'pending_shipment' }] } })
      ])
      result.push({ type: 'counts', title: '订单待办', items: [{ label: '待报价', value: quotes, path: '/orders?status=pending_quote' }, { label: '待发货', value: shipments, path: '/orders?status=pending_shipment' }] })
    }
    if (this.access.has(actor, 'inventory:read')) result.push(await this.lowStock(actor))
    if (this.access.has(actor, 'lead:read')) {
      const leads = await this.prisma.lead.findMany({ where: { AND: [this.access.leadWhere(actor), { status: { in: ['new', 'contacted'] }, OR: [{ nextFollowUpAt: { lte: new Date() } }, { status: 'new' }] }] }, select: { id: true, storeName: true, status: true, nextFollowUpAt: true }, orderBy: { createdAt: 'desc' }, take: 20 })
      result.push({ type: 'leads', title: '待跟进线索', items: leads })
    }
    if (this.access.has(actor, 'task:manage_own')) result.push(await this.tasks(actor))
    return result
  }

  async metrics(actor: StaffActor, period = 'week') {
    this.access.require(actor, 'analytics:view', 'order:read')
    const range = metricRange(period)
    const base = this.access.orderWhere(actor)
    const where = { AND: [base, { status: { in: [...EFFECTIVE_ORDER_STATUSES] }, sampleFlag: false, createdAt: { gte: range.start, lt: range.end } }] }
    const previousWhere = { AND: [base, { status: { in: [...EFFECTIVE_ORDER_STATUSES] }, sampleFlag: false, createdAt: { gte: range.previousStart, lt: range.previousEnd } }] }
    const [current, previous, top] = await Promise.all([
      this.prisma.order.aggregate({ where, _sum: { payableAmount: true }, _count: { id: true } }),
      this.prisma.order.aggregate({ where: previousWhere, _sum: { payableAmount: true }, _count: { id: true } }),
      this.prisma.orderItem.groupBy({ by: ['productId', 'productName', 'saleUnit'], where: { tenantId: actor.tenantId, order: where }, _sum: { quantity: true, amount: true }, orderBy: { _sum: { amount: 'desc' } }, take: 10 })
    ])
    const amount = current._sum.payableAmount
    return { type: 'metrics', title: '经营统计', period, timezone: range.timezone,
      start: range.start, end: range.end, previousStart: range.previousStart, previousEnd: range.previousEnd,
      amount: amount?.toFixed(2) ?? '0.00', orders: current._count.id,
      average: amount && current._count.id ? amount.div(current._count.id).toFixed(2) : null,
      previousAmount: previous._sum.payableAmount?.toFixed(2) ?? '0.00',
      top: top.map(x => ({ productId: x.productId, name: x.productName, unit: x.saleUnit, quantity: x._sum.quantity ?? 0, amount: x._sum.amount?.toFixed(2) ?? '0.00' })),
      definition: '有效订单金额：按下单时间，待发货/已发货/已完成，排除样品；不是实收或利润。排名使用明细金额，可能与订单优惠调整后的应付额不同。',
      queriedAt: new Date() }
  }

  async products(actor: StaffActor, keyword: string) {
    this.access.require(actor, 'product:read')
    const items = await this.prisma.product.findMany({
      where: { AND: [this.access.productWhere(actor), { status: { not: 'archived' }, OR: [{ name: { contains: keyword.slice(0, 100) } }, { subtitle: { contains: keyword.slice(0, 100) } }, { code: { contains: keyword.slice(0, 100) } }] }] },
      select: { id: true, code: true, name: true, subtitle: true, status: true, mainImageUrl: true, _count: { select: { skus: true } } }, take: 20
    })
    return { type: 'products', title: '商品查询', items: items.map(presentProduct) }
  }

  async customers(actor: StaffActor, keyword: string) {
    this.access.require(actor, 'customer:manage')
    return { type: 'customers', title: '客户查询', items: await this.prisma.customer.findMany({ where: { AND: [this.access.customerWhere(actor), { customerName: { contains: keyword.slice(0, 100) } }] }, select: { id: true, customerName: true, status: true }, orderBy: { updatedAt: 'desc' }, take: 20 }), note: '仅返回授权客户的门店名称和状态，联系人等资料请在客户页面按权限查看。' }
  }

  async quality(actor: StaffActor) {
    this.access.require(actor, 'product:read')
    const items = await this.prisma.product.findMany({ where: { AND: [this.access.productWhere(actor), { status: { not: 'archived' }, OR: [{ subtitle: null }, { subtitle: '' }, { mainImageUrl: null }, { mainImageUrl: '' }, { skus: { none: {} } }] }] }, select: { id: true, name: true, subtitle: true, mainImageUrl: true, _count: { select: { skus: true } } }, take: 30 })
    return { type: 'quality', title: '商品资料检查', items: items.map(presentProduct), note: '检查缺商品名称、缺主图与缺规格，最多展示30项' }
  }

  async quoteAssist(actor: StaffActor, orderId: number) {
    this.access.require(actor, 'order:read', 'order:confirm')
    if (!Number.isSafeInteger(orderId) || orderId <= 0) throw new NotFoundException('订单不可访问')
    const order = await this.prisma.order.findFirst({ where: { AND: [this.access.orderWhere(actor), { id: orderId }] },
      select: { id: true, orderNo: true, customerId: true, status: true, items: { take: 20, select: { skuId: true, productName: true, skuSpecText: true, saleUnit: true, unitPrice: true } } } })
    if (!order) throw new NotFoundException('订单不存在或不可访问')
    const items = await Promise.all(order.items.map(async item => {
      const historical = await this.prisma.customerPriceHistory.findFirst({ where: { tenantId: actor.tenantId, customerId: order.customerId, skuId: item.skuId }, orderBy: [{ createdAt: 'desc' }, { id: 'desc' }], select: { price: true, createdAt: true } })
      return { skuId: item.skuId, name: item.productName, specText: item.skuSpecText, unit: item.saleUnit, currentPrice: item.unitPrice.toFixed(2), historicalPrice: historical?.price.toFixed(2) ?? null, historicalAt: historical?.createdAt ?? null }
    }))
    return { type: 'quote', title: `报价参考 · ${order.orderNo}`, orderId: order.id, items, note: '历史价仅作参考，不代表当前授权售价；确认报价请进入原订单页面。每次最多展示20个规格。' }
  }

  async replenishment(actor: StaffActor) {
    this.access.require(actor, 'inventory:read', 'analytics:view', 'order:read')
    const stock = await this.lowStock(actor)
    if (!stock.items.length) return { ...stock, title: '补货建议', note: '当前权限范围内没有触发预警的SKU。' }
    const sales = await this.prisma.orderItem.groupBy({ by: ['skuId', 'saleUnit'], where: { tenantId: actor.tenantId, skuId: { in: stock.items.map(x => x.id) }, order: {
      AND: [this.access.orderWhere(actor), { sampleFlag: false, status: { in: ['shipped', 'completed'] }, createdAt: { gte: new Date(Date.now() - 14 * 86400000), lt: new Date() } }]
    } }, _sum: { quantity: true } })
    const items = stock.items.map(item => {
      const quantity = sales.find(x => x.skuId === item.id && x.saleUnit === item.saleUnit)?._sum.quantity ?? 0
      return { ...item, recentQuantity: quantity, suggestedQuantity: quantity > 0 ? Math.max(0, Math.ceil(quantity / 14 * 7 - item.stockNum)) : null }
    })
    return { type: 'inventory', title: '补货建议', items, note: '仅依据当前授权订单范围、最近14天下单且已发货/完成的数量估算7天需求；无记录时不估算。未计采购在途，不自动生成采购或入库。' }
  }
}
