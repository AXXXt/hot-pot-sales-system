import { BadRequestException, Injectable } from '@nestjs/common'
import { Workbook } from 'exceljs'
import { PrismaService } from '../prisma.service'
import { toBrandPrefix } from '../product/product-code'

interface Row {
  brand: string
  brandCode?: string
  category: string
  productName: string
  productCode?: string
  specText: string
  saleUnit: string
  basePrice: string
  minOrderQty?: number
  stockNum?: number
  customerPrice?: string
}

@Injectable()
export class ImportService {
  constructor(private readonly prisma: PrismaService) {}

  /** 从 xlsx 解析并幂等导入品牌/商品/SKU/协议价 */
  async importProducts(buffer: Buffer, tenantId = 1, customerPhone?: string) {
    const rows = await this.parseRows(buffer)
    if (!rows.length) {
      throw new BadRequestException({ message: '未解析到有效数据', errorCode: 'IMP_1001' })
    }

    const customer = customerPhone
      ? await this.prisma.customer.findFirst({ where: { tenantId, contactPhone: customerPhone } })
      : null
    if (customerPhone && !customer) {
      throw new BadRequestException({ message: `未找到客户 ${customerPhone}`, errorCode: 'CUS_1001' })
    }

    let brandCount = 0
    let productCount = 0
    let skuCount = 0
    let ruleCount = 0
    let skipped = 0

    // 品牌编码去重用 Map
    const brandCodeMap = new Map<string, string>()
    for (const row of rows) {
      const brandName = row.brand.trim()
      if (!brandName) { skipped += 1; continue }
      let brandCode = brandCodeMap.get(brandName)
      if (!brandCode) {
        brandCode = (row.brandCode || toBrandPrefix(brandName) || 'BRAND').toUpperCase()
        brandCodeMap.set(brandName, brandCode)
      }

      const brand = await this.prisma.brand.upsert({
        where: { tenantId_code: { tenantId, code: brandCode } },
        update: { name: brandName, status: 'active' },
        create: { tenantId, name: brandName, code: brandCode, status: 'active' }
      })
      brandCount += 1

      let categoryId: number | null = null
      if (row.category.trim()) {
        const cat = await this.prisma.productCategory.upsert({
          where: { tenantId_code: { tenantId, code: row.category.trim() } },
          update: { name: row.category.trim(), status: 'active' },
          create: { tenantId, name: row.category.trim(), code: row.category.trim(), status: 'active' }
        })
        categoryId = cat.id
      }

      const productCode = row.productCode?.trim() || `IMP-${brandCode}-${String(productCount + 1).padStart(3, '0')}`
      const product = await this.prisma.product.upsert({
        where: { tenantId_code: { tenantId, code: productCode } },
        update: {
          name: row.productName.trim(), categoryId, brandId: brand.id, isFactoryProduct: false, status: 'active'
        },
        create: {
          tenantId, brandId: brand.id, categoryId, code: productCode, name: row.productName.trim(),
          isFactoryProduct: false, status: 'active'
        }
      })
      productCount += 1

      const skuCode = row.specText ? `${productCode}-${row.specText}` : productCode
      const sku = await this.prisma.productSku.upsert({
        where: { tenantId_skuCode: { tenantId, skuCode } },
        update: {
          productId: product.id, specText: row.specText.trim(), saleUnit: row.saleUnit.trim(),
          basePrice: row.basePrice, minOrderQty: row.minOrderQty || 1, stockNum: row.stockNum || 0, status: 'active'
        },
        create: {
          tenantId, productId: product.id, skuCode, specText: row.specText.trim(), saleUnit: row.saleUnit.trim(),
          basePrice: row.basePrice, minOrderQty: row.minOrderQty || 1, stockNum: row.stockNum || 0, status: 'active'
        }
      })
      skuCount += 1

      if (row.customerPrice && customer) {
        await this.prisma.customerPriceRule.upsert({
          where: { tenantId_customerId_skuId: { tenantId, customerId: customer.id, skuId: sku.id } },
          update: { price: row.customerPrice, status: 'active' },
          create: {
            tenantId, brandId: brand.id, productId: product.id, customerId: customer.id, skuId: sku.id,
            priceType: 'agreement', price: row.customerPrice, status: 'active'
          }
        })
        ruleCount += 1
      }
    }

    return { brandCount, productCount, skuCount, priceRuleCount: ruleCount, skipped }
  }

  private async parseRows(buffer: Buffer): Promise<Row[]> {
    const workbook = new Workbook()
    await workbook.xlsx.load(buffer as any)
    const sheet = workbook.worksheets[0]
    if (!sheet) return []

    const rows: Row[] = []
    // 表头行定位（第 1 行应为标题，第 2 行开始数据）
    const headerRow = sheet.getRow(1)

    const headers: string[] = []
    headerRow.eachCell((cell, colNumber) => { headers[colNumber] = String(cell.value || '').trim() })

    const col = (names: string[]) => {
      const idx = headers.findIndex((h) => names.includes(h))
      return idx + 1
    }

    const cBrand = col(['品牌', 'brand'])
    const cBrandCode = col(['品牌编码', 'brandCode', 'brand_code'])
    const cCategory = col(['分类', 'category'])
    const cName = col(['商品名称', '名称', 'name'])
    const cCode = col(['商品编码', '编码', 'code'])
    const cSpec = col(['规格', 'spec', 'specText'])
    const cUnit = col(['单位', 'unit', 'saleUnit'])
    const cPrice = col(['基础价', '价格', 'basePrice'])
    const cMin = col(['起订量', 'minOrderQty'])
    const cStock = col(['库存', 'stock', 'stockNum'])
    const cCustPrice = col(['协议价', '客户价', 'customerPrice'])

    sheet.eachRow((row, rowNumber) => {
      if (rowNumber === 1) return
      const get = (i: number) => (i > 0 ? String(row.getCell(i).value ?? '').trim() : '')
      const brand = get(cBrand)
      const productName = get(cName)
      const specText = get(cSpec)
      const basePrice = get(cPrice)
      if (!brand || !productName || !specText || !basePrice) return
      rows.push({
        brand,
        brandCode: get(cBrandCode) || undefined,
        category: get(cCategory),
        productName,
        productCode: get(cCode) || undefined,
        specText,
        saleUnit: get(cUnit) || '件',
        basePrice,
        minOrderQty: get(cMin) ? Number(get(cMin)) : undefined,
        stockNum: get(cStock) ? Number(get(cStock)) : undefined,
        customerPrice: get(cCustPrice) || undefined
      })
    })
    return rows
  }
}