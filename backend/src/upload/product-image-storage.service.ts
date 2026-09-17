import { Inject, Injectable, ServiceUnavailableException } from '@nestjs/common'
import { ConfigService } from '@nestjs/config'
import { randomUUID } from 'node:crypto'
import { PRODUCT_IMAGE_CLIENT, ProductImageClient } from './product-image-client.provider'
import { ProductImageDescriptor } from './product-image.validation'

interface BucketPolicy {
  Version: string
  Statement: Array<Record<string, unknown>>
}

const productImagePolicySid = 'AllowPublicReadProductImages'
const paymentProofPolicySid = 'AllowPublicReadPaymentProofs'

@Injectable()
export class ProductImageStorageService {
  private readonly bucket: string
  private readonly publicUrl: string
  private readiness?: Promise<void>

  constructor(
    @Inject(PRODUCT_IMAGE_CLIENT) private readonly client: ProductImageClient,
    config: ConfigService
  ) {
    this.bucket = config.getOrThrow<string>('MINIO_BUCKET')
    this.publicUrl = config.getOrThrow<string>('MINIO_PUBLIC_URL').replace(/\/+$/, '')
  }

  async uploadProductImage(
    buffer: Buffer,
    mimetype: ProductImageDescriptor['mimetype'],
    extension: ProductImageDescriptor['extension'],
    now = new Date()
  ) {
    return this.uploadImage('products', buffer, mimetype, extension, now)
  }

  async uploadPaymentProof(
    buffer: Buffer,
    mimetype: ProductImageDescriptor['mimetype'],
    extension: ProductImageDescriptor['extension'],
    now = new Date()
  ) {
    return this.uploadImage('payment-proofs', buffer, mimetype, extension, now)
  }

  private async uploadImage(
    prefix: 'products' | 'payment-proofs',
    buffer: Buffer,
    mimetype: ProductImageDescriptor['mimetype'],
    extension: ProductImageDescriptor['extension'],
    now: Date
  ) {
    try {
      await this.ensureReady()

      const year = String(now.getUTCFullYear())
      const month = String(now.getUTCMonth() + 1).padStart(2, '0')
      const objectKey = `${prefix}/${year}/${month}/${randomUUID()}.${extension}`

      await this.client.putObject(this.bucket, objectKey, buffer, buffer.length, {
        'Content-Type': mimetype,
        'Cache-Control': 'public, max-age=31536000, immutable'
      })

      return {
        objectKey,
        url: `${this.publicUrl}/${this.bucket}/${objectKey}`
      }
    } catch {
      throw new ServiceUnavailableException({
        message: '图片存储服务暂不可用',
        errorCode: 'UPL_2001'
      })
    }
  }

  private ensureReady() {
    if (!this.readiness) {
      this.readiness = this.prepareBucket().catch((error) => {
        this.readiness = undefined
        throw error
      })
    }
    return this.readiness
  }

  private async prepareBucket() {
    const exists = await this.client.bucketExists(this.bucket)
    if (!exists) {
      await this.client.makeBucket(this.bucket)
    }

    const policy = await this.readBucketPolicy()
    const publicReadStatements = [
      {
        Sid: productImagePolicySid,
        Effect: 'Allow',
        Principal: { AWS: ['*'] },
        Action: ['s3:GetObject'],
        Resource: [`arn:aws:s3:::${this.bucket}/products/*`]
      },
      {
        Sid: paymentProofPolicySid,
        Effect: 'Allow',
        Principal: { AWS: ['*'] },
        Action: ['s3:GetObject'],
        Resource: [`arn:aws:s3:::${this.bucket}/payment-proofs/*`]
      }
    ]
    policy.Statement = policy.Statement
      .filter((statement) => !publicReadStatements.some(item => item.Sid === statement.Sid))
      .concat(publicReadStatements)

    await this.client.setBucketPolicy(this.bucket, JSON.stringify(policy))
  }

  private async readBucketPolicy(): Promise<BucketPolicy> {
    try {
      const rawPolicy = await this.client.getBucketPolicy(this.bucket)
      const parsed = JSON.parse(rawPolicy) as Partial<BucketPolicy>
      return {
        Version: typeof parsed.Version === 'string' ? parsed.Version : '2012-10-17',
        Statement: Array.isArray(parsed.Statement) ? parsed.Statement : []
      }
    } catch (error) {
      if (this.isMissingPolicy(error)) {
        return { Version: '2012-10-17', Statement: [] }
      }
      throw error
    }
  }

  private isMissingPolicy(error: unknown) {
    return typeof error === 'object'
      && error !== null
      && 'code' in error
      && error.code === 'NoSuchBucketPolicy'
  }
}
