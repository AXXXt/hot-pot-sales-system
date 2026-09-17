import { CustomerService } from '../src/customer/customer.service'

describe('customer status safety', () => {
  function createService() {
    const transactionCustomerUpdate = jest.fn().mockResolvedValue({})
    const transactionUserUpdateMany = jest.fn().mockResolvedValue({ count: 1 })
    const transactionClient = {
      customer: { update: transactionCustomerUpdate },
      user: { updateMany: transactionUserUpdateMany }
    }
    const prisma = {
      customer: {
        findUnique: jest.fn().mockResolvedValue({ id: 3 }),
        update: jest.fn().mockResolvedValue({ id: 3 }),
        delete: jest.fn()
      },
      user: {
        updateMany: jest.fn(),
        deleteMany: jest.fn()
      },
      $transaction: jest.fn(async (callback: any) => callback(transactionClient))
    }
    const service = new CustomerService(prisma as any, { write: jest.fn() } as any)
    return { service, prisma, transactionCustomerUpdate, transactionUserUpdateMany }
  }

  it('disables the customer and associated users without deleting data', async () => {
    const { service, prisma, transactionCustomerUpdate, transactionUserUpdateMany } = createService()
    jest.spyOn(service, 'detail').mockResolvedValue({ id: 3, status: 'disabled' } as any)

    await service.update(3, { status: 'disabled' })

    expect(transactionCustomerUpdate).toHaveBeenCalledWith({
      where: { id: 3 },
      data: { status: 'disabled' }
    })
    expect(transactionUserUpdateMany).toHaveBeenCalledWith({
      where: { customerId: 3 },
      data: { status: 'disabled' }
    })
    expect(prisma.customer.delete).not.toHaveBeenCalled()
    expect(prisma.user.deleteMany).not.toHaveBeenCalled()
  })

  it('rejects an application by disabling records instead of deleting them', async () => {
    const { service, prisma, transactionCustomerUpdate, transactionUserUpdateMany } = createService()

    const result = await service.reject(3, '资料不完整')

    expect(transactionCustomerUpdate).toHaveBeenCalledWith({
      where: { id: 3 },
      data: { status: 'disabled' }
    })
    expect(transactionUserUpdateMany).toHaveBeenCalledWith({
      where: { customerId: 3 },
      data: { status: 'disabled' }
    })
    expect(prisma.customer.delete).not.toHaveBeenCalled()
    expect(prisma.user.deleteMany).not.toHaveBeenCalled()
    expect(result).toEqual({ id: 3, status: 'disabled', message: '已驳回并禁用：资料不完整' })
  })

  it('re-enables the customer and associated users together', async () => {
    const { service, transactionCustomerUpdate, transactionUserUpdateMany } = createService()

    await service.approve(3)

    expect(transactionCustomerUpdate).toHaveBeenCalledWith({
      where: { id: 3 },
      data: { status: 'active' }
    })
    expect(transactionUserUpdateMany).toHaveBeenCalledWith({
      where: { customerId: 3 },
      data: { status: 'active' }
    })
  })
})
