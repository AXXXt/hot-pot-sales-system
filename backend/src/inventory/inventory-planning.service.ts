import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common'
import { randomUUID } from 'node:crypto'
import { PrismaService } from '../prisma.service'
import { Prisma } from '@prisma/client'
import { StaffAccessService, StaffActor } from '../auth/staff-access.service'
import { productDisplayName } from '../product/product-presentation'
import { batchDates, businessDate, ReceiptBatch } from './stock-ledger'

@Injectable()
export class InventoryPlanningService {
  constructor(private readonly prisma: PrismaService, private readonly access: StaffAccessService) {}

  private scope(actor: StaffActor) { return { AND: [this.access.productWhere(actor), { status: 'active' as const, brand: { status: 'active' as const } }] } }

  private pagination(page = 1, pageSize = 500) {
    if (!Number.isSafeInteger(page) || page < 1 || !Number.isSafeInteger(pageSize) || pageSize < 1 || pageSize > 500 || (page - 1) * pageSize > 2147483647) throw new BadRequestException('分页参数无效，每页须为1～500条')
    return { page, pageSize, skip: (page - 1) * pageSize }
  }

  async overview(actor: StaffActor, keyword = '', page = 1, pageSize = 500) {
    this.access.require(actor, 'inventory:read')
    const pagination = this.pagination(page, pageSize)
    if (typeof keyword !== 'string' || keyword.length > 100) throw new BadRequestException('关键词最多100个字符')
    keyword = keyword.trim()
    const where: Prisma.ProductSkuWhereInput = { tenantId: actor.tenantId, status: 'active', product: this.scope(actor),
      ...(keyword ? { OR: [{ skuCode: { contains: keyword } }, { product: { subtitle: { contains: keyword } } }, { product: { name: { contains: keyword } } }] } : {}) }
    const [total, items] = await Promise.all([this.prisma.productSku.count({ where }), this.prisma.productSku.findMany({ where,
      include: { product: { select: { name: true, subtitle: true, brandId: true } }, batches: { where: { quantity: { gt: 0 } } } }, orderBy: { id: 'asc' }, skip: pagination.skip, take: pageSize })
    ])
    const skuIds = items.map(x => x.id), now = new Date(), from = new Date(now.getTime() - 28 * 86400000)
    const canForecast = this.access.has(actor, 'analytics:view') && this.access.has(actor, 'order:read')
    const [sales, pending] = await Promise.all([
      canForecast ? this.prisma.orderItem.groupBy({ by: ['skuId'], where: { tenantId: actor.tenantId, skuId: { in: skuIds }, order: { AND: [this.access.orderWhere(actor), { sampleFlag: false, status: { in: ['shipped', 'completed'] }, createdAt: { gte: from, lt: now } }] } }, _sum: { quantity: true } }) : [],
      this.access.has(actor, 'order:read') ? this.prisma.orderItem.groupBy({ by: ['skuId'], where: { tenantId: actor.tenantId, skuId: { in: skuIds }, order: { AND: [this.access.orderWhere(actor), { status: { in: ['pending_quote', 'pending_confirm', 'pending_finance'] } }] } }, _sum: { quantity: true } }) : []
    ])
    const today = businessDate(), soon = new Date(today.getTime() + 30 * 86400000)
    return { items: items.map(sku => {
      const sold28 = sales.find(x => x.skuId === sku.id)?._sum.quantity || 0
      const available = Math.max(0, sku.stockNum - sku.reservedNum - sku.batches.filter(x => x.expiryDate && x.expiryDate <= today).reduce((sum, x) => sum + x.quantity, 0))
      const forecastThreshold = canForecast && sold28 > 0 ? Math.ceil(sold28 / 28 * sku.leadTimeDays + sku.safetyStock) : sku.lowStockThreshold
      const threshold = Math.max(sku.lowStockThreshold, forecastThreshold)
      const target = Math.max(threshold, canForecast && sold28 > 0 ? Math.ceil(sold28 / 28 * (sku.leadTimeDays + 7) + sku.safetyStock) : threshold)
      return { skuId: sku.id, productId: sku.productId, skuCode: sku.skuCode, productName: productDisplayName(sku.product), specText: sku.specText, saleUnit: sku.saleUnit, stockNum: sku.stockNum, reservedNum: sku.reservedNum,
        pendingDemand: this.access.has(actor, 'order:read') ? pending.find(x => x.skuId === sku.id)?._sum.quantity || 0 : null,
        availableNum: available, packagingUnits: sku.packagingUnits, lowStockThreshold: sku.lowStockThreshold, leadTimeDays: sku.leadTimeDays, safetyStock: sku.safetyStock,
        threshold, lowStock: available <= threshold, sold28: canForecast ? sold28 : null, suggestedQuantity: available <= threshold ? Math.max(0, target - available) : 0,
        batchTracking: sku.batchTracking, expiredQuantity: sku.batches.filter(x => x.expiryDate && x.expiryDate <= today).reduce((n, x) => n + x.quantity, 0),
        expiringQuantity: sku.batches.filter(x => x.expiryDate && x.expiryDate > today && x.expiryDate <= soon).reduce((n, x) => n + x.quantity, 0),
        unknownBatchQuantity: sku.batchTracking ? Math.max(0, sku.stockNum - sku.batches.filter(x => x.expiryDate).reduce((n, x) => n + x.quantity, 0)) : 0 }
    }), canForecast, total, page, pageSize, hasMore: page * pageSize < total, truncated: page * pageSize < total, note: '库存按基础销售单位显示；预占覆盖提交后至财务审核前的订单。销量取当前权限范围最近28天下单且已发货/完成的非样品订单。建议未计采购在途；无销量时使用人工阈值。预警为后台页面提示，未自动发送低库存或临期微信消息。' }
  }

  async batches(actor: StaffActor, skuId?: number, page = 1, pageSize = 500) {
    this.access.require(actor, 'inventory:read')
    const pagination = this.pagination(page, pageSize)
    if (skuId !== undefined && (!Number.isSafeInteger(skuId) || skuId < 1)) throw new BadRequestException('规格编号无效')
    const where: Prisma.StockBatchWhereInput = { tenantId: actor.tenantId, ...(skuId ? { skuId } : {}), quantity: { gt: 0 }, sku: { product: this.access.productWhere(actor) } }
    const [total, items] = await Promise.all([this.prisma.stockBatch.count({ where }), this.prisma.stockBatch.findMany({ where, include: { sku: { include: { product: { select: { name: true, subtitle: true } } } } }, orderBy: [{ expiryDate: 'asc' }, { id: 'asc' }], skip: pagination.skip, take: pageSize })])
    const today = businessDate()
    return { items: items.map(x => ({ id: x.id, skuId: x.skuId, skuCode: x.sku.skuCode, productName: productDisplayName(x.sku.product), specText: x.sku.specText, saleUnit: x.sku.saleUnit,
      batchNo: x.batchNo.startsWith('__') ? '历史/未注明批次' : x.batchNo, quantity: x.quantity, productionDate: x.productionDate?.toISOString().slice(0, 10) || '', expiryDate: x.expiryDate?.toISOString().slice(0, 10) || '',
      state: !x.expiryDate ? '日期未知' : x.expiryDate <= today ? '已到期' : x.expiryDate.getTime() - today.getTime() <= 30 * 86400000 ? '30天内到期' : '正常' })), total, page, pageSize, hasMore: page * pageSize < total }
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
    const items = (plan.payload as any)?.items as Array<{ skuId: number }>
    if (!Array.isArray(items) || !items.length || items.some(x => !Number.isSafeInteger(x?.skuId))) throw new NotFoundException('补货草稿内容无效，请联系管理员核实')
    const count = await this.prisma.productSku.count({ where: { tenantId: actor.tenantId, id: { in: items.map(x => x.skuId) }, product: this.access.productWhere(actor) } })
    if (count !== items.length) throw new NotFoundException('补货草稿的商品权限范围已变化')
    return plan
  }

  async plans(actor: StaffActor, page = 1, pageSize = 100) {
    this.access.require(actor, 'inventory:read')
    const pagination = this.pagination(page, pageSize)
    const plans = await this.prisma.replenishmentPlan.findMany({ where: { tenantId: actor.tenantId, ...(actor.superAdmin ? {} : { ownerId: actor.id }) }, orderBy: [{ createdAt: 'desc' }, { id: 'desc' }], skip: pagination.skip, take: pageSize + 1 })
    const items: unknown[] = []
    for (const plan of plans.slice(0, pageSize)) { try { items.push(await this.visiblePlan(actor, plan)) } catch (error) { if (!(error instanceof NotFoundException)) throw error } }
    return { items, page, pageSize, hasMore: plans.length > pageSize }
  }

  async createPlan(actor: StaffActor, input: { requestId: string; items: Array<{ skuId: number; quantity: number }> }) {
    this.access.require(actor, 'inventory:read', 'inventory:adjust')
    if (!input || !/^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i.test(input.requestId || '') || !Array.isArray(input.items) || !input.items.length || input.items.length > 100 || input.items.some(x => !Number.isSafeInteger(x.skuId) || x.skuId < 1 || !Number.isSafeInteger(x.quantity) || x.quantity < 1 || x.quantity > 2147483647) || new Set(input.items.map(x => x.skuId)).size !== input.items.length) throw new BadRequestException('补货清单须包含1～100个不同规格和有效提交标识')
    const sameInput = (plan: any) => {
      const normalized = (items: Array<{ skuId: number; quantity: number }>) => items.map(x => [x.skuId, x.quantity]).sort((a, b) => a[0] - b[0])
      if (!Array.isArray(plan.payload?.items) || JSON.stringify(normalized(plan.payload.items)) !== JSON.stringify(normalized(input.items))) throw new ConflictException('请求标识已用于其他补货内容，请重新生成清单')
      return plan
    }
    const planNo = `RP${input.requestId}`
    const previous = await this.prisma.replenishmentPlan.findUnique({ where: { planNo } })
    if (previous) {
      if (previous.tenantId !== actor.tenantId) throw new ConflictException('请求标识已使用')
      return sameInput(await this.visiblePlan(actor, previous))
    }
    const items: any[] = []
    for (const line of input.items) {
      const sku = await this.prisma.productSku.findFirst({ where: { tenantId: actor.tenantId, id: line.skuId, status: 'active', product: this.scope(actor) }, include: { product: true } })
      if (!sku || !Number.isSafeInteger(line.quantity) || line.quantity < 1 || line.quantity > 2147483647) throw new BadRequestException('补货商品或数量无效')
      items.push({ skuId: sku.id, skuCode: sku.skuCode, productName: productDisplayName(sku.product), specText: sku.specText, saleUnit: sku.saleUnit, quantity: line.quantity })
    }
    try {
      return await this.prisma.$transaction(async tx => {
        const plan = await tx.replenishmentPlan.create({ data: { tenantId: actor.tenantId, ownerId: actor.id, planNo, payload: { items } } })
        await tx.auditLog.create({ data: { tenantId: actor.tenantId, operatorId: actor.id, action: 'create', module: 'inventory', targetType: 'replenishment_plan', targetId: String(plan.id), requestId: randomUUID(), afterData: { items } } })
        return plan
      })
    } catch (error) {
      // 并发重试可能同时通过首次查询；唯一键的胜出单据仍须重新校验租户、归属和商品范围。
      if ((error as { code?: string })?.code !== 'P2002') throw error
      const winner = await this.prisma.replenishmentPlan.findUnique({ where: { planNo } })
      if (!winner) throw error
      if (winner.tenantId !== actor.tenantId) throw new ConflictException('请求标识已使用')
      return sameInput(await this.visiblePlan(actor, winner))
    }
  }

  async updatePlan(actor: StaffActor, id: number, status: string, updatedAt: string) {
    this.access.require(actor, 'inventory:read', 'inventory:adjust')
    const plan = await this.visiblePlan(actor, await this.prisma.replenishmentPlan.findFirst({ where: { id, tenantId: actor.tenantId } }))
    const transitions: Record<string, string[]> = { draft: ['ordered', 'cancelled'], ordered: ['closed', 'cancelled'] }
    if (!transitions[plan.status]?.includes(status) || !Number.isFinite(Date.parse(updatedAt))) throw new BadRequestException('草稿状态不允许此操作')
    return this.prisma.$transaction(async tx => {
      const result = await tx.replenishmentPlan.updateMany({ where: { id, status: plan.status, updatedAt: new Date(updatedAt) }, data: { status, updatedAt: new Date(Math.max(Date.now(), plan.updatedAt.getTime() + 1)) } })
      if (result.count !== 1) throw new ConflictException('补货草稿已变化，请刷新')
      await tx.auditLog.create({ data: { tenantId: actor.tenantId, operatorId: actor.id, action: 'update', module: 'inventory', targetType: 'replenishment_plan', targetId: String(id), requestId: randomUUID(), afterData: { status } } })
      return { id, status }
    })
  }
}
