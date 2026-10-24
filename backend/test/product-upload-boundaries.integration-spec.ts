import { randomUUID } from 'node:crypto'
import { INestApplication } from '@nestjs/common'
import { ConfigService } from '@nestjs/config'
import { JwtService } from '@nestjs/jwt'
import { Test } from '@nestjs/testing'
import { PrismaClient } from '@prisma/client'
import { Client } from 'minio'
import Redis from 'ioredis'
import request from 'supertest'
import sharp from 'sharp'
import { AuthSessionService } from '../src/auth/auth-session.service'
import { PrismaService } from '../src/prisma.service'
import { REDIS } from '../src/redis.provider'
import { ProductImageStorageService } from '../src/upload/product-image-storage.service'
import { PRODUCT_IMAGE_CLIENT } from '../src/upload/product-image-client.provider'
import { UploadController } from '../src/upload/upload.controller'
import { AppFilter } from '../src/app.filter'
import { SuccessInterceptor } from '../src/success.interceptor'

const url = new URL(process.env.TEST_DATABASE_URL || 'invalid://missing')
const redisUrl = new URL(process.env.TEST_REDIS_URL || 'redis://127.0.0.1:6379')
const local = (host: string) => ['127.0.0.1', 'localhost', '[::1]'].includes(host)
if (url.protocol !== 'mysql:' || !local(url.hostname) || !url.pathname.endsWith('_test') || url.search) throw Error('Isolated local test database required')
if (!['redis:', 'rediss:'].includes(redisUrl.protocol) || !local(redisUrl.hostname) || redisUrl.search) throw Error('Local isolated Redis required')
if (!local(process.env.MINIO_ENDPOINT || '') || process.env.MINIO_PORT !== '9000') throw Error('Local MinIO required')
const bucket = 'qa10-' + randomUUID()
const db = new PrismaClient({ datasources: { db: { url: url.toString() } } })
const redis = new Redis(redisUrl.toString(), { keyPrefix: bucket + ':' })
const client = new Client({ endPoint: process.env.MINIO_ENDPOINT!, port: 9000, useSSL: false,
  accessKey: process.env.MINIO_ACCESS_KEY!, secretKey: process.env.MINIO_SECRET_KEY! })
let app: INestApplication, tenantId: number, admin: string, buyer: string
const objects = async () => {
  if (!await client.bucketExists(bucket)) return [] as string[]
  const result: string[] = []
  for await (const item of client.listObjectsV2(bucket, '', true)) if (item.name) result.push(item.name)
  return result.sort()
}
beforeAll(async () => {
  tenantId = (await db.tenant.create({ data: { code: randomUUID(), name: 'Upload isolated fixture' } })).id
  const jwt = new JwtService(), secret = randomUUID()
  for (const type of ['super_admin', 'customer_user'] as const) {
    const user = await db.user.create({ data: { tenantId, userType: type, phone: randomUUID().slice(0,20), name: 'Upload fixture' } })
    const token = jwt.sign({ sub: user.id, tenantId }, { secret })
    if (type === 'super_admin') admin = token
    else buyer = token
  }
  const module = await Test.createTestingModule({ controllers: [UploadController], providers: [
    AuthSessionService, ProductImageStorageService,
    { provide: PrismaService, useValue: db }, { provide: REDIS, useValue: redis },
    { provide: PRODUCT_IMAGE_CLIENT, useValue: client }, { provide: JwtService, useValue: jwt },
    { provide: ConfigService, useValue: new ConfigService({ JWT_ACCESS_SECRET: secret,
      MINIO_BUCKET: bucket, MINIO_PUBLIC_URL: 'http://127.0.0.1:9000' }) }
  ] }).compile()
  app = module.createNestApplication(); app.setGlobalPrefix('api/v1')
  app.useGlobalFilters(new AppFilter()); app.useGlobalInterceptors(new SuccessInterceptor()); await app.init()
})
afterAll(async () => {
  await app?.close()
  // Only this suite's generated bucket is eligible for cleanup.
  if (!/^qa10-[a-f0-9-]{36}$/.test(bucket)) throw Error('Unexpected test bucket')
  if (await client.bucketExists(bucket)) {
    const keys = await objects()
    if (keys.length) await client.removeObjects(bucket, keys)
    await client.removeBucket(bucket)
  }
  await redis.quit()
  if (tenantId) {
    await db.user.deleteMany({ where: { tenantId } })
    await db.tenant.delete({ where: { id: tenantId } })
  }
  await db.$disconnect()
})

it.each(['jpeg','png','webp'] as const)('stores and reads a complete %s through real HTTP and local MinIO', async format => {
  const image = await sharp({ create: { width: 8, height: 6, channels: 3, background: '#b85127' } })[format]().toBuffer()
  const response = await request(app.getHttpServer()).post('/api/v1/uploads/product-image').auth(admin, { type: 'bearer' })
    .attach('file', image, { filename: 'qa.'+format, contentType: 'image/'+format }).expect(201)
  const key = response.body.data.objectKey
  expect(key).toMatch(/^products\//)
  const stream = await client.getObject(bucket, key), chunks: Buffer[] = []
  for await (const chunk of stream) chunks.push(Buffer.from(chunk))
  expect(Buffer.concat(chunks)).toEqual(image)
  const http = await fetch(response.body.data.url)
  expect(http.status).toBe(200)
  expect(Buffer.from(await http.arrayBuffer())).toEqual(image)
})

it('rejects missing, oversized, unsupported, truncated and mismatched product files without creating objects', async () => {
  const before = await objects()
  await request(app.getHttpServer()).post('/api/v1/uploads/product-image').auth(admin, { type: 'bearer' }).expect(400)
  const png = await sharp({ create: { width: 4, height: 3, channels: 3, background: 'red' } }).png().toBuffer()
  for (const [buffer, mimetype] of [[Buffer.from('GIF89a'), 'image/gif'], [png, 'image/jpeg'],
    [png.subarray(0, 8), 'image/png'], [Buffer.from([0xff,0xd8,0xff,0]), 'image/jpeg']] as const) {
    await request(app.getHttpServer()).post('/api/v1/uploads/product-image').auth(admin, { type: 'bearer' })
      .attach('file', buffer, { filename: 'qa-image', contentType: mimetype }).expect(400)
  }
  await request(app.getHttpServer()).post('/api/v1/uploads/product-image').auth(admin, { type: 'bearer' })
    .attach('file', Buffer.alloc(5*1024*1024+1), { filename: 'qa.png', contentType: 'image/png' }).expect(413)
  expect(await objects()).toEqual(before)
})

it('rejects an anonymous user and a customer before exposing public image storage', async () => {
  const before = await objects()
  const file = Buffer.from([0xff,0xd8,0xff,0])
  await request(app.getHttpServer()).post('/api/v1/uploads/product-image')
    .attach('file', file, { filename: 'qa.jpg', contentType: 'image/jpeg' }).expect(401)
  await request(app.getHttpServer()).post('/api/v1/uploads/product-image').auth(buyer, { type: 'bearer' })
    .attach('file', file, { filename: 'qa.jpg', contentType: 'image/jpeg' }).expect(403)
  expect(await objects()).toEqual(before)
})
