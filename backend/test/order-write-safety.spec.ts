import { OrderService } from '../src/order/order.service'

function subject(status = 'pending_finance', stockNum = 10) {
  let state: any = {
    order: {
      id: 1, tenantId: 1, customerId: 3, status, updatedAt: new Date('2026-10-01'),
      orderNo: 'TEST', payableAmount: '100', totalAmount: '100', discountAmount: '0', creditAmount: '0',
      items: [{ id: 11, skuId: 11, quantity: 2, productName: 'Test product' }]
    },
    stockNum, movements: [], logs: [], refunds: []
  }
  let tail = Promise.resolve()
  const db: any = {
    user: { findUnique: jest.fn().mockResolvedValue({ userType: 'super_admin' }) },
    order: {
      findUnique: jest.fn(async () => ({ ...state.order, items: state.order.items.map((item: any) => ({ ...item })) })),
      updateMany: jest.fn(async ({ where, data }) => {
        if (where.status && where.status !== state.order.status) return { count: 0 }
        Object.assign(state.order, data)
        return { count: 1 }
      }),
      update: jest.fn(async ({ data }) => Object.assign(state.order, data))
    },
    productSku: {
      findUnique: jest.fn(async () => ({ id: 11, productId: 11, stockNum: state.stockNum })),
      updateMany: jest.fn(async ({ where, data }) => {
        if (state.stockNum !== where.stockNum) return { count: 0 }
        state.stockNum = data.stockNum
        return { count: 1 }
      })
    },
    orderItem: { update: jest.fn() }, customerPriceHistory: { create: jest.fn() },
    stockMovement: { create: jest.fn(async ({ data }) => state.movements.push(data)) },
    orderStatusLog: { create: jest.fn(async ({ data }) => state.logs.push(data)) },
    orderRefund: {
      aggregate: jest.fn(async () => ({ _sum: { amount: state.refunds.reduce((sum: number, r: any) => sum + Number(r.amount), 0) } })),
      create: jest.fn(async ({ data }) => { const r = { id: state.refunds.length + 1, ...data }; state.refunds.push(r); return r })
    },
    $queryRaw: jest.fn(),
    $transaction: (fn: any) => {
      const next = tail.then(async () => {
        const before = { ...state, order: { ...state.order }, movements: [...state.movements], logs: [...state.logs], refunds: [...state.refunds] }
        try { return await fn(db) } catch (error) { state = before; throw error }
      })
      tail = next.catch(() => {})
      return next
    }
  }
  const service = new OrderService(db, {} as any, { write: jest.fn() } as any, {} as any, {} as any)
  return { service, db, state: () => state }
}

describe('order transactional safety', () => {
  it('deducts inventory only once for two overlapping finance approvals', async () => {
    const { service, state } = subject()
    const results = await Promise.allSettled([service.approveFinance(1, 1), service.approveFinance(1, 1)])
    expect(results.filter(r => r.status === 'fulfilled')).toHaveLength(1)
    expect(state().stockNum).toBe(8)
    expect(state().movements).toHaveLength(1)
    expect(state().logs).toHaveLength(1)
  })
  it('returns stock only once for overlapping cancellations', async () => {
    const { service, state } = subject('pending_shipment', 8)
    const results = await Promise.allSettled([service.cancel(1, 1), service.cancel(1, 1)])
    expect(results.filter(r => r.status === 'fulfilled')).toHaveLength(1)
    expect(state().stockNum).toBe(10)
    expect(state().movements).toHaveLength(1)
  })
  it('rolls back the order claim and all logs when stock is insufficient', async () => {
    const { service, state } = subject('pending_finance', 1)
    await expect(service.approveFinance(1, 1)).rejects.toThrow('库存不足')
    expect(state().order.status).toBe('pending_finance')
    expect(state().movements).toHaveLength(0)
    expect(state().logs).toHaveLength(0)
  })
  it('rolls back when inventory changes after the read', async () => {
    const { service, db, state } = subject()
    db.productSku.updateMany.mockResolvedValueOnce({ count: 0 })
    await expect(service.approveFinance(1, 1)).rejects.toThrow('库存已变化')
    expect(state().order.status).toBe('pending_finance')
  })
  it.each([[], [{ skuId: 99, quotedPrice: 10 }], [{ skuId: 11, quotedPrice: -2 }], [{ skuId: 11, quotedPrice: 0.001 }]].map(items => ({ items })))('rejects incomplete or invalid quotes', async ({ items }) => {
    const { service, state } = subject('pending_quote')
    await expect(service.quote(1, items, '', 1)).rejects.toThrow()
    expect(state().order.payableAmount).toBe('100')
    expect(state().order.status).toBe('pending_quote')
  })
  it('quotes items and total atomically with decimal arithmetic', async () => {
    const { service, state } = subject('pending_quote')
    await service.quote(1, [{ skuId: 11, quotedPrice: 0.29 }], '', 1)
    expect(state().order.payableAmount.toString()).toBe('0.58')
    expect(state().order.status).toBe('pending_confirm')
  })
  it('rolls back the quote status when a line update fails', async () => {
    const { service, db, state } = subject('pending_quote')
    db.orderItem.update.mockRejectedValueOnce(new Error('write failed'))
    await expect(service.quote(1, [{ skuId: 11, quotedPrice: 10 }], '', 1)).rejects.toThrow('write failed')
    expect(state().order.status).toBe('pending_quote')
  })
  it('rejects concurrent refunds exceeding the remaining refundable amount', async () => {
    const { service, state, db } = subject('cancelled')
    const results = await Promise.allSettled([service.refund(1, { amount: '80' }, 1), service.refund(1, { amount: '80' }, 1)])
    expect(results.filter(r => r.status === 'fulfilled')).toHaveLength(1)
    expect(state().refunds).toHaveLength(1)
    expect(db.$queryRaw).toHaveBeenCalledTimes(2)
    await service.refund(1, { amount: '20' }, 1)
    expect(state().refunds.reduce((sum: number, r: any) => sum + Number(r.amount), 0)).toBe(100)
  })
  it.each(['pending_confirm', 'pending_finance', 'pending_shipment', 'shipped'])('does not bypass business checks with generic transition to %s', async to => {
    const from: Record<string, string> = { pending_confirm: 'pending_quote', pending_finance: 'pending_confirm', pending_shipment: 'pending_finance', shipped: 'pending_shipment' }
    const { service } = subject(from[to])
    await expect(service.transition(1, to, 1)).rejects.toThrow('对应业务操作')
  })
})
