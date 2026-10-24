import { ExecutionContext } from '@nestjs/common'
import { AuthService } from '../src/auth/auth.service'
import { JwtAuthGuard, OptionalJwtAuthGuard } from '../src/auth/auth.guard'

describe('disabled account session safety', () => {
  const contextFor = (authorization?: string) => {
    const request: any = { headers: authorization ? { authorization } : {} }
    const context = {
      switchToHttp: () => ({ getRequest: () => request })
    } as ExecutionContext
    return { context, request }
  }

  it('rejects an access token when the account is disabled', async () => {
    const jwt = { verify: jest.fn().mockReturnValue({ sub: 7, tenantId: 1 }) }
    const config = { get: jest.fn().mockReturnValue('secret') }
    const prisma = {
      user: {
        findUnique: jest.fn().mockResolvedValue({ status: 'disabled', customer: { status: 'active' } })
      }
    }
    const guard = new JwtAuthGuard(jwt as any, config as any, prisma as any, { assertActive: async () => {} } as any)
    const { context } = contextFor('Bearer access-token')

    await expect(guard.canActivate(context)).rejects.toMatchObject({
      response: { errorCode: 'AUTH_3005' }
    })
  })

  it('allows optional public access when no token is provided', async () => {
    const jwt = { verify: jest.fn() }
    const config = { get: jest.fn() }
    const prisma = { user: { findUnique: jest.fn() } }
    const guard = new OptionalJwtAuthGuard(jwt as any, config as any, prisma as any, { assertActive: async () => {} } as any)
    const { context } = contextFor()

    await expect(guard.canActivate(context)).resolves.toBe(true)
    expect(prisma.user.findUnique).not.toHaveBeenCalled()
  })

  it.each([JwtAuthGuard, OptionalJwtAuthGuard])('rejects credentials issued before the password changed in %p', async Guard => {
    const jwt = { verify: jest.fn().mockReturnValue({ sub: 7, tenantId: 1, cv: 1 }) }
    const config = { get: jest.fn().mockReturnValue('secret') }
    const prisma = { user: { findUnique: jest.fn().mockResolvedValue({ status: 'active', customer: null, staffCredential: { version: 2 } }) } }
    const guard = new Guard(jwt as any, config as any, prisma as any, { assertActive: async () => {} } as any)
    await expect(guard.canActivate(contextFor('Bearer stale-token').context)).rejects.toMatchObject({ response: { errorCode: 'AUTH_3005' } })
  })

  it('keeps pre-password and customer access tokens valid when no staff password exists', async () => {
    const jwt = { verify: jest.fn().mockReturnValue({ sub: 7, tenantId: 1 }) }
    const config = { get: jest.fn().mockReturnValue('secret') }
    const prisma = { user: { findUnique: jest.fn().mockResolvedValue({ status: 'active', customer: { status: 'active' }, staffCredential: null }) } }
    await expect(new JwtAuthGuard(jwt as any, config as any, prisma as any, { assertActive: async () => {} } as any).canActivate(contextFor('Bearer legacy-token').context)).resolves.toBe(true)
  })

  it('rejects refresh for a disabled account and revokes the stored session', async () => {
    const prisma = {
      user: {
        findUnique: jest.fn().mockResolvedValue({ status: 'disabled', customer: { status: 'active' } })
      }
    }
    const jwt = {
      verify: jest.fn().mockReturnValue({ sub: 7, phone: '13800000000', tenantId: 1 }),
      sign: jest.fn()
    }
    const config = { get: jest.fn().mockReturnValue('secret') }
    const sms = {}
    const redis = {
      get: jest.fn().mockResolvedValueOnce(null).mockResolvedValueOnce('refresh-token'),
      set: jest.fn(),
      del: jest.fn().mockResolvedValue(1), eval: jest.fn().mockResolvedValue(1)
    }
    const service = new AuthService(prisma as any, jwt as any, config as any, sms as any, {} as any, redis as any)

    await expect(service.refreshToken('refresh-token')).rejects.toMatchObject({
      response: { errorCode: 'AUTH_3003' }
    })
    expect(redis.eval).toHaveBeenCalledWith(expect.stringContaining('-- auth-session-revoke-legacy-v1'), 2, 'refresh:7', 'auth:legacy-revoked:7', 604800)
    expect(jwt.sign).not.toHaveBeenCalled()
  })
})
