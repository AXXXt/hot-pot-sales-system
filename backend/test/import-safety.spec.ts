import { BadRequestException, ForbiddenException } from '@nestjs/common'
import { Workbook } from 'exceljs'
import { ImportService } from '../src/import/import.service'
import { StaffAccessService } from '../src/auth/staff-access.service'
import { ImportErrorFilter } from '../src/import/import-error.filter'

const actor = { id: 7, tenantId: 9, superAdmin: true, brandIds: [], customerIds: null, permissions: new Set<string>() } as any
const header = ['品牌', '品牌编码', '分类', '商品名称', '商品编码', '规格', '单位', '基础价', '起订量', '库存', '协议价']
const good = ['品牌甲', 'BRANDA', '丸滑', '爆汁牛筋丸', 'OLD-001', '500克/袋', '袋', '19.90', 1, '', '']
async function excel(rows: unknown[][] = [good], columns = header) {
  const workbook = new Workbook(), sheet = workbook.addWorksheet('商品')
  sheet.addRow(columns); for (const row of rows) sheet.addRow(row)
  return Buffer.from(await workbook.xlsx.writeBuffer())
}
function fixture() {
  const brand = { id: 3, tenantId: 9, name: '品牌甲', code: 'BRANDA', status: 'active' }
  const category = { id: 4, tenantId: 9, name: '丸滑', code: '丸滑', status: 'active' }
  const product = { id: 5, tenantId: 9, brandId: 3, categoryId: 4, code: 'OLD-001', name: '品牌甲丸滑', subtitle: '爆汁牛筋丸', status: 'active' }
  const sku = { id: 6, tenantId: 9, productId: 5, skuCode: 'OLD-001-01', specText: '500克/袋', saleUnit: '袋', stockNum: 8, reservedNum: 2, basePrice: '19.9', minOrderQty: 1, status: 'active' }
  const methods = (value: any) => ({ findFirst: jest.fn().mockResolvedValue(value), findUnique: jest.fn().mockResolvedValue(value), findMany: jest.fn().mockResolvedValue(value ? [value] : []), create: jest.fn().mockResolvedValue(value), update: jest.fn().mockResolvedValue(value), upsert: jest.fn().mockResolvedValue(value) })
  const prisma: any = { brand: methods(brand), productCategory: methods(category), product: methods(product), productSku: methods(sku), customer: methods(null), customerPriceRule: methods(null), auditLog: methods({ id: 1 }), $queryRaw: jest.fn().mockResolvedValue([]) }
  prisma.$transaction = jest.fn((callback: any) => callback(prisma))
  const service = new (ImportService as any)(prisma, { allocateProductIdentity: jest.fn() }, new StaffAccessService({} as any)) as ImportService
  const writes = () => ['brand', 'productCategory', 'product', 'productSku', 'customerPriceRule'].flatMap(model => ['create', 'update', 'upsert'].flatMap(method => prisma[model][method].mock.calls))
  return { prisma, service, writes, sku }
}

describe('product Excel import boundaries', () => {
  it('downloads a standard empty XLSX whose headers parse correctly after filling a real row', async () => {
    const f = fixture(), workbook = new Workbook()
    const buffer = await f.service.productTemplate(actor)
    await workbook.xlsx.load(buffer as any)
    expect(workbook.worksheets.map(sheet => sheet.name)).toEqual(['商品导入', '填写说明'])
    const sheet = workbook.worksheets[0]
    expect(sheet.rowCount).toBe(1)
    expect(sheet.getRow(1).values).toEqual([undefined, ...header])
    sheet.addRow(good)
    const rows = await (f.service as any).parseRows(Buffer.from(await workbook.xlsx.writeBuffer()))
    expect(rows).toHaveLength(1); expect(rows[0]).toMatchObject({ productName: '爆汁牛筋丸', basePrice: '19.90' })
    expect(f.writes()).toHaveLength(0)
  })

  it('imports an agreement for an exact authorized customer id without using an ambiguous phone match', async () => {
    const f = fixture(), row = [...good]; row[10] = '16.80'
    f.prisma.customer.findFirst.mockResolvedValue({ id: 77 }); f.prisma.customerPriceRule.upsert.mockResolvedValue({ id: 8 })
    const scopedActor = { ...actor, customerIds: [77] }
    const result = await f.service.importProducts(await excel([row]), scopedActor, undefined, 77)
    expect(result.priceRuleCount).toBe(1)
    expect(f.prisma.customer.findFirst).toHaveBeenCalledWith({ where: { tenantId: 9, status: 'active', id: 77, AND: [{ id: { in: [77] } }] }, select: { id: true } })
    expect(f.prisma.customerPriceRule.upsert.mock.calls[0][0].create.customerId).toBe(77)
  })

  it('rejects absent/out-of-scope selected customers and conflicting identifiers without creating an agreement', async () => {
    const f = fixture(), row = [...good]; row[10] = '16.80'
    const buffer = await excel([row])
    await expect(f.service.importProducts(buffer, actor, undefined, 99)).rejects.toBeInstanceOf(ForbiddenException)
    expect(f.writes()).toHaveLength(0)
    await expect(f.service.importProducts(buffer, actor, '13000000000', 99)).rejects.toThrow('一种客户标识')
    await expect(f.service.importProducts(buffer, actor, undefined, -1)).rejects.toThrow('客户ID')
  })

  it('requires price/product permissions to download a template and customer permission for targeted agreement import', async () => {
    const f = fixture(), restricted = { ...actor, superAdmin: false, permissions: new Set(['product:update', 'product:price:update']) }
    await expect(f.service.productTemplate({ ...restricted, permissions: new Set(['product:update']) })).rejects.toBeInstanceOf(ForbiddenException)
    const row = [...good]; row[10] = '16.80'
    await expect(f.service.importProducts(await excel([row]), restricted, undefined, 77)).rejects.toBeInstanceOf(ForbiddenException)
    expect(f.writes()).toHaveLength(0)
  })

  it('uses actual one-based header columns and preserves zero prices', async () => {
    const { service } = fixture()
    const rows = await (service as any).parseRows(await excel([[...good.slice(0, 7), 0, 1, '', '']]))
    expect(rows[0]).toMatchObject({ brand: '品牌甲', brandCode: 'BRANDA', category: '丸滑', productName: '爆汁牛筋丸', productCode: 'OLD-001', specText: '500克/袋', saleUnit: '袋', basePrice: '0' })
  })

  it('rejects a missing required header with a useful error before database writes', async () => {
    const f = fixture()
    await expect(f.service.importProducts(await excel([good], header.map(x => x === '规格' ? '错误表头' : x)), actor)).rejects.toThrow('缺少表头')
    expect(f.writes()).toHaveLength(0)
  })

  it('validates every input row and reports the invalid row rather than silently skipping it', async () => {
    const f = fixture(), bad = [...good]; bad[3] = ''
    try { await f.service.importProducts(await excel([good, bad]), actor); throw Error('Unexpected success') }
    catch (error) {
      expect(error).toBeInstanceOf(BadRequestException)
      expect((error as BadRequestException).getResponse()).toMatchObject({ errors: expect.arrayContaining([expect.objectContaining({ row: 3 })]) })
    }
    expect(f.writes()).toHaveLength(0)
  })

  it('does not overwrite an existing SKU stock, reservations, status or historical codes', async () => {
    const f = fixture()
    await f.service.importProducts(await excel(), actor)
    const skuUpdates = [...f.prisma.productSku.update.mock.calls.map((x: any) => x[0].data), ...f.prisma.productSku.upsert.mock.calls.map((x: any) => x[0].update)]
    expect(skuUpdates.length).toBeGreaterThan(0)
    for (const data of skuUpdates) for (const field of ['stockNum', 'reservedNum', 'skuCode', 'status']) expect(data).not.toHaveProperty(field)
    expect(f.prisma.$transaction).toHaveBeenCalled()
  })

  it('rejects nonzero stock columns before writing any row', async () => {
    const f = fixture(), row = [...good]; row[9] = 8
    await expect(f.service.importProducts(await excel([row]), actor)).rejects.toBeInstanceOf(BadRequestException)
    expect(f.writes()).toHaveLength(0)
  })

  it('requires the normal product price permission and rejects unassigned brands', async () => {
    const f = fixture(), restricted = { ...actor, superAdmin: false, brandIds: [99], permissions: new Set(['product:update']) }
    await expect(f.service.importProducts(await excel(), restricted)).rejects.toBeInstanceOf(ForbiddenException)
    restricted.permissions.add('product:price:update')
    await expect(f.service.importProducts(await excel(), restricted)).rejects.toBeInstanceOf(ForbiddenException)
    expect(f.writes()).toHaveLength(0)
  })

  it('deduplicates identical rows while rejecting conflicting data for the same SKU', async () => {
    const f = fixture()
    const result = await f.service.importProducts(await excel([good, good]), actor)
    expect(result.skipped).toBe(1)
    const g = fixture(), conflict = [...good]; conflict[7] = '0.01'
    await expect(g.service.importProducts(await excel([good, conflict]), actor)).rejects.toBeInstanceOf(BadRequestException)
    expect(g.writes()).toHaveLength(0)
  })

  it('rejects unsupported archives, oversized decompression, excessive rows and formula cells before writes', async () => {
    const f = fixture(), oversized = await excel()
    const central = oversized.indexOf(Buffer.from([0x50, 0x4b, 0x01, 0x02]))
    expect(central).toBeGreaterThan(0)
    oversized.writeUInt32LE(25 * 1024 * 1024, central + 24)
    for (const buffer of [Buffer.from('not an Excel workbook'), oversized, await excel(Array.from({ length: 501 }, () => good))]) {
      await expect(f.service.importProducts(buffer, actor)).rejects.toBeInstanceOf(BadRequestException)
    }
    const formula = [...good] as unknown[]; formula[7] = { formula: '1+1', result: 2 }
    await expect(f.service.importProducts(await excel([formula]), actor)).rejects.toBeInstanceOf(BadRequestException)
    expect(f.writes()).toHaveLength(0)
  })

  it('rejects duplicate header aliases and preserves an omitted minimum for an existing SKU', async () => {
    const f = fixture()
    await expect(f.service.importProducts(await excel([good], [...header, '名称']), actor)).rejects.toBeInstanceOf(BadRequestException)
    const row = [...good]; row[8] = ''; f.sku.minOrderQty = 3
    await f.service.importProducts(await excel([row]), actor)
    expect(f.prisma.productSku.update).toHaveBeenCalledWith({ where: { id: 6 }, data: { basePrice: '19.90' } })
  })

  it('returns bounded import row errors through the local HTTP filter without exposing arbitrary exception data', () => {
    const reply: any = { status: jest.fn(() => reply), json: jest.fn() }
    const host: any = { switchToHttp: () => ({ getRequest: () => ({ requestId: 'fixture-request' }), getResponse: () => reply }) }
    new ImportErrorFilter().catch(new BadRequestException({ message: '导入校验失败', errorCode: 'IMP_1002', errorCount: 30,
      errors: Array.from({ length: 30 }, (_, i) => ({ row: i + 2, message: '价格格式无效', privateValue: 'must-not-leak' })), privateValue: 'must-not-leak' }), host)
    expect(reply.json.mock.calls[0][0].data.errors).toHaveLength(20)
    expect(reply.json.mock.calls[0][0].data.errorCount).toBe(30)
    expect(JSON.stringify(reply.json.mock.calls[0][0])).not.toContain('must-not-leak')
  })

  it('does not let later specifications silently rename the same coded product in one workbook', async () => {
    const f = fixture(), next = [...good]; next[3] = '冲突名称'; next[5] = '另一个规格'
    await expect(f.service.importProducts(await excel([good, next]), actor)).rejects.toBeInstanceOf(BadRequestException)
    expect(f.writes()).toHaveLength(0)
  })

  it('rejects conflicting data for the same resolved SKU when category name/code aliases are used', async () => {
    const f = fixture(), first = [...good], second = [...good]
    first[4] = ''; second[4] = ''; second[2] = 'CAT'; second[7] = '1.00'
    f.prisma.productCategory.findMany.mockResolvedValue([{ id: 4, tenantId: 9, name: '丸滑', code: 'CAT', status: 'active' }])
    await expect(f.service.importProducts(await excel([first, second]), actor)).rejects.toBeInstanceOf(BadRequestException)
    const same = fixture(); second[7] = '19.9'
    same.prisma.productCategory.findMany.mockResolvedValue([{ id: 4, tenantId: 9, name: '丸滑', code: 'CAT', status: 'active' }])
    expect((await same.service.importProducts(await excel([first, second]), actor)).skipped).toBe(1)
    expect(same.prisma.productSku.update).toHaveBeenCalledTimes(1)
  })
})
