import { DashboardService } from '../src/dashboard/dashboard.service'
import { StaffAccessService, StaffActor } from '../src/auth/staff-access.service'
import { InventoryPlanningService } from '../src/inventory/inventory-planning.service'
import { DashboardController } from '../src/dashboard/dashboard.controller'

const actor: StaffActor = { id: 1, tenantId: 7, userType: 'warehouse', superAdmin: false, permissions: new Set(['inventory:read']), brandIds: [3], customerIds: null, leadIds: null, fingerprint: 'dashboard' }

function createPrisma(skus: any[] = []) {
  return {
    order: { count: jest.fn().mockResolvedValue(0), aggregate: jest.fn().mockResolvedValue({ _sum: { payableAmount: null } }), groupBy: jest.fn().mockResolvedValue([]), findMany: jest.fn().mockResolvedValue([]) },
    product: { count: jest.fn().mockResolvedValue(1), findMany: jest.fn().mockResolvedValue([]) },
    productSku: { count: jest.fn().mockResolvedValue(skus.length), findMany: jest.fn().mockResolvedValue(skus) },
    customer: { count: jest.fn().mockResolvedValue(0) }, orderItem: { groupBy: jest.fn().mockResolvedValue([]) }
  }
}

function sku(overrides: Record<string, unknown>) {
  return { id: 1, productId: 2, stockNum: 0, reservedNum: 0, lowStockThreshold: 0, leadTimeDays: 3, safetyStock: 0,
    batchTracking: true, batches: [], specText: '袋', skuCode: 'QA-01', product: { name: '管理标签', subtitle: '合成测试商品' }, ...overrides }
}

describe('dashboard inventory availability parity', () => {
  it.each([
    { stockNum: 22, reservedNum: 22, lowStockThreshold: 10, expectedQty: 0, expectedWarnings: 1 },
    { stockNum: 50, reservedNum: 0, lowStockThreshold: 100, expectedQty: 50, expectedWarnings: 1 },
    { stockNum: 8, reservedNum: 0, lowStockThreshold: 3, expectedQty: 8, expectedWarnings: 0 }
  ])('uses available quantity and the SKU manual threshold: %p', async input => {
    const sku = { id: 1, productId: 2, ...input, batchTracking: false, batches: [], name: '袋', skuCode: 'QA-01', product: { name: '管理标签', subtitle: '合成测试商品' } }
    const oldFilter = (query: any) => query?.where?.stockNum?.lte === undefined || sku.stockNum <= query.where.stockNum.lte
    const prisma = {
      order: { count: jest.fn().mockResolvedValue(0), aggregate: jest.fn().mockResolvedValue({ _sum: { payableAmount: null } }), groupBy: jest.fn().mockResolvedValue([]), findMany: jest.fn().mockResolvedValue([]) },
      product: { count: jest.fn().mockResolvedValue(1), findMany: jest.fn().mockResolvedValue([]) },
      productSku: { count: jest.fn(async query => oldFilter(query) ? 1 : 0), findMany: jest.fn(async query => oldFilter(query) ? [sku] : []) },
      stockBatch: { groupBy: jest.fn().mockResolvedValue([]) }, customer: { count: jest.fn().mockResolvedValue(0) }, orderItem: { groupBy: jest.fn().mockResolvedValue([]) }
    }
    const planning = new InventoryPlanningService(prisma as any, new StaffAccessService(prisma as any))
    const result = await new DashboardService(prisma as any, planning).getStats(undefined, actor)
    expect(result.inventoryWarnings).toBe(input.expectedWarnings)
    expect(result.lowStockItems).toHaveLength(input.expectedWarnings)
    if (input.expectedWarnings) expect(result.lowStockItems[0]).toMatchObject({ availableQty: input.expectedQty, warningQty: input.lowStockThreshold })
  })

  it('subtracts expired batches and reservations while retaining a zero threshold', async () => {
    const prisma = createPrisma([sku({ stockNum: 30, reservedNum: 5, batches: [{ quantity: 25, expiryDate: new Date('2020-01-01') }] }), sku({ id: 2, stockNum: 1 })])
    const planning = new InventoryPlanningService(prisma as any, new StaffAccessService(prisma as any))
    const result = await new DashboardService(prisma as any, planning).getStats(undefined, actor)
    expect(result.inventoryWarnings).toBe(1)
    expect(result.lowStockItems).toEqual([expect.objectContaining({ id: 1, availableQty: 0, warningQty: 0 })])
    expect(prisma.orderItem.groupBy).toHaveBeenCalledTimes(1) // Only the bestseller query; no order forecast permission.
  })

  it('keeps inventory unavailable rather than reporting zero warnings when permission is absent', async () => {
    const prisma = createPrisma()
    const planning = { overview: jest.fn() }
    const restricted = { ...actor, permissions: new Set<string>() }
    const result = await new DashboardService(prisma as any, planning as any).getStats(undefined, restricted)
    expect(planning.overview).not.toHaveBeenCalled()
    expect(result.inventoryWarnings).toBeNull()
    expect(result.lowStockItems).toEqual([])
    expect(prisma.productSku.findMany).not.toHaveBeenCalled()
  })

  it('retains the tenant, active brand and responsible-customer scope when using forecast thresholds', async () => {
    const scopedActor: StaffActor = { ...actor, userType: 'sales', customerIds: [41], permissions: new Set(['inventory:read', 'analytics:view', 'order:read', 'product:read', 'customer:manage']) }
    const prisma = createPrisma([sku({ stockNum: 3, lowStockThreshold: 2 })])
    prisma.orderItem.groupBy.mockImplementation(async query => query.by[0] === 'skuId' && query.where.order.AND[1].sampleFlag === false ? [{ skuId: 1, _sum: { quantity: 56 } }] : [])
    const access = new StaffAccessService(prisma as any)
    const actorRead = jest.spyOn(access, 'actor').mockResolvedValue(scopedActor)
    const planning = new InventoryPlanningService(prisma as any, access)
    const service = new DashboardService(prisma as any, planning)
    const result = await new DashboardController(service, access).stats({ user: { sub: 1 } })
    expect(actorRead).toHaveBeenCalledTimes(1)
    expect(result.visibility.inventory).toBe(true)
    expect(result.inventoryWarnings).toBe(1)
    expect(result.lowStockItems[0]).toMatchObject({ availableQty: 3, warningQty: 6 })
    expect(prisma.productSku.findMany).toHaveBeenCalledWith(expect.objectContaining({ where: expect.objectContaining({ tenantId: 7, status: 'active', product: { AND: [{ tenantId: 7, brandId: { in: [3] } }, { status: 'active', brand: { status: 'active' } }] } }) }))
    const expectedOrderScope = { tenantId: 7, brandId: { in: [3] }, customerId: { in: [41] } }
    for (const [query] of prisma.order.count.mock.calls) expect(query.where.AND[0]).toEqual(expectedOrderScope)
    const forecastQueries = prisma.orderItem.groupBy.mock.calls.map(([query]) => query).filter(query => query.by[0] === 'skuId')
    expect(forecastQueries).toHaveLength(2)
    for (const query of forecastQueries) expect(query.where).toMatchObject({ tenantId: 7, skuId: { in: [1] }, order: { AND: [expectedOrderScope, expect.anything()] } })
    expect(prisma.product.count).toHaveBeenCalledWith({ where: { AND: [{ tenantId: 7, brandId: { in: [3] } }, { status: 'active' }] } })
    for (const [query] of prisma.customer.count.mock.calls) expect(query.where.AND[0]).toEqual({ tenantId: 7, id: { in: [41] } })
  })

  it('does not turn a failed inventory read into a successful zero warning result', async () => {
    const planning = { overview: jest.fn().mockRejectedValue(new Error('inventory unavailable')) }
    await expect(new DashboardService(createPrisma() as any, planning as any).getStats(undefined, actor)).rejects.toThrow('inventory unavailable')
  })
})
