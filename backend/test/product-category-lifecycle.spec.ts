import { ProductService } from '../src/product/product.service'

function createPrismaMock() {
  const prisma: any = {
    productCategory: {
      findFirst: jest.fn(),
      findMany: jest.fn(),
      update: jest.fn(),
      delete: jest.fn()
    },
    product: {
      count: jest.fn(),
      groupBy: jest.fn(),
      findMany: jest.fn(),
      update: jest.fn()
    }
  }
  prisma.$transaction = jest.fn(async (callback: (transaction: any) => unknown) => callback(prisma))
  return prisma
}

function createService(prisma: any, accessWhere: Record<string, unknown> = {}) {
  return new ProductService(
    prisma,
    {} as any,
    { whereForUser: jest.fn().mockResolvedValue(accessWhere) } as any,
    { write: jest.fn() } as any
  )
}

describe('ProductService category lifecycle', () => {
  it('renaming a category updates linked product names without changing codes', async () => {
    const prisma = createPrismaMock()
    prisma.productCategory.findFirst.mockResolvedValue({ id: 8, tenantId: 1, name: '鸭血', code: '鸭血' })
    prisma.productCategory.update.mockResolvedValue({ id: 8, name: '鲜鸭血' })
    prisma.product.findMany.mockResolvedValue([
      { id: 21, code: 'DEPIN-YaXue-001', brand: { name: '德品' } }
    ])
    const service = createService(prisma)

    await service.updateCategory(8, { name: '鲜鸭血' }, 1)

    expect(prisma.product.update).toHaveBeenCalledWith({
      where: { id: 21 },
      data: { name: '德品鲜鸭血' }
    })
    expect(prisma.product.update.mock.calls[0][0].data).not.toHaveProperty('code')
  })

  it('physically deletes a category with no historical products', async () => {
    const prisma = createPrismaMock()
    prisma.productCategory.findFirst.mockResolvedValue({ id: 8 })
    prisma.product.count.mockResolvedValue(0)
    prisma.productCategory.delete.mockResolvedValue({ id: 8 })
    const service = createService(prisma)

    await expect(service.deleteCategory(8, 1)).resolves.toEqual({
      id: 8,
      deletionMode: 'physical',
      linkedProductCount: 0
    })
  })

  it('disables a category with historical products', async () => {
    const prisma = createPrismaMock()
    prisma.productCategory.findFirst.mockResolvedValue({ id: 8 })
    prisma.product.count.mockResolvedValue(3)
    prisma.productCategory.update.mockResolvedValue({ id: 8, status: 'disabled' })
    const service = createService(prisma)

    await expect(service.deleteCategory(8, 1)).resolves.toEqual({
      id: 8,
      deletionMode: 'disabled',
      linkedProductCount: 3
    })
    expect(prisma.productCategory.update).toHaveBeenCalledWith({
      where: { id: 8 },
      data: { status: 'disabled' }
    })
  })

  it('restores a disabled category', async () => {
    const prisma = createPrismaMock()
    prisma.productCategory.findFirst.mockResolvedValue({ id: 8 })
    prisma.productCategory.update.mockResolvedValue({ id: 8, status: 'active' })
    const service = createService(prisma)

    await service.restoreCategory(8, 1)

    expect(prisma.productCategory.update).toHaveBeenCalledWith({
      where: { id: 8 },
      data: { status: 'active' }
    })
  })

  it('managed category list includes disabled categories and product counts', async () => {
    const prisma = createPrismaMock()
    prisma.productCategory.findMany.mockResolvedValue([
      { id: 8, name: '鸭血', status: 'disabled', _count: { products: 3 } }
    ])
    prisma.product.groupBy.mockResolvedValue([
      { categoryId: 8, status: 'active', _count: { _all: 1 } },
      { categoryId: 8, status: 'archived', _count: { _all: 2 } }
    ])
    const service = createService(prisma)

    await expect(service.managedCategories(1)).resolves.toEqual([
      expect.objectContaining({
        id: 8,
        status: 'disabled',
        codeSegment: 'YaXue',
        _count: { products: 3 },
        currentProductCount: 1,
        archivedProductCount: 2,
        historicalProductCount: 3
      })
    ])
    expect(prisma.productCategory.findMany).toHaveBeenCalledWith({
      where: { tenantId: 1, status: { in: ['active', 'disabled'] } },
      include: { _count: { select: { products: true } } },
      orderBy: { sortOrder: 'asc' }
    })
    expect(prisma.product.groupBy).toHaveBeenCalledWith({
      by: ['categoryId', 'status'],
      where: { tenantId: 1, categoryId: { not: null } },
      _count: { _all: true }
    })
  })

  it('public category list stays active-only and exposes code segment', async () => {
    const prisma = createPrismaMock()
    prisma.productCategory.findMany.mockResolvedValue([{ id: 8, name: '鸭血', status: 'active' }])
    const service = createService(prisma)

    await expect(service.categories(1)).resolves.toEqual([
      expect.objectContaining({ id: 8, codeSegment: 'YaXue' })
    ])
    expect(prisma.productCategory.findMany.mock.calls[0][0].where.status).toBe('active')
  })
})
