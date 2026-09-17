import { Test } from '@nestjs/testing'
import { INestApplication, ValidationPipe, ExecutionContext } from '@nestjs/common'
import { ConfigService } from '@nestjs/config'
import { JwtService } from '@nestjs/jwt'
import request from 'supertest'
import { AuthController } from '../src/auth/auth.controller'
import { AuthService } from '../src/auth/auth.service'
import { SmsService } from '../src/auth/sms.service'
import { JwtAuthGuard } from '../src/auth/auth.guard'
import { PrismaService } from '../src/prisma.service'
import { REDIS } from '../src/redis.provider'
import { requestIdMiddleware } from '../src/request-id.middleware'
import { SuccessInterceptor } from '../src/success.interceptor'
import { AppFilter } from '../src/app.filter'

describe('auth HTTP contract', () => {
  let app: INestApplication

  const mockAuthService = {
    sendCode: jest.fn().mockResolvedValue({ sent: true }),
    login: jest.fn().mockResolvedValue({
      accessToken: 'at',
      refreshToken: 'rt',
      user: { id: 1, name: 'Test', phone: '13800000000', userType: 'super_admin' }
    }),
    refreshToken: jest.fn().mockResolvedValue({ accessToken: 'new-at', refreshToken: 'new-rt' }),
    logout: jest.fn().mockResolvedValue({ loggedOut: true }),
    getProfile: jest.fn().mockResolvedValue({
      user: { id: 1, name: 'Test' },
      customer: null,
      tenant: { id: 1, name: 'Demo', code: 'demo' },
      brands: [],
      roles: [],
      permissions: [],
      menus: []
    })
  }

  const mockGuard = {
    canActivate: jest.fn().mockImplementation((context: ExecutionContext) => {
      const req = context.switchToHttp().getRequest()
      req.user = { sub: 1, phone: '13800000000', tenantId: 1 }
      return true
    })
  }

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      controllers: [AuthController],
      providers: [
        { provide: AuthService, useValue: mockAuthService },
        { provide: ConfigService, useValue: { get: jest.fn().mockReturnValue('test-secret') } },
        { provide: JwtService, useValue: { sign: jest.fn(), verify: jest.fn() } },
        { provide: SmsService, useValue: { sendCode: jest.fn(), verifyCode: jest.fn() } },
        { provide: PrismaService, useValue: {} },
        { provide: REDIS, useValue: { get: jest.fn(), set: jest.fn(), del: jest.fn() } }
      ]
    })
      .overrideGuard(JwtAuthGuard)
      .useValue(mockGuard)
      .compile()

    app = moduleRef.createNestApplication()
    app.use(requestIdMiddleware)
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true, forbidNonWhitelisted: true }))
    app.useGlobalInterceptors(new SuccessInterceptor())
    app.useGlobalFilters(new AppFilter())
    app.setGlobalPrefix('api/v1')
    await app.init()
  })

  afterAll(async () => {
    await app.close()
  })

  it('POST /api/v1/auth/send-code returns wrapped response', async () => {
    const res = await request(app.getHttpServer())
      .post('/api/v1/auth/send-code')
      .send({ phone: '13800000000' })
      .expect(201)
    expect(res.body.code).toBe(0)
    expect(res.body.data).toEqual({ sent: true })
    expect(res.body.requestId).toEqual(expect.any(String))
  })

  it('POST /api/v1/auth/login returns accessToken and user', async () => {
    const res = await request(app.getHttpServer())
      .post('/api/v1/auth/login')
      .send({ phone: '13800000000', code: '123456' })
      .expect(201)
    expect(res.body.data.accessToken).toBe('at')
    expect(res.body.data.refreshToken).toBe('rt')
    expect(res.body.data.user.name).toBe('Test')
  })

  it('POST /api/v1/auth/activate is not exposed', async () => {
    const res = await request(app.getHttpServer())
      .post('/api/v1/auth/activate')
      .send({ phone: '13800000000' })
      .expect(404)
    expect(res.body.code).not.toBe(0)
  })

  it('POST /api/v1/auth/refresh-token returns new tokens', async () => {
    const res = await request(app.getHttpServer())
      .post('/api/v1/auth/refresh-token')
      .send({ refreshToken: 'old-rt' })
      .expect(201)
    expect(res.body.data.accessToken).toBe('new-at')
    expect(res.body.data.refreshToken).toBe('new-rt')
  })

  it('POST /api/v1/auth/logout succeeds', async () => {
    const res = await request(app.getHttpServer())
      .post('/api/v1/auth/logout')
      .set('Authorization', 'Bearer mock-token')
      .expect(201)
    expect(res.body.data.loggedOut).toBe(true)
  })

  it('GET /api/v1/auth/profile returns profile context', async () => {
    const res = await request(app.getHttpServer())
      .get('/api/v1/auth/profile')
      .set('Authorization', 'Bearer mock-token')
      .expect(200)
    expect(res.body.data.user).toBeDefined()
    expect(res.body.data.tenant).toBeDefined()
  })

  it('POST /api/v1/auth/send-code rejects invalid phone', async () => {
    const res = await request(app.getHttpServer())
      .post('/api/v1/auth/send-code')
      .send({ phone: '12345' })
      .expect(400)
    expect(res.body.code).not.toBe(0)
  })

  it('POST /api/v1/auth/login rejects missing code', async () => {
    const res = await request(app.getHttpServer())
      .post('/api/v1/auth/login')
      .send({ phone: '13800000000' })
      .expect(400)
    expect(res.body.code).not.toBe(0)
  })
})
