import { BadRequestException, ForbiddenException, HttpException, Injectable } from '@nestjs/common'
import { Prisma } from '@prisma/client'
import { randomUUID } from 'node:crypto'
import { inflateRawSync } from 'node:zlib'
import { Workbook } from 'exceljs'
import { PrismaService } from '../prisma.service'
import { isValidBrandPrefix, toBrandPrefix } from '../product/product-code'
import { ProductService } from '../product/product.service'
import { nextSkuCode } from '../product/sku-code'
import { StaffAccessService, StaffActor } from '../auth/staff-access.service'

interface Row {
  rowNumber: number
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
interface RowError { row: number; message: string }
const MAX_ROWS = 500, MAX_ERRORS = 20, MAX_BYTES = 5 * 1024 * 1024
const money = /^(0|[1-9]\d{0,15})(\.\d{1,2})?$/

@Injectable()
export class ImportService {
  constructor(private readonly prisma: PrismaService, private readonly products: ProductService, private readonly access: StaffAccessService) {}

  async productTemplate(actor: StaffActor) {
    this.access.require(actor, 'product:update', 'product:price:update')
    const workbook = new Workbook(), sheet = workbook.addWorksheet('商品导入')
    sheet.addRow(['品牌', '品牌编码', '分类', '商品名称', '商品编码', '规格', '单位', '基础价', '起订量', '库存', '协议价'])
    sheet.columns.forEach(column => { column.width = 22 })
    sheet.getRow(1).font = { bold: true }; sheet.views = [{ state: 'frozen', ySplit: 1 }]
    const notes = workbook.addWorksheet('填写说明')
    for (const text of [
      '请在“商品导入”工作表从第2行开始填写；本模板不含演示商品，不会替您初始化库存。',
      '品牌、分类、商品名称、规格、基础价必填；商品名称填写客户看到的真实名称。',
      '新商品的商品编码留空，由系统按品牌和分类生成；已有商品请填写当前准确编码。',
      '单位默认件，起订量默认1；库存仅可留空或0，实际库存通过出入库调整。',
      '协议价可留空；填写时须先在后台选择目标客户，并具备客户管理权限。',
      '一次最多500行、5MB；只接受文本/数值，不接受公式。任一行失败时整批回滚。'
    ]) notes.addRow([text])
    notes.getColumn(1).width = 110
    return Buffer.from(await workbook.xlsx.writeBuffer())
  }

  /** 整表预检并事务写入；导入商品资料绝不直接改库存、预占或启用状态。 */
  async importProducts(buffer: Buffer, actor: StaffActor, customerPhone?: string, customerId?: number) {
    this.access.require(actor, 'product:update', 'product:price:update')
    const parsed = await this.parseRows(buffer)
    const rows: Row[] = [], seen = new Map<string, Row>(), productIdentities = new Map<string, Row>(), errors: RowError[] = []
    let skipped = 0
    for (const row of parsed) {
      if (row.productCode) {
        const previous = productIdentities.get(row.productCode)
        if (previous && (previous.brand !== row.brand || previous.category !== row.category || previous.productName !== row.productName || previous.brandCode !== row.brandCode)) {
          errors.push({ row: row.rowNumber, message: `与第${previous.rowNumber}行的同一商品名称、品牌或分类冲突` })
          continue
        }
        productIdentities.set(row.productCode, row)
      }
      const key = JSON.stringify([row.brandCode || row.brand, row.category, row.productCode || row.productName, row.specText])
      const previous = seen.get(key)
      if (previous) {
        const values = (item: Row) => JSON.stringify({ ...item, rowNumber: undefined })
        if (values(previous) !== values(row)) errors.push({ row: row.rowNumber, message: `与第${previous.rowNumber}行的同一规格数据冲突` })
        else skipped++
      } else { seen.set(key, row); rows.push(row) }
    }
    if (errors.length) this.invalidRows(errors)
    if (customerPhone && !/^1[3-9]\d{9}$/.test(customerPhone)) throw new BadRequestException('客户手机号格式不正确')
    if (customerId !== undefined && (!Number.isSafeInteger(customerId) || customerId <= 0)) throw new BadRequestException('客户ID须为正整数')
    if (customerPhone && customerId !== undefined) throw new BadRequestException('请仅指定一种客户标识')
    const selectedCustomer = customerId !== undefined || Boolean(customerPhone)
    if (selectedCustomer) this.access.require(actor, 'customer:manage')
    const missingCustomerRows = rows.filter(row => row.customerPrice !== undefined && !selectedCustomer)
    if (missingCustomerRows.length) this.invalidRows(missingCustomerRows.map(row => ({ row: row.rowNumber, message: '导入协议价须先指定有权限的客户' })))

    let currentRow = rows[0].rowNumber
    try {
      return await this.prisma.$transaction(async tx => {
        const customer = selectedCustomer ? await tx.customer.findFirst({ where: {
          tenantId: actor.tenantId, status: 'active', ...(customerId !== undefined ? { id: customerId } : { contactPhone: customerPhone }),
          ...(actor.customerIds === null ? {} : { AND: [{ id: { in: actor.customerIds } }] })
        }, select: { id: true } }) : null
        if (selectedCustomer && !customer) throw new ForbiddenException('客户不存在、已停用或不在当前负责范围')
        // 同租户导入串行处理品牌及分类身份，防止重复导入并发创建同名实体。
        await tx.$queryRaw(Prisma.sql`SELECT id FROM brands WHERE tenant_id = ${actor.tenantId} ORDER BY id FOR UPDATE`)
        const brands = new Set<number>(), products = new Set<number>(), skus = new Set<number>(), rules = new Set<number>()
        const resolvedSkus = new Map<number, { row: number; signature: string }>()
        for (const row of rows) {
          currentRow = row.rowNumber
          const brand = await this.brand(tx, actor, row)
          const category = await this.category(tx, actor, row)
          brands.add(brand.id)
          let product
          if (row.productCode) {
            product = await tx.product.findUnique({ where: { tenantId_code: { tenantId: actor.tenantId, code: row.productCode } } })
            if (!product) throw new BadRequestException('商品编码不存在；新商品请留空编码，由系统自动分配')
            if (product.brandId !== brand.id || product.categoryId !== category.id) throw new BadRequestException('商品编码对应的品牌或分类不一致，请在商品管理中调整')
          } else {
            const matches = await tx.product.findMany({ where: { tenantId: actor.tenantId, brandId: brand.id, categoryId: category.id,
              status: { not: 'archived' }, OR: [{ subtitle: row.productName }, { subtitle: null, name: row.productName }] } })
            if (matches.length > 1) throw new BadRequestException('同品牌分类存在同名商品，请填写具体商品编码')
            product = matches[0]
          }
          if (product?.status === 'archived') throw new BadRequestException('商品已归档，不能通过导入恢复')
          if (product) {
            // 在读取规格前锁商品，与普通新建规格共用锁，自动编码不会重用或覆盖历史编号。
            await tx.$queryRaw(Prisma.sql`SELECT id FROM products WHERE id = ${product.id} FOR UPDATE`)
            await tx.product.update({ where: { id: product.id }, data: { name: `${brand.name}${category.name}`, subtitle: row.productName } })
          } else {
            this.access.require(actor, 'product:create')
            const identity = await this.products.allocateProductIdentity(tx, actor.tenantId, brand.id, category.id)
            product = await tx.product.create({ data: { tenantId: actor.tenantId, brandId: brand.id, categoryId: category.id,
              code: identity.code, name: identity.name, subtitle: row.productName, isFactoryProduct: false } })
          }
          products.add(product.id)
          const matches = await tx.productSku.findMany({ where: { tenantId: actor.tenantId, productId: product.id, specText: row.specText } })
          const matchingUnit = matches.filter(sku => sku.saleUnit === row.saleUnit)
          if (matchingUnit.length > 1) throw new BadRequestException('该商品有重复规格，请先在商品管理中核对')
          if (!matchingUnit.length && matches.length) throw new BadRequestException('已有规格的销售单位不一致，请通过规格管理修改')
          let sku = matchingUnit[0]
          const signature = JSON.stringify([product.id, row.productName, row.saleUnit, new Prisma.Decimal(row.basePrice).toFixed(2),
            row.minOrderQty ?? sku?.minOrderQty ?? 1, row.customerPrice === undefined ? null : new Prisma.Decimal(row.customerPrice).toFixed(2)])
          const previous = sku && resolvedSkus.get(sku.id)
          if (previous) {
            if (previous.signature !== signature) throw new BadRequestException(`与第${previous.row}行解析为同一规格，但价格或商品资料冲突`)
            skipped++
            continue
          }
          if (sku) {
            await tx.productSku.update({ where: { id: sku.id }, data: { basePrice: row.basePrice, ...(row.minOrderQty !== undefined ? { minOrderQty: row.minOrderQty } : {}) } })
          } else {
            const existing = await tx.productSku.findMany({ where: { productId: product.id }, select: { skuCode: true } })
            const codes = existing.map(item => item.skuCode)
            let skuCode = nextSkuCode(product.code, codes), attempts = 0
            while (await tx.productSku.findUnique({ where: { tenantId_skuCode: { tenantId: actor.tenantId, skuCode } }, select: { id: true } })) {
              if (++attempts > 100) throw new BadRequestException('规格编码无法分配，请核对历史规格')
              codes.push(skuCode); skuCode = nextSkuCode(product.code, codes)
            }
            sku = await tx.productSku.create({ data: { tenantId: actor.tenantId, productId: product.id, skuCode,
              specText: row.specText, saleUnit: row.saleUnit, basePrice: row.basePrice, minOrderQty: row.minOrderQty ?? 1 } })
          }
          resolvedSkus.set(sku.id, { row: row.rowNumber, signature })
          skus.add(sku.id)
          if (row.customerPrice !== undefined && customer) {
            const rule = await tx.customerPriceRule.upsert({ where: { tenantId_customerId_skuId: { tenantId: actor.tenantId, customerId: customer.id, skuId: sku.id } },
              update: { price: row.customerPrice, status: 'active' }, create: { tenantId: actor.tenantId, brandId: brand.id, productId: product.id,
                customerId: customer.id, skuId: sku.id, priceType: 'agreement', price: row.customerPrice, status: 'active' } })
            rules.add(rule.id)
          }
        }
        const result = { brandCount: brands.size, productCount: products.size, skuCount: skus.size, priceRuleCount: rules.size, skipped }
        await tx.auditLog.create({ data: { tenantId: actor.tenantId, operatorId: actor.id, action: 'update', module: 'product',
          targetType: 'product_import', requestId: randomUUID(), afterData: { ...result, productIds: [...products], skuIds: [...skus] } } })
        return result
      }, { isolationLevel: Prisma.TransactionIsolationLevel.ReadCommitted, timeout: 30000 })
    } catch (error) {
      if (error instanceof HttpException) {
        const response = error.getResponse(), message = typeof response === 'string' ? response : (response as { message?: string }).message || '此行数据不可导入'
        const body = { message: `第${currentRow}行：${message}；本次导入未写入任何数据`, errorCode: 'IMP_1003', errors: [{ row: currentRow, message }] }
        if (error instanceof ForbiddenException) throw new ForbiddenException(body)
        throw new BadRequestException(body)
      }
      throw new BadRequestException({ message: '导入未完成，本次数据已回滚；请核对重复编码或减少行数后重试', errorCode: 'IMP_1003', errors: [{ row: currentRow, message: '数据库写入未完成' }] })
    }
  }

  private async brand(tx: Prisma.TransactionClient, actor: StaffActor, row: Row) {
    let brand = row.brandCode ? await tx.brand.findUnique({ where: { tenantId_code: { tenantId: actor.tenantId, code: row.brandCode } } }) : null
    const matches = await tx.brand.findMany({ where: { tenantId: actor.tenantId, name: row.brand } })
    if (brand && brand.name !== row.brand) throw new BadRequestException('品牌名称与编码不一致')
    if (!brand && matches.length) {
      if (matches.length > 1 || (row.brandCode && matches[0].code !== row.brandCode)) throw new BadRequestException('品牌名称与编码不明确，请核对品牌管理')
      brand = matches[0]
    }
    if (!brand) {
      if (!actor.superAdmin) throw new ForbiddenException('品牌不在当前授权范围；新建品牌请联系租户管理员')
      this.access.require(actor, 'brand:manage')
      const code = row.brandCode || toBrandPrefix(row.brand)
      if (!code || code.length > 64 || !isValidBrandPrefix(code)) throw new BadRequestException('品牌无法自动编码，请先在品牌管理中创建')
      brand = await tx.brand.create({ data: { tenantId: actor.tenantId, name: row.brand, code } })
    }
    if (brand.status !== 'active') throw new BadRequestException('品牌已停用，不能通过导入恢复')
    if (!actor.superAdmin && !actor.brandIds.includes(brand.id)) throw new ForbiddenException('品牌不在当前授权范围')
    return brand
  }

  private async category(tx: Prisma.TransactionClient, actor: StaffActor, row: Row) {
    const matches = await tx.productCategory.findMany({ where: { tenantId: actor.tenantId, OR: [{ name: row.category }, { code: row.category }] } })
    if (matches.length > 1) throw new BadRequestException('分类名称与编码不明确，请先核对分类管理')
    let category = matches[0]
    if (!category) {
      if (row.category.length > 64) throw new BadRequestException('新分类名称过长，请先在分类管理中创建')
      category = await tx.productCategory.create({ data: { tenantId: actor.tenantId, name: row.category, code: row.category } })
    }
    if (category.status !== 'active') throw new BadRequestException('分类已停用，不能通过导入恢复')
    return category
  }

  private invalidRows(errors: RowError[]): never {
    throw new BadRequestException({ message: `导入校验失败，第${errors[0].row}行：${errors[0].message}；未写入数据`, errorCode: 'IMP_1002',
      errors: errors.slice(0, MAX_ERRORS), errorCount: errors.length })
  }

  private assertArchiveSize(buffer: Buffer) {
    const invalid = () => { throw new BadRequestException('Excel压缩格式无效或展开内容过大，请使用普通xlsx并拆分文件') }
    if (buffer.length < 22 || buffer.readUInt32LE(0) !== 0x04034b50) invalid()
    let end = -1
    for (let offset = buffer.length - 22; offset >= Math.max(0, buffer.length - 65557); offset--) {
      if (buffer.readUInt32LE(offset) === 0x06054b50 && offset + 22 + buffer.readUInt16LE(offset + 20) === buffer.length) { end = offset; break }
    }
    if (end < 0) invalid()
    const entries = buffer.readUInt16LE(end + 10), directorySize = buffer.readUInt32LE(end + 12)
    let cursor = buffer.readUInt32LE(end + 16), expanded = 0
    const directoryStart = cursor
    if (!entries || entries > 256 || cursor + directorySize !== end || buffer.readUInt16LE(end + 4) || buffer.readUInt16LE(end + 6)) invalid()
    for (let index = 0; index < entries; index++) {
      if (cursor + 46 > end || buffer.readUInt32LE(cursor) !== 0x02014b50) invalid()
      const declaredSize = buffer.readUInt32LE(cursor + 24), compressedSize = buffer.readUInt32LE(cursor + 20)
      const method = buffer.readUInt16LE(cursor + 10), local = buffer.readUInt32LE(cursor + 42)
      if (expanded + declaredSize > 20 * 1024 * 1024 || (buffer.readUInt16LE(cursor + 8) & 1) || ![0, 8].includes(method) ||
        local + 30 > directoryStart || buffer.readUInt32LE(local) !== 0x04034b50) invalid()
      const dataStart = local + 30 + buffer.readUInt16LE(local + 26) + buffer.readUInt16LE(local + 28)
      if (dataStart + compressedSize > directoryStart) invalid()
      let actualSize = 0
      try {
        actualSize = method === 0 ? compressedSize : inflateRawSync(buffer.subarray(dataStart, dataStart + compressedSize), { maxOutputLength: Math.max(1, 20 * 1024 * 1024 - expanded) }).length
      } catch { invalid() }
      if (actualSize !== declaredSize || expanded + actualSize > 20 * 1024 * 1024) invalid()
      expanded += actualSize
      cursor += 46 + buffer.readUInt16LE(cursor + 28) + buffer.readUInt16LE(cursor + 30) + buffer.readUInt16LE(cursor + 32)
      if (cursor > end) invalid()
    }
    if (cursor !== directoryStart + directorySize) invalid()
  }

  private async parseRows(buffer: Buffer): Promise<Row[]> {
    if (!buffer?.length || buffer.length > MAX_BYTES) throw new BadRequestException('请上传不超过5MB的xlsx文件')
    this.assertArchiveSize(buffer)
    const workbook = new Workbook()
    try { await workbook.xlsx.load(buffer as any) } catch { throw new BadRequestException('Excel格式无法读取，请上传有效xlsx文件') }
    const sheet = workbook.worksheets[0]
    if (!sheet) throw new BadRequestException('Excel中没有工作表')
    if (sheet.rowCount > MAX_ROWS + 1 || sheet.columnCount > 30) throw new BadRequestException(`一次最多导入${MAX_ROWS}行、30列，请拆分文件`)
    const headers = new Map<string, number>()
    sheet.getRow(1).eachCell((cell, index) => {
      if (typeof cell.value !== 'string' || !cell.value.trim()) return
      const name = cell.value.trim()
      if (headers.has(name)) throw new BadRequestException('表头重复，每个字段只可保留一列')
      headers.set(name, index)
    })
    const col = (aliases: string[]) => {
      const matches = aliases.map(name => headers.get(name)).filter(index => index !== undefined)
      if (matches.length > 1) throw new BadRequestException('表头包含同一字段的多个别名，请仅保留一列')
      return matches[0] || 0
    }
    const fields = {
      brand: col(['品牌', 'brand']), brandCode: col(['品牌编码', 'brandCode', 'brand_code']), category: col(['分类', 'category']),
      productName: col(['商品名称', '名称', 'name']), productCode: col(['商品编码', '编码', 'code']), specText: col(['规格', 'spec', 'specText']),
      saleUnit: col(['单位', 'unit', 'saleUnit']), basePrice: col(['基础价', '价格', 'basePrice']), minOrderQty: col(['起订量', 'minOrderQty']),
      stockNum: col(['库存', 'stock', 'stockNum']), customerPrice: col(['协议价', '客户价', 'customerPrice'])
    }
    const required: Array<[keyof typeof fields, string]> = [['brand', '品牌'], ['category', '分类'], ['productName', '商品名称'], ['specText', '规格'], ['basePrice', '基础价']]
    const missing = required.filter(([key]) => !fields[key]).map(([, label]) => label)
    if (missing.length) throw new BadRequestException(`缺少表头：${missing.join('、')}`)
    const rows: Row[] = [], errors: RowError[] = []
    sheet.eachRow((source, rowNumber) => {
      if (rowNumber === 1) return
      const get = (field: keyof typeof fields) => {
        const value = fields[field] ? source.getCell(fields[field]).value : null
        if (value == null) return ''
        if (typeof value !== 'string' && typeof value !== 'number') throw Error('不支持公式、日期或复合单元格，请粘贴为纯文本/数值')
        return String(value).trim()
      }
      try {
        if (!Object.keys(fields).some(key => get(key as keyof typeof fields))) return
        const row: Row = { rowNumber, brand: get('brand'), brandCode: get('brandCode').toUpperCase() || undefined,
          category: get('category'), productName: get('productName'), productCode: get('productCode') || undefined,
          specText: get('specText'), saleUnit: get('saleUnit') || '件', basePrice: get('basePrice'),
          minOrderQty: get('minOrderQty') ? Number(get('minOrderQty')) : undefined,
          stockNum: get('stockNum') ? Number(get('stockNum')) : undefined, customerPrice: get('customerPrice') || undefined }
        for (const [key, label, max] of [['brand', '品牌', 100], ['category', '分类', 100], ['productName', '商品名称', 255], ['specText', '规格', 255], ['saleUnit', '单位', 50]] as const) {
          if (!row[key] || row[key].length > max) throw Error(`${label}不能为空且最多${max}字`)
        }
        if ((row.brandCode && (!isValidBrandPrefix(row.brandCode) || row.brandCode.length > 64)) || (row.productCode && row.productCode.length > 64)) throw Error('品牌或商品编码格式不正确')
        if (!money.test(row.basePrice) || (row.customerPrice !== undefined && !money.test(row.customerPrice))) throw Error('价格须为非负金额，最多两位小数')
        if (row.minOrderQty !== undefined && (!Number.isSafeInteger(row.minOrderQty) || row.minOrderQty < 1 || row.minOrderQty > 2147483647)) throw Error('起订量须为1至2147483647的整数')
        if (row.stockNum !== undefined && row.stockNum !== 0) throw Error('库存列仅可为空或0；实际库存请通过库存管理出入库录入')
        rows.push(row)
      } catch (error) { errors.push({ row: rowNumber, message: (error as Error).message }) }
    })
    if (errors.length) this.invalidRows(errors)
    if (!rows.length) throw new BadRequestException('未解析到有效数据')
    return rows
  }
}
