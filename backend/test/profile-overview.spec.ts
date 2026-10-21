import { OrderService } from '../src/order/order.service'
import { AuthService } from '../src/auth/auth.service'

describe('customer purchase overview', () => {
  function subject() {
    const prisma = { order: {
      groupBy: jest.fn().mockResolvedValue([{ status: 'pending_confirm', _count: { _all: 73 } }]),
      findMany: jest.fn().mockResolvedValue([{
        id: 12, orderNo: 'OD12', createdAt: '2026-10-01',
        items: [{ productName: '商品', skuSpecText: '1kg', quantity: 2, sku: { product: { mainImageUrl: 'image.jpg' } } }]
      }]),
      count: jest.fn().mockResolvedValue(73)
    } }
    return { prisma, service: new OrderService(prisma as any, {} as any, {} as any, {} as any, {} as any) }
  }
  it('uses full scoped aggregation rather than the first page of orders', async () => {
    const { prisma, service } = subject()
    const result = await service.overview({ tenantId: 8, customerId: 14 })
    expect(result.counts.pending_confirm).toBe(73)
    expect(prisma.order.groupBy).toHaveBeenCalledWith({
      by: ['status'], where: { tenantId: 8, customerId: 14 }, _count: { _all: true }
    })
    expect(prisma.order.findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: { tenantId: 8, customerId: 14, status: 'completed' }, take: 2
    }))
    expect(result.recentOrders[0]).toMatchObject({ image: 'image.jpg', skuCount: 1, itemCount: 2 })
  })
  it('refuses an unbound customer before querying', async () => {
    const { prisma, service } = subject()
    await expect(service.overview({ tenantId: 1, customerId: 0 })).rejects.toMatchObject({ status: 403 })
    expect(prisma.order.groupBy).not.toHaveBeenCalled()
  })
  it('filters pending on the server before paginating', async () => {
    const { prisma, service } = subject()
    prisma.order.findMany.mockResolvedValue([])
    await service.list({ tenantId: 8, customerId: 14, status: 'pending', page: 2, pageSize: 20 })
    const where = { tenantId: 8, customerId: 14, status: { notIn: ['completed', 'cancelled'] } }
    expect(prisma.order.findMany).toHaveBeenCalledWith(expect.objectContaining({ where, skip: 20, take: 20 }))
    expect(prisma.order.count).toHaveBeenCalledWith({ where })
  })
})

describe('profile identity and credit', () => {
  it.each(['active', 'disabled'])('returns the actual %s customer level without leaking the model', async status => {
    const prisma = { user: { findUnique: jest.fn().mockResolvedValue({
      id: 1, tenant: { id: 8, name: '供应商', code: 'supplier' }, userRoles: [], brandAccess: [],
      customer: { id: 14, customerType: 'chain', creditLimit: '100', creditUsed: '20',
        level: { name: '普通客户', status, discountRate: '.9' } }
    }) } }
    const config = { get: (_key: string, fallback: string) => fallback }
    const service = new AuthService(prisma as any, {} as any, config as any, {} as any, {} as any, {} as any)
    const result = await service.getProfile(1)
    expect(result.customer?.customerLevelName).toBe(status === 'active' ? '普通客户' : null)
    expect(result.customer?.creditRemaining).toBe('80.00')
    expect(result.customer).not.toHaveProperty('level')
    expect(result.support).toEqual({ phone: '', hours: '' })
  })
})
