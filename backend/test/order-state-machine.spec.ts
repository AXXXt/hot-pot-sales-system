import { OrderService } from '../src/order/order.service'

describe('OrderService state machine', () => {
  function createSubject(order: Record<string, unknown> = { status: 'draft' }, detail: Record<string, unknown> = {}) {
    const baseOrder = {
      id: 100,
      tenantId: 1,
      customerId: 3,
      status: 'draft',
      items: [],
      statusLogs: [],
      customer: { id: 3, creditLimit: '100.00', creditUsed: '0.00' },
      ...order
    }
    const detailOrder = { ...baseOrder, ...detail }
    const prisma = {
      order: {
        findUnique: jest.fn()
          .mockResolvedValueOnce(baseOrder)
          .mockResolvedValueOnce(detailOrder),
        update: jest.fn().mockResolvedValue({})
      },
      orderStatusLog: { create: jest.fn().mockResolvedValue({}) }
    }
    const service = new OrderService(prisma as any, {} as any, { write: jest.fn() } as any, {} as any, {} as any)
    return { service, prisma }
  }

  const validTransitions: Array<[string, string]> = [
    ['draft', 'pending_quote'],
    ['draft', 'cancelled'],
    ['pending_quote', 'pending_confirm'],
    ['pending_quote', 'cancelled'],
    ['pending_confirm', 'pending_finance'],
    ['pending_confirm', 'cancelled'],
    ['pending_finance', 'pending_shipment'],
    ['pending_finance', 'cancelled'],
    ['pending_shipment', 'shipped'],
    ['pending_shipment', 'cancelled'],
    ['shipped', 'completed']
  ]

  it.each(validTransitions)('allows %s -> %s', async (from, to) => {
    const { service, prisma } = createSubject({ status: from }, { status: to })

    await service.transition(100, to, 9)

    expect(prisma.order.update).toHaveBeenCalledWith({
      where: { id: 100 },
      data: { status: to }
    })
    expect(prisma.orderStatusLog.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ fromStatus: from, toStatus: to })
    }))
  })

  it.each([
    ['draft', 'completed'],
    ['draft', 'shipped'],
    ['pending_quote', 'shipped'],
    ['pending_finance', 'completed'],
    ['shipped', 'pending_finance'],
    ['completed', 'cancelled'],
    ['cancelled', 'pending_quote']
  ])('rejects illegal transition %s -> %s', async (from, to) => {
    const { service, prisma } = createSubject({ status: from })

    await expect(service.transition(100, to, 9)).rejects.toThrow(/不允许从/)

    expect(prisma.order.update).not.toHaveBeenCalled()
    expect(prisma.orderStatusLog.create).not.toHaveBeenCalled()
  })
})

describe('OrderService stock deduction and rollback', () => {
  function createStockSubject(options: { stockNum?: number; status?: string; paymentMethod?: string } = {}) {
    const stockNum = options.stockNum ?? 10
    const order = {
      id: 100,
      tenantId: 1,
      customerId: 3,
      status: options.status || 'pending_finance',
      paymentMethod: options.paymentMethod || 'transfer',
      creditAmount: '0.00',
      items: [{ skuId: 11, quantity: 5, productName: '牛肉卷', name: '标准箱' }]
    }
    const detailOrder = {
      ...order,
      status: options.status === 'pending_finance' ? 'pending_shipment' : order.status,
      customer: { id: 3, creditLimit: '100.00', creditUsed: '0.00' },
      items: [],
      statusLogs: []
    }
    const tx = {
      productSku: {
        findUnique: jest.fn().mockResolvedValue({ id: 11, productId: 11, name: '标准箱', stockNum }),
        update: jest.fn().mockResolvedValue({})
      },
      stockMovement: { create: jest.fn().mockResolvedValue({}) },
      customer: {
        findUnique: jest.fn().mockResolvedValue({ creditUsed: '0.00' }),
        update: jest.fn().mockResolvedValue({})
      },
      order: { update: jest.fn().mockResolvedValue({}) },
      orderStatusLog: { create: jest.fn().mockResolvedValue({}) }
    }
    const prisma = {
      user: { findUnique: jest.fn().mockResolvedValue({ userType: 'admin' }) },
      order: {
        findUnique: jest.fn()
          .mockResolvedValueOnce(order)
          .mockResolvedValueOnce(detailOrder)
      },
      orderStatusLog: { create: jest.fn().mockResolvedValue({}) },
      $transaction: jest.fn(async (callback: (client: typeof tx) => Promise<unknown>) => callback(tx))
    }
    const service = new OrderService(prisma as any, {} as any, { write: jest.fn() } as any, {} as any, {} as any)
    return { service, tx }
  }

  it('deducts stock when finance approves a pending_finance order', async () => {
    const { service, tx } = createStockSubject()

    await service.approveFinance(100, 9)

    expect(tx.productSku.update).toHaveBeenCalledWith({
      where: { id: 11 },
      data: { stockNum: 5 }
    })
    expect(tx.order.update).toHaveBeenCalledWith({
      where: { id: 100 },
      data: { status: 'pending_shipment' }
    })
  })

  it('rolls back the whole transaction when stock is insufficient', async () => {
    const { service, tx } = createStockSubject({ stockNum: 2 })

    await expect(service.approveFinance(100, 9)).rejects.toMatchObject({
      response: { errorCode: 'INV_1001' }
    })

    expect(tx.productSku.update).not.toHaveBeenCalled()
    expect(tx.order.update).not.toHaveBeenCalled()
  })

  it('restores stock when a pending_shipment order is cancelled', async () => {
    const { service, tx } = createStockSubject({ status: 'pending_shipment' })

    await service.cancel(100, 9)

    expect(tx.productSku.update).toHaveBeenCalledWith({
      where: { id: 11 },
      data: { stockNum: 15 }
    })
    expect(tx.order.update).toHaveBeenCalledWith({
      where: { id: 100 },
      data: { status: 'cancelled' }
    })
  })

  it('refuses to approve finance for a non-pending_finance order', async () => {
    const { service, tx } = createStockSubject({ status: 'shipped' })

    await expect(service.approveFinance(100, 9)).rejects.toThrow(/当前状态不允许审核/)

    expect(tx.productSku.update).not.toHaveBeenCalled()
    expect(tx.order.update).not.toHaveBeenCalled()
  })
})

describe('OrderService credit concurrency', () => {
  function createConcurrencySubject(creditUpdateCount: number) {
    const initialOrder = {
      id: 100,
      tenantId: 1,
      customerId: 3,
      status: 'pending_confirm',
      paymentProof: null,
      payableAmount: '60.00'
    }
    const detailOrder = {
      ...initialOrder,
      status: 'pending_finance',
      paymentMethod: 'credit',
      creditAmount: '60.00',
      customer: { id: 3, customerName: '客户', creditLimit: '100.00', creditUsed: '80.00' },
      items: [],
      statusLogs: []
    }
    const tx = {
      order: {
        findUnique: jest.fn().mockResolvedValue({
          ...initialOrder,
          customer: { id: 3, creditLimit: '100.00', creditUsed: '20.00' }
        }),
        updateMany: jest.fn().mockResolvedValue({ count: 1 }),
        update: jest.fn()
      },
      customer: {
        updateMany: jest.fn().mockResolvedValue({ count: creditUpdateCount }),
        findUnique: jest.fn(),
        update: jest.fn()
      },
      orderStatusLog: { create: jest.fn().mockResolvedValue({}) }
    }
    const prisma = {
      user: { findUnique: jest.fn().mockResolvedValue({ userType: 'customer_user', customerId: 3 }) },
      order: {
        findUnique: jest.fn()
          .mockResolvedValueOnce(initialOrder)
          .mockResolvedValueOnce(detailOrder)
      },
      $transaction: jest.fn(async (callback: (client: typeof tx) => Promise<unknown>) => callback(tx))
    }
    const service = new OrderService(prisma as any, {} as any, { write: jest.fn() } as any, {} as any, {} as any)
    return { service, tx }
  }

  it('rejects when the customer credit used changes concurrently', async () => {
    const { service, tx } = createConcurrencySubject(0)

    await expect(service.submitFinance(100, undefined, true, 9)).rejects.toMatchObject({
      response: { errorCode: 'CREDIT_1002' }
    })

    expect(tx.order.updateMany).not.toHaveBeenCalled()
  })

  it('commits when credit update succeeds', async () => {
    const { service, tx } = createConcurrencySubject(1)

    await service.submitFinance(100, undefined, true, 9)

    expect(tx.order.updateMany).toHaveBeenCalledWith(expect.objectContaining({
      where: { id: 100, status: 'pending_confirm' },
      data: expect.objectContaining({ status: 'pending_finance', paymentMethod: 'credit' })
    }))
  })
})