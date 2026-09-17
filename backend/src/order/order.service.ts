import {
  Injectable,
  NotFoundException,
  BadRequestException,
  ForbiddenException
} from '@nestjs/common'
import { PrismaService } from '../prisma.service'
import { CreateOrderDto, AdjustPriceDto } from './dto/order.dto'
import { customAlphabet } from 'nanoid'
import { ProductVisibilityService } from '../product/product-visibility.service'

const no = customAlphabet('0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ', 16)

const TRANSITIONS: Record<string, string[]> = {
  draft: ['pending_quote', 'cancelled'],
  pending_quote: ['pending_confirm', 'cancelled'],
  pending_confirm: ['pending_finance', 'cancelled'],
  pending_finance: ['pending_shipment', 'cancelled'],
  pending_shipment: ['shipped', 'cancelled'],
  shipped: ['completed'],
  completed: [],
  cancelled: []
}

@Injectable()
export class OrderService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly productVisibility: ProductVisibilityService
  ) {}

  async list(query: { status?: string; customerId?: number; page: number; pageSize: number }) {
    const { status, customerId, page, pageSize } = query
    const where: any = { tenantId: 1 }
    if (status && status !== 'all') where.status = status
    if (customerId) where.customerId = customerId
    const [orders, total] = await Promise.all([
      this.prisma.order.findMany({
        where,
        include: {
          customer: { select: { id: true, customerName: true } },
          items: {
            select: { quantity: true, productName: true },
            orderBy: { id: 'asc' }
          }
        },
        orderBy: { createdAt: 'desc' }, skip: (page - 1) * pageSize, take: pageSize
      }),
      this.prisma.order.count({ where })
    ])
    const items = orders.map(({ items: orderItems, ...order }) => ({
      ...order,
      itemCount: orderItems.reduce((sum, item) => sum + item.quantity, 0),
      productNames: orderItems.slice(0, 2).map(item => item.productName)
    }))
    return { items, page, pageSize, total }
  }

  async detail(id: number) {
    const order = await this.prisma.order.findUnique({
      where: { id },
      include: {
        customer: {
          select: {
            id: true,
            customerName: true,
            contactPhone: true,
            contactName: true,
            creditLimit: true,
            creditUsed: true
          }
        },
        items: { include: { sku: { select: { id: true, skuCode: true, specText: true } } } },
        statusLogs: { orderBy: { createdAt: 'asc' } }
      }
    })
    if (!order) throw new NotFoundException({ message: '订单不存在', errorCode: 'ORD_1001' })
    const customer = order.customer as typeof order.customer | undefined
    const creditLimit = Number(customer?.creditLimit || 0)
    const creditUsed = Number(customer?.creditUsed || 0)
    return {
      ...order,
      customer: customer ? {
        ...customer,
        creditRemaining: Math.max(0, creditLimit - creditUsed).toFixed(2)
      } : customer
    }
  }

  async create(dto: CreateOrderDto, userId?: number) {
    const actor = userId
      ? await this.prisma.user.findUnique({
          where: { id: userId },
          select: { customerId: true, userType: true }
        })
      : null
    const customerId = actor?.customerId ?? dto.customerId
    const customer = await this.prisma.customer.findUnique({ where: { id: customerId } })
    if (!customer) throw new NotFoundException({ message: '客户不存在' })
    if (customer.status !== 'active') throw new BadRequestException({ message: '客户账号未审核通过' })

    const items = this.normalizeItems(dto.items)
    const skuIds = items.map(item => item.skuId)
    const productWhere = await this.productVisibility.whereForCustomer(customerId)
    const skus = await this.prisma.productSku.findMany({
      where: {
        id: { in: skuIds },
        status: 'active',
        product: { is: productWhere }
      },
      include: { product: { select: { id: true, name: true, brandId: true } } }
    })
    if (skus.length !== skuIds.length) {
      throw new BadRequestException({
        message: '商品不存在或暂不可购买，请刷新购物车',
        errorCode: 'PRO_1004'
      })
    }
    this.assertOrderQuantities(items, skus)
    const brandIds = [...new Set(skus.map(sku => sku.product.brandId))]
    if (brandIds.length !== 1) {
      throw new BadRequestException({
        message: '一个订单只能包含同一品牌的商品',
        errorCode: 'ORD_1002'
      })
    }
    const orderBrandId = brandIds[0]
    const now = new Date()
    const priceRules = await this.prisma.customerPriceRule.findMany({
      where: {
        customerId,
        skuId: { in: skuIds },
        status: 'active',
        AND: [
          { OR: [{ startAt: null }, { startAt: { lte: now } }] },
          { OR: [{ endAt: null }, { endAt: { gte: now } }] }
        ]
      },
      select: { skuId: true, price: true }
    })
    const skuMap = new Map(skus.map(s => [s.id, s]))
    const priceMap = new Map(priceRules.filter(rule => rule.skuId != null).map(rule => [rule.skuId!, rule.price]))
    let total = 0
    const orderItems = items.map(item => {
      const sku = skuMap.get(item.skuId)
      if (!sku) throw new NotFoundException({ message: 'SKU ' + item.skuId + ' 不存在或已下架' })
      const agreementPrice = priceMap.get(sku.id)
      const unitPrice = agreementPrice ?? sku.basePrice
      const amt = Number(unitPrice) * item.quantity
      total += amt
      return { tenantId: 1, productId: sku.productId, skuId: sku.id, productName: sku.product.name, skuName: sku.name, skuSpecText: sku.specText, saleUnit: sku.saleUnit, quantity: item.quantity, unitPrice: unitPrice.toString(), amount: amt.toString(), priceSource: agreementPrice !== undefined ? 'agreement' : 'base' }
    })

    const orderNo = 'OD' + no()
    const initialStatus = (dto as any).sampleFlag ? 'pending_shipment' : 'draft'
    const order = await this.prisma.order.create({
      data: {
        tenantId: 1, brandId: orderBrandId, customerId, userId, orderNo,
        status: initialStatus,
        totalAmount: total.toString(), discountAmount: '0', adjustAmount: '0', payableAmount: total.toString(),
        remark: dto.remark, sampleFlag: (dto as any).sampleFlag || false,
        items: { create: orderItems }
      },
      include: { items: true, customer: { select: { id: true, customerName: true } } }
    })
    await this.log(order.id, '', initialStatus, userId)
    return order
  }

  private normalizeItems(items: Array<{ skuId: number; quantity: number }>) {
    const quantityBySku = new Map<number, number>()
    for (const item of items) {
      const quantity = (quantityBySku.get(item.skuId) || 0) + item.quantity
      if (!Number.isSafeInteger(quantity) || quantity <= 0) {
        throw new BadRequestException({ message: '商品数量无效', errorCode: 'ORD_1003' })
      }
      quantityBySku.set(item.skuId, quantity)
    }
    return [...quantityBySku].map(([skuId, quantity]) => ({ skuId, quantity }))
  }

  private assertOrderQuantities(
    items: Array<{ skuId: number; quantity: number }>,
    skus: Array<{ id: number; name: string | null; saleUnit: string; minOrderQty: number; stockNum: number }>
  ) {
    const skuMap = new Map(skus.map(sku => [sku.id, sku]))
    for (const item of items) {
      const sku = skuMap.get(item.skuId)!
      const skuName = sku.name || '该规格'
      if (item.quantity < sku.minOrderQty) {
        throw new BadRequestException({
          message: `${skuName} 起订量为 ${sku.minOrderQty}${sku.saleUnit}`,
          errorCode: 'ORD_1003'
        })
      }
      if (item.quantity > sku.stockNum) {
        throw new BadRequestException({
          message: `${skuName} 库存不足，当前库存 ${sku.stockNum}${sku.saleUnit}`,
          errorCode: 'INV_1001'
        })
      }
    }
  }

  // Admin fills in quoted prices per item, auto-fills from price history
  async quote(id: number, items: Array<{ skuId: number; quotedPrice: number }>, note?: string, userId?: number) {
    await this.assertStaffActor(userId)
    const order = await this.prisma.order.findUnique({ where: { id }, include: { items: true } })
    if (!order || order.status !== 'pending_quote') throw new BadRequestException({ message: '当前状态不允许报价' })

    let total = 0
    for (const qi of items) {
      const oi = order.items.find(i => i.skuId === qi.skuId)
      if (!oi) continue
      await this.prisma.orderItem.update({ where: { id: oi.id }, data: { quotedPrice: qi.quotedPrice.toString(), unitPrice: qi.quotedPrice.toString(), amount: (qi.quotedPrice * oi.quantity).toString(), priceSource: 'manual' } })
      total += qi.quotedPrice * oi.quantity
      // Save to price history
      await this.prisma.customerPriceHistory.create({ data: { tenantId: 1, customerId: order.customerId, skuId: qi.skuId, price: qi.quotedPrice.toString(), orderId: id } })
    }

    await this.prisma.order.update({ where: { id }, data: { quotedAmount: total.toString(), payableAmount: total.toString(), totalAmount: total.toString(), quoteNote: note || '' } })
    return this.transition(id, 'pending_confirm', userId)
  }

  // Get price history for a customer's SKUs (for auto-fill in quoting)
  async getPriceHistory(customerId: number, skuIds: number[]) {
    const history = await this.prisma.customerPriceHistory.findMany({
      where: { customerId, skuId: { in: skuIds } },
      orderBy: { createdAt: 'desc' },
      distinct: ['skuId'],
      select: { skuId: true, price: true }
    })
    return history
  }

  // Customer confirms quote and chooses the single payment method for this order.
  async submitFinance(
    id: number,
    paymentProof?: string,
    creditRequested?: boolean,
    userId?: number
  ) {
    const order = await this.prisma.order.findUnique({ where: { id } })
    if (!order || order.status !== 'pending_confirm') {
      throw new BadRequestException({ message: '当前状态不允许提交' })
    }
    await this.assertCustomerActor(order.customerId, userId)

    const proof = paymentProof || order.paymentProof || null
    if (!creditRequested && !proof) {
      throw new BadRequestException({ message: '请上传转账凭证或选择账期支付' })
    }

    await this.prisma.$transaction(async (tx) => {
      const currentOrder = await tx.order.findUnique({
        where: { id },
        include: {
          customer: { select: { id: true, creditLimit: true, creditUsed: true } }
        }
      })
      if (!currentOrder || currentOrder.status !== 'pending_confirm') {
        throw new BadRequestException({ message: '订单状态已变化，请刷新后重试' })
      }

      if (creditRequested) {
        const creditLimit = Number(currentOrder.customer.creditLimit || 0)
        const creditUsed = Number(currentOrder.customer.creditUsed || 0)
        const payableAmount = Number(currentOrder.payableAmount || 0)
        const creditRemaining = Math.max(0, creditLimit - creditUsed)
        if (payableAmount > creditRemaining) {
          throw new BadRequestException({
            message: `账期额度不足，当前可用 ¥${creditRemaining.toFixed(2)}`,
            errorCode: 'CREDIT_1001'
          })
        }

        const creditUpdate = await tx.customer.updateMany({
          where: {
            id: currentOrder.customerId,
            creditUsed: currentOrder.customer.creditUsed
          },
          data: { creditUsed: { increment: currentOrder.payableAmount } }
        })
        if (creditUpdate.count !== 1) {
          throw new BadRequestException({
            message: '账期额度已变化，请重试',
            errorCode: 'CREDIT_1002'
          })
        }
      }

      const orderUpdate = await tx.order.updateMany({
        where: { id, status: 'pending_confirm' },
        data: {
          status: 'pending_finance',
          paymentMethod: creditRequested ? 'credit' : 'transfer',
          paymentProof: creditRequested ? null : proof,
          creditAmount: creditRequested ? currentOrder.payableAmount : '0',
          confirmedAt: new Date()
        }
      })
      if (orderUpdate.count !== 1) {
        throw new BadRequestException({ message: '订单状态已变化，请刷新后重试' })
      }

      await tx.orderStatusLog.create({
        data: {
          tenantId: currentOrder.tenantId,
          orderId: id,
          fromStatus: 'pending_confirm',
          toStatus: 'pending_finance',
          operatorId: userId
        }
      })
    })
    return this.detail(id)
  }

  // Admin/finance approves: verifies payment, checks stock, deducts inventory (with transaction)
  async approveFinance(id: number, userId?: number) {
    await this.assertStaffActor(userId)
    const order = await this.prisma.order.findUnique({ where: { id }, include: { items: true } })
    if (!order || order.status !== 'pending_finance') throw new BadRequestException({ message: '当前状态不允许审核' })

    await this.prisma.$transaction(async (tx) => {
      for (const item of order.items) {
        const sku = await tx.productSku.findUnique({ where: { id: item.skuId } })
        if (!sku || sku.stockNum < item.quantity) {
          throw new BadRequestException({
            message: '库存不足：' + (sku?.name || item.productName) + ' 当前库存 ' + (sku?.stockNum || 0) + '，需要 ' + item.quantity,
            errorCode: 'INV_1001'
          })
        }
        await tx.productSku.update({ where: { id: item.skuId }, data: { stockNum: { decrement: item.quantity } } })
      }
      await tx.order.update({ where: { id }, data: { status: 'pending_shipment' as any } })
    })

    await this.log(id, 'pending_finance', 'pending_shipment', userId)
    return this.detail(id)
  }

  // Admin enters logistics info
  async ship(id: number, logistics: { logisticsType: string; driverName?: string; driverPhone?: string; plateNumber?: string }, userId?: number) {
    const order = await this.prisma.order.findUnique({ where: { id } })
    if (!order || order.status !== 'pending_shipment') throw new BadRequestException({ message: '当前状态不允许发货' })
    if (logistics.logisticsType !== 'tricycle') {
      if (!logistics.plateNumber || !logistics.driverName || !logistics.driverPhone) {
        throw new BadRequestException({ message: '冷链/普货必须填写车牌号、司机姓名和联系方式' })
      }
    }
    await this.prisma.order.update({
      where: { id },
      data: { logisticsType: logistics.logisticsType, logisticsInfo: logistics as any }
    })
    return this.transition(id, 'shipped', userId)
  }

  // User confirms receipt
  async complete(id: number, userId?: number) {
    return this.transition(id, 'completed', userId)
  }

  // Cancel transactionally and restore every occupied business resource.
  async cancel(id: number, userId?: number) {
    const order = await this.prisma.order.findUnique({
      where: { id },
      include: { items: true }
    })
    if (!order) throw new NotFoundException({ message: '订单不存在' })
    if (!TRANSITIONS[order.status]?.includes('cancelled')) {
      throw new BadRequestException({ message: '当前状态不允许取消' })
    }

    await this.prisma.$transaction(async (tx) => {
      if (['pending_shipment', 'shipped'].includes(order.status)) {
        for (const item of order.items) {
          await tx.productSku.update({
            where: { id: item.skuId },
            data: { stockNum: { increment: item.quantity } }
          })
        }
      }

      const occupiedCredit = Number(order.creditAmount || 0)
      if (order.paymentMethod === 'credit' && occupiedCredit > 0) {
        const customer = await tx.customer.findUnique({
          where: { id: order.customerId },
          select: { creditUsed: true }
        })
        const nextCreditUsed = Math.max(
          0,
          Number(customer?.creditUsed || 0) - occupiedCredit
        )
        await tx.customer.update({
          where: { id: order.customerId },
          data: { creditUsed: nextCreditUsed.toFixed(2) }
        })
      }

      await tx.order.update({ where: { id }, data: { status: 'cancelled' } })
      await tx.orderStatusLog.create({
        data: {
          tenantId: order.tenantId,
          orderId: id,
          fromStatus: order.status,
          toStatus: 'cancelled',
          operatorId: userId
        }
      })
    })
    return this.detail(id)
  }

  async adjustPrice(id: number, dto: AdjustPriceDto, userId?: number) {
    await this.assertStaffActor(userId)
    const order = await this.prisma.order.findUnique({ where: { id } })
    if (!order) throw new NotFoundException({ message: '订单不存在' })
    if (!['draft', 'pending_quote', 'pending_confirm'].includes(order.status)) {
      throw new BadRequestException({ message: '客户确认支付后不允许改价' })
    }
    const before = order.payableAmount
    await this.prisma.order.update({ where: { id }, data: { payableAmount: dto.afterAmount, adjustAmount: (Number(dto.afterAmount) - Number(before)).toString() } })
    return this.detail(id)
  }

  private async assertStaffActor(userId?: number) {
    if (!userId) return
    const actor = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { userType: true }
    })
    if (!actor || actor.userType === 'customer_user') {
      throw new ForbiddenException({
        message: '仅管理端人员可执行此操作',
        errorCode: 'ORD_1004'
      })
    }
  }

  private async assertCustomerActor(customerId: number, userId?: number) {
    if (!userId) {
      throw new ForbiddenException({
        message: '仅订单客户可确认报价',
        errorCode: 'ORD_1005'
      })
    }
    const actor = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { customerId: true, userType: true }
    })
    if (actor?.userType !== 'customer_user' || actor.customerId !== customerId) {
      throw new ForbiddenException({
        message: '仅订单客户可确认报价',
        errorCode: 'ORD_1005'
      })
    }
  }

  // Generic transition helper
  async transition(id: number, toStatus: string, userId?: number) {
    const order = await this.prisma.order.findUnique({ where: { id } })
    if (!order) throw new NotFoundException({ message: '订单不存在' })
    const allowed = TRANSITIONS[order.status]
    if (!allowed?.includes(toStatus)) throw new BadRequestException({ message: '不允许从 ' + order.status + ' 转换到 ' + toStatus })
    await this.prisma.order.update({ where: { id }, data: { status: toStatus as any } })
    await this.log(id, order.status, toStatus, userId)
    return this.detail(id)
  }

  private async log(orderId: number, from: string, to: string, userId?: number) {
    await this.prisma.orderStatusLog.create({ data: { tenantId: 1, orderId, fromStatus: from || '', toStatus: to, operatorId: userId } })
  }
}
