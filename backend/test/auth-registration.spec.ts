import { BadRequestException } from '@nestjs/common'
import { AuthService } from '../src/auth/auth.service'

describe('AuthService registration defaults', () => {
  const dto = {
    phone: '13911112222',
    code: '123456',
    customerName: '测试门店',
    contactName: '张三'
  }

  function dependencies(normalLevel: { id: number } | null) {
    const tx = {
      customer: {
        create: jest.fn().mockResolvedValue({
          id: 20,
          customerName: '测试门店',
          status: 'disabled'
        })
      },
      user: {
        create: jest.fn().mockResolvedValue({
          id: 30,
          tenantId: 1,
          customerId: 20,
          phone: dto.phone,
          name: '张三',
          status: 'disabled',
          userType: 'customer_user'
        })
      }
    }
    const prisma = {
      user: { findUnique: jest.fn().mockResolvedValue(null) },
      customerLevel: { findFirst: jest.fn().mockResolvedValue(normalLevel) },
      $transaction: jest.fn(async (callback: (client: typeof tx) => Promise<any>) => callback(tx))
    }
    const sms = { verifyCode: jest.fn().mockResolvedValue(true) }
    const service = new AuthService(
      prisma as any,
      {} as any,
      {} as any,
      sms as any,
      {} as any,
      {} as any
    )
    return { service, prisma, tx }
  }

  it('creates new users transactionally with the normal level and factory catalog', async () => {
    const { service, prisma, tx } = dependencies({ id: 6 })

    await expect(service.registerOrLogin(dto)).resolves.toMatchObject({
      isNew: true,
      pending: true,
      customer: { id: 20, customerName: '测试门店', status: 'disabled' }
    })

    expect(prisma.customerLevel.findFirst).toHaveBeenCalledWith({
      where: { tenantId: 1, code: 'normal', status: 'active' },
      select: { id: true }
    })
    expect(tx.customer.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        customerLevelId: 6,
        productVisibilityMode: 'factory'
      })
    })
    expect(tx.user.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ customerId: 20 })
    }))
  })

  it('creates no partial customer when the normal level is missing', async () => {
    const { service, prisma, tx } = dependencies(null)

    await expect(service.registerOrLogin(dto)).rejects.toBeInstanceOf(BadRequestException)
    expect(prisma.$transaction).not.toHaveBeenCalled()
    expect(tx.customer.create).not.toHaveBeenCalled()
    expect(tx.user.create).not.toHaveBeenCalled()
  })
})
