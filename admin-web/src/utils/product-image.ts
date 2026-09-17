export const PRODUCT_IMAGE_MAX_BYTES = 5 * 1024 * 1024
export const PRODUCT_IMAGE_MIME_TYPES = ['image/jpeg', 'image/png', 'image/webp'] as const

interface ProductImageFileLike {
  type: string
  size: number
}

const productImageMimeTypes = new Set<string>(PRODUCT_IMAGE_MIME_TYPES)

export function validateProductImageFile(file: ProductImageFileLike): string | null {
  if (file.size <= 0) {
    return '请选择有效的商品图片'
  }

  if (!productImageMimeTypes.has(file.type)) {
    return '仅支持 JPG、PNG、WebP 图片'
  }

  if (file.size > PRODUCT_IMAGE_MAX_BYTES) {
    return '图片不能超过 5MB'
  }

  return null
}
