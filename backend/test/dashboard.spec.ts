import { DashboardService } from '../src/dashboard/dashboard.service'

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
          createdAt: new Date(2026, 6, 27, 21, 0, 0),
          _count: { id: 1 },
          _sum: { payableAmount: '77.50' }
        }]),
      findMany: jest.fn().mockResolvedValue([{
        id: 2,
        orderNo: 'OD002',
        status: 'shipped',
        payableAmount: '77.50',
        createdAt: new Date(2026, 6, 27, 21, 0, 0),
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
    jest.useFakeTimers().setSystemTime(new Date(2026, 6, 27, 12, 0, 0))
  })

  afterEach(() => {
    jest.useRealTimers()
  })

  it('keeps Decimal order amounts in yuan across all dashboard sales data', async () => {
    const service = new DashboardService(createPrismaMock() as any)

    const stats = await service.getStats()

    expect(stats.todayRevenue).toBe(247.5)
    expect(stats.monthRevenue).toBe(247.5)
    expect(stats.recentOrders[0].payableAmount).toBe(77.5)
    expect(stats.trend[6].revenue).toBe(77.5)
    expect(stats.topProducts[0].revenue).toBe(77.5)
  })

  it('builds the seven-day trend using local calendar dates', () => {
    const service = new DashboardService({} as any)
    const start = new Date(2026, 6, 21, 0, 0, 0)
    const raw = [{
      createdAt: new Date(2026, 6, 27, 21, 0, 0),
      _count: { id: 1 },
      _sum: { payableAmount: '77.50' }
    }]

    const trend = (service as any).buildTrend(start, raw)

    expect(trend[6]).toEqual({ date: '2026-07-27', orders: 1, revenue: 77.5 })
  })

  it('counts only paid, non-sample orders in every sales metric', async () => {
    const prisma = createPrismaMock()
    const service = new DashboardService(prisma as any)
    const paidStatuses = ['pending_shipment', 'shipped', 'completed']

    await service.getStats()

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
    const service = new DashboardService(prisma as any)

    const stats = await service.getStats()

    expect(prisma.order.count.mock.calls[2][0]).toEqual({
      where: { status: 'pending_quote' }
    })
    expect(stats.pendingQuotes).toBe(0)
  })

  it('uses the same active SKU threshold for the warning count and list', async () => {
    const prisma = createPrismaMock()
    const service = new DashboardService(prisma as any)

    await service.getStats()

    const expectedWhere = { stockNum: { lte: 10 }, status: 'active', product: { status: 'active' } }
    expect(prisma.productSku.count).toHaveBeenCalledWith({ where: expectedWhere })
    expect(prisma.productSku.findMany).toHaveBeenCalledWith(expect.objectContaining({ where: expectedWhere }))
  })

  it('includes the product name in low-stock items', async () => {
    const prisma = createPrismaMock()
    prisma.productSku.findMany.mockResolvedValue([{
      id: 11,
      productId: 7,
      name: '500g/袋',
      skuCode: 'SKU-11',
      stockNum: 5,
      product: { name: '牛油火锅底料' }
    }])
    const service = new DashboardService(prisma as any)

    const stats = await service.getStats()

    expect(stats.lowStockItems[0]).toMatchObject({
      productId: 7,
      productName: '牛油火锅底料',
      skuName: '500g/袋'
    })
    expect(prisma.productSku.findMany).toHaveBeenCalledWith(expect.objectContaining({
      select: expect.objectContaining({ product: { select: { name: true } } })
    }))
  })
})
