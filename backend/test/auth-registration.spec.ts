import { BadRequestException } from '@nestjs/common'
import { AuthService } from '../src/auth/auth.service'
import { JwtService } from '@nestjs/jwt'
import { ConfigService } from '@nestjs/config'
import { LEGAL_VERSION } from '../src/legal/legal-consent'

describe('AuthService registration defaults', () => {
  const dto = {
    consentAccepted: true, consentVersion: LEGAL_VERSION, consentChannel: 'mini' as const,
    phone: '13911112222',
    code: '123456',
    customerName: '测试门店',
    contactName: '张三'
  }

  function dependencies(normalLevel: { id: number } | null) {
    const tx = {
      legalConsent: { createMany: jest.fn().mockResolvedValue({ count: 1 }) },
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
      },
      auditLog: { create: jest.fn().mockResolvedValue({ id: 1 }) }
    }
    const prisma = {
      user: { findUnique: jest.fn().mockResolvedValue(null) },
      customerLevel: { findFirst: jest.fn().mockResolvedValue(normalLevel) },
      $transaction: jest.fn(async (callback: (client: typeof tx) => Promise<any>) => callback(tx))
    }
    const sms = { verifyCode: jest.fn().mockResolvedValue(true) }
    const service = new AuthService(
      prisma as any,
      new JwtService(),
      new ConfigService({ JWT_REFRESH_SECRET: 'local-registration-test-only' }),
      sms as any,
      {} as any,
      {} as any
    )
    return { service, prisma, tx, sms }
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
      orderBy: { id: 'asc' },
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
    const { service, prisma, tx, sms } = dependencies(null)

    await expect(service.registerOrLogin(dto)).rejects.toBeInstanceOf(BadRequestException)
    expect(prisma.$transaction).not.toHaveBeenCalled()
    expect(tx.customer.create).not.toHaveBeenCalled()
    expect(tx.user.create).not.toHaveBeenCalled()
    expect(sms.verifyCode).not.toHaveBeenCalled()
  })

  it('records the submission in the same transaction as the customer and account', async () => {
    const { service, tx } = dependencies({ id: 6 })
    await service.registerOrLogin(dto)
    expect(tx.auditLog.create).toHaveBeenCalledWith({ data: expect.objectContaining({
      targetType: 'customer', targetId: '20', afterData: { action: 'submit_registration', status: 'disabled' }
    }) })
  })
})
