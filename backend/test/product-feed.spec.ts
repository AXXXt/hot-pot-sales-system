import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { ProductService } from '../src/product/product.service'

const baseParams = { brandId: 1, page: 1, pageSize: 6 }

describe('product feed schema', () => {
  const schema = readFileSync(join(__dirname, '../prisma/schema.prisma'), 'utf8')

  it('stores the new and hot product flags', () => {
    expect(schema).toContain('isNew')
    expect(schema).toContain('isHot')
  })
})

describe('ProductService home feeds', () => {
  it.each([
    ['new', { isNew: true }],
    ['hot', { isHot: true }]
  ])('filters the %s feed by its product flag', async (feed, expectedFlag) => {
    const findMany = jest.fn().mockResolvedValue([])
    const count = jest.fn().mockResolvedValue(0)
    const prisma = { product: { findMany, count } }
    const visibility = { whereForUser: jest.fn().mockResolvedValue({ status: 'active' }) }
    const service = new ProductService(prisma as any, {} as any, visibility as any, { write: jest.fn() } as any)

    await service.list({ ...baseParams, feed } as any, 7)

    expect(findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: { brandId: 1, status: 'active', ...expectedFlag }
    }))
    expect(count).toHaveBeenCalledWith({
      where: { brandId: 1, status: 'active', ...expectedFlag }
    })
  })

  it('returns the five most purchased products in quantity order', async () => {
    const groupBy = jest.fn().mockResolvedValue([
      { productId: 3, _sum: { quantity: 18 } },
      { productId: 1, _sum: { quantity: 9 } }
    ])
    const findMany = jest.fn().mockResolvedValue([
      { id: 1, skus: [] },
      { id: 3, skus: [] }
    ])
    const prisma = {
      user: { findUnique: jest.fn().mockResolvedValue({ customerId: 12 }) },
      orderItem: { groupBy },
      product: { findMany }
    }
    const visibility = { whereForUser: jest.fn().mockResolvedValue({ status: 'active' }) }
    const service = new ProductService(prisma as any, {} as any, visibility as any, { write: jest.fn() } as any)

    const result = await service.list({ ...baseParams, feed: 'frequent' } as any, 7)

    expect(groupBy).toHaveBeenCalledWith({
      by: ['productId'],
      where: {
        productId: { not: null },
        order: {
          customerId: 12,
          brandId: 1,
          status: { notIn: ['draft', 'cancelled'] }
        }
      },
      _sum: { quantity: true },
      orderBy: { _sum: { quantity: 'desc' } },
      take: 5
    })
    expect(findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: { brandId: 1, status: 'active', id: { in: [3, 1] } }
    }))
    expect(result.items.map((item: any) => item.id)).toEqual([3, 1])
    expect(result).toMatchObject({ page: 1, pageSize: 5, total: 2 })
  })

  it('aggregates frequent purchases across brands when no brand filter is selected', async () => {
    const groupBy = jest.fn().mockResolvedValue([{ productId: 4, _sum: { quantity: 6 } }])
    const findMany = jest.fn().mockResolvedValue([{ id: 4, skus: [] }])
    const prisma = {
      user: { findUnique: jest.fn().mockResolvedValue({ customerId: 12 }) },
      orderItem: { groupBy },
      product: { findMany }
    }
    const visibility = { whereForUser: jest.fn().mockResolvedValue({ status: 'active' }) }
    const service = new ProductService(prisma as any, {} as any, visibility as any, { write: jest.fn() } as any)

    await service.list({ page: 1, pageSize: 6, feed: 'frequent' } as any, 7)

    expect(groupBy).toHaveBeenCalledWith(expect.objectContaining({
      where: {
        productId: { not: null },
        order: {
          customerId: 12,
          status: { notIn: ['draft', 'cancelled'] }
        }
      }
    }))
    expect(findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: { status: 'active', id: { in: [4] } }
    }))
  })

  it('returns an empty frequent feed when the user has no customer purchase history', async () => {
    const prisma = {
      user: { findUnique: jest.fn().mockResolvedValue({ customerId: null }) },
      orderItem: { groupBy: jest.fn() },
      product: { findMany: jest.fn() }
    }
    const visibility = { whereForUser: jest.fn().mockResolvedValue({ status: 'active' }) }
    const service = new ProductService(prisma as any, {} as any, visibility as any, { write: jest.fn() } as any)

    await expect(service.list({ ...baseParams, feed: 'frequent' } as any, 7)).resolves.toEqual({
      items: [],
      page: 1,
      pageSize: 5,
      total: 0
    })
    expect(prisma.orderItem.groupBy).not.toHaveBeenCalled()
    expect(prisma.product.findMany).not.toHaveBeenCalled()
  })

  it('persists the new and hot flags when creating a product', async () => {
    const create = jest.fn().mockResolvedValue({ id: 8 })
    const prisma: any = {
      brand: { findFirst: jest.fn().mockResolvedValue({ id: 5, name: '德品', code: 'DEPIN' }) },
      productCategory: {
        findFirst: jest.fn().mockResolvedValue({ id: 2, name: '鸭血' }),
        update: jest.fn().mockResolvedValue({ productSequence: 1 })
      },
      product: { create, findFirst: jest.fn().mockResolvedValue(null) }
    }
    prisma.$transaction = jest.fn(async (callback: (transaction: any) => unknown) => callback(prisma))
    const service = new ProductService(prisma as any, {} as any, {} as any, { write: jest.fn() } as any)

    await service.create({
      brandId: 5,
      categoryId: 2,
      code: 'P-8',
      name: '鸭血',
      isNew: true,
      isHot: true
    } as any)

    expect(create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ isNew: true, isHot: true })
    }))
  })

  it('combines category and stock filters in one product query', async () => {
    const findMany = jest.fn().mockResolvedValue([])
    const count = jest.fn().mockResolvedValue(0)
    const prisma = { product: { findMany, count } }
    const visibility = { whereForUser: jest.fn().mockResolvedValue({ status: 'active' }) }
    const service = new ProductService(prisma as any, {} as any, visibility as any, { write: jest.fn() } as any)

    await service.list({
      ...baseParams,
      categoryId: 4,
      inStock: true
    }, 7)

    const expectedWhere = {
      brandId: 1,
      categoryId: 4,
      status: 'active',
      skus: { some: { status: 'active', stockNum: { gt: 0 } } }
    }
    expect(findMany).toHaveBeenCalledWith(expect.objectContaining({ where: expectedWhere }))
    expect(count).toHaveBeenCalledWith({ where: expectedWhere })
  })

  it('sorts the combined product result by the lowest active SKU price', async () => {
    const findMany = jest.fn().mockResolvedValue([
      { id: 1, skus: [{ id: 11, basePrice: '72.00' }] },
      { id: 2, skus: [{ id: 21, basePrice: '65.00' }] },
      { id: 3, skus: [] }
    ])
    const prisma = {
      product: { findMany, count: jest.fn().mockResolvedValue(3) }
    }
    const visibility = { whereForUser: jest.fn().mockResolvedValue({ status: 'active' }) }
    const service = new ProductService(prisma as any, {} as any, visibility as any, { write: jest.fn() } as any)

    const result = await service.list({
      ...baseParams,
      pageSize: 2,
      sortBy: 'price_asc'
    })

    expect(result.items.map((item: any) => item.id)).toEqual([2, 1])
  })
})
