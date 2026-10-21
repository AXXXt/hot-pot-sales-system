import {
  Injectable,
  NotFoundException,
  BadRequestException,
  ForbiddenException
} from '@nestjs/common'
import { PrismaService } from '../prisma.service'
import { CreateOrderDto, AdjustPriceDto, CreateRefundDto } from './dto/order.dto'
import { customAlphabet } from 'nanoid'
import { ProductVisibilityService } from '../product/product-visibility.service'
import { productDisplayName } from '../product/product-presentation'
import { AuditService } from '../audit/audit.service'
import { WxService } from '../notify/wx.service'
import { LogisticsService } from '../logistics/logistics.service'
import { MetricsService } from '../monitor/metrics.service'
import { Prisma } from '@prisma/client'
import { stockAvailability } from '../inventory/stock-availability'
import { changeStock, reserveOrder, BatchAllocation } from '../inventory/stock-ledger'

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
    private readonly productVisibility: ProductVisibilityService,
    private readonly audit: AuditService,
    private readonly wx: WxService,
    private readonly logistics: LogisticsService,
    private readonly metrics?: MetricsService
  ) {}

  async list(query: { status?: string; customerId?: number; tenantId?: number; page: number; pageSize: number }) {
    const { status, customerId, page, pageSize } = query
    const where: any = { tenantId: query.tenantId || 1 }
    if (status === 'pending') where.status = { notIn: ['completed', 'cancelled'] }
    else if (status && status !== 'all') where.status = status
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
        statusLogs: { orderBy: { createdAt: 'asc' } },
        refunds: { orderBy: { createdAt: 'asc' } }
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

  async overview(scope: { tenantId: number; customerId: number }) {
    if (!scope.tenantId || !scope.customerId) throw new ForbiddenException('当前账号未关联客户')
    const where = { tenantId: scope.tenantId, customerId: scope.customerId }
    const [groups, recentOrders] = await Promise.all([
      this.prisma.order.groupBy({ by: ['status'], where, _count: { _all: true } }),
      this.prisma.order.findMany({
        where: { ...where, status: 'completed' },
        orderBy: [{ updatedAt: 'desc' }, { id: 'desc' }], take: 2,
        select: {
          id: true, orderNo: true, createdAt: true, updatedAt: true,
          items: {
            orderBy: { id: 'asc' },
            select: {
              productName: true, skuSpecText: true, quantity: true, saleUnit: true,
              sku: { select: { product: { select: { mainImageUrl: true } } } }
            }
          }
        }
      })
    ])
    const counts: Record<string, number> = {}
    groups.forEach(group => { counts[group.status] = group._count._all })
    return {
      counts,
      recentOrders: recentOrders.map(order => ({
        id: order.id, orderNo: order.orderNo, createdAt: order.createdAt,
        itemCount: order.items.reduce((sum, item) => sum + item.quantity, 0),
        productName: order.items[0]?.productName || '',
        spec: order.items[0]?.skuSpecText || '',
        image: order.items[0]?.sku?.product?.mainImageUrl || '',
        skuCount: order.items.length
      }))
    }
  }

  async getLogistics(id: number) {
    const order = await this.prisma.order.findUnique({
      where: { id },
      select: { id: true, logisticsType: true, logisticsInfo: true, status: true, createdAt: true }
    })
    if (!order) throw new NotFoundException({ message: '订单不存在', errorCode: 'ORD_1001' })
    return this.logistics.getOrderTrack(order)
  }

  async create(dto: CreateOrderDto, userId?: number) {
    await this.metrics?.recordOrderAttempt()
    try {
      return await this.createOrder(dto, userId)
    } catch (error) {
      await this.metrics?.recordOrderFailure()
      throw error
    }
  }

  async createDraftInTransaction(tx: Prisma.TransactionClient, dto: CreateOrderDto, userId: number) { return this.createOrder(dto, userId, tx) }

  private async createOrder(dto: CreateOrderDto, userId?: number, db: Prisma.TransactionClient = this.prisma) {
    const actor = userId
      ? await db.user.findUnique({
          where: { id: userId },
          select: { customerId: true, userType: true, tenantId: true }
        })
      : null
    const customerId = actor?.userType === 'customer_user' ? actor.customerId! : dto.customerId
    const customer = await db.customer.findUnique({ where: { id: customerId } })
    if (!customer) throw new NotFoundException({ message: '客户不存在' })
    if (actor?.tenantId && customer.tenantId !== actor.tenantId) throw new ForbiddenException('无权为该客户创建订单')
    if (customer.status !== 'active') throw new BadRequestException({ message: '客户账号未审核通过' })

    const items = this.normalizeItems(dto.items)
    const skuIds = items.map(item => item.skuId)
    const productWhere = await this.productVisibility.whereForCustomer(customerId)
    const skus = await db.productSku.findMany({
      where: {
        id: { in: skuIds },
        tenantId: customer.tenantId,
        status: 'active',
        product: { is: { ...productWhere, tenantId: customer.tenantId } }
      },
      include: { product: { select: { id: true, name: true, subtitle: true, brandId: true } } }
    })
    if (skus.length !== skuIds.length) {
      throw new BadRequestException({
        message: '商品不存在或暂不可购买，请刷新购物车',
        errorCode: 'PRO_1004'
      })
    }
    const available = await stockAvailability(db, skus)
    this.assertOrderQuantities(items, skus.map(sku => ({ ...sku, stockNum: available.get(sku.id) || 0, reservedNum: 0 })))
    const brandIds = [...new Set(skus.map(sku => sku.product.brandId))]
    if (brandIds.length !== 1) {
      throw new BadRequestException({
        message: '一个订单只能包含同一品牌的商品',
        errorCode: 'ORD_1002'
      })
    }
    const orderBrandId = brandIds[0]
    const now = new Date()
    const priceRules = await db.customerPriceRule.findMany({
      where: {
        tenantId: customer.tenantId,
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
    let total = new Prisma.Decimal(0)
    const orderItems = items.map(item => {
      const sku = skuMap.get(item.skuId)
      if (!sku) throw new NotFoundException({ message: 'SKU ' + item.skuId + ' 不存在或已下架' })
      const agreementPrice = priceMap.get(sku.id)
      const unitPrice = agreementPrice ?? sku.basePrice
      const amt = new Prisma.Decimal(unitPrice).mul(item.quantity)
      total = total.add(amt)
      return { tenantId: customer.tenantId, productId: sku.productId, skuId: sku.id, productName: productDisplayName(sku.product), skuName: sku.name, skuSpecText: sku.specText, saleUnit: sku.saleUnit, quantity: item.quantity, unitPrice: unitPrice.toString(), amount: amt.toString(), priceSource: agreementPrice !== undefined ? 'agreement' : 'base' }
    })

    const orderNo = 'OD' + no()
    const initialStatus = (dto as any).sampleFlag ? 'pending_shipment' : 'draft'
    const order = await db.order.create({
      data: {
        tenantId: customer.tenantId, brandId: orderBrandId, customerId, userId, orderNo,
        status: initialStatus,
        totalAmount: total.toString(), discountAmount: '0', adjustAmount: '0', payableAmount: total.toString(),
        remark: dto.remark, sampleFlag: (dto as any).sampleFlag || false,
        items: { create: orderItems },
        statusLogs: { create: { tenantId: customer.tenantId, fromStatus: '', toStatus: initialStatus, operatorId: userId } }
      },
      include: { items: true, customer: { select: { id: true, customerName: true } } }
    })
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
    skus: Array<{ id: number; name: string | null; saleUnit: string; minOrderQty: number; stockNum: number; reservedNum?: number }>
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
      if (item.quantity > sku.stockNum - (sku.reservedNum || 0)) {
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

    if (!Array.isArray(items) || items.length !== order.items.length || !items.length
      || new Set(items.map(item => item.skuId)).size !== items.length
      || items.some(item => !order.items.some(oi => oi.skuId === item.skuId))) {
      throw new BadRequestException('请为订单中的每个商品填写一次完整报价')
    }
    const prices = items.map(item => this.money(item.quotedPrice))
    let total = new Prisma.Decimal(0)
    await this.prisma.$transaction(async tx => {
      await this.claimOrder(tx, order, 'pending_confirm')
      for (const [index, qi] of items.entries()) {
        const oi = order.items.find(i => i.skuId === qi.skuId)
        const amount = prices[index].mul(oi!.quantity)
        await tx.orderItem.update({ where: { id: oi!.id }, data: { quotedPrice: prices[index], unitPrice: prices[index], amount, priceSource: 'manual' } })
        total = total.add(amount)
        await tx.customerPriceHistory.create({ data: { tenantId: order.tenantId, customerId: order.customerId, skuId: qi.skuId, price: prices[index], orderId: id } })
      }

      await tx.order.update({ where: { id }, data: { quotedAmount: total, payableAmount: total, totalAmount: total, adjustAmount: '0', discountAmount: '0', quoteNote: note || '' } })
      await this.logInTransaction(tx, order, 'pending_confirm', userId)
    })
    await this.audit.write({
      action: 'price_change',
      module: 'order',
      targetType: 'order',
      targetId: id,
      beforeData: { quotedAmount: order.quotedAmount?.toString() ?? null },
      afterData: { quotedAmount: total.toString(), quoteNote: note || '', items: items.map((item) => ({ skuId: item.skuId, quotedPrice: item.quotedPrice })) },
      operatorId: userId
    })
    await this.notifyOrderStatus(order, 'pending_confirm')
    return this.detail(id)
  }

  // Get price history for a customer's SKUs (for auto-fill in quoting)
  async getPriceHistory(customerId: number, skuIds: number[], tenantId = 1) {
    const history = await this.prisma.customerPriceHistory.findMany({
      where: { tenantId, customerId, skuId: { in: skuIds } },
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
    if (!creditRequested && proof !== order.paymentProof) {
      const file = await this.prisma.file.findFirst({
        where: { tenantId: order.tenantId, createdBy: userId, fileType: 'payment-proof', fileUrl: proof! }
      })
      if (!file) throw new BadRequestException('请上传本人有效的转账凭证')
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
        where: { id, status: 'pending_confirm', updatedAt: currentOrder.updatedAt },
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

    try {
      await this.prisma.$transaction(async (tx) => {
        await this.claimOrder(tx, order, 'pending_shipment')
        if (order.stockReserved) await reserveOrder(tx, order, order.items, true)
        for (const item of [...order.items].sort((a, b) => a.skuId - b.skuId)) {
          const sku = await tx.productSku.findUnique({ where: { id: item.skuId } })
          if (!sku || sku.stockNum - (sku.reservedNum || 0) < item.quantity) {
            throw new BadRequestException({
              message: '库存不足：' + (sku?.name || item.productName) + ' 当前库存 ' + (sku?.stockNum || 0) + '，需要 ' + item.quantity,
              errorCode: 'INV_1001'
            })
          }
          const beforeStock = sku.stockNum
          const afterStock = beforeStock - item.quantity
          const batchAllocations = await changeStock(tx, sku, afterStock, { orderOut: true })
          await tx.stockMovement.create({
            data: {
              tenantId: order.tenantId,
              skuId: item.skuId,
              productId: sku.productId,
              changeQty: -item.quantity,
              beforeQty: beforeStock,
              afterQty: afterStock,
              type: 'order_out', batchAllocations: batchAllocations as unknown as Prisma.InputJsonValue,
              sourceType: 'order',
              sourceId: order.id,
              operatorId: userId,
              remark: `订单 ${order.orderNo} 审核扣减库存`
            }
          })
        }
        await this.logInTransaction(tx, order, 'pending_shipment', userId)
      })

      await this.notifyOrderStatus(order, 'pending_shipment')
      return this.detail(id)
    } catch (error) {
      await this.metrics?.recordInventoryFailure()
      throw error
    }
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
    if (!['tricycle', 'cold-chain', 'regular'].includes(logistics.logisticsType)) throw new BadRequestException('配送方式无效')
    await this.prisma.$transaction(async tx => {
      await this.claimOrder(tx, order, 'shipped')
      await tx.order.update({
        where: { id },
        data: { logisticsType: logistics.logisticsType, logisticsInfo: logistics as any }
      })
      await this.logInTransaction(tx, order, 'shipped', userId)
    })
    await this.notifyOrderStatus(order, 'shipped')
    return this.detail(id)
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
      await this.claimOrder(tx, order, 'cancelled')
      if (order.stockReserved) await reserveOrder(tx, order, order.items, true)
      if (['pending_shipment', 'shipped'].includes(order.status)) {
        for (const item of [...order.items].sort((a, b) => a.skuId - b.skuId)) {
          const sku = await tx.productSku.findUnique({ where: { id: item.skuId } })
          const beforeStock = sku?.stockNum ?? 0
          const afterStock = beforeStock + item.quantity
          const original = sku?.batchTracking ? await tx.stockMovement.findFirst({ where: { tenantId: order.tenantId, skuId: item.skuId, sourceType: 'order', sourceId: order.id, type: 'order_out' } }) : null
          const batchAllocations = await changeStock(tx, sku, afterStock, { restore: original?.batchAllocations as unknown as BatchAllocation[] | undefined, historicalReturn: !Array.isArray(original?.batchAllocations) || !original.batchAllocations.length })
          await tx.stockMovement.create({
            data: {
              tenantId: order.tenantId,
              skuId: item.skuId,
              productId: sku?.productId ?? null,
              changeQty: item.quantity,
              beforeQty: beforeStock,
              afterQty: afterStock,
              type: 'order_return', batchAllocations: batchAllocations as unknown as Prisma.InputJsonValue,
              sourceType: 'order',
              sourceId: order.id,
              operatorId: userId,
              remark: `取消订单 ${order.orderNo} 退回库存`
            }
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
        const creditUpdate = await tx.customer.updateMany({
          where: { id: order.customerId, creditUsed: customer!.creditUsed },
          data: { creditUsed: nextCreditUsed.toFixed(2) }
        })
        if (creditUpdate.count !== 1) throw new BadRequestException('账期额度已变化，请重试')
      }

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
    await this.notifyOrderStatus(order, 'cancelled')
    return this.detail(id)
  }

  async adjustPrice(id: number, dto: AdjustPriceDto, userId?: number) {
    await this.assertStaffActor(userId)
    const order = await this.prisma.order.findUnique({ where: { id } })
    if (!order) throw new NotFoundException({ message: '订单不存在' })
    if (!['draft', 'pending_quote', 'pending_confirm'].includes(order.status)) {
      throw new BadRequestException({ message: '客户确认支付后不允许改价' })
    }
    const before = Number(order.payableAmount)
    const afterAmount = this.money(dto.afterAmount)

    await this.prisma.$transaction(async (tx) => {
      const updated = await tx.order.updateMany({
        where: { id, status: order.status, updatedAt: order.updatedAt },
        data: {
          payableAmount: dto.afterAmount,
          adjustAmount: afterAmount.minus(order.totalAmount).add(order.discountAmount).toString()
        }
      })
      if (updated.count !== 1) throw new BadRequestException('订单已变化，请刷新后重试')
      await tx.orderPriceAdjustment.create({
        data: {
          tenantId: order.tenantId,
          orderId: id,
          beforeAmount: before.toString(),
          afterAmount: dto.afterAmount,
          reason: dto.reason,
          adjustedBy: userId ?? null
        }
      })
    })

    await this.audit.write({
      action: 'price_change',
      module: 'order',
      targetType: 'order',
      targetId: id,
      beforeData: { payableAmount: before.toString() },
      afterData: { payableAmount: dto.afterAmount, adjustAmount: afterAmount.minus(order.totalAmount).add(order.discountAmount).toString(), reason: dto.reason },
      operatorId: userId
    })
    return this.detail(id)
  }

  async refund(id: number, dto: CreateRefundDto, userId?: number) {
    await this.assertStaffActor(userId)
    const order = await this.prisma.order.findUnique({ where: { id } })
    if (!order) throw new NotFoundException({ message: '订单不存在', errorCode: 'ORD_1001' })
    if (order.status !== 'cancelled') {
      throw new BadRequestException({ message: '仅已取消订单可登记退款', errorCode: 'ORD_1006' })
    }
    const amount = this.money(dto.amount)

    const refund = await this.prisma.$transaction(async tx => {
      // Serialize refund totals for the same order before reading prior refunds.
      await tx.$queryRaw`SELECT id FROM orders WHERE id = ${id} FOR UPDATE`
      const previous = await tx.orderRefund.aggregate({ where: { orderId: id }, _sum: { amount: true } })
      if (amount.add(previous._sum.amount || 0).gt(order.payableAmount)) {
        throw new BadRequestException({ message: '累计退款金额不能超过订单应付金额', errorCode: 'ORD_1008' })
      }
      return tx.orderRefund.create({
        data: {
          tenantId: order.tenantId,
          orderId: id,
          amount: dto.amount,
          method: dto.method || 'transfer',
          reason: dto.reason,
          operatorId: userId ?? null
        }
      })
    })

    await this.audit.write({
      action: 'price_change',
      module: 'order',
      targetType: 'order_refund',
      targetId: refund.id,
      afterData: { orderId: id, amount: dto.amount, method: refund.method, reason: dto.reason ?? null },
      operatorId: userId
    })
    return refund
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
    if (toStatus === 'cancelled') return this.cancel(id, userId)
    const order = await this.prisma.order.findUnique({ where: { id } })
    if (!order) throw new NotFoundException({ message: '订单不存在' })
    const allowed = TRANSITIONS[order.status]
    if (!allowed?.includes(toStatus)) throw new BadRequestException({ message: '不允许从 ' + order.status + ' 转换到 ' + toStatus })
    if (!['pending_quote', 'completed'].includes(toStatus)) throw new BadRequestException('请通过对应业务操作更新订单')
    await this.prisma.$transaction(async tx => {
      await this.claimOrder(tx, order, toStatus)
      if (toStatus === 'pending_quote') {
        const items = await tx.orderItem.findMany({ where: { orderId: order.id, tenantId: order.tenantId } })
        await reserveOrder(tx, order, items)
      }
      await this.logInTransaction(tx, order, toStatus, userId)
    })
    await this.audit.write({
      action: 'order_status_change',
      module: 'order',
      targetType: 'order',
      targetId: id,
      beforeData: { status: order.status },
      afterData: { status: toStatus },
      operatorId: userId
    })
    await this.notifyOrderStatus(order, toStatus)
    return this.detail(id)
  }

  /** 订单状态变化时向已绑定微信的客户发送订阅消息；失败不阻断业务 */
  private async notifyOrderStatus(
    order: { id: number; userId?: number | null; orderNo: string },
    toStatus: string
  ): Promise<void> {
    const templateId = this.wx.orderTemplateId
    if (!templateId || !order.userId) return
    try {
      const user = await this.prisma.user.findUnique({
        where: { id: order.userId },
        select: { openid: true }
      })
      if (!user?.openid) return
      const statusText: Record<string, string> = {
        pending_quote: '待报价',
        pending_confirm: '待确认',
        pending_finance: '待财务审核',
        pending_shipment: '待发货',
        shipped: '已发货',
        completed: '已完成',
        cancelled: '已取消'
      }
      await this.wx.sendSubscribeMessage({
        openid: user.openid,
        templateId,
        page: `pages/order-detail/order-detail?id=${order.id}`,
        data: {
          thing1: { value: order.orderNo.slice(0, 20) },
          phrase2: { value: statusText[toStatus] || toStatus }
        }
      })
    } catch {
      // 通知失败不影响业务
    }
  }

  private money(value: string | number) {
    if (!/^\d{1,16}(?:\.\d{1,2})?$/.test(String(value))) throw new BadRequestException('金额格式无效，最多保留两位小数')
    const amount = new Prisma.Decimal(value)
    if (!amount.isFinite() || amount.lte(0)) throw new BadRequestException('金额必须大于 0')
    return amount
  }

  private async claimOrder(tx: Prisma.TransactionClient, order: { id: number; status: string; updatedAt: Date }, status: string) {
    const result = await tx.order.updateMany({
      where: { id: order.id, status: order.status as any, updatedAt: order.updatedAt },
      data: { status: status as any }
    })
    if (result.count !== 1) throw new BadRequestException('订单状态已变化，请刷新后重试')
  }

  private async logInTransaction(tx: Prisma.TransactionClient, order: { id: number; tenantId: number; status: string }, to: string, userId?: number) {
    await tx.orderStatusLog.create({ data: { tenantId: order.tenantId, orderId: order.id, fromStatus: order.status, toStatus: to, operatorId: userId } })
  }
}
