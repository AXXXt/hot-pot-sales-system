import { BadRequestException } from '@nestjs/common'

/** 停用规格及旧商品编码的规格也计入历史序号，避免重新使用已有编号。 */
export function nextSkuCode(productCode: string, codes: string[]) {
  const sequence = codes.reduce((max, code) => {
    const suffix = code.match(/-(\d+)$/)?.[1]
    const value = suffix ? Number(suffix) : 0
    return Number.isSafeInteger(value) ? Math.max(max, value) : max
  }, 0) + 1
  const code = `${productCode}-${String(sequence).padStart(2, '0')}`
  if (!Number.isSafeInteger(sequence) || code.length > 100) throw new BadRequestException('规格编码序号已达上限')
  return code
}
