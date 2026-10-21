import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common'
import { randomUUID } from 'node:crypto'
import { PrismaService } from '../prisma.service'
import { StaffAccessService, StaffActor } from '../auth/staff-access.service'
import { productDisplayName } from '../product/product-presentation'
import { batchDates, businessDate, ReceiptBatch } from './stock-ledger'

@Injectable()
export class InventoryPlanningService {
  constructor(private readonly prisma: PrismaService, private readonly access: StaffAccessService) {}

  private scope(actor: StaffActor) { return { AND: [this.access.productWhere(actor), { status: 'active' as const, brand: { status: 'active' as const } }] } }

  async overview(actor: StaffActor, keyword = '') {
    this.access.require(actor, 'inventory:read')
    const items = await this.prisma.productSku.findMany({ where: { tenantId: actor.tenantId, status: 'active', product: this.scope(actor),
      ...(keyword ? { OR: [{ skuCode: { contains: keyword.slice(0, 100) } }, { product: { subtitle: { contains: keyword.slice(0, 100) } } }, { product: { name: { contains: keyword.slice(0, 100) } } }] } : {}) },
      include: { product: { select: { name: true, subtitle: true, brandId: true } }, batches: { where: { quantity: { gt: 0 } } } }, orderBy: { id: 'asc' }, take: 500 })
    const skuIds = items.map(x => x.id), now = new Date(), from = new Date(now.getTime() - 28 * 86400000)
    const canForecast = this.access.has(actor, 'analytics:view') && this.access.has(actor, 'order:read')
    const [sales, pending] = await Promise.all([
      canForecast ? this.prisma.orderItem.groupBy({ by: ['skuId'], where: { tenantId: actor.tenantId, skuId: { in: skuIds }, order: { AND: [this.access.orderWhere(actor), { sampleFlag: false, status: { in: ['shipped', 'completed'] }, createdAt: { gte: from, lt: now } }] } }, _sum: { quantity: true } }) : [],
      this.access.has(actor, 'order:read') ? this.prisma.orderItem.groupBy({ by: ['skuId'], where: { tenantId: actor.tenantId, skuId: { in: skuIds }, order: { AND: [this.access.orderWhere(actor), { status: { in: ['pending_quote', 'pending_confirm', 'pending_finance'] } }] } }, _sum: { quantity: true } }) : []
    ])
    const today = businessDate(), soon = new Date(today.getTime() + 30 * 86400000)
    return { items: items.map(sku => {
      const sold28 = sales.find(x => x.skuId === sku.id)?._sum.quantity || 0
      const available = Math.max(0, sku.stockNum - sku.reservedNum - sku.batches.filter(x => x.expiryDate && x.expiryDate <= businessDate()).reduce((sum, x) => sum + x.quantity, 0))
      const forecastThreshold = canForecast && sold28 > 0 ? Math.ceil(sold28 / 28 * sku.leadTimeDays + sku.safetyStock) : sku.lowStockThreshold
      const threshold = Math.max(sku.lowStockThreshold, forecastThreshold)
      const target = canForecast && sold28 > 0 ? Math.ceil(sold28 / 28 * (sku.leadTimeDays + 7) + sku.safetyStock) : threshold
      return { skuId: sku.id, productId: sku.productId, skuCode: sku.skuCode, productName: productDisplayName(sku.product), specText: sku.specText, saleUnit: sku.saleUnit, stockNum: sku.stockNum, reservedNum: sku.reservedNum,
        pendingDemand: this.access.has(actor, 'order:read') ? pending.find(x => x.skuId === sku.id)?._sum.quantity || 0 : null,
        availableNum: available, packagingUnits: sku.packagingUnits, lowStockThreshold: sku.lowStockThreshold, leadTimeDays: sku.leadTimeDays, safetyStock: sku.safetyStock,
        threshold, lowStock: available <= threshold, sold28: canForecast ? sold28 : null, suggestedQuantity: available <= threshold ? Math.max(0, target - available) : 0,
        batchTracking: sku.batchTracking, expiredQuantity: sku.batches.filter(x => x.expiryDate && x.expiryDate <= today).reduce((n, x) => n + x.quantity, 0),
        expiringQuantity: sku.batches.filter(x => x.expiryDate && x.expiryDate > today && x.expiryDate <= soon).reduce((n, x) => n + x.quantity, 0),
        unknownBatchQuantity: sku.batchTracking ? Math.max(0, sku.stockNum - sku.batches.filter(x => x.expiryDate).reduce((n, x) => n + x.quantity, 0)) : 0 }
    }), canForecast, truncated: items.length === 500, note: '库存按基础销售单位显示；预占覆盖提交后至财务审核前的订单。销量取当前权限范围最近28天下单且已发货/完成的非样品订单。建议未计采购在途；无销量时使用人工阈值。' }
  }

  async batches(actor: StaffActor, skuId?: number) {
    this.access.require(actor, 'inventory:read')
    const items = await this.prisma.stockBatch.findMany({ where: { tenantId: actor.tenantId, ...(skuId ? { skuId } : {}), quantity: { gt: 0 }, sku: { product: this.access.productWhere(actor) } }, include: { sku: { include: { product: { select: { name: true, subtitle: true } } } } }, orderBy: [{ expiryDate: 'asc' }, { id: 'asc' }], take: 500 })
    return { items: items.map(x => ({ id: x.id, skuId: x.skuId, skuCode: x.sku.skuCode, productName: productDisplayName(x.sku.product), specText: x.sku.specText, saleUnit: x.sku.saleUnit,
      batchNo: x.batchNo.startsWith('__') ? '历史/未注明批次' : x.batchNo, quantity: x.quantity, productionDate: x.productionDate?.toISOString().slice(0, 10) || '', expiryDate: x.expiryDate?.toISOString().slice(0, 10) || '',
      state: !x.expiryDate ? '日期未知' : x.expiryDate <= businessDate() ? '已到期' : x.expiryDate.getTime() - businessDate().getTime() <= 30 * 86400000 ? '30天内到期' : '正常' })) }
  }

  async assignBatch(actor: StaffActor, input: ReceiptBatch & { fromBatchId: number; quantity: number }) {
    this.access.require(actor, 'inventory:read', 'inventory:adjust')
    const dates = batchDates(input), batchNo = input.batchNo?.trim()
    if (!batchNo || batchNo.startsWith('__') || batchNo.length > 64 || !dates.expiryDate || !Number.isSafeInteger(input.quantity) || input.quantity < 1) throw new BadRequestException('请填写批次号、到期日期和正整数数量')
    return this.prisma.$transaction(async tx => {
      const source = await tx.stockBatch.findFirst({ where: { id: input.fromBatchId, tenantId: actor.tenantId, expiryDate: null, sku: { product: this.scope(actor) } }, include: { sku: true } })
      if (!source) throw new NotFoundException('仅可给当前授权的未知日期库存补登记批次')
      const locked = await tx.productSku.updateMany({ where: { id: source.skuId, stockNum: source.sku.stockNum, reservedNum: source.sku.reservedNum }, data: { updatedAt: new Date() } })
      if (locked.count !== 1) throw new ConflictException('库存已变化，请刷新')
      const moved = await tx.stockBatch.updateMany({ where: { id: source.id, quantity: { gte: input.quantity } }, data: { quantity: { decrement: input.quantity } } })
      if (moved.count !== 1) throw new ConflictException('未知批次数量不足，请刷新')
      const existing = await tx.stockBatch.findUnique({ where: { tenantId_skuId_batchNo: { tenantId: actor.tenantId, skuId: source.skuId, batchNo } } })
      if (existing && (existing.productionDate?.getTime() !== dates.productionDate?.getTime() || existing.expiryDate?.getTime() !== dates.expiryDate?.getTime())) throw new ConflictException('该批次已登记不同日期')
      const batch = await tx.stockBatch.upsert({ where: { tenantId_skuId_batchNo: { tenantId: actor.tenantId, skuId: source.skuId, batchNo } }, create: { tenantId: actor.tenantId, skuId: source.skuId, batchNo, quantity: input.quantity, ...dates }, update: { quantity: { increment: input.quantity } } })
      await tx.stockMovement.create({ data: { tenantId: actor.tenantId, skuId: source.skuId, productId: source.sku.productId, type: 'batch_assign', changeQty: 0, beforeQty: source.sku.stockNum, afterQty: source.sku.stockNum, sourceType: 'batch', sourceId: batch.id, operatorId: actor.id, remark: `历史库存补批次：${input.quantity}${source.sku.saleUnit} → ${batchNo}`, batchAllocations: { fromBatchId: source.id, toBatchId: batch.id, quantity: input.quantity } } })
      await tx.auditLog.create({ data: { tenantId: actor.tenantId, operatorId: actor.id, action: 'update', module: 'inventory', targetType: 'stock_batch', targetId: String(batch.id), requestId: randomUUID(), afterData: { fromBatchId: source.id, quantity: input.quantity, batchNo, expiryDate: input.expiryDate } } })
      return { id: batch.id, batchNo }
    })
  }

  private async visiblePlan(actor: StaffActor, plan: any) {
    if (!plan || (plan.ownerId !== actor.id && !actor.superAdmin)) throw new NotFoundException('补货草稿不存在')
    const items = (plan.payload as any).items as Array<{ skuId: number }>
    const count = await this.prisma.productSku.count({ where: { tenantId: actor.tenantId, id: { in: items.map(x => x.skuId) }, product: this.access.productWhere(actor) } })
    if (count !== items.length) throw new NotFoundException('补货草稿的商品权限范围已变化')
    return plan
  }

  async plans(actor: StaffActor) {
    this.access.require(actor, 'inventory:read')
    const plans = await this.prisma.replenishmentPlan.findMany({ where: { tenantId: actor.tenantId, ...(actor.superAdmin ? {} : { ownerId: actor.id }) }, orderBy: { createdAt: 'desc' }, take: 100 })
    const items: unknown[] = []
    for (const plan of plans) { try { items.push(await this.visiblePlan(actor, plan)) } catch (error) { if (!(error instanceof NotFoundException)) throw error } }
    return { items }
  }

  async createPlan(actor: StaffActor, input: { requestId: string; items: Array<{ skuId: number; quantity: number }> }) {
    this.access.require(actor, 'inventory:read', 'inventory:adjust')
    if (!input.items.length || input.items.length > 100 || new Set(input.items.map(x => x.skuId)).size !== input.items.length) throw new BadRequestException('补货清单须包含1～100个不同规格')
    const planNo = `RP${input.requestId}`
    const previous = await this.prisma.replenishmentPlan.findUnique({ where: { planNo } })
    if (previous) {
      if (previous.tenantId !== actor.tenantId) throw new ConflictException('请求标识已使用')
      return this.visiblePlan(actor, previous)
    }
    const items: any[] = []
    for (const line of input.items) {
      const sku = await this.prisma.productSku.findFirst({ where: { tenantId: actor.tenantId, id: line.skuId, status: 'active', product: this.scope(actor) }, include: { product: true } })
      if (!sku || !Number.isSafeInteger(line.quantity) || line.quantity < 1 || line.quantity > 2147483647) throw new BadRequestException('补货商品或数量无效')
      items.push({ skuId: sku.id, skuCode: sku.skuCode, productName: productDisplayName(sku.product), specText: sku.specText, saleUnit: sku.saleUnit, quantity: line.quantity })
    }
    return this.prisma.$transaction(async tx => {
      const plan = await tx.replenishmentPlan.create({ data: { tenantId: actor.tenantId, ownerId: actor.id, planNo, payload: { items } } })
      await tx.auditLog.create({ data: { tenantId: actor.tenantId, operatorId: actor.id, action: 'create', module: 'inventory', targetType: 'replenishment_plan', targetId: String(plan.id), requestId: randomUUID(), afterData: { items } } })
      return plan
    })
  }

  async updatePlan(actor: StaffActor, id: number, status: string, updatedAt: string) {
    this.access.require(actor, 'inventory:read', 'inventory:adjust')
    const plan = await this.visiblePlan(actor, await this.prisma.replenishmentPlan.findFirst({ where: { id, tenantId: actor.tenantId } }))
    const transitions: Record<string, string[]> = { draft: ['ordered', 'cancelled'], ordered: ['closed', 'cancelled'] }
    if (!transitions[plan.status]?.includes(status) || !Number.isFinite(Date.parse(updatedAt))) throw new BadRequestException('草稿状态不允许此操作')
    return this.prisma.$transaction(async tx => {
      const result = await tx.replenishmentPlan.updateMany({ where: { id, status: plan.status, updatedAt: new Date(updatedAt) }, data: { status } })
      if (result.count !== 1) throw new ConflictException('补货草稿已变化，请刷新')
      await tx.auditLog.create({ data: { tenantId: actor.tenantId, operatorId: actor.id, action: 'update', module: 'inventory', targetType: 'replenishment_plan', targetId: String(id), requestId: randomUUID(), afterData: { status } } })
      return { id, status }
    })
  }
}
