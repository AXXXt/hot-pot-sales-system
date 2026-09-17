import { BadRequestException, Inject, Injectable, ServiceUnavailableException } from '@nestjs/common'
import { ConfigService } from '@nestjs/config'
import { randomUUID } from 'node:crypto'
import { PRODUCT_IMAGE_CLIENT, ProductImageClient } from './product-image-client.provider'
import { ProductImageDescriptor } from './product-image.validation'

interface BucketPolicy {
  Version: string
  Statement: Array<Record<string, unknown>>
}

const productImagePolicySid = 'AllowPublicReadProductImages'

const PAYMENT_PROOF_KEY_PATTERN = /^payment-proofs\/\d{4}\/\d{2}\/[A-Za-z0-9-]+\.(jpg|jpeg|png|webp)$/i

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

  /**
   * 生成转账凭证的临时签名访问地址（凭证桶为私有读，无签名无法访问）。
   * key 支持两种格式：objectKey（payment-proofs/...）或完整地址。
   */
  async getPaymentProofSignedUrl(key: string, expiresSeconds = 3600) {
    try {
      await this.ensureReady()
      const objectKey = this.resolvePaymentProofObjectKey(key)
      if (!objectKey) {
        throw new BadRequestException({ message: '凭证地址无效', errorCode: 'UPL_1003' })
      }
      const url = await this.client.presignedGetObject(this.bucket, objectKey, expiresSeconds)
      return { url, expiresIn: expiresSeconds, objectKey }
    } catch (error) {
      if (error instanceof BadRequestException) throw error
      throw new ServiceUnavailableException({
        message: '图片存储服务暂不可用',
        errorCode: 'UPL_2001'
      })
    }
  }

  private resolvePaymentProofObjectKey(key: string): string | null {
    if (!key) return null
    let objectKey = key.trim()
    const prefix = `${this.publicUrl}/${this.bucket}/`
    if (objectKey.startsWith('http://') || objectKey.startsWith('https://')) {
      if (!objectKey.startsWith(prefix)) return null
      objectKey = objectKey.slice(prefix.length)
    }
    if (!PAYMENT_PROOF_KEY_PATTERN.test(objectKey)) return null
    return objectKey
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

    // 仅商品图公开读；转账凭证为私有读（通过签名 URL 访问）
    const policy = await this.readBucketPolicy()
    const publicReadStatements = [
      {
        Sid: productImagePolicySid,
        Effect: 'Allow',
        Principal: { AWS: ['*'] },
        Action: ['s3:GetObject'],
        Resource: [`arn:aws:s3:::${this.bucket}/products/*`]
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