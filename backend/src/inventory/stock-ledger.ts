import { BadRequestException, ConflictException } from '@nestjs/common'
import { Prisma } from '@prisma/client'

export interface ReceiptBatch { batchNo?: string; productionDate?: string; expiryDate?: string }
export function receiptInput(input: ReceiptBatch, stored: any = {}) {
  const result = { batchNo: input.batchNo ?? stored?.batchNo ?? '', productionDate: input.productionDate ?? stored?.productionDate ?? '', expiryDate: input.expiryDate ?? stored?.expiryDate ?? '' }
  batchDates(result)
  return result
}
export interface BatchAllocation { batchId: number; batchNo: string; quantity: number }
export function businessDate() { return new Date(new Date().toLocaleDateString('sv-SE', { timeZone: 'Asia/Shanghai' }) + 'T00:00:00.000Z') }
export function batchDates(input: ReceiptBatch) {
  const parse = (value?: string) => {
    if (!value) return null
    const date = new Date(`${value}T00:00:00.000Z`)
    if (!/^\d{4}-\d{2}-\d{2}$/.test(value) || !Number.isFinite(date.getTime()) || date.toISOString().slice(0, 10) !== value) throw new BadRequestException('批次日期须为有效的年月日')
    return date
  }
  const productionDate = parse(input.productionDate), expiryDate = parse(input.expiryDate)
  if (productionDate && productionDate > businessDate()) throw new BadRequestException('生产日期不能晚于今天')
  if (productionDate && expiryDate && expiryDate <= productionDate) throw new BadRequestException('到期日期必须晚于生产日期')
  return { productionDate, expiryDate }
}

/** 必须在调用方的单据事务内执行，SKU更新锁把预占、库存及批次变动串行化。 */
export async function changeStock(tx: Prisma.TransactionClient, sku: any, after: number, options: { receipt?: ReceiptBatch; orderOut?: boolean; restore?: BatchAllocation[]; historicalReturn?: boolean } = {}): Promise<BatchAllocation[]> {
  const reserved = sku.reservedNum || 0
  if (!Number.isSafeInteger(after) || after < reserved || after > 2147483647) throw new BadRequestException('调整后库存不足以覆盖已预占订单，或数量超出范围')
  const updated = await tx.productSku.updateMany({ where: { id: sku.id, tenantId: sku.tenantId, stockNum: sku.stockNum, reservedNum: reserved, ...(sku.updatedAt ? { updatedAt: sku.updatedAt } : {}) }, data: { stockNum: after } })
  if (updated.count !== 1) throw new ConflictException('库存已变化或预占发生变动，请刷新后重试')
  const delta = after - sku.stockNum
  if (!delta) return []
  if (!sku.batchTracking) {
    if (options.receipt?.batchNo || options.receipt?.expiryDate || options.receipt?.productionDate) throw new BadRequestException('请先在规格中启用批次管理，再按批次入库')
    return []
  }
  const existing = await tx.stockBatch.findMany({ where: { tenantId: sku.tenantId, skuId: sku.id } })
  const tracked = existing.reduce((sum, x) => sum + x.quantity, 0)
  if (tracked > sku.stockNum) throw new ConflictException('批次数量与账面库存不一致，请先盘点')
  if (tracked < sku.stockNum) await tx.stockBatch.upsert({ where: { tenantId_skuId_batchNo: { tenantId: sku.tenantId, skuId: sku.id, batchNo: '__LEGACY__' } }, create: { tenantId: sku.tenantId, skuId: sku.id, batchNo: '__LEGACY__', quantity: sku.stockNum - tracked }, update: { quantity: { increment: sku.stockNum - tracked } } })
  if (delta > 0) {
    if (options.restore?.length) {
      if (options.restore.reduce((sum, x) => sum + x.quantity, 0) !== delta) throw new ConflictException('退回批次与数量不一致')
      for (const item of options.restore) {
        const result = await tx.stockBatch.updateMany({ where: { id: item.batchId, tenantId: sku.tenantId, skuId: sku.id }, data: { quantity: { increment: item.quantity } } })
        if (result.count !== 1) throw new ConflictException('原出库批次不存在')
      }
      return options.restore
    }
    const receipt = options.receipt || {}, dates = batchDates(receipt)
    if (sku.batchTracking && !options.historicalReturn && (!receipt.batchNo?.trim() || !dates.expiryDate)) throw new BadRequestException('该规格启用了批次管理，入库须填写批次号和到期日期')
    if (dates.expiryDate && dates.expiryDate <= businessDate()) throw new BadRequestException('到期批次不能作为新到货入库')
    const batchNo = receipt.batchNo?.trim() || '__UNTRACKED__'
    if (batchNo.length > 64 || (receipt.batchNo && batchNo.startsWith('__'))) throw new BadRequestException('批次号无效')
    const current = await tx.stockBatch.findUnique({ where: { tenantId_skuId_batchNo: { tenantId: sku.tenantId, skuId: sku.id, batchNo } } })
    if (current && (current.productionDate?.getTime() !== dates.productionDate?.getTime() || current.expiryDate?.getTime() !== dates.expiryDate?.getTime())) throw new ConflictException('同一批次的生产/到期日期不一致')
    const batch = await tx.stockBatch.upsert({ where: { tenantId_skuId_batchNo: { tenantId: sku.tenantId, skuId: sku.id, batchNo } }, create: { tenantId: sku.tenantId, skuId: sku.id, batchNo, quantity: delta, ...dates }, update: { quantity: { increment: delta } } })
    return [{ batchId: batch.id, batchNo, quantity: delta }]
  }
  const batches = await tx.stockBatch.findMany({ where: { tenantId: sku.tenantId, skuId: sku.id, quantity: { gt: 0 }, ...(options.receipt?.batchNo ? { batchNo: options.receipt.batchNo } : {}) } })
  // 先到期先出；日期未知批次排在已知批次后，过期批次只允许报损等手动出库。
  batches.sort((a, b) => (a.expiryDate?.getTime() ?? Infinity) - (b.expiryDate?.getTime() ?? Infinity) || a.id - b.id)
  let remaining = -delta
  const allocations: BatchAllocation[] = []
  for (const batch of batches) {
    if (options.orderOut && batch.expiryDate && batch.expiryDate <= businessDate()) continue
    const quantity = Math.min(remaining, batch.quantity)
    if (!quantity) continue
    const result = await tx.stockBatch.updateMany({ where: { id: batch.id, quantity: batch.quantity }, data: { quantity: { decrement: quantity } } })
    if (result.count !== 1) throw new ConflictException('批次库存已变化')
    allocations.push({ batchId: batch.id, batchNo: batch.batchNo, quantity })
    remaining -= quantity
    if (!remaining) break
  }
  if (remaining) throw new BadRequestException('可出库批次不足，库存包含到期批次，请先处理')
  return allocations
}

export async function reserveOrder(tx: Prisma.TransactionClient, order: { id: number; tenantId: number }, items: Array<{ skuId: number; quantity: number }>, release = false) {
  for (const item of [...items].sort((a, b) => a.skuId - b.skuId)) {
    const sku = await tx.productSku.findFirst({ where: { id: item.skuId, tenantId: order.tenantId, ...(!release ? { product: { status: 'active', brand: { status: 'active' } } } : {}) } })
    if (!sku || (!release && (sku.status !== 'active' || sku.stockNum - sku.reservedNum < item.quantity))) throw new BadRequestException('可售库存不足，其他待处理订单已占用库存')
    if (!release && sku.batchTracking) {
      const expired = await tx.stockBatch.aggregate({ where: { tenantId: order.tenantId, skuId: sku.id, expiryDate: { lte: businessDate() } }, _sum: { quantity: true } })
      if (sku.stockNum - sku.reservedNum - (expired._sum.quantity || 0) < item.quantity) throw new BadRequestException('可售库存不足，包含到期批次')
    }
    if (release && sku.reservedNum < item.quantity) throw new ConflictException('预占数量不一致，请检查订单')
    const result = await tx.productSku.updateMany({ where: { id: sku.id, stockNum: sku.stockNum, reservedNum: sku.reservedNum }, data: { reservedNum: { increment: release ? -item.quantity : item.quantity } } })
    if (result.count !== 1) throw new ConflictException('库存占用已变化，请重试')
  }
  await tx.order.update({ where: { id: order.id }, data: { stockReserved: !release } })
}
