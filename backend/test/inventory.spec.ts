import { BadRequestException } from '@nestjs/common'
import { InventoryService } from '../src/inventory/inventory.service'
import { OrderService } from '../src/order/order.service'

function createInventorySubject() {
  const tx: any = {
    stockAdjustment: { create: jest.fn() },
    productSku: { findUnique: jest.fn(), update: jest.fn() },
    stockMovement: { create: jest.fn() },
    stocktake: { create: jest.fn(), update: jest.fn() },
    stocktakeItem: { createMany: jest.fn(), update: jest.fn() }
  }
  const prisma: any = {
    user: { findUnique: jest.fn() },
    productSku: { findMany: jest.fn() },
    stocktake: { findUnique: jest.fn() },
    $transaction: jest.fn(async (callback: any) => callback(tx))
  }
  const audit = { write: jest.fn() }
  const service = new InventoryService(prisma, audit as any)
  return { prisma, tx, audit, service }
}

describe('InventoryService', () => {
  beforeEach(() => jest.clearAllMocks())

  it('creates a manual stock-in adjustment and writes a movement', async () => {
    const { prisma, tx, audit, service } = createInventorySubject()
    prisma.user.findUnique.mockResolvedValue({ userType: 'admin' })
    tx.stockAdjustment.create.mockResolvedValue({ id: 1, adjustmentNo: 'ADJ1', type: 'manual_in' })
    tx.productSku.findUnique.mockResolvedValue({ id: 26, productId: 26, stockNum: 100, status: 'active', product: { name: '示例毛肚', status: 'active' } })
    tx.stockMovement.create.mockResolvedValue({ id: 10 })

    const result = await service.createAdjustment(
      { type: 'manual_in', reason: '期初入库', items: [{ skuId: 26, quantity: 5 }] },
      9
    )

    expect(tx.productSku.update).toHaveBeenCalledWith({ where: { id: 26 }, data: { stockNum: 105 } })
    expect(tx.stockMovement.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ changeQty: 5, beforeQty: 100, afterQty: 105, type: 'manual_in', sourceType: 'adjustment', sourceId: 1 })
      })
    )
    expect(audit.write).toHaveBeenCalledWith(expect.objectContaining({ action: 'inventory_adjust', targetType: 'stock_adjustment' }))
    expect(result.id).toBe(1)
  })

  it('rejects manual stock-out when inventory is insufficient', async () => {
    const { prisma, tx, audit, service } = createInventorySubject()
    prisma.user.findUnique.mockResolvedValue({ userType: 'admin' })
    tx.stockAdjustment.create.mockResolvedValue({ id: 2, adjustmentNo: 'ADJ2', type: 'manual_out' })
    tx.productSku.findUnique.mockResolvedValue({ id: 26, productId: 26, stockNum: 2, status: 'active', product: { name: '示例毛肚', status: 'active' } })

    await expect(
      service.createAdjustment({ type: 'manual_out', reason: '出库', items: [{ skuId: 26, quantity: 5 }] }, 9)
    ).rejects.toBeInstanceOf(BadRequestException)
    expect(tx.productSku.update).not.toHaveBeenCalled()
    expect(tx.stockMovement.create).not.toHaveBeenCalled()
    expect(audit.write).not.toHaveBeenCalled()
  })

  it('creates a stocktake snapshot from active SKUs', async () => {
    const { prisma, tx, service } = createInventorySubject()
    prisma.user.findUnique.mockResolvedValue({ userType: 'admin' })
    prisma.productSku.findMany.mockResolvedValue([{ id: 1, stockNum: 10 }, { id: 2, stockNum: 5 }])
    tx.stocktake.create.mockResolvedValue({ id: 9, stocktakeNo: 'PD1' })
    prisma.stocktake.findUnique.mockResolvedValue({
      id: 9,
      stocktakeNo: 'PD1',
      status: 'draft',
      items: [
        { id: 1, skuId: 1, systemQty: 10, countedQty: null, diffQty: 0, sku: { product: { name: 'A' }, specText: 'x' } }
      ]
    })

    const result = await service.createStocktake({ remark: '盘点' }, 9)

    expect(tx.stocktakeItem.createMany).toHaveBeenCalledWith({
      data: [
        { tenantId: 1, stocktakeId: 9, skuId: 1, systemQty: 10 },
        { tenantId: 1, stocktakeId: 9, skuId: 2, systemQty: 5 }
      ]
    })
    expect(result.stocktakeNo).toBe('PD1')
  })

  it('completes a stocktake and applies the stock difference as a movement', async () => {
    const { prisma, tx, service } = createInventorySubject()
    prisma.user.findUnique.mockResolvedValue({ userType: 'admin' })
    prisma.stocktake.findUnique
      .mockResolvedValueOnce({
        id: 9,
        stocktakeNo: 'PD1',
        status: 'draft',
        items: [{ id: 1, skuId: 26, systemQty: 105 }]
      })
      .mockResolvedValue({
        id: 9,
        stocktakeNo: 'PD1',
        status: 'completed',
        items: []
      })
    tx.productSku.findUnique.mockResolvedValue({ id: 26, productId: 26, stockNum: 105 })
    tx.stockMovement.create.mockResolvedValue({ id: 20 })

    await service.completeStocktake(
      9,
      { items: [{ skuId: 26, countedQty: 100, remark: '盘亏5' }] },
      9
    )

    expect(tx.productSku.update).toHaveBeenCalledWith({ where: { id: 26 }, data: { stockNum: 100 } })
    expect(tx.stockMovement.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ changeQty: -5, beforeQty: 105, afterQty: 100, type: 'stocktake_out', sourceType: 'stocktake', sourceId: 9 })
      })
    )
    expect(tx.stocktake.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ status: 'completed' }) })
    )
  })

  it('rejects completing a stocktake with missing counted quantities', async () => {
    const { prisma, service } = createInventorySubject()
    prisma.user.findUnique.mockResolvedValue({ userType: 'admin' })
    prisma.stocktake.findUnique.mockResolvedValue({
      id: 9,
      stocktakeNo: 'PD1',
      status: 'draft',
      items: [{ id: 1, skuId: 26, systemQty: 105 }]
    })

    await expect(
      service.completeStocktake(9, { items: [] }, 9)
    ).rejects.toBeInstanceOf(BadRequestException)
  })
})

describe('OrderService stock movement logging', () => {
  beforeEach(() => jest.clearAllMocks())

  function createOrderSubject() {
    const tx: any = {
      productSku: { findUnique: jest.fn(), update: jest.fn() },
      stockMovement: { create: jest.fn() },
      order: { update: jest.fn() },
      orderStatusLog: { create: jest.fn() },
      customer: { findUnique: jest.fn(), update: jest.fn() }
    }
    const prisma: any = {
      user: { findUnique: jest.fn() },
      order: { findUnique: jest.fn() },
      orderStatusLog: { create: jest.fn() },
      customer: { findUnique: jest.fn(), update: jest.fn() },
      $transaction: jest.fn(async (callback: any) => callback(tx))
    }
    const service = new OrderService(
      prisma,
      {} as any,
      { write: jest.fn() } as any,
      {} as any,
      {} as any,
      { recordInventoryFailure: jest.fn() } as any
    )
    return { prisma, tx, service }
  }

  it('writes an order_out movement when finance approval deducts stock', async () => {
    const { prisma, tx, service } = createOrderSubject()
    const order = {
      id: 100,
      tenantId: 1,
      orderNo: 'OD100',
      status: 'pending_finance',
      items: [{ skuId: 11, quantity: 3, productName: '牛肉卷' }]
    }
    prisma.user.findUnique.mockResolvedValue({ userType: 'admin' })
    prisma.order.findUnique.mockResolvedValue(order)
    tx.productSku.findUnique.mockResolvedValue({ id: 11, productId: 11, stockNum: 10 })
    tx.productSku.update.mockResolvedValue({})
    tx.stockMovement.create.mockResolvedValue({ id: 30 })
    tx.order.update.mockResolvedValue({ count: 1 })

    await service.approveFinance(100, 9)

    expect(tx.stockMovement.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ changeQty: -3, beforeQty: 10, afterQty: 7, type: 'order_out', sourceType: 'order', sourceId: 100 })
      })
    )
  })

  it('writes an order_return movement when a pending_shipment order is cancelled', async () => {
    const { prisma, tx, service } = createOrderSubject()
    const order = {
      id: 101,
      tenantId: 1,
      orderNo: 'OD101',
      status: 'pending_shipment',
      paymentMethod: null,
      creditAmount: 0,
      items: [{ skuId: 12, quantity: 4, productName: '鸭血' }]
    }
    prisma.order.findUnique.mockResolvedValue(order)
    tx.productSku.findUnique.mockResolvedValue({ id: 12, productId: 12, stockNum: 20 })
    tx.productSku.update.mockResolvedValue({})
    tx.stockMovement.create.mockResolvedValue({ id: 31 })
    tx.order.update.mockResolvedValue({})
    tx.orderStatusLog.create.mockResolvedValue({})

    await service.cancel(101, 9)

    expect(tx.stockMovement.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ changeQty: 4, beforeQty: 20, afterQty: 24, type: 'order_return', sourceType: 'order', sourceId: 101 })
      })
    )
  })
})