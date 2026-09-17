import { ProductService } from '../src/product/product.service'
import { OrderService } from '../src/order/order.service'

describe('customer agreement pricing', () => {
  it('adds the active customer agreement price to product SKUs', async () => {
    const prisma = {
      product: {
        findFirst: jest.fn().mockResolvedValue({
          id: 1,
          skus: [{ id: 11, basePrice: '100.00' }]
        })
      },
      user: {
        findUnique: jest.fn().mockResolvedValue({ customerId: 3 })
      },
      customerPriceRule: {
        findMany: jest.fn().mockResolvedValue([
          { skuId: 11, price: '80.00' }
        ])
      }
    }
    const visibility = { whereForUser: jest.fn().mockResolvedValue({ status: 'active' }) }
    const service = new ProductService(prisma as any, {} as any, visibility as any)

    const product = await (service as any).detail(1, 7)

    expect(product.skus[0].customerPrice).toBe('80.00')
    const productRuleQuery = prisma.customerPriceRule.findMany.mock.calls[0][0]
    expect(productRuleQuery.where).not.toHaveProperty('priceType')
  })

  it('creates order items using the active customer agreement price', async () => {
    const orderCreate = jest.fn().mockResolvedValue({ id: 9, items: [] })
    const prisma = {
      user: {
        findUnique: jest.fn().mockResolvedValue({
          customerId: 3,
          userType: 'customer_user'
        })
      },
      customer: {
        findUnique: jest.fn().mockResolvedValue({ id: 3, status: 'active' })
      },
      productSku: {
        findMany: jest.fn().mockResolvedValue([{
          id: 11,
          productId: 1,
          name: '500g',
          specText: '500g',
          saleUnit: '件',
          basePrice: '100.00',
          product: { id: 1, name: '测试商品', brandId: 4 }
        }])
      },
      customerPriceRule: {
        findMany: jest.fn().mockResolvedValue([
          { skuId: 11, price: '80.00' }
        ])
      },
      order: { create: orderCreate },
      orderStatusLog: { create: jest.fn().mockResolvedValue({}) }
    }
    const visibility = { whereForCustomer: jest.fn().mockResolvedValue({ status: 'active' }) }
    const service = new OrderService(prisma as any, visibility as any)

    await service.create({
      customerId: 3,
      items: [{ skuId: 11, quantity: 2 }]
    }, 7)

    const createArgs = orderCreate.mock.calls[0][0]
    expect(createArgs.data.brandId).toBe(4)
    expect(createArgs.data.items.create[0]).toMatchObject({
      unitPrice: '80.00',
      amount: '160',
      priceSource: 'agreement'
    })
    expect(prisma.productSku.findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({
        product: { is: { status: 'active' } }
      })
    }))
    const orderRuleQuery = prisma.customerPriceRule.findMany.mock.calls[0][0]
    expect(orderRuleQuery.where).not.toHaveProperty('priceType')
  })

  it('rejects an order when a requested SKU is outside the customer catalog', async () => {
    const orderCreate = jest.fn()
    const prisma = {
      user: {
        findUnique: jest.fn().mockResolvedValue({
          customerId: 3,
          userType: 'customer_user'
        })
      },
      customer: {
        findUnique: jest.fn().mockResolvedValue({ id: 3, status: 'active' })
      },
      productSku: { findMany: jest.fn().mockResolvedValue([]) },
      customerPriceRule: { findMany: jest.fn().mockResolvedValue([]) },
      order: { create: orderCreate }
    }
    const visibility = {
      whereForCustomer: jest.fn().mockResolvedValue({ status: 'active', isFactoryProduct: true })
    }
    const service = new OrderService(prisma as any, visibility as any)

    await expect(service.create({
      customerId: 3,
      items: [{ skuId: 11, quantity: 1 }]
    }, 7)).rejects.toThrow('商品不存在或暂不可购买')
    expect(orderCreate).not.toHaveBeenCalled()
  })

  it('rejects an order containing products from multiple brands', async () => {
    const orderCreate = jest.fn().mockResolvedValue({ id: 10, items: [] })
    const prisma = {
      user: {
        findUnique: jest.fn().mockResolvedValue({
          customerId: 3,
          userType: 'customer_user'
        })
      },
      customer: {
        findUnique: jest.fn().mockResolvedValue({ id: 3, status: 'active' })
      },
      productSku: {
        findMany: jest.fn().mockResolvedValue([
          {
            id: 11,
            productId: 1,
            name: '500g',
            specText: '500g',
            saleUnit: '件',
            basePrice: '100.00',
            product: { id: 1, name: '品牌甲商品', brandId: 4 }
          },
          {
            id: 12,
            productId: 2,
            name: '500g',
            specText: '500g',
            saleUnit: '件',
            basePrice: '120.00',
            product: { id: 2, name: '品牌乙商品', brandId: 5 }
          }
        ])
      },
      customerPriceRule: { findMany: jest.fn().mockResolvedValue([]) },
      order: { create: orderCreate },
      orderStatusLog: { create: jest.fn() }
    }
    const visibility = { whereForCustomer: jest.fn().mockResolvedValue({ status: 'active' }) }
    const service = new OrderService(prisma as any, visibility as any)

    await expect(service.create({
      customerId: 3,
      items: [
        { skuId: 11, quantity: 1 },
        { skuId: 12, quantity: 1 }
      ]
    }, 7)).rejects.toMatchObject({
      response: {
        message: '一个订单只能包含同一品牌的商品',
        errorCode: 'ORD_1002'
      }
    })
    expect(orderCreate).not.toHaveBeenCalled()
  })
})
