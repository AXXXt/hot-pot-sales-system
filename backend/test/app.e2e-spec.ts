import { Test } from '@nestjs/testing'
import { INestApplication } from '@nestjs/common'
import request from 'supertest'
import { HealthController } from '../src/health.controller'
import { PrismaService } from '../src/prisma.service'
import { REDIS } from '../src/redis.provider'
import { MINIO } from '../src/minio.provider'
import { requestIdMiddleware } from '../src/request-id.middleware'
import { SuccessInterceptor } from '../src/success.interceptor'
import { AppFilter } from '../src/app.filter'

describe('health HTTP contract', () => {
  let app: INestApplication

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      controllers: [HealthController],
      providers: [
        { provide: PrismaService, useValue: { ping: jest.fn().mockResolvedValue(true) } },
        { provide: REDIS, useValue: { ping: jest.fn().mockResolvedValue('PONG') } },
        { provide: MINIO, useValue: { health: jest.fn().mockResolvedValue(true) } }
      ]
    }).compile()

    app = moduleRef.createNestApplication()
    app.use(requestIdMiddleware)
    app.useGlobalInterceptors(new SuccessInterceptor())
    app.useGlobalFilters(new AppFilter())
    app.setGlobalPrefix('api/v1', { exclude: ['health', 'health/ready'] })
    await app.init()
  })

  afterAll(async () => {
    await app.close()
  })

  it('returns a wrapped liveness response with a request id', async () => {
    const response = await request(app.getHttpServer()).get('/health').expect(200)
    expect(response.body.code).toBe(0)
    expect(response.body.data).toEqual({ status: 'ok' })
    expect(response.body.requestId).toEqual(expect.any(String))
    expect(response.headers['x-request-id']).toBe(response.body.requestId)
  })

  it('returns a wrapped readiness response when dependencies are healthy', async () => {
    const response = await request(app.getHttpServer()).get('/health/ready').expect(200)
    expect(response.body.data.checks).toEqual({ database: 'ok', redis: 'ok', minio: 'ok' })
  })
})
