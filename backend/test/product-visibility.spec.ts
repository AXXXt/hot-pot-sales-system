import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { NotFoundException } from '@nestjs/common'
import { ProductVisibilityService } from '../src/product/product-visibility.service'
import { ProductService } from '../src/product/product.service'

describe('product visibility schema', () => {
  const schema = readFileSync(join(__dirname, '../prisma/schema.prisma'), 'utf8')

  it('defines factory/all/custom visibility without obsolete fields', () => {
    expect(schema).toContain('enum ProductVisibilityMode')
    expect(schema).toContain('isFactoryProduct')
    expect(schema).toContain('model CustomerVisibleProduct')
    expect(schema).not.toContain('visibilityType')
    expect(schema).not.toContain('channelType')
  })
})

describe('ProductVisibilityService', () => {
  it('limits guests to active factory products', async () => {
    const service = new ProductVisibilityService({} as any)

    await expect(service.whereForUser()).resolves.toEqual({
      status: 'active',
      isFactoryProduct: true
    })
  })

  it('does not restrict internal users even when they have a customer association', async () => {
    const prisma = {
      user: {
        findUnique: jest.fn().mockResolvedValue({
          userType: 'super_admin',
          customer: { id: 10, productVisibilityMode: 'factory' }
        })
      }
    }
    const service = new ProductVisibilityService(prisma as any)

    await expect(service.whereForUser(1)).resolves.toEqual({})
  })

  it.each([
    ['factory', { status: 'active', isFactoryProduct: true }],
    ['all', { status: 'active' }],
    ['custom', { status: 'active', visibleToCustomers: { some: { customerId: 44 } } }]
  ])('builds the %s customer filter', async (mode, expected) => {
    const prisma = {
      user: {
        findUnique: jest.fn().mockResolvedValue({
          userType: 'customer_user',
          customer: { id: 44, productVisibilityMode: mode }
        })
      }
    }
    const service = new ProductVisibilityService(prisma as any)

    await expect(service.whereForUser(2)).resolves.toEqual(expected)
  })

  it('falls back to factory visibility for missing users and unbound customers', async () => {
    const prisma = {
      user: { findUnique: jest.fn().mockResolvedValue(null) }
    }
    const service = new ProductVisibilityService(prisma as any)

    await expect(service.whereForUser(999)).resolves.toEqual({
      status: 'active',
      isFactoryProduct: true
    })
  })

  it('returns 404 semantics when a product is outside the resolved scope', async () => {
    const prisma = {
      user: { findUnique: jest.fn().mockResolvedValue(null) },
      product: { findFirst: jest.fn().mockResolvedValue(null) }
    }
    const service = new ProductVisibilityService(prisma as any)

    await expect(service.assertVisible(7, 999)).rejects.toBeInstanceOf(NotFoundException)
    expect(prisma.product.findFirst).toHaveBeenCalledWith({
      where: { id: 7, status: 'active', isFactoryProduct: true },
      select: { id: true }
    })
  })
})

describe('ProductService visibility integration', () => {
  const listParams = { brandId: 1, page: 1, pageSize: 10 }

  it('uses the same actor scope for list rows and total count', async () => {
    const findMany = jest.fn().mockResolvedValue([])
    const count = jest.fn().mockResolvedValue(0)
    const prisma = {
      product: { findMany, count },
      user: { findUnique: jest.fn().mockResolvedValue(null) }
    }
    const visibility = {
      whereForUser: jest.fn().mockResolvedValue({ status: 'active', isFactoryProduct: true })
    }
    const service = new ProductService(prisma as any, {} as any, visibility as any, { write: jest.fn() } as any)

    await service.list(listParams, 7)

    const expectedWhere = { brandId: 1, status: 'active', isFactoryProduct: true }
    expect(findMany).toHaveBeenCalledWith(expect.objectContaining({ where: expectedWhere }))
    expect(count).toHaveBeenCalledWith({ where: expectedWhere })
  })

  it('allows admin inventory management to include disabled products without showing archived rows', async () => {
    const findMany = jest.fn().mockResolvedValue([])
    const count = jest.fn().mockResolvedValue(0)
    const prisma = {
      product: { findMany, count }
    }
    const visibility = {
      whereForUser: jest.fn().mockResolvedValue({})
    }
    const service = new ProductService(prisma as any, {} as any, visibility as any, { write: jest.fn() } as any)

    await service.list({ page: 1, pageSize: 10, includeDisabled: true } as any, 7)

    const expectedWhere = { status: { not: 'archived' } }
    expect(findMany).toHaveBeenCalledWith(expect.objectContaining({ where: expectedWhere }))
    expect(count).toHaveBeenCalledWith({ where: expectedWhere })
  })
  it('queries detail inside the actor visibility scope', async () => {
    const findFirst = jest.fn().mockResolvedValue({ id: 9, skus: [] })
    const prisma = { product: { findFirst } }
    const visibility = {
      whereForUser: jest.fn().mockResolvedValue({ status: 'active', isFactoryProduct: true })
    }
    const service = new ProductService(prisma as any, {} as any, visibility as any, { write: jest.fn() } as any)

    await expect(service.detail(9)).resolves.toMatchObject({ id: 9 })
    expect(findFirst).toHaveBeenCalledWith(expect.objectContaining({
      where: { id: 9, status: 'active', isFactoryProduct: true }
    }))
  })

  it('checks product access before returning active SKUs', async () => {
    const findMany = jest.fn().mockResolvedValue([])
    const prisma = { productSku: { findMany } }
    const visibility = { assertVisible: jest.fn().mockResolvedValue(undefined) }
    const service = new ProductService(prisma as any, {} as any, visibility as any, { write: jest.fn() } as any)

    await service.skus(4, 12)

    expect(visibility.assertVisible).toHaveBeenCalledWith(4, 12)
    expect(findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: { productId: 4, status: 'active' }
    }))
  })

  it('creates products with the selected brand and factory flag', async () => {
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
      isFactoryProduct: true
    } as any)

    expect(create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ brandId: 5, isFactoryProduct: true })
    }))
  })

  it('returns current visible cart lines and reports inaccessible SKU IDs', async () => {
    const prisma = {
      productSku: {
        findMany: jest.fn().mockResolvedValue([{
          id: 11,
          productId: 1,
          name: '500g',
          specText: '500g/盒',
          saleUnit: '盒',
          basePrice: '20.00',
          minOrderQty: 1,
          stockNum: 10,
          product: { id: 1, name: '鸭血' }
        }])
      },
      user: { findUnique: jest.fn().mockResolvedValue({ customerId: null }) }
    }
    const visibility = {
      whereForUser: jest.fn().mockResolvedValue({ status: 'active', isFactoryProduct: true })
    }
    const service = new ProductService(prisma as any, {} as any, visibility as any, { write: jest.fn() } as any)

    await expect(service.validateCart([11, 12], 7)).resolves.toMatchObject({
      items: [expect.objectContaining({ skuId: 11, available: true, price: '20.00' })],
      invalidSkuIds: [12]
    })
  })

  it('returns all active categories even when some currently have no visible products', async () => {
    const findMany = jest.fn().mockResolvedValue([])
    const prisma = { productCategory: { findMany } }
    const visibility = {
      whereForUser: jest.fn().mockResolvedValue({ status: 'active', isFactoryProduct: true })
    }
    const service = new ProductService(prisma as any, {} as any, visibility as any, { write: jest.fn() } as any)

    await service.categories(7)

    expect(visibility.whereForUser).not.toHaveBeenCalled()
    expect(findMany).toHaveBeenCalledWith({
      where: { status: 'active' },
      orderBy: { sortOrder: 'asc' }
    })
  })

  it('returns all active categories to unrestricted internal users', async () => {
    const findMany = jest.fn().mockResolvedValue([])
    const prisma = { productCategory: { findMany } }
    const visibility = {
      whereForUser: jest.fn().mockResolvedValue({})
    }
    const service = new ProductService(prisma as any, {} as any, visibility as any, { write: jest.fn() } as any)

    await service.categories(1)

    expect(findMany).toHaveBeenCalledWith({
      where: { status: 'active' },
      orderBy: { sortOrder: 'asc' }
    })
  })
})
