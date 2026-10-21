import { BadRequestException } from '@nestjs/common'

export const MAX_PRODUCT_IMAGES = 9
type ImageSource = { images?: unknown; mainImageUrl?: string | null }

/** 旧商品的单张主图也作为图库返回；有图库时以图库顺序为准。 */
export function productImages(product: ImageSource): string[] {
  const images = Array.isArray(product.images)
    ? [...new Set(product.images.filter((url): url is string => typeof url === 'string' && !!url.trim()))]
    : []
  return images.length ? images : product.mainImageUrl ? [product.mainImageUrl] : []
}

export function imageUpdate(input: ImageSource, current: ImageSource = {}) {
  if (input.images === undefined && input.mainImageUrl === undefined) return {}
  let images: string[]
  if (input.images !== undefined) {
    if (!Array.isArray(input.images) || input.images.length > MAX_PRODUCT_IMAGES || input.images.some(url => typeof url !== 'string' || !url.trim() || url.length > 500)) {
      throw new BadRequestException('商品图片须为有效地址列表，最多9张')
    }
    images = [...new Set(input.images.map(url => url.trim()))]
  } else {
    // 兼容旧管理端更换封面，保留其余详情图。
    const cover = input.mainImageUrl?.trim()
    images = cover ? [cover, ...productImages(current).slice(1).filter(url => url !== cover)].slice(0, MAX_PRODUCT_IMAGES) : []
  }
  if (images.some(url => !/^(https?:\/\/|\/(?!\/))\S+$/i.test(url))) throw new BadRequestException('商品图片地址无效')
  return { images, mainImageUrl: images[0] || '' }
}
