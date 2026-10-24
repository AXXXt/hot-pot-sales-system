import { DashboardService } from '../src/dashboard/dashboard.service'
import { StaffAccessService, StaffActor } from '../src/auth/staff-access.service'
import { InventoryPlanningService } from '../src/inventory/inventory-planning.service'

const inventoryActor: StaffActor = { id: 1, tenantId: 1, userType: 'warehouse', superAdmin: false,
  permissions: new Set(['inventory:read']), brandIds: [1], customerIds: null, leadIds: null, fingerprint: 'dashboard' }
const serviceFor = (prisma: any) => new DashboardService(prisma, new InventoryPlanningService(prisma, new StaffAccessService(prisma)))

function createPrismaMock() {
  return {
    order: {
      count: jest.fn()
        .mockResolvedValueOnce(2)
        .mockResolvedValueOnce(0)
        .mockResolvedValueOnce(0)
        .mockResolvedValueOnce(0),
      aggregate: jest.fn()
        .mockResolvedValueOnce({ _sum: { payableAmount: '247.50' } })
        .mockResolvedValueOnce({ _sum: { payableAmount: null } })
        .mockResolvedValueOnce({ _sum: { payableAmount: '247.50' } }),
      groupBy: jest.fn()
        .mockResolvedValueOnce([])
        .mockResolvedValueOnce([{
          createdAt: new Date('2026-07-27T21:00:00+08:00'),
          _count: { id: 1 },
          _sum: { payableAmount: '77.50' }
        }]),
      findMany: jest.fn().mockResolvedValue([{
        id: 2,
        orderNo: 'OD002',
        status: 'shipped',
        payableAmount: '77.50',
        createdAt: new Date('2026-07-27T21:00:00+08:00'),
        customer: { customerName: '客户A' }
      }])
    },
    productSku: {
      count: jest.fn().mockResolvedValue(0),
      findMany: jest.fn().mockResolvedValue([])
    },
    orderItem: {
      groupBy: jest.fn().mockResolvedValue([{
        productId: 1,
        _sum: { quantity: 2, amount: '77.50' }
      }])
    },
    product: {
      count: jest.fn().mockResolvedValue(1),
      findMany: jest.fn().mockResolvedValue([{ id: 1, name: '商品A' }])
    },
    customer: {
      count: jest.fn()
        .mockResolvedValueOnce(1)
        .mockResolvedValueOnce(1)
    }
  }
}

describe('DashboardService', () => {
  beforeEach(() => {
    jest.useFakeTimers().setSystemTime(new Date('2026-07-27T12:00:00+08:00'))
  })

  afterEach(() => {
    jest.useRealTimers()
  })

  it('keeps Decimal order amounts in yuan across all dashboard sales data', async () => {
    const service = serviceFor(createPrismaMock())

    const stats = await service.getStats(undefined, inventoryActor)

    expect(stats.todayRevenue).toBe(247.5)
    expect(stats.monthRevenue).toBe(247.5)
    expect(stats.recentOrders[0].payableAmount).toBe(77.5)
    expect(stats.trend[6].revenue).toBe(77.5)
    expect(stats.topProducts[0].revenue).toBe(77.5)
  })

  it('builds the seven-day trend using Shanghai calendar dates regardless of the host timezone', () => {
    const service = serviceFor({})
    const start = new Date('2026-07-21T00:00:00+08:00')
    const raw = [{
      createdAt: new Date('2026-07-27T21:00:00+08:00'),
      _count: { id: 1 },
      _sum: { payableAmount: '77.50' }
    }]

    const trend = (service as any).buildTrend(start, raw)

    expect(trend[6]).toEqual({ date: '2026-07-27', orders: 1, revenue: 77.5 })
  })

  it('counts only paid, non-sample orders in every sales metric', async () => {
    const prisma = createPrismaMock()
    const service = serviceFor(prisma)
    const paidStatuses = ['pending_shipment', 'shipped', 'completed']

    await service.getStats(undefined, inventoryActor)

    for (const call of prisma.order.aggregate.mock.calls) {
      expect(call[0]).toMatchObject({
        where: { status: { in: paidStatuses }, sampleFlag: false }
      })
    }
    expect(prisma.order.groupBy.mock.calls[1][0]).toMatchObject({
      where: { status: { in: paidStatuses }, sampleFlag: false }
    })
    expect(prisma.orderItem.groupBy.mock.calls[0][0]).toMatchObject({
      where: { order: { status: { in: paidStatuses }, sampleFlag: false } }
    })
  })

  it('counts pending quotes for the admin to-do card', async () => {
    const prisma = createPrismaMock()
    const service = serviceFor(prisma)

    const stats = await service.getStats(undefined, inventoryActor)

    expect(prisma.order.count.mock.calls[2][0]).toEqual({
      where: { status: 'pending_quote' }
    })
    expect(stats.pendingQuotes).toBe(0)
  })

  it('uses the same inventory plan result for both warning count and list', async () => {
    const prisma = createPrismaMock()
    const planning = { overview: jest.fn().mockResolvedValue({ truncated: false, items: [
      { skuId: 1, productId: 2, productName: '商品', specText: '袋', availableNum: 0, threshold: 100, lowStock: true },
      { skuId: 2, productId: 2, productName: '商品', specText: '箱', availableNum: 8, threshold: 3, lowStock: false }
    ] }) }
    const stats = await new DashboardService(prisma as any, planning as any).getStats(undefined, inventoryActor)
    expect(planning.overview).toHaveBeenCalledTimes(1)
    expect(planning.overview).toHaveBeenCalledWith(inventoryActor)
    expect(stats.inventoryWarnings).toBe(1)
    expect(stats.lowStockItems).toEqual([{ id: 1, productId: 2, productName: '商品', skuName: '袋', warehouse: '', availableQty: 0, warningQty: 100 }])
    expect(prisma.productSku.count).not.toHaveBeenCalled()
  })

  it('includes the product name in low-stock items', async () => {
    const prisma = createPrismaMock()
    prisma.productSku.findMany.mockResolvedValue([{
      id: 11,
      productId: 7,
      name: '500g/袋',
      specText: '500g/袋', reservedNum: 0, lowStockThreshold: 10, leadTimeDays: 3, safetyStock: 0, batches: [],
      skuCode: 'SKU-11',
      stockNum: 5,
      product: { name: '牛油火锅底料' }
    }])
    const service = serviceFor(prisma)

    const stats = await service.getStats(undefined, inventoryActor)

    expect(stats.lowStockItems[0]).toMatchObject({
      productId: 7,
      productName: '牛油火锅底料',
      skuName: '500g/袋'
    })
    expect(prisma.productSku.findMany).toHaveBeenCalledWith(expect.objectContaining({
      include: expect.objectContaining({ product: { select: { name: true, subtitle: true, brandId: true } } })
    }))
  })

  it('shows the real name in warnings and bestsellers while retaining legacy label fallback', async () => {
    const prisma = createPrismaMock()
    prisma.productSku.findMany.mockResolvedValue([{
      id: 11, productId: 1, name: '500g/袋', skuCode: 'SKU-11', stockNum: 5,
      specText: '500g/袋', reservedNum: 0, lowStockThreshold: 10, leadTimeDays: 3, safetyStock: 0, batches: [],
      product: { name: '品牌丸滑', subtitle: '爆汁牛筋丸' }
    }, {
      id: 12, productId: 2, name: '1kg/袋', skuCode: 'SKU-12', stockNum: 0,
      specText: '1kg/袋', reservedNum: 0, lowStockThreshold: 10, leadTimeDays: 3, safetyStock: 0, batches: [],
      product: { name: '旧商品标签', subtitle: ' ' }
    }])
    prisma.product.findMany.mockResolvedValue([
      { id: 1, name: '品牌丸滑', subtitle: '爆汁牛筋丸' } as any
    ])
    const stats = await serviceFor(prisma).getStats(undefined, inventoryActor)

    expect(stats.lowStockItems.map(item => item.productName)).toEqual(['爆汁牛筋丸', '旧商品标签'])
    expect(stats.topProducts[0].name).toBe('爆汁牛筋丸')
    expect(prisma.product.findMany).toHaveBeenCalledWith(expect.objectContaining({
      select: { id: true, name: true, subtitle: true }
    }))
  })
})
