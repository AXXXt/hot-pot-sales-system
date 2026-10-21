import { BadRequestException, ConflictException, Injectable } from '@nestjs/common'
import { randomUUID } from 'node:crypto'
import { isDeepStrictEqual } from 'node:util'
import { Prisma } from '@prisma/client'
import { PrismaService } from '../prisma.service'
import { StaffAccessService, StaffActor } from '../auth/staff-access.service'
import { ProductVisibilityService } from '../product/product-visibility.service'
import { productDisplayName } from '../product/product-presentation'
import { stockAvailability } from '../inventory/stock-availability'
import { convertQuantity } from '../inventory/packaging'
import { OrderService } from '../order/order.service'
import { AiInventoryService, InventoryDraft, inventoryMissing, normalizeInventoryDraft } from './ai-inventory.service'

const text = (x: unknown, max = 100) => typeof x === 'string' ? x.trim().normalize('NFKC').slice(0, max) : ''
const id = (x: unknown) => Number.isSafeInteger(x) && Number(x) > 0 ? Number(x) : null
export function normalizeWorkflow(action: string, value: any): any {
  if (!Array.isArray(value?.lines) || !value.lines.length || value.lines.length > 50) throw new BadRequestException('清单须包含1～50行，请勿截断原始清单')
  const attachmentIds = (Array.isArray(value.attachmentIds) ? value.attachmentIds : []).filter((x: any) => typeof x === 'string').slice(0, 3)
  if (action === 'inventory.batch') return { mode: ['increase', 'decrease', 'set'].includes(value.mode) ? value.mode : '', reason: text(value.reason, 200), attachmentIds,
    lines: value.lines.map((line: any) => normalizeInventoryDraft({ ...line, mode: value.mode, reason: value.reason })) }
  return { customerId: id(value.customerId), customerName: text(value.customerName), remark: text(value.remark, 500), attachmentIds,
    lines: value.lines.map((line: any) => ({ keyword: text(line.keyword), specText: text(line.specText, 255), skuId: id(line.skuId), quantity: Number.isSafeInteger(line.quantity) && line.quantity > 0 && line.quantity <= 2147483647 ? line.quantity : null, unit: text(line.unit, 50) })) }
}

export function workflowMissing(action: string, payload: any): string[] {
  const missing: string[] = []
  if (action === 'order.create' && !payload.customer) missing.push('请选择唯一的可操作客户')
  const seen = new Set<string>()
  for (const [index, line] of (payload.lines || []).entries()) {
    const errors = action === 'inventory.batch' ? inventoryMissing(line) : line.errors || []
    errors.forEach((message: string) => missing.push(`第${index + 1}行：${message}`))
    if (line.skuId) {
      const key = `${line.skuId}:${action === 'inventory.batch' && payload.mode !== 'set' ? line.batchNo || '' : ''}`
      if (seen.has(key)) missing.push(`第${index + 1}行规格及批次重复，请合并数量`)
      seen.add(key)
    }
  }
  return missing
}

@Injectable()
export class AiWorkflowsService {
  constructor(private readonly prisma: PrismaService, private readonly access: StaffAccessService, private readonly inventory: AiInventoryService, private readonly visibility: ProductVisibilityService, private readonly orders: OrderService) {}

  authorize(actor: StaffActor, action: string) {
    this.access.require(actor, 'ai:use', ...(action === 'inventory.batch' ? ['inventory:read', 'inventory:adjust'] : ['order:read', 'order:confirm', 'customer:manage']))
  }

  async prepare(actor: StaffActor, action: string, value: unknown, db: Prisma.TransactionClient = this.prisma): Promise<any> {
    this.authorize(actor, action)
    const payload = normalizeWorkflow(action, value)
    if (action === 'inventory.batch') {
      payload.lines = await Promise.all(payload.lines.map((line: InventoryDraft) => this.inventory.prepare(actor, line)))
      const running = new Map<number, number>()
      for (const line of payload.lines as InventoryDraft[]) {
        if (!line.item || line.changeQty === null || line.afterQty === null) continue
        const before = running.get(line.item.skuId) ?? line.item.beforeQty
        if (payload.mode !== 'set') { line.item.beforeQty = before; line.afterQty = before + line.changeQty }
        running.set(line.item.skuId, line.afterQty)
      }
      return payload
    }
    const customers = await db.customer.findMany({ where: { ...this.access.customerWhere(actor), status: 'active', ...(payload.customerId ? { id: payload.customerId } : { customerName: payload.customerName || '__未指定客户__' }) }, select: { id: true, customerName: true }, take: 2 })
    payload.customerCandidates = customers
    payload.customer = customers.length === 1 ? customers[0] : null
    payload.orders = []
    if (!payload.customer) { payload.lines = payload.lines.map((line: any) => ({ ...line, errors: ['请先选择客户以核对商品范围和协议价'] })); return payload }
    payload.customerId = payload.customer.id
    payload.customerName = payload.customer.customerName
    const customerScope = await this.visibility.whereForCustomer(payload.customer.id)
    const groups = new Map<number, any>()
    for (const line of payload.lines) {
      const candidates = !line.keyword && !line.skuId ? [] : await db.productSku.findMany({ where: { tenantId: actor.tenantId, status: 'active',
        product: { AND: [customerScope, this.access.productWhere(actor)] }, ...(line.skuId ? { id: line.skuId } : {}),
        ...(line.specText ? { specText: { contains: line.specText } } : {}),
        ...(line.keyword ? { OR: [{ skuCode: { contains: line.keyword } }, { product: { subtitle: { contains: line.keyword } } }, { product: { name: { contains: line.keyword } } }] } : {}) }, include: { product: { include: { brand: true } } }, orderBy: { id: 'asc' }, take: 21 })
      line.candidates = candidates.slice(0, 20).map(x => ({ skuId: x.id, productName: productDisplayName(x.product), specText: x.specText, skuCode: x.skuCode, saleUnit: x.saleUnit }))
      line.errors = []
      if (candidates.length !== 1) { line.errors.push(candidates.length ? '请选择唯一规格，不会自动猜选' : '客户范围内未找到商品规格'); continue }
      const sku = candidates[0]
      Object.assign(line, { skuId: sku.id, specText: sku.specText, unit: line.unit || sku.saleUnit, item: { skuId: sku.id, skuCode: sku.skuCode, productName: productDisplayName(sku.product), specText: sku.specText, saleUnit: sku.saleUnit } })
      if (!line.quantity) { line.errors.push('请填写正整数数量'); continue }
      try {
        const conversion = convertQuantity(sku, line.quantity, line.unit)
        line.baseQuantity = conversion.baseQuantity; line.factor = conversion.factor
        line.availableNum = (await stockAvailability(db, [sku])).get(sku.id) || 0
        if (conversion.baseQuantity < sku.minOrderQty) line.errors.push(`起订量为${sku.minOrderQty}${sku.saleUnit}`)
        if (conversion.baseQuantity > line.availableNum) line.errors.push('可售库存不足')
        const now = new Date()
        const rule = await db.customerPriceRule.findFirst({ where: { tenantId: actor.tenantId, customerId: payload.customer.id, skuId: sku.id, status: 'active', AND: [{ OR: [{ startAt: null }, { startAt: { lte: now } }] }, { OR: [{ endAt: null }, { endAt: { gte: now } }] }] } })
        line.unitPrice = (rule?.price ?? sku.basePrice).toFixed(2)
        line.amount = new Prisma.Decimal(line.unitPrice).mul(line.baseQuantity).toFixed(2)
        const group = groups.get(sku.product.brandId) || { brandId: sku.product.brandId, brandName: sku.product.brand.name, items: [], amount: '0.00' }
        group.items.push({ skuId: sku.id, quantity: line.baseQuantity })
        group.amount = new Prisma.Decimal(group.amount).add(line.amount).toFixed(2)
        groups.set(sku.product.brandId, group)
      } catch (error) { line.errors.push((error as Error).message) }
    }
    payload.orders = [...groups.values()]
    return payload
  }

  async apply(tx: Prisma.TransactionClient, actor: StaffActor, action: string, payload: any, draftId: string): Promise<Record<string, unknown>> {
    this.authorize(actor, action)
    const missing = workflowMissing(action, payload)
    if (missing.length) throw new BadRequestException(`请检查：${missing.join('、')}`)
    if (action === 'inventory.batch') {
      const adjustment = await tx.stockAdjustment.create({ data: { tenantId: actor.tenantId, operatorId: actor.id, adjustmentNo: `AI${randomUUID()}`, type: payload.mode === 'set' ? 'stocktake' : payload.mode === 'increase' ? 'manual_in' : 'manual_out', reason: payload.reason || 'AI批量库存清单' } })
      const items: any[] = []
      for (const line of [...payload.lines].sort((a: any, b: any) => a.skuId - b.skuId)) items.push(await this.inventory.apply(tx, actor, line, draftId, adjustment))
      return { type: 'inventory-batch', id: adjustment.id, adjustmentNo: adjustment.adjustmentNo, items, path: '/inventory' }
    }
    const current = await this.prepare(actor, action, payload, tx)
    if (workflowMissing(action, current).length || !isDeepStrictEqual(current, payload)) throw new ConflictException('客户、商品、包装、库存或价格已变化，请保存草稿重新核对')
    const orders: any[] = []
    for (const group of current.orders) {
      const order = await this.orders.createDraftInTransaction(tx, { customerId: current.customerId, items: group.items, remark: current.remark }, actor.id)
      orders.push({ id: order.id, orderNo: order.orderNo, brandName: group.brandName, amount: order.payableAmount.toString(), status: 'draft', path: `/orders/${order.id}` })
    }
    if (!orders.length) throw new BadRequestException('没有可创建的订单')
    return { type: 'order-batch', id: orders[0].id, orders, path: '/orders' }
  }
}
