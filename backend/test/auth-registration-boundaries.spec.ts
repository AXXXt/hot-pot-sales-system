import { createHash } from 'node:crypto'
import { LEGAL_VERSION } from '../src/legal/legal-consent'
import { AuthSessionService } from '../src/auth/auth-session.service'
import { INestApplication, ValidationPipe } from '@nestjs/common'
import { ConfigService } from '@nestjs/config'
import { JwtService } from '@nestjs/jwt'
import { Test } from '@nestjs/testing'
import request from 'supertest'
import { AuthController } from '../src/auth/auth.controller'
import { AuthService } from '../src/auth/auth.service'
import { JwtAuthGuard } from '../src/auth/auth.guard'
import { PrismaService } from '../src/prisma.service'

const input = { consentAccepted: true, consentVersion: LEGAL_VERSION, consentChannel: 'mini' as const, phone: '13911112222', code: '123456', customerName: 'Local boundary fixture', contactName: 'Local tester' }

const statusSecret = 'status-fixture-not-a-production-secret'
const statusTicket = () => new JwtService().sign({ sub: 7, tenantId: 3, ph: createHash('sha256').update(input.phone).digest('hex'), tokenUse: 'registration_status' }, { secret: statusSecret, expiresIn: '24h' })

function fixture(options: { action?: string; changedStatus?: string; userStatus?: string; customerStatus?: string; tenantStatus?: string; userType?: string; fresh?: boolean } = {}) {
  const user = {
    id: 7, tenantId: 3, customerId: 2, userType: options.userType || 'customer_user', status: options.userStatus || 'disabled',
    tenant: { status: options.tenantStatus || 'active' },
    customer: { id: 2, tenantId: 3, customerName: 'Existing fixture', status: options.customerStatus || 'disabled' }
  }
  const tx = {
    legalConsent: { createMany: jest.fn() },
    $queryRaw: jest.fn().mockResolvedValue([{ id: 2 }]),
    customer: { create: jest.fn().mockResolvedValue({ id: 2, status: 'disabled', customerName: input.customerName }), findUnique: jest.fn().mockResolvedValue(user.customer), update: jest.fn(), updateMany: jest.fn().mockResolvedValue({ count: 1 }) },
    user: { create: jest.fn(), findUnique: jest.fn().mockResolvedValue(user) },
    auditLog: { create: jest.fn(), findFirst: jest.fn().mockResolvedValue({ afterData: { action: options.action, status: options.changedStatus } }) }
  }
  const db = {
    legalConsent: { createMany: jest.fn() },
    user: { findUnique: jest.fn().mockResolvedValue(options.fresh ? null : user) },
    customerLevel: { findFirst: jest.fn().mockResolvedValue({ id: 6 }) },
    auditLog: { findFirst: jest.fn().mockResolvedValue(options.action || options.changedStatus ? { afterData: { action: options.action, status: options.changedStatus } } : null) },
    $transaction: jest.fn(async (callback: any) => callback(tx))
  }
  const sms = { verifyCode: jest.fn().mockResolvedValue(true) }
  const service = new AuthService(db as any, new JwtService(), new ConfigService({ JWT_REFRESH_SECRET: statusSecret }), sms as any, {} as any, { eval: jest.fn().mockResolvedValue(1) } as any)
  return { service, db, tx, sms, user }
}

describe('registration, disabled-account and tenant boundaries', () => {
  it.each([{}, { changedStatus: 'disabled' }, { action: 'approve' }])('does not describe an ordinary disabled account as a pending registration: %p', async options => {
    const { service } = fixture(options)
    await expect(service.checkStatus(input.phone, statusTicket())).resolves.toMatchObject({ reviewStatus: 'disabled' })
  })

  it('does not describe a stopped user of an active customer as a rejected application', async () => {
    const { service } = fixture({ action: 'reject', customerStatus: 'active' })
    await expect(service.checkStatus(input.phone, statusTicket())).resolves.toMatchObject({ reviewStatus: 'disabled' })
  })

  it.each([{}, { action: 'approve' }, { changedStatus: 'disabled' }])('does not let a stopped customer overwrite its profile and reopen review: %p', async options => {
    const { service, db, tx } = fixture(options)
    await expect(service.registerOrLogin(input)).rejects.toMatchObject({ status: 403 })
    expect(db.$transaction).not.toHaveBeenCalled()
    expect(tx.customer.update).not.toHaveBeenCalled()
    expect(tx.auditLog.create).not.toHaveBeenCalled()
  })

  it('keeps a rejected application resubmittable and records the actual tenant', async () => {
    const { service, tx } = fixture({ action: 'reject' })
    await expect(service.registerOrLogin(input)).resolves.toMatchObject({ pending: true })
    expect(tx.customer.updateMany).toHaveBeenCalledWith(expect.objectContaining({ where: { id: 2, tenantId: 3, status: 'disabled' }, data: expect.objectContaining({ status: 'disabled' }) }))
    expect(tx.auditLog.create).toHaveBeenCalledWith({ data: expect.objectContaining({ tenantId: 3, targetId: '2', afterData: { action: 'submit_registration', status: 'disabled' } }) })
  })

  it('does not use a staff account as a customer registration profile', async () => {
    const { service, db } = fixture({ action: 'submit_registration', userType: 'admin' })
    await expect(service.registerOrLogin(input)).rejects.toMatchObject({ status: 403 })
    expect(db.$transaction).not.toHaveBeenCalled()
  })

  it('does not reopen or overwrite an application approved while the resubmission was in flight', async () => {
    const { service, tx } = fixture({ action: 'reject' })
    tx.customer.updateMany.mockResolvedValueOnce({ count: 0 })
    await expect(service.registerOrLogin(input)).rejects.toMatchObject({ status: 409 })
    expect(tx.auditLog.create).not.toHaveBeenCalled()
  })

  it('does not reopen an account manually disabled after a rejected application was read', async () => {
    const { service, tx } = fixture({ action: 'reject' })
    tx.auditLog.findFirst.mockResolvedValueOnce({ afterData: { action: undefined, status: 'disabled' } })
    await expect(service.registerOrLogin(input)).rejects.toMatchObject({ status: 403 })
    expect(tx.$queryRaw).toHaveBeenCalled()
    expect(tx.customer.updateMany).not.toHaveBeenCalled()
    expect(tx.auditLog.create).not.toHaveBeenCalled()
  })

  it('refuses to overwrite another already submitted application after acquiring the customer lock', async () => {
    const { service, tx } = fixture({ action: 'reject' })
    tx.auditLog.findFirst.mockResolvedValueOnce({ afterData: { action: 'submit_registration', status: undefined } })
    await expect(service.registerOrLogin(input)).rejects.toMatchObject({ status: 409 })
    expect(tx.customer.updateMany).not.toHaveBeenCalled()
    expect(tx.auditLog.create).not.toHaveBeenCalled()
  })

  it('returns a controlled duplicate-application response instead of leaking a unique-key error', async () => {
    const { service, db } = fixture({ fresh: true })
    db.$transaction.mockRejectedValueOnce({ code: 'P2002', meta: { target: 'phone' } })
    await expect(service.registerOrLogin(input)).rejects.toMatchObject({ status: 409 })
  })

  it('does not issue SMS-login credentials for a disabled tenant', async () => {
    const { service } = fixture({ userStatus: 'active', customerStatus: 'active', tenantStatus: 'disabled' })
    const generate = jest.spyOn(service, 'generateTokens').mockResolvedValue({} as any)
    await expect(service.login(input)).rejects.toMatchObject({ status: 403 })
    expect(generate).not.toHaveBeenCalled()
  })

  it('does not describe an account in a disabled tenant as approved', async () => {
    const { service } = fixture({ userStatus: 'active', customerStatus: 'active', tenantStatus: 'disabled' })
    await expect(service.checkStatus(input.phone, statusTicket())).resolves.toMatchObject({ reviewStatus: 'disabled' })
  })

  it('revokes a refresh token when its tenant differs from the current database tenant', async () => {
    const user = { status: 'active', tenantId: 3, tenant: { status: 'active' }, customer: null, staffCredential: null }
    const db = { user: { findUnique: jest.fn().mockResolvedValue(user) } }
    const jwt = { verify: jest.fn().mockReturnValue({ sub: 7, tenantId: 99, phone: input.phone }), sign: jest.fn().mockReturnValue('fixture-only') }
    const redis = { get: jest.fn().mockResolvedValueOnce(null).mockResolvedValueOnce('refresh-fixture'), del: jest.fn(), set: jest.fn(), eval: jest.fn().mockResolvedValue(1) }
    const service = new AuthService(db as any, jwt as any, { get: () => 'fixture' } as any, {} as any, {} as any, redis as any)
    await expect(service.refreshToken('refresh-fixture')).rejects.toMatchObject({ status: 401 })
    expect(redis.eval).toHaveBeenCalledWith(expect.stringContaining('-- auth-session-revoke-legacy-v1'), 2, 'refresh:7', 'auth:legacy-revoked:7', 604800)
    expect(jwt.sign).not.toHaveBeenCalled()
  })

  it('blocks a still-valid access token when the tenant was disabled after login', async () => {
    const db = { user: { findUnique: jest.fn().mockResolvedValue({ status: 'active', tenantId: 3, tenant: { status: 'disabled' }, customer: null, staffCredential: null }) } }
    const guard = new JwtAuthGuard({ verify: () => ({ sub: 7, tenantId: 3 }) } as any, { get: () => 'fixture' } as any, db as any, { assertActive: async () => {} } as any)
    await expect(guard.canActivate({ switchToHttp: () => ({ getRequest: () => ({ headers: { authorization: 'Bearer fixture' } }) }) } as any)).rejects.toMatchObject({ status: 403 })
  })

  it('does not return disabled or foreign-tenant role grants through the signed-in profile', async () => {
    const { service, db, user } = fixture({ userStatus: 'active', customerStatus: 'active' })
    const permission = (code: string, status = 'active') => ({ code, status, type: 'menu', name: code, path: '/fixture' })
    db.user.findUnique.mockResolvedValue({ ...user, tenant: { id: 3, name: 'Tenant', code: 'LOCAL', status: 'active' }, brandAccess: [], userRoles: [
      { tenantId: 3, role: { id: 1, tenantId: 3, status: 'active', name: 'Allowed', code: 'allowed', permissions: [
        { tenantId: 3, permission: permission('allowed') }, { tenantId: 3, permission: permission('disabled', 'disabled') },
        { tenantId: 99, permission: permission('foreign-grant') }
      ] } },
      { tenantId: 3, role: { id: 2, tenantId: 3, status: 'disabled', name: 'Stopped', code: 'stopped', permissions: [{ tenantId: 3, permission: permission('stopped-role') }] } },
      { tenantId: 99, role: { id: 3, tenantId: 99, status: 'active', name: 'Foreign', code: 'foreign', permissions: [{ tenantId: 99, permission: permission('foreign-role') }] } }
    ] } as any)
    const result = await service.getProfile(7)
    expect(result.roles.map(role => role.id)).toEqual([1])
    expect(result.permissions).toEqual(['allowed'])
    expect(result.menus.map(menu => menu.code)).toEqual(['allowed'])
  })

  it('does not return disabled or foreign-tenant assigned brands through the signed-in profile', async () => {
    const { service, db, user } = fixture({ userStatus: 'active', customerStatus: 'active' })
    const brand = (id: number, tenantId: number, status = 'active') => ({ id, tenantId, status, code: 'LOCAL', name: 'Fixture' })
    db.user.findUnique.mockResolvedValue({ ...user, tenant: { id: 3, name: 'Tenant', code: 'LOCAL', status: 'active' }, userRoles: [], brandAccess: [
      { tenantId: 3, brand: brand(1, 3) }, { tenantId: 3, brand: brand(2, 3, 'disabled') },
      { tenantId: 99, brand: brand(3, 99) }, { tenantId: 3, brand: brand(4, 99) }
    ] } as any)
    expect((await service.getProfile(7)).brands.map(item => item.id)).toEqual([1])
  })

  it('does not expose a legacy foreign-tenant customer through a signed-in profile', async () => {
    const { service, db, user } = fixture({ userStatus: 'active', customerStatus: 'active' })
    db.user.findUnique.mockResolvedValue({ ...user, customer: { ...user.customer, tenantId: 99 }, userRoles: [], brandAccess: [] } as any)
    await expect(service.getProfile(7)).rejects.toMatchObject({ status: 403 })
  })

  it('does not disclose a legacy foreign-tenant customer name in the public status response', async () => {
    const { service, db, user } = fixture({ userStatus: 'active', customerStatus: 'active' })
    db.user.findUnique.mockResolvedValue({ ...user, customer: { ...user.customer, tenantId: 99 } })
    await expect(service.checkStatus(input.phone, statusTicket())).resolves.toMatchObject({ reviewStatus: 'disabled', customerName: null, customerStatus: null })
  })

  it('does not issue SMS-login credentials for a legacy foreign-tenant customer association', async () => {
    const { service, db, user } = fixture({ userStatus: 'active', customerStatus: 'active' })
    db.user.findUnique.mockResolvedValue({ ...user, customer: { ...user.customer, tenantId: 99 } })
    const generate = jest.spyOn(service, 'generateTokens').mockResolvedValue({} as any)
    await expect(service.login(input)).rejects.toMatchObject({ status: 403 })
    expect(generate).not.toHaveBeenCalled()
  })

  it('revokes a refresh token for a legacy foreign-tenant customer association', async () => {
    const { user } = fixture({ userStatus: 'active', customerStatus: 'active' })
    const db = { user: { findUnique: jest.fn().mockResolvedValue({ ...user, customer: { ...user.customer, tenantId: 99 } }) } }
    const jwt = { verify: jest.fn().mockReturnValue({ sub: 7, tenantId: 3 }), sign: jest.fn() }
    const redis = { get: jest.fn().mockResolvedValueOnce(null).mockResolvedValueOnce('refresh-fixture'), del: jest.fn(), set: jest.fn(), eval: jest.fn().mockResolvedValue(1) }
    const service = new AuthService(db as any, jwt as any, { get: () => 'fixture' } as any, {} as any, {} as any, redis as any)
    await expect(service.refreshToken('refresh-fixture')).rejects.toMatchObject({ status: 401 })
    expect(redis.eval).toHaveBeenCalledWith(expect.stringContaining('-- auth-session-revoke-legacy-v1'), 2, 'refresh:7', 'auth:legacy-revoked:7', 604800)
    expect(jwt.sign).not.toHaveBeenCalled()
  })

  it('blocks a still-valid access token linked to a legacy foreign-tenant customer', async () => {
    const { user } = fixture({ userStatus: 'active', customerStatus: 'active' })
    const db = { user: { findUnique: jest.fn().mockResolvedValue({ ...user, customer: { ...user.customer, tenantId: 99 } }) } }
    const guard = new JwtAuthGuard({ verify: () => ({ sub: 7, tenantId: 3 }) } as any, { get: () => 'fixture' } as any, db as any, { assertActive: async () => {} } as any)
    await expect(guard.canActivate({ switchToHttp: () => ({ getRequest: () => ({ headers: { authorization: 'Bearer fixture' } }) }) } as any)).rejects.toMatchObject({ status: 401 })
  })
})

describe('public registration status HTTP input', () => {
  let app: INestApplication
  const checkStatus = jest.fn().mockResolvedValue({ exists: false, reviewStatus: 'not_registered' })
  beforeAll(async () => {
    const module = await Test.createTestingModule({ controllers: [AuthController], providers: [
      { provide: AuthSessionService, useValue: { assertActive: async () => {} } },
      { provide: AuthService, useValue: { checkStatus } }, { provide: PrismaService, useValue: {} },
      { provide: JwtService, useValue: {} }, { provide: ConfigService, useValue: {} }
    ] }).compile()
    app = module.createNestApplication()
    app.useGlobalPipes(new ValidationPipe({ transform: true, whitelist: true, forbidNonWhitelisted: true }))
    await app.init()
  })
  beforeEach(() => checkStatus.mockClear())
  afterAll(async () => { if (app) await app.close() })

  it.each([{}, { phone: null }, { phone: {} }, { phone: '123' }, { phone: '12000000000' }])('rejects malformed status phones before calling the service: %p', async body => {
    await request(app.getHttpServer()).post('/auth/check-status').send(body).expect(400)
    expect(checkStatus).not.toHaveBeenCalled()
  })
})
