import { ConfigService } from '@nestjs/config'
import { INestApplication } from '@nestjs/common'
import { JwtService } from '@nestjs/jwt'
import { Test } from '@nestjs/testing'
import request from 'supertest'
import { AppFilter } from '../src/app.filter'
import { JwtAuthGuard } from '../src/auth/auth.guard'
import { ProductImageStorageService } from '../src/upload/product-image-storage.service'
import { UploadController } from '../src/upload/upload.controller'
import { requestIdMiddleware } from '../src/request-id.middleware'
import { SuccessInterceptor } from '../src/success.interceptor'
import { PrismaService } from '../src/prisma.service'

describe('product image upload HTTP contract', () => {
  let app: INestApplication
  let token: string

  const storage = {
    uploadProductImage: jest.fn().mockResolvedValue({
      url: 'http://127.0.0.1:9000/b2b-miniapp/products/2026/07/product.jpg',
      objectKey: 'products/2026/07/product.jpg'
    }),
    uploadPaymentProof: jest.fn().mockResolvedValue({
      url: 'http://127.0.0.1:9000/b2b-miniapp/payment-proofs/2026/08/proof.jpg',
      objectKey: 'payment-proofs/2026/08/proof.jpg'
    })
  }

  beforeAll(async () => {
    const jwt = new JwtService()
    token = jwt.sign({ sub: 1, tenantId: 1 }, { secret: 'upload-test-secret' })
    const moduleRef = await Test.createTestingModule({
      controllers: [UploadController],
      providers: [
        JwtAuthGuard,
        {
          provide: PrismaService,
          useValue: {
            user: {
              findUnique: jest.fn().mockResolvedValue({ status: 'active', customer: null })
            }
          }
        },
        { provide: ProductImageStorageService, useValue: storage },
        { provide: JwtService, useValue: jwt },
        {
          provide: ConfigService,
          useValue: {
            get: jest.fn((key: string) => key === 'JWT_ACCESS_SECRET' ? 'upload-test-secret' : undefined)
          }
        }
      ]
    }).compile()

    app = moduleRef.createNestApplication()
    app.use(requestIdMiddleware)
    app.useGlobalInterceptors(new SuccessInterceptor())
    app.useGlobalFilters(new AppFilter())
    app.setGlobalPrefix('api/v1')
    await app.init()
  })

  beforeEach(() => {
    storage.uploadProductImage.mockClear()
    storage.uploadPaymentProof.mockClear()
  })

  afterAll(async () => {
    await app.close()
  })

  it('requires a valid access token', async () => {
    const response = await request(app.getHttpServer())
      .post('/api/v1/uploads/product-image')
      .attach('file', Buffer.from([0xff, 0xd8, 0xff, 0x00]), {
        filename: 'product.jpg',
        contentType: 'image/jpeg'
      })
      .expect(401)

    expect(response.body.message).toBe('未登录')
    expect(storage.uploadProductImage).not.toHaveBeenCalled()
  })

  it('uploads a valid product image', async () => {
    const response = await request(app.getHttpServer())
      .post('/api/v1/uploads/product-image')
      .set('Authorization', `Bearer ${token}`)
      .attach('file', Buffer.from([0xff, 0xd8, 0xff, 0x00]), {
        filename: 'product.jpg',
        contentType: 'image/jpeg'
      })
      .expect(201)

    expect(response.body.data.url).toContain('/products/')
    expect(response.body.data.objectKey).toBe('products/2026/07/product.jpg')
    expect(storage.uploadProductImage).toHaveBeenCalledWith(
      expect.any(Buffer),
      'image/jpeg',
      'jpg'
    )
  })

  it('uploads a valid payment proof', async () => {
    const response = await request(app.getHttpServer())
      .post('/api/v1/uploads/payment-proof')
      .set('Authorization', `Bearer ${token}`)
      .attach('file', Buffer.from([0xff, 0xd8, 0xff, 0x00]), {
        filename: 'proof.jpg',
        contentType: 'image/jpeg'
      })
      .expect(201)

    expect(response.body.data.objectKey).toBe('payment-proofs/2026/08/proof.jpg')
    expect(storage.uploadPaymentProof).toHaveBeenCalledWith(
      expect.any(Buffer),
      'image/jpeg',
      'jpg'
    )
  })

  it('rejects an image whose signature does not match its MIME type', async () => {
    const response = await request(app.getHttpServer())
      .post('/api/v1/uploads/product-image')
      .set('Authorization', `Bearer ${token}`)
      .attach('file', Buffer.from([0xff, 0xd8, 0xff, 0x00]), {
        filename: 'product.png',
        contentType: 'image/png'
      })
      .expect(400)

    expect(response.body.message).toBe('图片文件无效')
    expect(storage.uploadProductImage).not.toHaveBeenCalled()
  })

  it('rejects a request without a file', async () => {
    const response = await request(app.getHttpServer())
      .post('/api/v1/uploads/product-image')
      .set('Authorization', `Bearer ${token}`)
      .expect(400)

    expect(response.body.message).toBe('请选择商品图片')
    expect(storage.uploadProductImage).not.toHaveBeenCalled()
  })
})
