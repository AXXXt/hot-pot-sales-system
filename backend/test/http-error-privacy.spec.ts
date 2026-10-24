import { BadRequestException, Controller, Get, INestApplication } from '@nestjs/common'
import { Test } from '@nestjs/testing'
import request from 'supertest'
import { pinoHttp } from 'pino-http'
import { Writable } from 'node:stream'
import { AppFilter } from '../src/app.filter'
import { httpRequestLog } from '../src/http-request-log'
import { requestIdMiddleware } from '../src/request-id.middleware'
import { MetricsService } from '../src/monitor/metrics.service'

@Controller()
class FailureFixture {
  @Get('unexpected') unexpected() { throw new Error('mysql://synthetic:SYNTHETIC_DB_SECRET@private-host/internal; SQL SELECT private_phone') }
  @Get('validation') validation() { throw new BadRequestException({ message: '请输入正确的规格数量', errorCode: 'FIXTURE_VALIDATION' }) }
}

describe('HTTP error and request logging privacy', () => {
  let app: INestApplication
  const lines: string[] = []
  beforeAll(async () => {
    const module = await Test.createTestingModule({ controllers: [FailureFixture] }).compile()
    app = module.createNestApplication()
    app.use(requestIdMiddleware)
    app.use(pinoHttp({ serializers: { req: httpRequestLog } }, new Writable({ write(chunk, _encoding, done) { lines.push(String(chunk)); done() } })))
    app.useGlobalFilters(new AppFilter())
    await app.init()
  })
  afterAll(async () => { await app.close() })
  it('does not return an unexpected SQL/provider error or credentials to the caller', async () => {
    const response = await request(app.getHttpServer()).get('/unexpected').expect(500)
    expect(response.body).toMatchObject({ message: '服务暂不可用，请稍后重试', errorCode: 'SYS_0001', data: null })
    expect(response.body.requestId).toEqual(expect.any(String))
    expect(JSON.stringify(response.body)).not.toMatch(/SYNTHETIC_DB_SECRET|private-host|SELECT|mysql:/)
  })
  it('preserves explicit business validation messages and error codes', async () => {
    const response = await request(app.getHttpServer()).get('/validation').expect(400)
    expect(response.body).toMatchObject({ message: '请输入正确的规格数量', errorCode: 'FIXTURE_VALIDATION' })
  })
  it('logs the route without query values, authorization, cookies or private headers', async () => {
    lines.length = 0
    await request(app.getHttpServer()).get('/validation?phone=SYNTHETIC_PHONE&token=SYNTHETIC_QUERY_TOKEN')
      .set('Authorization', 'Bearer SYNTHETIC_ACCESS_TOKEN').set('Cookie', 'session=SYNTHETIC_COOKIE')
      .set('x-api-key', 'SYNTHETIC_API_KEY').expect(400)
    expect(lines.length).toBeGreaterThan(0)
    const output = lines.join('')
    expect(output).not.toMatch(/SYNTHETIC_PHONE|SYNTHETIC_QUERY_TOKEN|SYNTHETIC_ACCESS_TOKEN|SYNTHETIC_COOKIE|SYNTHETIC_API_KEY/)
    expect(JSON.parse(lines[0]).req).toMatchObject({ method: 'GET', url: '/validation' })
  })
  it('keeps dependency error text out of operational warnings', async () => {
    const error = Object.assign(new Error('redis://synthetic:SYNTHETIC_REDIS_SECRET@private-host'), { code: 'ECONNREFUSED' })
    const service = new MetricsService({ lrange: jest.fn().mockRejectedValue(error) } as any, {} as any)
    const warnings = jest.spyOn((service as any).logger, 'warn').mockImplementation(() => {})
    expect(await service.getAlerts()).toEqual([])
    expect(warnings).toHaveBeenCalledWith(expect.stringContaining('ECONNREFUSED'))
    expect(JSON.stringify(warnings.mock.calls)).not.toMatch(/SYNTHETIC_REDIS_SECRET|private-host|redis:/)
  })
})
