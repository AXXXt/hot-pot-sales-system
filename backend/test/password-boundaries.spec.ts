import { validate } from 'class-validator'
import { PasswordLoginDto, SetPasswordDto } from '../src/auth/dto/password.dto'
import { PasswordService } from '../src/auth/password.service'
import { auditStorage } from '../src/audit/audit-context'

describe('isolated password boundaries', () => {
  it('validates setup lengths and whitespace without touching real credentials', async () => {
    for (const password of ['', 'x'.repeat(14), 'x'.repeat(129), ' '.repeat(15)]) {
      expect((await validate(Object.assign(new SetPasswordDto(), { token: 'x'.repeat(43), password }))).some(item => item.property === 'password')).toBe(true)
    }
    for (const password of ['x'.repeat(15), 'x'.repeat(128), '🔐'.repeat(65)]) {
      expect(await validate(Object.assign(new SetPasswordDto(), { token: 'x'.repeat(43), password }))).toHaveLength(0)
    }
    for (const password of ['', 'x'.repeat(129)]) expect((await validate(Object.assign(new PasswordLoginDto(), { phone: '13800000000', password }))).some(item => item.property === 'password')).toBe(true)
  })

  it('commits the credential and trusted security audit together while tolerating a later Redis cleanup failure', async () => {
    const writes = jest.fn().mockResolvedValue({}), audit = { write: jest.fn() }
    const securityAudit = jest.fn().mockResolvedValue({})
    const tx = { $queryRaw: jest.fn().mockResolvedValue([]), user: { findUnique: jest.fn().mockResolvedValue({ id: 7, tenantId: 9, userType: 'admin', status: 'active', tenant: { status: 'active' }, staffCredential: { version: 2 } }) }, staffCredential: { upsert: writes }, auditLog: { create: securityAudit } }
    let committed = false
    const prisma = { $transaction: jest.fn(async callback => { await callback(tx); committed = true }) }
    const service = new PasswordService(prisma as any, {} as any, audit as any, { del: jest.fn().mockRejectedValue(new Error('isolated redis unavailable')) } as any)
    await auditStorage.run({ requestId: 'synthetic-password-request', tenantId: 9, userId: 7, ip: '127.0.0.1', userAgent: 'isolated-test' }, async () => {
      await expect((service as any).savePassword({ userId: 7, tenantId: 9, version: 2 }, 'synthetic-encoded-value')).resolves.toBeUndefined()
    })
    expect(committed).toBe(true)
    expect(writes).toHaveBeenCalledWith(expect.objectContaining({ update: { passwordHash: 'synthetic-encoded-value', version: { increment: 1 } } }))
    expect(audit.write).not.toHaveBeenCalled()
    expect(securityAudit).toHaveBeenCalledWith({ data: { tenantId: 9, operatorId: 7, action: 'update', module: 'auth', targetType: 'staff_password', targetId: '7',
      afterData: { configured: true, sessionsRevoked: true }, requestId: 'synthetic-password-request', ipAddress: '127.0.0.1', userAgent: 'isolated-test' } })
    expect(JSON.stringify(securityAudit.mock.calls)).not.toContain('synthetic-encoded-value')
  })
})
