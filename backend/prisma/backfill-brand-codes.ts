import { PrismaClient } from '@prisma/client'
import { isValidBrandPrefix, normalizeBrandPrefix, toBrandPrefix } from '../src/product/product-code'

const prisma = new PrismaClient()

async function main() {
  const brands = await prisma.brand.findMany({ orderBy: [{ tenantId: 'asc' }, { id: 'asc' }] })
  const used = new Set<string>()
  const updates: Array<{ id: number; code: string }> = []

  for (const brand of brands) {
    const normalizedExisting = normalizeBrandPrefix(brand.code)
    const code = isValidBrandPrefix(normalizedExisting) && normalizedExisting
      ? normalizedExisting
      : toBrandPrefix(brand.name)
    const key = `${brand.tenantId}:${code}`

    if (!code || used.has(key)) {
      throw new Error(`品牌编码冲突: ${brand.name} -> ${code || '(empty)'}`)
    }

    used.add(key)
    if (brand.code !== code) updates.push({ id: brand.id, code })
  }

  if (updates.length > 0) {
    await prisma.$transaction(updates.map((item) => prisma.brand.update({
      where: { id: item.id },
      data: { code: item.code }
    })))
  }
}

main()
  .catch((error) => {
    console.error(error)
    process.exitCode = 1
  })
  .finally(() => prisma.$disconnect())
