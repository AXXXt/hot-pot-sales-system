import { ConfigService } from '@nestjs/config'
import { SmsService } from '../src/auth/sms.service'
import { productImageClientProvider } from '../src/upload/product-image-client.provider'

test('disabled SMS fails closed without writing or reading codes', async () => {
  const redis = { get: jest.fn(), set: jest.fn(), del: jest.fn() }
  const service = new SmsService(new ConfigService({ SMS_PROVIDER: 'disabled' }), redis)
  await expect(service.sendCode('13800000000', '127.0.0.1')).rejects.toMatchObject({ status: 503 })
  await expect(service.verifyCode('13800000000', '123456')).resolves.toBe(false)
  expect(redis.get).not.toHaveBeenCalled()
  expect(redis.set).not.toHaveBeenCalled()
})

test('private proof URLs are signed for HTTPS without a public bucket lookup', async () => {
  const factory = (productImageClientProvider as any).useFactory
  const client = factory(new ConfigService({
    MINIO_ENDPOINT: 'minio', MINIO_PORT: '9000', MINIO_USE_SSL: 'false',
    MINIO_ACCESS_KEY: 'test-access', MINIO_SECRET_KEY: 'test-secret',
    MINIO_SIGNING_ENDPOINT: 'weiduoxian.cn', MINIO_REGION: 'us-east-1'
  }))
  const url = new URL(await client.presignedGetObject('b2b-miniapp', 'payment-proofs/test.png', 60))
  expect(url.origin).toBe('https://weiduoxian.cn')
  expect(url.pathname).toBe('/b2b-miniapp/payment-proofs/test.png')
  expect(url.searchParams.get('X-Amz-Signature')).toMatch(/^[a-f0-9]{64}$/)
  expect(url.searchParams.get('X-Amz-Expires')).toBe('60')
})
