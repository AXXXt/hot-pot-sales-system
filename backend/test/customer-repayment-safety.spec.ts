import { CustomerService } from '../src/customer/customer.service'

test('repayment does not overwrite a concurrently changed credit balance', async () => {
  const db: any = {
    customer: {
      findUnique: jest.fn().mockResolvedValue({ id: 1, creditUsed: '100' }),
      updateMany: jest.fn().mockResolvedValue({ count: 0 })
    },
    customerRepayment: { create: jest.fn() },
    $transaction: (fn: any) => fn(db)
  }
  const service = new CustomerService(db, { write: jest.fn() } as any)
  await expect(service.createRepayment(1, { amount: '20' }, 1)).rejects.toThrow('账期余额已变化')
  expect(db.customer.updateMany).toHaveBeenCalledWith({ where: { id: 1, creditUsed: '100' }, data: { creditUsed: '80.00' } })
  expect(db.customerRepayment.create).not.toHaveBeenCalled()
})
