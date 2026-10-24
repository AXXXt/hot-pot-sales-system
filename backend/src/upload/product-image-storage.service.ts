import { BadRequestException, ForbiddenException, Inject, Injectable, ServiceUnavailableException } from '@nestjs/common'
import { ConfigService } from '@nestjs/config'
import { randomUUID } from 'node:crypto'
import { PRODUCT_IMAGE_CLIENT, ProductImageClient } from './product-image-client.provider'
import { ProductImageDescriptor } from './product-image.validation'
import { PrismaService } from '../prisma.service'
import { getOrderScope, orderScopeWhere } from '../order/order-access.guard'

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
  private readonly aiBucket: string
  private aiReadiness?: Promise<void>

  constructor(
    @Inject(PRODUCT_IMAGE_CLIENT) private readonly client: ProductImageClient,
    config: ConfigService,
    private readonly prisma: PrismaService
  ) {
    this.bucket = config.getOrThrow<string>('MINIO_BUCKET')
    this.aiBucket = `${this.bucket}-ai-private`
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

  async uploadAiImage(buffer: Buffer) {
    await this.ensureAiBucket()
    const now = new Date()
    const objectKey = `ai-private/${now.getUTCFullYear()}/${String(now.getUTCMonth() + 1).padStart(2, '0')}/${randomUUID()}.jpg`
    await this.client.putObject(this.aiBucket, objectKey, buffer, buffer.length, { 'Content-Type': 'image/jpeg', 'Cache-Control': 'private, no-store' })
    return { objectKey }
  }

  async readAiImage(objectKey: string): Promise<Buffer> {
    if (!/^ai-private\/\d{4}\/\d{2}\/[a-zA-Z0-9-]+\.jpg$/.test(objectKey)) throw new BadRequestException('识别附件地址无效')
    const stream = await this.client.getObject(this.aiBucket, objectKey)
    const chunks: Buffer[] = []
    let bytes = 0
    for await (const chunk of stream) {
      bytes += chunk.length
      if (bytes > 5 * 1024 * 1024) { stream.destroy(); throw new BadRequestException('识别附件过大') }
      chunks.push(Buffer.from(chunk))
    }
    return Buffer.concat(chunks)
  }

  async removeAiImage(objectKey: string) {
    if (!/^ai-private\/\d{4}\/\d{2}\/[a-zA-Z0-9-]+\.jpg$/.test(objectKey)) throw new BadRequestException('识别附件地址无效')
    await this.client.removeObject(this.aiBucket, objectKey)
  }

  private ensureAiBucket() {
    if (!this.aiReadiness) this.aiReadiness = (async () => {
      if (!await this.client.bucketExists(this.aiBucket)) await this.client.makeBucket(this.aiBucket)
      // A dedicated bucket avoids inheriting legacy public product-image policies.
      await this.client.setBucketPolicy(this.aiBucket, '')
    })().catch(error => { this.aiReadiness = undefined; throw error })
    return this.aiReadiness
  }

  async uploadPaymentProof(
    buffer: Buffer,
    mimetype: ProductImageDescriptor['mimetype'],
    extension: ProductImageDescriptor['extension'],
    userId: number,
    now = new Date()
  ) {
    const scope = await getOrderScope(this.prisma, userId)
    const result = await this.uploadImage('payment-proofs', buffer, mimetype, extension, now)
    await this.prisma.file.create({
      data: {
        tenantId: scope.tenantId, createdBy: userId, fileName: result.objectKey,
        fileUrl: result.url, fileType: 'payment-proof', fileSize: buffer.length, mimeType: mimetype
      }
    })
    return result
  }

  /**
   * 生成转账凭证的临时签名访问地址（凭证桶为私有读，无签名无法访问）。
   * key 支持两种格式：objectKey（payment-proofs/...）或完整地址。
   */
  async getPaymentProofSignedUrl(key: string, userId: number, expiresSeconds = 3600) {
    const objectKey = this.resolvePaymentProofObjectKey(key)
    if (!objectKey) throw new BadRequestException({ message: '凭证地址无效', errorCode: 'UPL_1003' })
    const scope = await getOrderScope(this.prisma, userId)
    const url = `${this.publicUrl}/${this.bucket}/${objectKey}`
    const order = await this.prisma.order.findFirst({
      where: { ...orderScopeWhere(scope), paymentProof: { in: [objectKey, url] } }, select: { id: true }
    })
    const ownFile = !order && await this.prisma.file.findFirst({
      where: { tenantId: scope.tenantId, createdBy: userId, fileType: 'payment-proof', fileUrl: url },
      select: { id: true }
    })
    if (!order && !ownFile) throw new ForbiddenException('无权访问该付款凭证')
    try {
      await this.ensureReady()
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
    prefix: 'products' | 'payment-proofs' | 'ai-private',
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
        'Cache-Control': prefix === 'products' ? 'public, max-age=31536000, immutable' : 'private, no-store'
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
