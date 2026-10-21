import { BadRequestException, ConflictException, Injectable } from '@nestjs/common'
import { AuditAction, Prisma } from '@prisma/client'
import { createHash, randomBytes } from 'node:crypto'
import { PrismaService } from '../prisma.service'
import { StaffAccessService, StaffActor } from '../auth/staff-access.service'
import { productDisplayName } from '../product/product-presentation'
import { convertQuantity } from '../inventory/packaging'
import { batchDates, businessDate, changeStock } from '../inventory/stock-ledger'

type StockMode = 'increase' | 'decrease' | 'set' | ''
export interface StockCandidate {
  skuId: number; productId: number; productName: string; skuCode: string
  specText: string; saleUnit: string; beforeQty: number
  reservedNum?: number; packagingUnits?: unknown; batchTracking?: boolean
}
export interface InventoryDraft {
  keyword: string; specText: string; unit: string; skuId: number | null
  mode: StockMode; quantity: number | null; reason: string
  item: StockCandidate | null; candidates: StockCandidate[]; truncated: boolean
  afterQty: number | null; changeQty: number | null
  factor?: number; unitError?: string; batchNo?: string; productionDate?: string; expiryDate?: string
}

export function normalizeInventoryDraft(value: any): InventoryDraft {
  const text = (x: unknown, max: number) => typeof x === 'string' ? x.trim().normalize('NFKC').slice(0, max) : ''
  return {
    keyword: text(value?.keyword, 100), specText: text(value?.specText, 255), unit: text(value?.unit, 50),
    skuId: Number.isSafeInteger(value?.skuId) && value.skuId > 0 ? value.skuId : null,
    mode: ['increase', 'decrease', 'set'].includes(value?.mode) ? value.mode : '',
    quantity: Number.isSafeInteger(value?.quantity) && value.quantity >= 0 && value.quantity <= 2147483647 ? value.quantity : null,
    reason: text(value?.reason, 200), item: null, candidates: [], truncated: false, afterQty: null, changeQty: null,
    batchNo: text(value?.batchNo, 64), productionDate: text(value?.productionDate, 10), expiryDate: text(value?.expiryDate, 10)
  }
}

export function inventoryMissing(payload: InventoryDraft): string[] {
  const missing: string[] = []
  if (!payload.keyword && !payload.skuId) missing.push('商品名称或规格编码')
  if (!payload.item) missing.push(payload.candidates.length ? '请选择唯一商品规格' : '未找到可操作规格，请核对商品和规格')
  if (payload.item && !payload.item.saleUnit) missing.push('该规格尚未填写销售单位')
  if (!payload.mode) missing.push('增加、减少或设为指定库存')
  if (payload.quantity === null || (payload.mode !== 'set' && payload.quantity === 0)) missing.push('有效数量（增加或减少须大于0）')
  if (payload.unitError) missing.push(`数量单位或批次：${payload.unitError}`)
  if (payload.item && !payload.item.batchTracking && (payload.batchNo || payload.productionDate || payload.expiryDate)) missing.push('请先在规格中启用批次管理')
  if (payload.item && payload.afterQty !== null) {
    if (payload.afterQty < 0) missing.push('库存不足，调整后不能为负数')
    if (payload.afterQty > 2147483647) missing.push('调整后库存超过支持范围')
    if (payload.changeQty === 0) missing.push('目标与当前库存相同，无需调整')
    if (payload.afterQty < (payload.item.reservedNum || 0)) missing.push('调整后库存不能低于订单预占量')
    if (payload.changeQty! > 0 && payload.item.batchTracking && (!payload.batchNo || !payload.expiryDate)) missing.push('批次号和到期日期')
  }
  return missing
}

/** 一句话库存操作：只生成服务器核验的预览，确认时在同一事务写入单据、流水与审计。 */
@Injectable()
export class AiInventoryService {
  constructor(private readonly prisma: PrismaService, private readonly access: StaffAccessService) {}

  private scope(actor: StaffActor): Prisma.ProductWhereInput {
    return { AND: [this.access.productWhere(actor), { status: 'active', brand: { status: 'active' } }] }
  }

  private async candidates(actor: StaffActor, input: InventoryDraft) {
    const items = await this.prisma.productSku.findMany({
      where: { tenantId: actor.tenantId, status: 'active', product: this.scope(actor),
        ...(input.skuId ? { id: input.skuId } : {}),
        ...(input.specText ? { specText: { contains: input.specText } } : {}),
        ...(input.keyword ? { OR: [{ skuCode: { contains: input.keyword } }, { product: { OR: [{ name: { contains: input.keyword } }, { subtitle: { contains: input.keyword } }, { code: { contains: input.keyword } }] } }] } : {}) },
      select: { id: true, productId: true, skuCode: true, specText: true, saleUnit: true, stockNum: true, reservedNum: true, packagingUnits: true, batchTracking: true, product: { select: { name: true, subtitle: true } } },
      orderBy: { id: 'asc' }, take: 21
    })
    return items.map(x => ({ skuId: x.id, productId: x.productId, skuCode: x.skuCode, specText: x.specText || '', saleUnit: x.saleUnit || '', beforeQty: x.stockNum, reservedNum: x.reservedNum || 0, packagingUnits: x.packagingUnits, batchTracking: x.batchTracking || false, productName: productDisplayName(x.product) }))
  }

  async search(actor: StaffActor, keyword: string) {
    this.access.require(actor, 'inventory:read')
    const items = await this.candidates(actor, normalizeInventoryDraft({ keyword }))
    return { type: 'stock-options', title: '商品规格库存', items: items.slice(0, 20), note: '按规格及销售单位显示；重名或多规格时需明确选择，不换算箱袋。最多20项。' }
  }

  async prepare(actor: StaffActor, value: unknown): Promise<InventoryDraft> {
    this.access.require(actor, 'inventory:read', 'inventory:adjust')
    const payload = normalizeInventoryDraft(value)
    if (!payload.keyword && !payload.skuId) return payload
    const candidates = await this.candidates(actor, payload)
    payload.candidates = candidates.slice(0, 20)
    payload.truncated = candidates.length > 20
    if (candidates.length !== 1) return payload
    payload.item = candidates[0]
    payload.skuId = candidates[0].skuId
    payload.specText = candidates[0].specText
    payload.unit ||= candidates[0].saleUnit
    if (payload.mode && payload.quantity !== null) {
      let quantity = payload.quantity
      try {
        const conversion = convertQuantity(candidates[0], quantity, payload.unit)
        payload.factor = conversion.factor; quantity = conversion.baseQuantity
        batchDates(payload)
      } catch (error) { payload.unitError = (error as Error).message }
      payload.afterQty = payload.mode === 'set' ? quantity : candidates[0].beforeQty + (payload.mode === 'increase' ? quantity : -quantity)
      payload.changeQty = payload.afterQty - candidates[0].beforeQty
      if (payload.changeQty > 0 && payload.expiryDate && new Date(payload.expiryDate) <= businessDate()) payload.unitError = '到期批次不能作为新到货入库'
    }
    return payload
  }

  async apply(tx: Prisma.TransactionClient, actor: StaffActor, payload: InventoryDraft, draftId: string, sharedAdjustment?: { id: number; adjustmentNo: string }) {
    this.access.require(actor, 'inventory:read', 'inventory:adjust')
    const missing = inventoryMissing(payload)
    if (missing.length || !payload.item || payload.afterQty === null || payload.changeQty === null) throw new BadRequestException(`请检查：${missing.join('、')}`)
    const item = payload.item
    const current = await tx.productSku.findFirst({ where: { id: item.skuId, tenantId: actor.tenantId, status: 'active', product: this.scope(actor) }, include: { product: { select: { name: true, subtitle: true } } } })
    if (!current) throw new ConflictException('规格已停用或权限范围变化，请重新检查草稿')
    if (current.stockNum !== item.beforeQty || current.saleUnit !== item.saleUnit || current.skuCode !== item.skuCode || (current.specText || '') !== item.specText || productDisplayName(current.product) !== item.productName) throw new ConflictException('库存或规格资料已变化，请保存草稿刷新预览后再确认')
    if ((current.reservedNum || 0) !== (item.reservedNum || 0) || convertQuantity(current, payload.quantity!, payload.unit).factor !== (payload.factor || 1) || !!current.batchTracking !== !!item.batchTracking) throw new ConflictException('预占或包装配置已变化，请保存草稿刷新预览')
    const batchAllocations = await changeStock(tx, { ...current, tenantId: actor.tenantId }, payload.afterQty, { receipt: payload })
    const type = payload.changeQty > 0 ? 'manual_in' : 'manual_out'
    const reason = `AI库存调整：${payload.reason || (payload.mode === 'set' ? '设为指定数量' : payload.mode === 'increase' ? '增加库存' : '减少库存')}；输入${payload.quantity}${payload.unit}${(payload.factor || 1) > 1 ? `，1${payload.unit}=${payload.factor}${item.saleUnit}` : ''}`.slice(0, 255)
    const adjustment = sharedAdjustment || await tx.stockAdjustment.create({ data: { tenantId: actor.tenantId, adjustmentNo: `AI${Date.now().toString(36).toUpperCase()}${randomBytes(6).toString('hex')}`, type, reason, operatorId: actor.id } })
    await tx.stockMovement.create({ data: { tenantId: actor.tenantId, skuId: current.id, productId: current.productId, type, changeQty: payload.changeQty, beforeQty: item.beforeQty, afterQty: payload.afterQty, batchAllocations: batchAllocations as unknown as Prisma.InputJsonValue, sourceType: 'adjustment', sourceId: adjustment.id, stockAdjustmentId: adjustment.id, operatorId: actor.id, remark: reason } })
    const result = { type: 'inventory', id: adjustment.id, adjustmentNo: adjustment.adjustmentNo, ...item, afterQty: payload.afterQty, changeQty: payload.changeQty, path: '/inventory' }
    await tx.auditLog.create({ data: { tenantId: actor.tenantId, operatorId: actor.id, action: AuditAction.inventory_adjust, module: 'inventory', targetType: 'stock_adjustment', targetId: String(adjustment.id), requestId: `ai-inventory-${createHash('sha256').update(`${draftId}:${current.id}:${payload.batchNo || ''}`).digest('hex').slice(0, 40)}`, afterData: result as unknown as Prisma.InputJsonValue } })
    return result
  }
}
