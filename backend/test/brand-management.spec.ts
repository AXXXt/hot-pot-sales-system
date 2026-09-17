import { ConflictException } from '@nestjs/common'
import { BrandService } from '../src/brand/brand.service'

function createPrismaMock() {
  const prisma: any = {
    brand: {
      findMany: jest.fn(),
      findFirst: jest.fn(),
      create: jest.fn(),
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

describe('BrandService', () => {
  it('suggests DEPIN for 德品', () => {
    const service = new BrandService(createPrismaMock())

    expect(service.suggestCode('德品')).toEqual({ code: 'DEPIN' })
  })

  it('separates current and archived product counts in the brand list', async () => {
    const prisma = createPrismaMock()
    prisma.brand.findMany.mockResolvedValue([
      { id: 1, name: '演示品牌', _count: { products: 20 } },
      { id: 4, name: '德品', _count: { products: 1 } }
    ])
    prisma.product.groupBy.mockResolvedValue([
      { brandId: 1, status: 'archived', _count: { _all: 20 } },
      { brandId: 4, status: 'active', _count: { _all: 1 } }
    ])
    const service = new BrandService(prisma)

    await expect(service.list(1)).resolves.toEqual([
      expect.objectContaining({
        id: 1,
        currentProductCount: 0,
        archivedProductCount: 20,
        historicalProductCount: 20
      }),
      expect.objectContaining({
        id: 4,
        currentProductCount: 1,
        archivedProductCount: 0,
        historicalProductCount: 1
      })
    ])
    expect(prisma.product.groupBy).toHaveBeenCalledWith({
      by: ['brandId', 'status'],
      where: { tenantId: 1 },
      _count: { _all: true }
    })
  })

  it('creates a brand with an automatic prefix when code is omitted', async () => {
    const prisma = createPrismaMock()
    prisma.brand.create.mockResolvedValue({ id: 4, tenantId: 1, name: '德品', code: 'DEPIN' })
    const service = new BrandService(prisma)

    await service.create(1, { name: ' 德品 ' })

    expect(prisma.brand.create).toHaveBeenCalledWith({
      data: {
        tenantId: 1,
        name: '德品',
        code: 'DEPIN',
        sortOrder: 0,
        logoUrl: undefined,
        description: undefined,
        status: 'active'
      }
    })
  })

  it('rejects a duplicate tenant brand prefix with ConflictException', async () => {
    const prisma = createPrismaMock()
    prisma.brand.create.mockRejectedValue({ code: 'P2002' })
    const service = new BrandService(prisma)

    await expect(service.create(1, { name: '德品', code: 'DEPIN' })).rejects.toBeInstanceOf(ConflictException)
  })

  it('physically deletes a brand without historical products', async () => {
    const prisma = createPrismaMock()
    prisma.brand.findFirst.mockResolvedValue({ id: 4 })
    prisma.product.count.mockResolvedValue(0)
    prisma.brand.delete.mockResolvedValue({ id: 4 })
    const service = new BrandService(prisma)

    await expect(service.delete(1, 4)).resolves.toEqual({
      id: 4,
      deletionMode: 'physical',
      linkedProductCount: 0
    })
    expect(prisma.brand.delete).toHaveBeenCalledWith({ where: { id: 4 } })
  })

  it('disables a brand with historical products', async () => {
    const prisma = createPrismaMock()
    prisma.brand.findFirst.mockResolvedValue({ id: 4 })
    prisma.product.count.mockResolvedValue(2)
    prisma.brand.update.mockResolvedValue({ id: 4, status: 'disabled' })
    const service = new BrandService(prisma)

    await expect(service.delete(1, 4)).resolves.toEqual({
      id: 4,
      deletionMode: 'disabled',
      linkedProductCount: 2
    })
    expect(prisma.brand.update).toHaveBeenCalledWith({ where: { id: 4 }, data: { status: 'disabled' } })
  })

  it('restores a disabled brand', async () => {
    const prisma = createPrismaMock()
    prisma.brand.findFirst.mockResolvedValue({ id: 4 })
    prisma.brand.update.mockResolvedValue({ id: 4, status: 'active' })
    const service = new BrandService(prisma)

    await service.restore(1, 4)

    expect(prisma.brand.update).toHaveBeenCalledWith({ where: { id: 4 }, data: { status: 'active' } })
  })

  it('renaming a brand updates product names but preserves product codes', async () => {
    const prisma = createPrismaMock()
    prisma.brand.findFirst.mockResolvedValue({ id: 4, tenantId: 1, name: '德品', code: 'DEPIN' })
    prisma.brand.update.mockResolvedValue({ id: 4, tenantId: 1, name: '德新', code: 'DEPIN' })
    prisma.product.findMany.mockResolvedValue([
      { id: 11, code: 'DEPIN-YaXue-001', category: { name: '鸭血' } },
      { id: 12, code: 'DEPIN-NiuRou-001', category: null }
    ])
    const service = new BrandService(prisma)

    await service.update(1, 4, { name: '德新' })

    expect(prisma.product.update).toHaveBeenCalledTimes(1)
    expect(prisma.product.update).toHaveBeenCalledWith({
      where: { id: 11 },
      data: { name: '德新鸭血' }
    })
    expect(prisma.product.update.mock.calls[0][0].data).not.toHaveProperty('code')
  })
})
