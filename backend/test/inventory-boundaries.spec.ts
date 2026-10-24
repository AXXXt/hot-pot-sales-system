import { BadRequestException, ConflictException, ForbiddenException } from '@nestjs/common'
import { InventoryService } from '../src/inventory/inventory.service'
import { InventoryController } from '../src/inventory/inventory.controller'
import { InventoryPlanningService } from '../src/inventory/inventory-planning.service'
import { StaffAccessService, StaffActor } from '../src/auth/staff-access.service'
import { batchDates, businessDate, changeStock, reserveOrder } from '../src/inventory/stock-ledger'

const actor: StaffActor = { id: 4, tenantId: 2, userType: 'super_admin', superAdmin: true, permissions: new Set(), brandIds: [], customerIds: null, leadIds: null, fingerprint: 'inventory-boundaries' }
const day = (offset: number) => new Date(businessDate().getTime() + offset * 86400000)

describe('inventory availability and replenishment boundaries', () => {
  it('rejects stock mutations when the fresh staff context is no longer valid', async () => {
    const inventory: any = { createAdjustment: jest.fn().mockResolvedValue({ id: 1 }) }
    const access: any = { actor: jest.fn().mockRejectedValue(new ForbiddenException('租户已停用')) }
    const controller = new InventoryController(inventory, access)
    await expect(controller.createAdjustment({ type: 'manual_in', items: [{ skuId: 40, quantity: 1 }] }, { user: { sub: 4 } })).rejects.toBeInstanceOf(ForbiddenException)
    expect(inventory.createAdjustment).not.toHaveBeenCalled()
  })

  it('shows the same sellable stock in inventory and replenishment when a batch has expired', async () => {
    const sku = { id: 40, tenantId: 2, productId: 29, stockNum: 22, reservedNum: 3, batchTracking: true, product: { name: '管理标签', subtitle: '真实名称' } }
    const db: any = { productSku: { findMany: jest.fn().mockResolvedValue([sku]), count: jest.fn().mockResolvedValue(1) }, stockBatch: { groupBy: jest.fn().mockResolvedValue([{ skuId: 40, _sum: { quantity: 5 } }]) } }
    const inventory = new InventoryService(db, {} as any)
    const result = await inventory.stock({ page: 1, pageSize: 10 }, actor)
    expect(result.items[0]).toMatchObject({ stockNum: 22, reservedNum: 3, availableNum: 14, productName: '真实名称' })
  })

  it('never forecasts a replenishment target below the manually configured minimum', async () => {
    const sku = { id: 40, tenantId: 2, stockNum: 50, reservedNum: 0, batches: [], lowStockThreshold: 100, leadTimeDays: 1, safetyStock: 0, product: { name: '标签', subtitle: '商品' } }
    const db: any = { productSku: { count: jest.fn().mockResolvedValue(1), findMany: jest.fn().mockResolvedValue([sku]) }, orderItem: { groupBy: jest.fn().mockResolvedValueOnce([{ skuId: 40, _sum: { quantity: 1 } }]).mockResolvedValueOnce([]) } }
    const planning = new InventoryPlanningService(db, new StaffAccessService(db))
    const result = await planning.overview(actor)
    expect(result.items[0]).toMatchObject({ availableNum: 50, threshold: 100, lowStock: true, suggestedQuantity: 50 })
  })

  it('returns the winning plan for simultaneous retries of the same request identifier', async () => {
    const plan = { id: 1, tenantId: 2, ownerId: 4, payload: { items: [{ skuId: 40, quantity: 5 }] } }
    const tx: any = { replenishmentPlan: { create: jest.fn().mockRejectedValue({ code: 'P2002', meta: { target: 'planNo' } }) }, auditLog: { create: jest.fn() } }
    const db: any = {
      replenishmentPlan: { findUnique: jest.fn().mockResolvedValueOnce(null).mockResolvedValueOnce(plan) },
      productSku: { findFirst: jest.fn().mockResolvedValue({ id: 40, product: { name: '商品' } }), count: jest.fn().mockResolvedValue(1) },
      $transaction: jest.fn(async (callback: any) => callback(tx))
    }
    const planning = new InventoryPlanningService(db, new StaffAccessService(db))
    await expect(planning.createPlan(actor, { requestId: 'c86d66a7-a18b-4583-ab37-324bb7950c76', items: [{ skuId: 40, quantity: 5 }] })).resolves.toEqual(plan)
    expect(tx.auditLog.create).not.toHaveBeenCalled()
  })
})

describe('stock ledger batch and reservation boundaries', () => {
  function ledger() {
    const sku = { id: 40, tenantId: 2, stockNum: 22, reservedNum: 0, batchTracking: true }
    const batches = [
      { id: 3, batchNo: 'UNKNOWN', quantity: 3, expiryDate: null },
      { id: 2, batchNo: 'LATER', quantity: 8, expiryDate: day(50) },
      { id: 1, batchNo: 'EARLIER', quantity: 7, expiryDate: day(10) },
      { id: 4, batchNo: 'EXPIRED', quantity: 4, expiryDate: day(0) }
    ]
    const tx: any = {
      productSku: { updateMany: jest.fn().mockResolvedValue({ count: 1 }), findFirst: jest.fn().mockResolvedValue({ ...sku, status: 'active' }) },
      stockBatch: { findMany: jest.fn().mockResolvedValue(batches), updateMany: jest.fn().mockResolvedValue({ count: 1 }), aggregate: jest.fn().mockResolvedValue({ _sum: { quantity: 4 } }) },
      order: { update: jest.fn() }
    }
    return { sku, batches, tx }
  }

  it('allocates earlier expiry first, skips batches expiring today and keeps unknown dates last', async () => {
    const { sku, tx } = ledger()
    expect(await changeStock(tx, sku, 6, { orderOut: true })).toEqual([
      { batchId: 1, batchNo: 'EARLIER', quantity: 7 }, { batchId: 2, batchNo: 'LATER', quantity: 8 }, { batchId: 3, batchNo: 'UNKNOWN', quantity: 1 }
    ])
    expect(tx.stockBatch.updateMany.mock.calls.map((call: any) => call[0].where.id)).toEqual([1, 2, 3])
  })

  it('permits manual expired-lot disposal but refuses to sell expired stock', async () => {
    const { sku, tx } = ledger()
    expect(await changeStock(tx, sku, 18)).toEqual([{ batchId: 4, batchNo: 'EXPIRED', quantity: 4 }])
    await expect(changeStock(tx, sku, 3, { orderOut: true })).rejects.toThrow('到期')
  })

  it('restores the exact original batch allocation and rejects mismatched returns', async () => {
    const { sku, tx } = ledger()
    const restore = [{ batchId: 1, batchNo: 'EARLIER', quantity: 4 }]
    expect(await changeStock(tx, sku, 26, { restore })).toEqual(restore)
    expect(tx.stockBatch.updateMany).toHaveBeenCalledWith({ where: { id: 1, tenantId: 2, skuId: 40 }, data: { quantity: { increment: 4 } } })
    await expect(changeStock(tx, sku, 27, { restore })).rejects.toBeInstanceOf(ConflictException)
  })

  it('cannot reduce total stock below reservations or apply a stale stock update', async () => {
    const { sku, tx } = ledger()
    await expect(changeStock(tx, { ...sku, reservedNum: 10 }, 9)).rejects.toBeInstanceOf(BadRequestException)
    expect(tx.productSku.updateMany).not.toHaveBeenCalled()
    tx.productSku.updateMany.mockResolvedValue({ count: 0 })
    await expect(changeStock(tx, sku, 20)).rejects.toBeInstanceOf(ConflictException)
    expect(tx.stockBatch.updateMany).not.toHaveBeenCalled()
  })

  it('cannot reserve expired stock or release more than the held quantity', async () => {
    const { tx } = ledger()
    await expect(reserveOrder(tx, { id: 1, tenantId: 2 }, [{ skuId: 40, quantity: 19 }])).rejects.toThrow('到期')
    await expect(reserveOrder(tx, { id: 1, tenantId: 2 }, [{ skuId: 40, quantity: 1 }], true)).rejects.toThrow('预占数量不一致')
    expect(tx.productSku.updateMany).not.toHaveBeenCalled()
    expect(tx.order.update).not.toHaveBeenCalled()
  })

  it('validates actual calendar dates and the Shanghai business-date cutoff', () => {
    jest.useFakeTimers().setSystemTime(new Date('2026-10-23T16:01:00.000Z'))
    try {
      expect(businessDate().toISOString()).toBe('2026-10-24T00:00:00.000Z')
      expect(batchDates({ productionDate: '2026-10-24', expiryDate: '2026-10-25' })).toMatchObject({ productionDate: new Date('2026-10-24'), expiryDate: new Date('2026-10-25') })
      expect(() => batchDates({ expiryDate: '2027-02-29' })).toThrow('有效的年月日')
      expect(() => batchDates({ productionDate: '2026-10-25' })).toThrow('晚于今天')
      expect(() => batchDates({ productionDate: '2026-10-24', expiryDate: '2026-10-24' })).toThrow('晚于生产日期')
    } finally { jest.useRealTimers() }
  })
})
