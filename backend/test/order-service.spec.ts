import { OrderService } from '../src/order/order.service'

describe('OrderService checkout invariants', () => {
  function createSubject(skuOverrides: Record<string, unknown> = {}) {
    const sku = {
      id: 11,
      productId: 21,
      name: '标准箱',
      specText: '10kg',
      saleUnit: '箱',
      basePrice: '10.00',
      minOrderQty: 5,
      stockNum: 10,
      status: 'active',
      product: { id: 21, name: '牛肉卷', brandId: 4 },
      ...skuOverrides
    }
    const prisma = {
      user: {
        findUnique: jest.fn().mockResolvedValue({ customerId: 3, userType: 'customer_user' })
      },
      customer: {
        findUnique: jest.fn().mockResolvedValue({ id: 3, status: 'active' })
      },
      productSku: {
        findMany: jest.fn().mockResolvedValue([sku])
      },
      customerPriceRule: {
        findMany: jest.fn().mockResolvedValue([])
      },
      order: {
        create: jest.fn().mockResolvedValue({ id: 100, orderNo: 'OD100' }),
        findMany: jest.fn(),
        count: jest.fn(),
        findUnique: jest.fn(),
        update: jest.fn()
      },
      orderStatusLog: {
        create: jest.fn().mockResolvedValue({})
      }
    }
    const visibility = {
      whereForCustomer: jest.fn().mockResolvedValue({ status: 'active' })
    }
    return {
      prisma,
      visibility,
      service: new OrderService(prisma as any, visibility as any, { write: jest.fn() } as any)
    }
  }

  it('aggregates duplicate SKUs and calculates the authoritative total', async () => {
    const { prisma, visibility, service } = createSubject()

    await service.create({
      customerId: 3,
      items: [
        { skuId: 11, quantity: 2 },
        { skuId: 11, quantity: 3 }
      ]
    }, 9)

    expect(visibility.whereForCustomer).toHaveBeenCalledWith(3)
    expect(prisma.order.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({
        totalAmount: '50',
        payableAmount: '50',
        items: {
          create: [expect.objectContaining({ skuId: 11, quantity: 5, amount: '50' })]
        }
      })
    }))
  })

  it.each([
    [4, { minOrderQty: 5, stockNum: 10 }, 'ORD_1003'],
    [11, { minOrderQty: 5, stockNum: 10 }, 'INV_1001']
  ])('rejects quantity %s when it violates SKU limits', async (quantity, skuOverrides, errorCode) => {
    const { prisma, service } = createSubject(skuOverrides)

    await expect(service.create({
      customerId: 3,
      items: [{ skuId: 11, quantity }]
    }, 9)).rejects.toMatchObject({ response: { errorCode } })
    expect(prisma.order.create).not.toHaveBeenCalled()
  })

  it('returns compact item summaries for the order list', async () => {
    const { prisma, service } = createSubject()
    prisma.order.findMany.mockResolvedValue([{
      id: 100,
      orderNo: 'OD100',
      items: [
        { quantity: 2, productName: '牛肉卷' },
        { quantity: 3, productName: '毛肚' },
        { quantity: 1, productName: '鸭血' }
      ]
    }])
    prisma.order.count.mockResolvedValue(1)

    await expect(service.list({ page: 1, pageSize: 10 })).resolves.toEqual({
      items: [{
        id: 100,
        orderNo: 'OD100',
        itemCount: 6,
        productNames: ['牛肉卷', '毛肚']
      }],
      page: 1,
      pageSize: 10,
      total: 1
    })
  })

  it('allows draft orders to transition to cancelled', async () => {
    const { prisma, service } = createSubject()
    prisma.order.findUnique
      .mockResolvedValueOnce({ id: 100, status: 'draft' })
      .mockResolvedValueOnce({ id: 100, status: 'cancelled', items: [], statusLogs: [] })
    prisma.order.update.mockResolvedValue({})

    await service.transition(100, 'cancelled', 9)

    expect(prisma.order.update).toHaveBeenCalledWith({
      where: { id: 100 },
      data: { status: 'cancelled' }
    })
  })
})


describe('OrderService customer finance flow', () => {
  function createFinanceSubject(options: {
    actorType?: string
    actorCustomerId?: number | null
    creditLimit?: string
    creditUsed?: string
    payableAmount?: string
  } = {}) {
    const actorType = options.actorType || 'customer_user'
    const actorCustomerId = options.actorCustomerId === undefined ? 3 : options.actorCustomerId
    const creditLimit = options.creditLimit || '100.00'
    const creditUsed = options.creditUsed || '20.00'
    const payableAmount = options.payableAmount || '60.00'
    const initialOrder = {
      id: 100,
      tenantId: 1,
      customerId: 3,
      status: 'pending_confirm',
      paymentProof: null,
      payableAmount
    }
    const currentOrder = {
      ...initialOrder,
      customer: { id: 3, creditLimit, creditUsed }
    }
    const detailOrder = {
      ...initialOrder,
      status: 'pending_finance',
      paymentMethod: 'credit',
      creditAmount: payableAmount,
      customer: {
        id: 3,
        customerName: '测试客户',
        contactPhone: '13800000000',
        contactName: '张三',
        creditLimit,
        creditUsed: (Number(creditUsed) + Number(payableAmount)).toFixed(2)
      },
      items: [],
      statusLogs: []
    }
    const tx = {
      order: {
        findUnique: jest.fn().mockResolvedValue(currentOrder),
        updateMany: jest.fn().mockResolvedValue({ count: 1 }),
        update: jest.fn()
      },
      customer: {
        updateMany: jest.fn().mockResolvedValue({ count: 1 }),
        findUnique: jest.fn(),
        update: jest.fn()
      },
      orderStatusLog: { create: jest.fn().mockResolvedValue({}) },
      productSku: { update: jest.fn() }
    }
    const prisma = {
      user: {
        findUnique: jest.fn().mockResolvedValue({
          userType: actorType,
          customerId: actorCustomerId
        })
      },
      order: {
        findUnique: jest.fn()
          .mockResolvedValueOnce(initialOrder)
          .mockResolvedValueOnce(detailOrder)
      },
      $transaction: jest.fn(async (callback: (client: typeof tx) => Promise<any>) => callback(tx))
    }
    const service = new OrderService(prisma as any, {} as any, { write: jest.fn() } as any)
    return { service, prisma, tx }
  }

  it('occupies available credit when the customer confirms the quote', async () => {
    const { service, tx } = createFinanceSubject()

    await service.submitFinance(100, undefined, true, 9)

    expect(tx.customer.updateMany).toHaveBeenCalledWith({
      where: { id: 3, creditUsed: '20.00' },
      data: { creditUsed: { increment: '60.00' } }
    })
    expect(tx.order.updateMany).toHaveBeenCalledWith(expect.objectContaining({
      where: { id: 100, status: 'pending_confirm' },
      data: expect.objectContaining({
        status: 'pending_finance',
        paymentMethod: 'credit',
        creditAmount: '60.00',
        paymentProof: null
      })
    }))
  })

  it('rejects credit payment when the available amount is insufficient', async () => {
    const { service, tx } = createFinanceSubject({
      creditLimit: '50.00',
      creditUsed: '10.00',
      payableAmount: '60.00'
    })

    await expect(service.submitFinance(100, undefined, true, 9)).rejects.toMatchObject({
      response: { errorCode: 'CREDIT_1001' }
    })
    expect(tx.customer.updateMany).not.toHaveBeenCalled()
    expect(tx.order.updateMany).not.toHaveBeenCalled()
  })

  it('rejects admin attempts to confirm a customer quote', async () => {
    const { service, prisma } = createFinanceSubject({
      actorType: 'admin',
      actorCustomerId: null
    })

    await expect(service.submitFinance(100, undefined, true, 9)).rejects.toMatchObject({
      response: { errorCode: 'ORD_1005' }
    })
    expect(prisma.$transaction).not.toHaveBeenCalled()
  })

  it('returns occupied credit when a credit order is cancelled', async () => {
    const cancelledOrder = {
      id: 100,
      tenantId: 1,
      customerId: 3,
      status: 'pending_finance',
      paymentMethod: 'credit',
      creditAmount: '60.00',
      items: []
    }
    const detailOrder = {
      ...cancelledOrder,
      status: 'cancelled',
      customer: {
        id: 3,
        customerName: '测试客户',
        contactPhone: '13800000000',
        contactName: '张三',
        creditLimit: '100.00',
        creditUsed: '20.00'
      },
      statusLogs: []
    }
    const tx = {
      productSku: { update: jest.fn() },
      customer: {
        findUnique: jest.fn().mockResolvedValue({ creditUsed: '80.00' }),
        update: jest.fn().mockResolvedValue({})
      },
      order: { update: jest.fn().mockResolvedValue({}) },
      orderStatusLog: { create: jest.fn().mockResolvedValue({}) }
    }
    const prisma = {
      order: {
        findUnique: jest.fn()
          .mockResolvedValueOnce(cancelledOrder)
          .mockResolvedValueOnce(detailOrder)
      },
      $transaction: jest.fn(async (callback: (client: typeof tx) => Promise<any>) => callback(tx))
    }
    const service = new OrderService(prisma as any, {} as any, { write: jest.fn() } as any)

    await service.cancel(100, 9)

    expect(tx.customer.update).toHaveBeenCalledWith({
      where: { id: 3 },
      data: { creditUsed: '20.00' }
    })
    expect(tx.order.update).toHaveBeenCalledWith({
      where: { id: 100 },
      data: { status: 'cancelled' }
    })
  })
})
