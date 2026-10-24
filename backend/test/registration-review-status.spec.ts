import { validate } from 'class-validator'
import { AuthService } from '../src/auth/auth.service'
import { RegisterDto } from '../src/auth/dto/register.dto'
import { JwtService } from '@nestjs/jwt'
import { ConfigService } from '@nestjs/config'

describe('registration review state', () => {
  function fixture(action?: string, status = 'disabled') {
    const prisma = {
      user: { findUnique: jest.fn().mockResolvedValue({
        id: 4, tenantId: 1, customerId: 2, userType: 'customer_user', status,
        customer: { id: 2, tenantId: 1, status, customerName: 'QA门店' }
      }) },
      auditLog: { findFirst: jest.fn().mockResolvedValue(action ? { afterData: { action } } : null) }
    }
    const service = new AuthService(prisma as any, new JwtService(), new ConfigService({ JWT_REFRESH_SECRET: 'local-review-ticket-fixture' }), {} as any, {} as any, { eval: async () => 1 } as any)
    const ticket = (service as any).issueStatusTicket(4, 1, '13911112222')
    return { service, prisma, ticket }
  }

  it.each([
    [undefined, 'disabled'], ['submit_registration', 'pending'], ['reject', 'rejected'], ['approve', 'disabled']
  ])('distinguishes disabled accounts after %s as %s', async (action, expected) => {
    const { service, prisma, ticket } = fixture(action)
    await expect(service.checkStatus('13911112222', ticket)).resolves.toMatchObject({ reviewStatus: expected })
    expect(prisma.auditLog.findFirst).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({ tenantId: 1, targetId: '2', OR: expect.any(Array) })
    }))
  })

  it('does not let an old rejection override an active approved account', async () => {
    const { service, prisma, ticket } = fixture('reject', 'active')
    await expect(service.checkStatus('13911112222', ticket)).resolves.toMatchObject({ reviewStatus: 'approved' })
    expect(prisma.auditLog.findFirst).not.toHaveBeenCalled()
  })

  it('validates registration phone, field types and lengths before reaching the service', async () => {
    const dto = Object.assign(new RegisterDto(), {
      phone: '123', code: '123456', customerName: '店'.repeat(51), contactName: { value: '张三' }
    })
    const errors = await validate(dto)
    expect(errors.map(error => error.property)).toEqual(expect.arrayContaining(['phone', 'customerName', 'contactName']))
  })
})
