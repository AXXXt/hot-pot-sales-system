import { plainToInstance } from 'class-transformer'
import { validate } from 'class-validator'
import { Prisma } from '@prisma/client'
import { OrderService } from '../src/order/order.service'
import { RejectFinanceDto, AdjustPriceDto } from '../src/order/dto/order.dto'

function fixture(paymentMethod = 'credit') {
  const order = { id: 31, tenantId: 2, customerId: 7, orderNo: 'QA-REJECT', status: 'pending_finance', updatedAt: new Date(0), paymentMethod, creditAmount: paymentMethod === 'credit' ? '19.90' : '0', paymentProof: 'private-proof', stockReserved: true }
  const tx: any = {
    order: { updateMany: jest.fn().mockResolvedValue({ count: 1 }), update: jest.fn().mockResolvedValue({}) },
    customer: { findUnique: jest.fn().mockResolvedValue({ creditUsed: new Prisma.Decimal('30.00') }), updateMany: jest.fn().mockResolvedValue({ count: 1 }) },
    orderStatusLog: { create: jest.fn().mockResolvedValue({ id: 8, createdAt: new Date(0) }) },
    auditLog: { create: jest.fn().mockResolvedValue({}) }, stockMovement: { create: jest.fn() }, productSku: { update: jest.fn() }
  }
  const db: any = { user: { findUnique: jest.fn().mockResolvedValue({ userType: 'finance' }) }, order: { findUnique: jest.fn().mockResolvedValue(order) }, $transaction: jest.fn((fn: any) => fn(tx)) }
  const notices: any = { record: jest.fn(), notify: jest.fn() }
  const service = new OrderService(db, {} as any, {} as any, {} as any, {} as any, undefined, undefined, notices)
  jest.spyOn(service, 'detail').mockResolvedValue({ id: 31 } as any)
  return { db, tx, notices, service, order }
}

describe('finance return is a payment retry, not cancellation', () => {
  it.each(['', '   ', 'x'.repeat(256)])('rejects a blank or oversized reason', async reason => {
    const { service, db } = fixture()
    await expect(service.rejectFinance(31, reason, 1)).rejects.toThrow('退回原因')
    expect(db.$transaction).not.toHaveBeenCalled()
  })
  it('atomically claims the review, releases only this order credit and persists a customer-visible reason', async () => {
    const { service, tx, notices } = fixture()
    await service.rejectFinance(31, '  金额不一致，请核对  ', 1)
    expect(tx.order.updateMany).toHaveBeenCalledWith(expect.objectContaining({ where: { id: 31, status: 'pending_finance', updatedAt: new Date(0) }, data: { status: 'pending_confirm' } }))
    expect(tx.customer.updateMany).toHaveBeenCalledWith({ where: { id: 7, creditUsed: new Prisma.Decimal('30') }, data: { creditUsed: { decrement: new Prisma.Decimal('19.90') } } })
    expect(tx.order.update).toHaveBeenCalledWith({ where: { id: 31 }, data: { paymentMethod: null, creditAmount: '0', confirmedAt: null } })
    expect(tx.orderStatusLog.create.mock.calls[0][0].data).toMatchObject({ fromStatus: 'pending_finance', toStatus: 'pending_confirm', remark: '金额不一致，请核对' })
    expect(notices.record).toHaveBeenCalledWith(tx, 31, 'finance_rejected', expect.anything())
    expect(notices.notify).not.toHaveBeenCalled()
    expect(tx.stockMovement.create).not.toHaveBeenCalled()
    expect(tx.productSku.update).not.toHaveBeenCalled()
    expect(tx.auditLog.create.mock.calls[0][0].data.requestId).toBe('finance-reject-2-8')
  })
  it('retains transfer proof and stock reservation without touching customer credit', async () => {
    const { service, tx, order } = fixture('transfer')
    await service.rejectFinance(31, '凭证不清晰', 1)
    expect(tx.customer.updateMany).not.toHaveBeenCalled()
    expect(tx.order.update.mock.calls[0][0].data).not.toHaveProperty('paymentProof')
    expect(tx.order.update.mock.calls[0][0].data).not.toHaveProperty('stockReserved')
    expect(order.stockReserved).toBe(true)
  })
  it('does not release credit after another reviewer has claimed the order', async () => {
    const { service, tx } = fixture()
    tx.order.updateMany.mockResolvedValue({ count: 0 })
    await expect(service.rejectFinance(31, '重新提供凭证', 1)).rejects.toThrow('订单状态已变化')
    expect(tx.customer.updateMany).not.toHaveBeenCalled()
    expect(tx.orderStatusLog.create).not.toHaveBeenCalled()
  })
  it('rejects inconsistent credit rather than silently clamping another order balance', async () => {
    const { service, tx } = fixture()
    tx.customer.findUnique.mockResolvedValue({ creditUsed: new Prisma.Decimal('1') })
    await expect(service.rejectFinance(31, '核对账期', 1)).rejects.toThrow('占用数据不一致')
    expect(tx.customer.updateMany).not.toHaveBeenCalled()
  })
  it('propagates a failed transaction audit so a real database can roll back all changes', async () => {
    const { service, tx } = fixture()
    tx.auditLog.create.mockRejectedValue(new Error('audit unavailable'))
    await expect(service.rejectFinance(31, '重新提供凭证', 1)).rejects.toThrow('audit unavailable')
    expect(service.detail).not.toHaveBeenCalled()
  })
  it.each(['draft', 'pending_confirm', 'pending_shipment', 'cancelled'])('rejects a review outside pending_finance (%s)', async status => {
    const { service, order, db } = fixture(); order.status = status
    await expect(service.rejectFinance(31, '原因', 1)).rejects.toThrow('当前状态')
    expect(db.$transaction).not.toHaveBeenCalled()
  })
  it('rejects a customer actor before any state mutation', async () => {
    const { service, db } = fixture(); db.user.findUnique.mockResolvedValue({ userType: 'customer_user' })
    await expect(service.rejectFinance(31, '原因', 1)).rejects.toMatchObject({ status: 403 })
    expect(db.$transaction).not.toHaveBeenCalled()
  })
  it('validates and trims the public reason DTO', async () => {
    expect(await validate(plainToInstance(RejectFinanceDto, { reason: '  金额不符  ' }))).toHaveLength(0)
    expect(plainToInstance(RejectFinanceDto, { reason: '  金额不符  ' }).reason).toBe('金额不符')
    for (const reason of [undefined, null, ' ', 123]) expect((await validate(plainToInstance(RejectFinanceDto, { reason }))).length).toBeGreaterThan(0)
  })
  it('requires a nonblank customer-visible adjustment reason', async () => {
    const valid = plainToInstance(AdjustPriceDto, { afterAmount: '29.50', reason: '  订单优惠  ' })
    expect(await validate(valid)).toHaveLength(0); expect(valid.reason).toBe('订单优惠')
    for (const reason of [undefined, null, ' ', 123]) {
      expect((await validate(plainToInstance(AdjustPriceDto, { afterAmount: '29.50', reason }))).length).toBeGreaterThan(0)
    }
  })
})
