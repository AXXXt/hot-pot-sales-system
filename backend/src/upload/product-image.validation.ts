import { BadRequestException } from '@nestjs/common'
import sharp from 'sharp'

export const PRODUCT_IMAGE_MAX_BYTES = 5 * 1024 * 1024
export const PRODUCT_IMAGE_MIME_TYPES = ['image/jpeg', 'image/png', 'image/webp'] as const
export const PAYMENT_PROOF_MAX_PIXELS = 40_000_000

export interface ProductImageFile {
  buffer: Buffer
  mimetype: string
  size: number
  originalname?: string
}

export interface ProductImageDescriptor {
  mimetype: (typeof PRODUCT_IMAGE_MIME_TYPES)[number]
  extension: 'jpg' | 'png' | 'webp'
}

const productImageMimeTypes = new Set<string>(PRODUCT_IMAGE_MIME_TYPES)
const pngSignature = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])
const pngEnd = Buffer.from([0, 0, 0, 0, 0x49, 0x45, 0x4e, 0x44, 0xae, 0x42, 0x60, 0x82])

function hasCompleteImageContainer(buffer: Buffer, extension: ProductImageDescriptor['extension']): boolean {
  if (extension === 'jpg') return buffer.length >= 4 && buffer[buffer.length - 2] === 0xff && buffer[buffer.length - 1] === 0xd9
  if (extension === 'png') return buffer.length >= pngEnd.length && buffer.subarray(-pngEnd.length).equals(pngEnd)
  return buffer.length >= 12 && buffer.readUInt32LE(4) === buffer.length - 8
}

function detectProductImage(buffer: Buffer): ProductImageDescriptor | null {
  if (buffer.length >= 3 && buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff) {
    return { mimetype: 'image/jpeg', extension: 'jpg' }
  }

  if (buffer.length >= pngSignature.length && buffer.subarray(0, pngSignature.length).equals(pngSignature)) {
    return { mimetype: 'image/png', extension: 'png' }
  }

  if (
    buffer.length >= 12
    && buffer.subarray(0, 4).toString('ascii') === 'RIFF'
    && buffer.subarray(8, 12).toString('ascii') === 'WEBP'
  ) {
    return { mimetype: 'image/webp', extension: 'webp' }
  }

  return null
}

function validateImage(file: ProductImageFile | undefined, emptyMessage: string): ProductImageDescriptor {
  if (!file?.buffer?.length || file.size <= 0) {
    throw new BadRequestException(emptyMessage)
  }

  if (file.size > PRODUCT_IMAGE_MAX_BYTES || file.buffer.length > PRODUCT_IMAGE_MAX_BYTES) {
    throw new BadRequestException('图片不能超过 5MB')
  }

  if (!productImageMimeTypes.has(file.mimetype)) {
    throw new BadRequestException('仅支持 JPG、PNG、WebP 图片')
  }

  const detected = detectProductImage(file.buffer)
  if (!detected || detected.mimetype !== file.mimetype) {
    throw new BadRequestException('图片文件无效')
  }

  return detected
}

export function validateProductImage(file?: ProductImageFile): ProductImageDescriptor {
  return validateImage(file, '请选择商品图片')
}

/** 商品图也须完整解码，不能把只有图片头的损坏文件写入存储。 */
export async function validateProductImageContent(file?: ProductImageFile): Promise<ProductImageDescriptor> {
  const image = validateProductImage(file)
  await validatePaymentProof(file)
  return image
}

export async function validatePaymentProof(file?: ProductImageFile): Promise<ProductImageDescriptor> {
  if (!file?.buffer?.length || file.size <= 0) throw new BadRequestException('请选择转账凭证')
  if (file.size > PRODUCT_IMAGE_MAX_BYTES || file.buffer.length > PRODUCT_IMAGE_MAX_BYTES) throw new BadRequestException('图片不能超过 5MB')
  if (!productImageMimeTypes.has(file.mimetype)) throw new BadRequestException('仅支持 JPG、PNG、WebP 图片')

  // 微信临时文件可能统一声明为JPEG；凭证按实际内容确定存储类型，商品图仍保持严格匹配。
  const detected = detectProductImage(file.buffer)
  // 解码器能容错恢复缺尾图片，因此还须检查格式结束标记或RIFF声明长度。
  if (!detected || !hasCompleteImageContainer(file.buffer, detected.extension)) throw new BadRequestException('图片文件无效')
  try {
    const image = sharp(file.buffer, { limitInputPixels: PAYMENT_PROOF_MAX_PIXELS, failOn: 'warning', animated: true })
    const metadata = await image.metadata()
    const expectedFormat = detected.extension === 'jpg' ? 'jpeg' : detected.extension
    if (metadata.format !== expectedFormat || !metadata.width || !metadata.height) throw new Error('Invalid image metadata')
    // 不能只检查魔数或metadata：完整解码才能拒绝伪造图片头和截断的像素内容。
    await image.raw().toBuffer()
  } catch {
    throw new BadRequestException('图片文件无效')
  }
  return detected
}
