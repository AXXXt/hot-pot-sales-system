import {
  PRODUCT_IMAGE_MAX_BYTES,
  ProductImageFile,
  validateProductImage
} from '../src/upload/product-image.validation'
import { ProductImageStorageService } from '../src/upload/product-image-storage.service'

function imageFile(mimetype: string, buffer: Buffer, size = buffer.length): ProductImageFile {
  return {
    buffer,
    mimetype,
    size,
    originalname: 'product-image'
  }
}

describe('product image validation', () => {
  it.each([
    ['image/jpeg', Buffer.from([0xff, 0xd8, 0xff, 0x00]), 'jpg'],
    ['image/png', Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), 'png'],
    ['image/webp', Buffer.concat([Buffer.from('RIFF'), Buffer.alloc(4), Buffer.from('WEBP')]), 'webp']
  ])('accepts %s with a matching signature', (mimetype, buffer, extension) => {
    expect(validateProductImage(imageFile(mimetype, buffer))).toEqual({ mimetype, extension })
  })

  it('rejects a missing file', () => {
    expect(() => validateProductImage()).toThrow('请选择商品图片')
  })

  it('rejects an empty file', () => {
    expect(() => validateProductImage(imageFile('image/jpeg', Buffer.alloc(0)))).toThrow('请选择商品图片')
  })

  it('rejects a file larger than 5MB', () => {
    expect(() => validateProductImage(
      imageFile('image/jpeg', Buffer.from([0xff, 0xd8, 0xff]), PRODUCT_IMAGE_MAX_BYTES + 1)
    )).toThrow('图片不能超过 5MB')
  })

  it('rejects an unsupported MIME type', () => {
    expect(() => validateProductImage(
      imageFile('image/gif', Buffer.from([0x47, 0x49, 0x46, 0x38]))
    )).toThrow('仅支持 JPG、PNG、WebP 图片')
  })

  it('rejects a declared image whose signature does not match', () => {
    expect(() => validateProductImage(
      imageFile('image/png', Buffer.from([0xff, 0xd8, 0xff, 0x00]))
    )).toThrow('图片文件无效')
  })
})

describe('product image storage', () => {
  const existingPolicyStatement = {
    Sid: 'ExistingPrivateRule',
    Effect: 'Deny',
    Principal: { AWS: ['*'] },
    Action: ['s3:DeleteObject'],
    Resource: ['arn:aws:s3:::b2b-miniapp/private/*']
  }

  function createSubject() {
    const client = {
      bucketExists: jest.fn().mockResolvedValue(true),
      makeBucket: jest.fn().mockResolvedValue(undefined),
      getBucketPolicy: jest.fn().mockRejectedValue(Object.assign(new Error('missing'), { code: 'NoSuchBucketPolicy' })),
      setBucketPolicy: jest.fn().mockResolvedValue(undefined),
      putObject: jest.fn().mockResolvedValue({ etag: 'etag-1', versionId: null })
    }
    const config = {
      getOrThrow: jest.fn((key: string) => ({
        MINIO_BUCKET: 'b2b-miniapp',
        MINIO_PUBLIC_URL: 'http://127.0.0.1:9000/'
      })[key])
    }
    return {
      client,
      service: new ProductImageStorageService(client as any, config as any)
    }
  }

  it('uploads a UUID-named object under the date-based products prefix', async () => {
    const { client, service } = createSubject()
    const image = Buffer.from([0xff, 0xd8, 0xff])

    const result = await service.uploadProductImage(
      image,
      'image/jpeg',
      'jpg',
      new Date('2026-07-28T12:00:00Z')
    )

    expect(result.objectKey).toMatch(/^products\/2026\/07\/[0-9a-f-]+\.jpg$/)
    expect(result.url).toBe(`http://127.0.0.1:9000/b2b-miniapp/${result.objectKey}`)
    expect(client.putObject).toHaveBeenCalledWith(
      'b2b-miniapp',
      result.objectKey,
      image,
      image.length,
      expect.objectContaining({
        'Content-Type': 'image/jpeg',
        'Cache-Control': 'public, max-age=31536000, immutable'
      })
    )
  })

  it('creates the bucket when it does not exist', async () => {
    const { client, service } = createSubject()
    client.bucketExists.mockResolvedValue(false)

    await service.uploadProductImage(Buffer.from([0xff, 0xd8, 0xff]), 'image/jpeg', 'jpg')

    expect(client.makeBucket).toHaveBeenCalledWith('b2b-miniapp')
  })

  it('preserves unrelated policy statements while adding public product image reads', async () => {
    const { client, service } = createSubject()
    client.getBucketPolicy.mockResolvedValue(JSON.stringify({
      Version: '2012-10-17',
      Statement: [existingPolicyStatement]
    }))

    await service.uploadProductImage(Buffer.from([0x89, 0x50, 0x4e, 0x47]), 'image/png', 'png')

    const policy = JSON.parse(client.setBucketPolicy.mock.calls[0][1])
    expect(policy.Statement).toContainEqual(existingPolicyStatement)
    expect(policy.Statement).toContainEqual(expect.objectContaining({
      Sid: 'AllowPublicReadProductImages',
      Effect: 'Allow',
      Action: ['s3:GetObject'],
      Resource: ['arn:aws:s3:::b2b-miniapp/products/*']
    }))
  })

  it('maps unexpected bucket policy errors to service unavailable', async () => {
    const { client, service } = createSubject()
    client.getBucketPolicy.mockRejectedValue(Object.assign(new Error('access denied'), { code: 'AccessDenied' }))

    await expect(service.uploadProductImage(
      Buffer.from([0xff, 0xd8, 0xff]),
      'image/jpeg',
      'jpg'
    )).rejects.toMatchObject({
      status: 503,
      response: {
        message: '图片存储服务暂不可用',
        errorCode: 'UPL_2001'
      }
    })
  })

  it('maps object upload failures to service unavailable', async () => {
    const { client, service } = createSubject()
    client.putObject.mockRejectedValue(new Error('storage offline'))

    await expect(service.uploadProductImage(
      Buffer.from([0xff, 0xd8, 0xff]),
      'image/jpeg',
      'jpg'
    )).rejects.toMatchObject({
      status: 503,
      response: {
        message: '图片存储服务暂不可用',
        errorCode: 'UPL_2001'
      }
    })
  })
})
