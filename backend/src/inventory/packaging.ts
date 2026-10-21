import { BadRequestException } from '@nestjs/common'

export interface PackagingUnit { unit: string; factor: number }
export function packagingUnits(value: unknown, saleUnit: string): PackagingUnit[] {
  if (value == null) return []
  if (!Array.isArray(value) || value.length > 5) throw new BadRequestException('包装单位最多5项')
  const seen = new Set([saleUnit.trim()])
  return value.map(item => {
    const unit = typeof item?.unit === 'string' ? item.unit.trim().normalize('NFKC') : ''
    if (!unit || unit.length > 20 || seen.has(unit) || !Number.isSafeInteger(item.factor) || item.factor < 2 || item.factor > 100000) throw new BadRequestException('包装单位须唯一，换算数量为2～100000的整数')
    seen.add(unit)
    return { unit, factor: item.factor }
  })
}

/** 仅按人工配置换算；不同净含量的SKU从不合并库存。 */
export function convertQuantity(sku: { saleUnit: string; packagingUnits?: unknown }, quantity: number, unit?: string) {
  if (!Number.isSafeInteger(quantity) || quantity < 0) throw new BadRequestException('数量必须为非负整数')
  const selected = (unit || sku.saleUnit).trim().normalize('NFKC')
  const factor = selected === sku.saleUnit ? 1 : packagingUnits(sku.packagingUnits, sku.saleUnit).find(x => x.unit === selected)?.factor
  if (!factor) throw new BadRequestException(`未配置${selected}与${sku.saleUnit}的换算关系`)
  const baseQuantity = quantity * factor
  if (!Number.isSafeInteger(baseQuantity) || baseQuantity < 0 || baseQuantity > 2147483647) throw new BadRequestException('换算后数量超出范围')
  return { unit: selected, factor, baseQuantity }
}
