import { BadRequestException } from '@nestjs/common'
import { productImages } from './product-images'

type ProductNameSource = { name?: string | null; subtitle?: string | null; images?: unknown; mainImageUrl?: string | null }

/** 数据库 name 保留自动管理标签，subtitle 沿用已有真实商品名。 */
export function productDisplayName(product: ProductNameSource): string {
  return product.subtitle?.trim() || product.name || ''
}

/** name 兼容已安装客户端；管理端通过 managementLabel 读取只读标签。 */
export function presentProduct<T extends ProductNameSource>(product: T) {
  const images = productImages(product)
  return {
    ...product,
    images,
    mainImageUrl: images[0] || '',
    managementLabel: product.name || '',
    displayName: productDisplayName(product),
    name: productDisplayName(product),
    nameNeedsReview: !product.subtitle?.trim()
  }
}

export function normalizeProductTitle(value: unknown): string | undefined {
  if (value === undefined) return undefined
  if (typeof value !== 'string' || !value.trim() || Array.from(value.trim()).length > 255) {
    throw new BadRequestException({ message: '商品名称须为1至255个字', errorCode: 'PRO_1004' })
  }
  return value.trim()
}
