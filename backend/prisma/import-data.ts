import { PrismaClient } from '@prisma/client'
import * as fs from 'node:fs'
import * as path from 'node:path'
import { toBrandPrefix } from '../src/product/product-code'

const prisma = new PrismaClient()

interface ImportSku {
  skuCode: string
  name?: string
  specText: string
  saleUnit: string
  basePrice: string
  minOrderQty?: number
  stockNum?: number
  customerPrice?: string
}

interface ImportProduct {
  code?: string
  name: string
  subtitle?: string
  baseSpec?: string
  categoryName?: string
  isFactoryProduct?: boolean
  skus: ImportSku[]
}

interface ImportBrand {
  name: string
  code?: string
  products: ImportProduct[]
}

interface ImportFile {
  tenantCode?: string
  customerPhone?: string
  brands: ImportBrand[]
}

/**
 * 幂等导入品牌/商品/SKU/协议价。
 * 用法: npm run data:import -- <data.json>
 */
async function main() {
  const fileArg = process.argv[2]
  if (!fileArg) {
    console.error('用法: npm run data:import -- <data.json>')
    process.exit(1)
  }
  const raw = fs.readFileSync(path.resolve(fileArg), 'utf8')
  const data = JSON.parse(raw) as ImportFile

  const tenant = await prisma.tenant.findFirst({ where: { code: data.tenantCode || 'demo' } })
  if (!tenant) throw new Error(`租户不存在: ${data.tenantCode || 'demo'}`)
  const tenantId = tenant.id

  const customer = data.customerPhone
    ? await prisma.customer.findFirst({ where: { tenantId, contactPhone: data.customerPhone } })
    : null
  if (data.customerPhone && !customer) {
    console.warn(`警告: 未找到客户 ${data.customerPhone}，协议价将跳过`)
  }

  let brandCount = 0
  let productCount = 0
  let skuCount = 0
  let ruleCount = 0

  for (const brandData of data.brands) {
    const brandCode = (brandData.code || toBrandPrefix(brandData.name) || 'BRAND').toUpperCase()
    const brand = await prisma.brand.upsert({
      where: { tenantId_code: { tenantId, code: brandCode } },
      update: { name: brandData.name, status: 'active' },
      create: { tenantId, name: brandData.name, code: brandCode, status: 'active' }
    })
    brandCount += 1

    for (const p of brandData.products) {
      let categoryId: number | null = null
      if (p.categoryName) {
        const cat = await prisma.productCategory.upsert({
          where: { tenantId_code: { tenantId, code: p.categoryName } },
          update: { name: p.categoryName, status: 'active' },
          create: { tenantId, name: p.categoryName, code: p.categoryName, status: 'active' }
        })
        categoryId = cat.id
      }

      const productCode = p.code || `IMP-${brandCode}-${String(productCount + 1).padStart(3, '0')}`
      const product = await prisma.product.upsert({
        where: { tenantId_code: { tenantId, code: productCode } },
        update: {
          name: p.name, subtitle: p.subtitle, baseSpec: p.baseSpec, categoryId,
          brandId: brand.id, isFactoryProduct: p.isFactoryProduct ?? false, status: 'active'
        },
        create: {
          tenantId, brandId: brand.id, categoryId, code: productCode, name: p.name,
          subtitle: p.subtitle, baseSpec: p.baseSpec, isFactoryProduct: p.isFactoryProduct ?? false,
          status: 'active'
        }
      })
      productCount += 1

      for (const skuData of p.skus) {
        const sku = await prisma.productSku.upsert({
          where: { tenantId_skuCode: { tenantId, skuCode: skuData.skuCode } },
          update: {
            productId: product.id, name: skuData.name, specText: skuData.specText, saleUnit: skuData.saleUnit,
            basePrice: skuData.basePrice, minOrderQty: skuData.minOrderQty ?? 1,
            stockNum: skuData.stockNum ?? 0, status: 'active'
          },
          create: {
            tenantId, productId: product.id, skuCode: skuData.skuCode, name: skuData.name,
            specText: skuData.specText, saleUnit: skuData.saleUnit, basePrice: skuData.basePrice,
            minOrderQty: skuData.minOrderQty ?? 1, stockNum: skuData.stockNum ?? 0, status: 'active'
          }
        })
        skuCount += 1

        if (skuData.customerPrice && customer) {
          await prisma.customerPriceRule.upsert({
            where: { tenantId_customerId_skuId: { tenantId, customerId: customer.id, skuId: sku.id } },
            update: { price: skuData.customerPrice, status: 'active' },
            create: {
              tenantId, brandId: brand.id, productId: product.id, customerId: customer.id,
              skuId: sku.id, priceType: 'agreement', price: skuData.customerPrice, status: 'active'
            }
          })
          ruleCount += 1
        }
      }
    }
  }

  console.log(JSON.stringify({ brandCount, productCount, skuCount, priceRuleCount: ruleCount }, null, 2))
}

main()
  .catch((error) => { console.error(error); process.exitCode = 1 })
  .finally(async () => { await prisma.$disconnect() })