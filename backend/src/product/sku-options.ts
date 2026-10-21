import { BadRequestException } from '@nestjs/common'
import { Prisma } from '@prisma/client'
import { packagingUnits } from '../inventory/packaging'

export function skuOptions(input: any, product: any, current?: any) {
  const result: Record<string, any> = {}
  if (current?.batchTracking && input.batchTracking === false) throw new BadRequestException('已启用批次追溯的规格不支持关闭，请保留批次记录')
  const unit = input.saleUnit ?? current?.saleUnit ?? ''
  if (current && unit !== current.saleUnit && (current.stockNum > 0 || current.reservedNum > 0)) throw new BadRequestException('有库存或预占时不能修改基础销售单位，请先核对库存')
  if (input.imageUrl !== undefined) {
    const images = [...(Array.isArray(product.images) ? product.images : []), product.mainImageUrl].filter(Boolean)
    if (input.imageUrl && !images.includes(input.imageUrl)) throw new BadRequestException('规格图片须从已保存的商品图库中选择')
    result.imageUrl = input.imageUrl || null
  }
  if (input.packagingUnits !== undefined || (current && unit !== current.saleUnit)) result.packagingUnits = packagingUnits(input.packagingUnits ?? current?.packagingUnits, unit) as unknown as Prisma.InputJsonValue
  for (const key of ['lowStockThreshold', 'leadTimeDays', 'safetyStock', 'batchTracking']) if (input[key] !== undefined) result[key] = input[key]
  return result
}
