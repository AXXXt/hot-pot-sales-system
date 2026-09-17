import { CustomerService } from '../src/customer/customer.service'

describe('customer price rules', () => {
  it('upserts one effective price per customer and SKU', async () => {
    const upsert = jest.fn().mockResolvedValue({ id: 8, status: 'active', price: '80.00' })
    const prisma = {
      customer: {
        findFirst: jest.fn().mockResolvedValue({ id: 3 })
      },
      productSku: {
        findFirst: jest.fn().mockResolvedValue({
          id: 11,
          productId: 5,
          product: { brandId: 4 }
        })
      },
      customerPriceRule: { upsert }
    }
    const service = new CustomerService(prisma as any)

    await service.createPriceRule({ customerId: 3, skuId: 11, price: '80.00' })

    expect(upsert).toHaveBeenCalledWith({
      where: {
        tenantId_customerId_skuId: { tenantId: 1, customerId: 3, skuId: 11 }
      },
      update: {
        brandId: 4,
        productId: 5,
        priceType: 'agreement',
        price: '80.00',
        status: 'active',
        startAt: null,
        endAt: null
      },
      create: {
        tenantId: 1,
        brandId: 4,
        customerId: 3,
        productId: 5,
        skuId: 11,
        priceType: 'agreement',
        price: '80.00',
        status: 'active'
      }
    })
  })

  it('rejects a non-positive agreement price', async () => {
    const prisma = {
      customer: { findFirst: jest.fn() },
      productSku: { findFirst: jest.fn() },
      customerPriceRule: { upsert: jest.fn() }
    }
    const service = new CustomerService(prisma as any)

    await expect(service.createPriceRule({ customerId: 3, skuId: 11, price: '0.00' }))
      .rejects.toMatchObject({ response: { errorCode: 'CUS_1004' } })
    expect(prisma.customer.findFirst).not.toHaveBeenCalled()
  })

  it('soft deletes a price rule so pricing falls back to the base price', async () => {
    const update = jest.fn().mockResolvedValue({ id: 8, status: 'disabled' })
    const prisma = {
      customerPriceRule: {
        findFirst: jest.fn().mockResolvedValue({ id: 8 }),
        update
      }
    }
    const service = new CustomerService(prisma as any)

    await service.deletePriceRule(8)

    expect(update).toHaveBeenCalledWith({
      where: { id: 8 },
      data: { status: 'disabled' }
    })
  })

  it('rejects deletion of a missing price rule', async () => {
    const prisma = {
      customerPriceRule: {
        findFirst: jest.fn().mockResolvedValue(null),
        update: jest.fn()
      }
    }
    const service = new CustomerService(prisma as any)

    await expect(service.deletePriceRule(99))
      .rejects.toMatchObject({ response: { errorCode: 'CUS_1006' } })
    expect(prisma.customerPriceRule.update).not.toHaveBeenCalled()
  })
})