import { AuthSessionService } from '../src/auth/auth-session.service'
import { Controller, ExecutionContext, Get, INestApplication, Logger, Req, UseGuards } from '@nestjs/common'
import { ConfigService } from '@nestjs/config'
import { JwtService } from '@nestjs/jwt'
import { Test } from '@nestjs/testing'
import request from 'supertest'
import { AuditService, AuditWriteInput } from '../src/audit/audit.service'
import { auditStorage, getAuditContext } from '../src/audit/audit-context'
import { JwtAuthGuard, OptionalJwtAuthGuard } from '../src/auth/auth.guard'
import { PrismaService } from '../src/prisma.service'
import { requestIdMiddleware } from '../src/request-id.middleware'

const event: AuditWriteInput = { action: 'update', module: 'product', targetType: 'product', targetId: 12 }

function fixture(tenantId: number | null = 9) {
  const db = {
    auditLog: { create: jest.fn().mockResolvedValue({ id: 1 }) },
    user: { findUnique: jest.fn().mockResolvedValue(tenantId === null ? null : { tenantId }) }
  }
  return { db, service: new AuditService(db as any) }
}

describe('audit tenant attribution', () => {
  let errorLog: jest.SpyInstance
  beforeEach(() => { errorLog = jest.spyOn(Logger.prototype, 'error').mockImplementation(() => {}) })
  afterEach(() => jest.restoreAllMocks())

  it('inherits the authenticated database tenant from the HTTP request context', async () => {
    const { db, service } = fixture()
    await auditStorage.run({ requestId: 'request-tenant-7', userId: 3, tenantId: 7 } as any, () => service.write(event))
    expect(db.auditLog.create).toHaveBeenCalledWith({ data: expect.objectContaining({ tenantId: 7, operatorId: 3, requestId: 'request-tenant-7' }) })
    expect(db.user.findUnique).not.toHaveBeenCalled()
  })

  it('accepts an explicit tenant for background tasks with no HTTP context', async () => {
    const { db, service } = fixture()
    await service.write({ ...event, tenantId: 12 })
    expect(db.auditLog.create).toHaveBeenCalledWith({ data: expect.objectContaining({ tenantId: 12, operatorId: null }) })
  })

  it('resolves a legacy non-HTTP operator from the database without assuming tenant 1', async () => {
    const { db, service } = fixture()
    await service.write({ ...event, operatorId: 3 })
    expect(db.user.findUnique).toHaveBeenCalledWith({ where: { id: 3 }, select: { tenantId: true } })
    expect(db.auditLog.create).toHaveBeenCalledWith({ data: expect.objectContaining({ tenantId: 9, operatorId: 3 }) })
  })

  it('resolves an older context containing only the operator through the database', async () => {
    const { db, service } = fixture()
    await auditStorage.run({ requestId: 'legacy-context', userId: 3 }, () => service.write(event))
    expect(db.auditLog.create).toHaveBeenCalledWith({ data: expect.objectContaining({ tenantId: 9, operatorId: 3 }) })
  })

  it('never inserts into tenant 1 when no reliable attribution exists', async () => {
    const { db, service } = fixture()
    await expect(service.write(event)).resolves.toBeUndefined()
    expect(db.auditLog.create).not.toHaveBeenCalled()
    expect(errorLog).toHaveBeenCalled()
  })

  it.each([0, -1, NaN, 1.5])('does not silently fall back when an explicit tenant is invalid: %s', async tenantId => {
    const { db, service } = fixture()
    await auditStorage.run({ requestId: 'valid-context', userId: 3, tenantId: 7 } as any, () => service.write({ ...event, tenantId }))
    expect(db.auditLog.create).not.toHaveBeenCalled()
    expect(errorLog).toHaveBeenCalled()
  })

  it('does not put one authenticated tenant event into another explicitly supplied tenant', async () => {
    const { db, service } = fixture()
    await auditStorage.run({ requestId: 'conflicting-context', userId: 3, tenantId: 7 } as any, () => service.write({ ...event, tenantId: 9 }))
    expect(db.auditLog.create).not.toHaveBeenCalled()
    expect(errorLog).toHaveBeenCalled()
  })

  it('skips an unknown non-HTTP operator instead of fabricating a tenant', async () => {
    const { db, service } = fixture(null)
    await expect(service.write({ ...event, operatorId: 404 })).resolves.toBeUndefined()
    expect(db.auditLog.create).not.toHaveBeenCalled()
  })

  it('keeps callers compatible with incomplete test doubles while refusing an unattributed insert', async () => {
    const db = { auditLog: { create: jest.fn() } }
    await expect(new AuditService(db as any).write({ ...event, operatorId: 3 })).resolves.toBeUndefined()
    expect(db.auditLog.create).not.toHaveBeenCalled()
  })

  it('does not print business payloads when the database error contains an SQL invocation', async () => {
    const { db, service } = fixture()
    const sensitive = 'private-proof-or-provider-secret-fixture'
    db.auditLog.create.mockRejectedValueOnce(new Error(`Database invocation contained ${sensitive}`))
    await expect(service.write({ ...event, tenantId: 7, afterData: { sensitive } })).resolves.toBeUndefined()
    expect(errorLog).toHaveBeenCalled()
    expect(JSON.stringify(errorLog.mock.calls)).not.toContain(sensitive)
  })

  it('keeps concurrent request tenant identities isolated across asynchronous work', async () => {
    const { db, service } = fixture()
    await Promise.all([7, 8].map(tenantId => auditStorage.run({ requestId: `concurrent-${tenantId}`, userId: tenantId + 10, tenantId } as any, async () => {
      await Promise.resolve()
      await service.write({ ...event, targetId: tenantId })
    })))
    const written = db.auditLog.create.mock.calls.map(([input]: any) => input.data).sort((a, b) => a.tenantId - b.tenantId)
    expect(written.map(data => [data.tenantId, data.operatorId, data.requestId])).toEqual([[7, 17, 'concurrent-7'], [8, 18, 'concurrent-8']])
  })
})

describe('JWT guards bind audit identity from the current database record', () => {
  const context = (request: any) => ({ switchToHttp: () => ({ getRequest: () => request }) }) as ExecutionContext
  const guards = [JwtAuthGuard, OptionalJwtAuthGuard]

  it.each(guards)('binds a trusted tenant for %p without trusting request headers', async Guard => {
    const jwt = { verify: jest.fn().mockReturnValue({ sub: 3, tenantId: 7 }) }
    const db = { user: { findUnique: jest.fn().mockResolvedValue({ tenantId: 7, status: 'active', customer: null, staffCredential: null }) } }
    const request = { headers: { authorization: 'Bearer fixture-token', 'x-tenant-id': '999' } }
    await auditStorage.run({ requestId: 'guard-context' }, async () => {
      await expect(new Guard(jwt as any, { get: () => 'fixture-secret' } as any, db as any, { assertActive: async () => {} } as any).canActivate(context(request))).resolves.toBe(true)
      expect(getAuditContext()).toMatchObject({ userId: 3, tenantId: 7 })
    })
    expect(db.user.findUnique.mock.calls[0][0].select.tenantId).toBe(true)
  })

  it.each(guards)('rejects a stale token tenant rather than binding it in %p', async Guard => {
    const jwt = { verify: jest.fn().mockReturnValue({ sub: 3, tenantId: 999 }) }
    const db = { user: { findUnique: jest.fn().mockResolvedValue({ tenantId: 7, status: 'active', customer: null, staffCredential: null }) } }
    await auditStorage.run({ requestId: 'stale-context' }, async () => {
      await expect(new Guard(jwt as any, { get: () => 'fixture-secret' } as any, db as any, { assertActive: async () => {} } as any).canActivate(context({ headers: { authorization: 'Bearer fixture-token' } }))).rejects.toMatchObject({ status: 401 })
      expect(getAuditContext()).not.toHaveProperty('tenantId')
      expect(getAuditContext()).not.toHaveProperty('userId')
    })
  })
})

@Controller('audit-context-fixture')
@UseGuards(JwtAuthGuard)
class AuditContextFixtureController {
  constructor(private readonly audit: AuditService) {}

  @Get()
  async write(@Req() req: any) {
    await Promise.resolve()
    // Model a legacy handler that omits tenantId and relies on authenticated HTTP context.
    await this.audit.write({ ...event, targetId: req.user.sub })
    return { ok: true }
  }
}

describe('authenticated HTTP audit context propagation', () => {
  let app: INestApplication
  const jwt = new JwtService({ secret: 'audit-http-fixture-secret' })
  const users: Record<number, any> = {
    3: { tenantId: 7, status: 'active', customer: null, staffCredential: null },
    4: { tenantId: 8, status: 'active', customer: null, staffCredential: null }
  }
  const db = {
    user: { findUnique: jest.fn(async ({ where }) => users[where.id] || null) },
    auditLog: { create: jest.fn().mockResolvedValue({ id: 1 }) }
  }

  beforeAll(async () => {
    const module = await Test.createTestingModule({ controllers: [AuditContextFixtureController], providers: [
      { provide: AuthSessionService, useValue: { assertActive: async () => {} } },
      AuditService, { provide: PrismaService, useValue: db }, { provide: JwtService, useValue: jwt },
      { provide: ConfigService, useValue: new ConfigService({ JWT_ACCESS_SECRET: 'audit-http-fixture-secret' }) }
    ] }).compile()
    app = module.createNestApplication()
    app.use(requestIdMiddleware)
    await app.init()
  })
  afterAll(async () => { if (app) await app.close() })

  it('carries each verified database identity through middleware and guards into its audit row', async () => {
    await Promise.all([3, 4].map(id => request(app.getHttpServer()).get('/audit-context-fixture')
      .set('Authorization', `Bearer ${jwt.sign({ sub: id, tenantId: users[id].tenantId })}`)
      .set('x-request-id', `audit-http-user-${id}`).set('x-tenant-id', '999').expect(200)))
    const rows = db.auditLog.create.mock.calls.map(([arg]: any) => arg.data).sort((a, b) => a.operatorId - b.operatorId)
    expect(rows.map(row => [row.tenantId, row.operatorId, row.requestId])).toEqual([[7, 3, 'audit-http-user-3'], [8, 4, 'audit-http-user-4']])
  })
})
