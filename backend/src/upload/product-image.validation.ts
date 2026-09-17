import { BadRequestException } from '@nestjs/common'

export const PRODUCT_IMAGE_MAX_BYTES = 5 * 1024 * 1024
export const PRODUCT_IMAGE_MIME_TYPES = ['image/jpeg', 'image/png', 'image/webp'] as const

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

export function validatePaymentProof(file?: ProductImageFile): ProductImageDescriptor {
  return validateImage(file, '请选择转账凭证')
}
