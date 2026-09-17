import { describe, expect, it } from 'vitest'
import {
  PRODUCT_IMAGE_MAX_BYTES,
  validateProductImageFile
} from './product-image'

describe('product image file validation', () => {
  it.each(['image/jpeg', 'image/png', 'image/webp'])('accepts %s within 5MB', (type) => {
    expect(validateProductImageFile({ type, size: PRODUCT_IMAGE_MAX_BYTES })).toBeNull()
  })

  it('rejects unsupported formats', () => {
    expect(validateProductImageFile({ type: 'image/gif', size: 1024 }))
      .toBe('仅支持 JPG、PNG、WebP 图片')
  })

  it('rejects files larger than 5MB', () => {
    expect(validateProductImageFile({ type: 'image/jpeg', size: PRODUCT_IMAGE_MAX_BYTES + 1 }))
      .toBe('图片不能超过 5MB')
  })

  it('rejects empty files', () => {
    expect(validateProductImageFile({ type: 'image/png', size: 0 }))
      .toBe('请选择有效的商品图片')
  })
})
