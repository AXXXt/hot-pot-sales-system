import { ExecutionContext, INestApplication } from '@nestjs/common'
import { Test } from '@nestjs/testing'
import { ConfigService } from '@nestjs/config'
import { JwtService } from '@nestjs/jwt'
import request from 'supertest'
import { BrandController } from '../src/brand/brand.controller'
import { BrandService } from '../src/brand/brand.service'
import { JwtAuthGuard } from '../src/auth/auth.guard'
import { PermissionsGuard } from '../src/auth/permissions.guard'
import { requestIdMiddleware } from '../src/request-id.middleware'
import { SuccessInterceptor } from '../src/success.interceptor'
import { AppFilter } from '../src/app.filter'

describe('BrandController contract', () => {
  let app: INestApplication

  const brandService = {
    list: jest.fn().mockResolvedValue([{ id: 4, name: '德品', code: 'DEPIN', status: 'active' }]),
    suggestCode: jest.fn().mockReturnValue({ code: 'DEPIN' }),
    create: jest.fn().mockResolvedValue({ id: 4, name: '德品', code: 'DEPIN' }),
    update: jest.fn().mockResolvedValue({ id: 4, name: '德品', code: 'DEPIN' }),
    delete: jest.fn().mockResolvedValue({ id: 4, deletionMode: 'disabled', linkedProductCount: 2 }),
    restore: jest.fn().mockResolvedValue({ id: 4, status: 'active' })
  }

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      controllers: [BrandController],
      providers: [
        { provide: BrandService, useValue: brandService },
        { provide: ConfigService, useValue: { get: jest.fn().mockReturnValue('secret') } },
        { provide: JwtService, useValue: { verify: jest.fn() } }
      ]
    }).overrideGuard(JwtAuthGuard).useValue({
      canActivate: (context: ExecutionContext) => {
        context.switchToHttp().getRequest().user = { sub: 1, tenantId: 1 }
        return true
      }
    }).overrideGuard(PermissionsGuard).useValue({ canActivate: () => true }).compile()

    app = moduleRef.createNestApplication()
    app.use(requestIdMiddleware)
    app.useGlobalInterceptors(new SuccessInterceptor())
    app.useGlobalFilters(new AppFilter())
    app.setGlobalPrefix('api/v1')
    await app.init()
  })

  afterAll(async () => app.close())

  it('GET /api/v1/admin/brands lists managed brands', async () => {
    const response = await request(app.getHttpServer())
      .get('/api/v1/admin/brands?status=active')
      .set('Authorization', 'Bearer token')
      .expect(200)

    expect(brandService.list).toHaveBeenCalledWith(1, 'active')
    expect(response.body.data[0].code).toBe('DEPIN')
  })

  it('GET /api/v1/admin/brands/code-suggestion returns a generated prefix', async () => {
    const response = await request(app.getHttpServer())
      .get('/api/v1/admin/brands/code-suggestion?name=德品')
      .set('Authorization', 'Bearer token')
      .expect(200)

    expect(brandService.suggestCode).toHaveBeenCalledWith('德品')
    expect(response.body.data.code).toBe('DEPIN')
  })

  it('POST /api/v1/admin/brands creates a brand', async () => {
    await request(app.getHttpServer())
      .post('/api/v1/admin/brands')
      .set('Authorization', 'Bearer token')
      .send({ name: '德品' })
      .expect(201)

    expect(brandService.create).toHaveBeenCalledWith(1, { name: '德品' })
  })

  it('DELETE /api/v1/admin/brands/:id returns safe deletion mode', async () => {
    const response = await request(app.getHttpServer())
      .delete('/api/v1/admin/brands/4')
      .set('Authorization', 'Bearer token')
      .expect(200)

    expect(brandService.delete).toHaveBeenCalledWith(1, 4)
    expect(response.body.data.deletionMode).toBe('disabled')
  })

  it('PATCH /api/v1/admin/brands/:id/restore restores a brand', async () => {
    await request(app.getHttpServer())
      .patch('/api/v1/admin/brands/4/restore')
      .set('Authorization', 'Bearer token')
      .expect(200)

    expect(brandService.restore).toHaveBeenCalledWith(1, 4)
  })
})
