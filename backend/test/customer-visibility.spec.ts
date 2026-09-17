import { BadRequestException, NotFoundException } from '@nestjs/common'
import { CustomerService } from '../src/customer/customer.service'

describe('CustomerService product visibility', () => {
  it('returns mode, selected products, and current visible count', async () => {
    const prisma = {
      customer: {
        findUnique: jest.fn().mockResolvedValue({
          id: 3,
          tenantId: 1,
          productVisibilityMode: 'custom'
        })
      },
      customerVisibleProduct: {
        findMany: jest.fn().mockResolvedValue([{
          productId: 7,
          product: { id: 7, name: '鸭血', status: 'active', category: { id: 2, name: '鸭副' } }
        }])
      },
      product: { count: jest.fn().mockResolvedValue(1) }
    }
    const service = new CustomerService(prisma as any)

    await expect(service.getProductVisibility(3)).resolves.toEqual({
      mode: 'custom',
      productIds: [7],
      products: [{ id: 7, name: '鸭血', status: 'active', category: { id: 2, name: '鸭副' } }],
      visibleProductCount: 1
    })
  })

  it('replaces custom products in one transaction', async () => {
    const tx = {
      customer: { update: jest.fn().mockResolvedValue({}) },
      customerVisibleProduct: {
        deleteMany: jest.fn().mockResolvedValue({ count: 1 }),
        createMany: jest.fn().mockResolvedValue({ count: 2 })
      }
    }
    const prisma = {
      customer: {
        findUnique: jest
          .fn()
          .mockResolvedValueOnce({ id: 3, tenantId: 1 })
          .mockResolvedValueOnce({ id: 3, tenantId: 1, productVisibilityMode: 'custom' })
      },
      product: {
        findMany: jest.fn().mockResolvedValue([
          { id: 7, tenantId: 1, status: 'active' },
          { id: 8, tenantId: 1, status: 'active' }
        ]),
        count: jest.fn().mockResolvedValue(2)
      },
      customerVisibleProduct: {
        findMany: jest.fn().mockResolvedValue([
          { productId: 7, product: { id: 7, name: '鸭血', status: 'active', category: null } },
          { productId: 8, product: { id: 8, name: '鸭肠', status: 'active', category: null } }
        ])
      },
      $transaction: jest.fn(async (callback: (client: typeof tx) => Promise<void>) => callback(tx))
    }
    const service = new CustomerService(prisma as any)

    await service.updateProductVisibility(3, { mode: 'custom', productIds: [7, 8] } as any)

    expect(tx.customer.update).toHaveBeenCalledWith({
      where: { id: 3 },
      data: { productVisibilityMode: 'custom' }
    })
    expect(tx.customerVisibleProduct.deleteMany).toHaveBeenCalledWith({ where: { customerId: 3 } })
    expect(tx.customerVisibleProduct.createMany).toHaveBeenCalledWith({
      data: [
        { tenantId: 1, customerId: 3, productId: 7 },
        { tenantId: 1, customerId: 3, productId: 8 }
      ]
    })
  })

  it.each([
    [[], '至少选择一个商品'],
    [[7, 7], '商品不能重复']
  ])('rejects invalid custom selections %j', async (productIds, message) => {
    const prisma = {
      customer: { findUnique: jest.fn().mockResolvedValue({ id: 3, tenantId: 1 }) },
      product: { findMany: jest.fn() },
      $transaction: jest.fn()
    }
    const service = new CustomerService(prisma as any)

    await expect(service.updateProductVisibility(3, { mode: 'custom', productIds } as any))
      .rejects.toThrow(message)
    expect(prisma.$transaction).not.toHaveBeenCalled()
  })

  it('rejects missing, disabled, or cross-tenant products before writing', async () => {
    const prisma = {
      customer: { findUnique: jest.fn().mockResolvedValue({ id: 3, tenantId: 1 }) },
      product: {
        findMany: jest.fn().mockResolvedValue([{ id: 7, tenantId: 2, status: 'active' }])
      },
      $transaction: jest.fn()
    }
    const service = new CustomerService(prisma as any)

    await expect(service.updateProductVisibility(3, { mode: 'custom', productIds: [7, 8] } as any))
      .rejects.toBeInstanceOf(BadRequestException)
    expect(prisma.$transaction).not.toHaveBeenCalled()
  })

  it('clears custom products when switching to factory mode', async () => {
    const tx = {
      customer: { update: jest.fn().mockResolvedValue({}) },
      customerVisibleProduct: { deleteMany: jest.fn().mockResolvedValue({ count: 2 }) }
    }
    const prisma = {
      customer: {
        findUnique: jest
          .fn()
          .mockResolvedValueOnce({ id: 3, tenantId: 1 })
          .mockResolvedValueOnce({ id: 3, tenantId: 1, productVisibilityMode: 'factory' })
      },
      customerVisibleProduct: { findMany: jest.fn().mockResolvedValue([]) },
      product: { count: jest.fn().mockResolvedValue(5) },
      $transaction: jest.fn(async (callback: (client: typeof tx) => Promise<void>) => callback(tx))
    }
    const service = new CustomerService(prisma as any)

    await service.updateProductVisibility(3, { mode: 'factory' } as any)

    expect(tx.customerVisibleProduct.deleteMany).toHaveBeenCalledWith({ where: { customerId: 3 } })
  })

  it('returns 404 for an unknown customer', async () => {
    const prisma = { customer: { findUnique: jest.fn().mockResolvedValue(null) } }
    const service = new CustomerService(prisma as any)

    await expect(service.getProductVisibility(404)).rejects.toBeInstanceOf(NotFoundException)
  })
})
