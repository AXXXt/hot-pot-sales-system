import { randomUUID } from 'node:crypto'
import { Workbook } from 'exceljs'
import { PrismaClient } from '@prisma/client'
import { ImportService } from '../src/import/import.service'
import { ExportService } from '../src/export/export.service'
import { ProductService } from '../src/product/product.service'
import { PrismaService } from '../src/prisma.service'
import { StaffAccessService, StaffActor } from '../src/auth/staff-access.service'

const target = new URL(process.env.TEST_DATABASE_URL || 'invalid://missing')
if (target.protocol !== 'mysql:' || !['127.0.0.1', 'localhost', '[::1]'].includes(target.hostname) || !target.pathname.endsWith('_test')) throw Error('Loopback mysql *_test database required')
const db = new PrismaClient({ datasources: { db: { url: process.env.TEST_DATABASE_URL } } }), tenants: number[] = []
let actor: StaffActor, imports: ImportService, exportService: ExportService, productId: number, brandId: number, customerId: number
const headers = ['品牌', '品牌编码', '分类', '商品名称', '商品编码', '规格', '单位', '基础价', '起订量', '库存', '协议价']
const input = (index: number, price = '19.90') => ['导入验收品牌', 'LOCALIMP', '导入验收分类', '导入验收真实名称', 'LOCALIMP-001', `${index}克/袋`, '袋', price, 2, '', '']
async function excel(rows: unknown[][]) {
  const workbook = new Workbook(), sheet = workbook.addWorksheet('商品')
  sheet.addRow(headers); rows.forEach(row => sheet.addRow(row))
  return Buffer.from(await workbook.xlsx.writeBuffer())
}
async function load(buffer: unknown) {
  const workbook = new Workbook(); await workbook.xlsx.load(buffer as any); return workbook.worksheets[0]
}

beforeAll(async () => {
  for (let i = 0; i < 2; i++) tenants.push((await db.tenant.create({ data: { code: randomUUID(), name: 'Local import/export maximum fixture' } })).id)
  const tenantId = tenants[0]
  const user = await db.user.create({ data: { tenantId, phone: randomUUID().slice(0, 20), name: 'Local importer', userType: 'super_admin' } })
  brandId = (await db.brand.create({ data: { tenantId, code: 'LOCALIMP', name: '导入验收品牌' } })).id
  const categoryId = (await db.productCategory.create({ data: { tenantId, code: 'LOCALIMP', name: '导入验收分类' } })).id
  productId = (await db.product.create({ data: { tenantId, brandId, categoryId, name: '管理标签', subtitle: '导入验收真实名称', code: 'LOCALIMP-001' } })).id
  await db.productSku.createMany({ data: Array.from({ length: 500 }, (_, index) => ({ tenantId, productId, skuCode: `LOCALIMP-001-${index + 1}`, specText: `${index}克/袋`, saleUnit: '袋', basePrice: '1', minOrderQty: 1, stockNum: 8, reservedNum: 2 })) })
  customerId = (await db.customer.create({ data: { tenantId, customerName: '=SUM(1,1)', contactPhone: '13000000001', contactName: '验收甲' } })).id
  await db.customer.create({ data: { tenantId, customerName: '排除禁用客户', contactPhone: '13000000002', status: 'disabled' } })
  const foreign = await db.customer.create({ data: { tenantId: tenants[1], customerName: '外租户验收甲', contactPhone: '13000000003', contactName: '验收甲' } })
  const foreignBrand = await db.brand.create({ data: { tenantId: tenants[1], code: 'LOCALIMP', name: '外租户品牌' } })
  const base = { tenantId, customerId, brandId, totalAmount: '19.90', payableAmount: '18.90', paymentMethod: 'transfer' }
  for (const [index, status] of ['pending_quote', 'shipped'].entries()) await db.order.create({ data: { ...base, orderNo: `LOCAL-EXPORT-${randomUUID()}`, status: status as 'pending_quote' | 'shipped', createdAt: new Date(`2026-01-0${index + 1}T00:00:00Z`) } })
  await db.order.create({ data: { ...base, tenantId: tenants[1], customerId: foreign.id, brandId: foreignBrand.id, orderNo: `LOCAL-EXPORT-${randomUUID()}`, status: 'pending_quote' } })
  const prisma = db as unknown as PrismaService, access = new StaffAccessService(prisma)
  actor = await access.actor(user.id)
  // Existing products only: allocation dependencies cannot be invoked by these import fixtures.
  imports = new ImportService(prisma, new ProductService(prisma, {} as any, {} as any, {} as any), access)
  exportService = new ExportService(prisma)
}, 60000)

afterAll(async () => {
  if (tenants.length) {
    const where = { tenantId: { in: tenants } }
    for (const model of ['auditLog', 'orderItem', 'order', 'customer', 'user', 'productSku', 'product', 'productCategory', 'brand'] as const) await (db[model] as any).deleteMany({ where })
    await db.tenant.deleteMany({ where: { id: { in: tenants } } })
  }
  await db.$disconnect()
})

it('imports exactly 500 distinct rows through the real XLSX parser and SQL transaction without altering stock or historical codes', async () => {
  const bytes = await excel(Array.from({ length: 500 }, (_, index) => input(index)))
  const result = await imports.importProducts(bytes, actor)
  expect(result).toMatchObject({ productCount: 1, skuCount: 500, skipped: 0 })
  const rows = await db.productSku.findMany({ where: { tenantId: tenants[0], productId }, orderBy: { id: 'asc' } })
  expect(rows).toHaveLength(500)
  expect(rows.every((sku, index) => sku.basePrice.toFixed(2) === '19.90' && sku.minOrderQty === 2 && sku.stockNum === 8 && sku.reservedNum === 2 && sku.skuCode === `LOCALIMP-001-${index + 1}`)).toBe(true)
}, 60000)

it('rejects 501 import rows before any update and exportService every one of 500 active inventory rows', async () => {
  const before = await db.productSku.findFirstOrThrow({ where: { tenantId: tenants[0], productId }, orderBy: { id: 'asc' } })
  await expect(imports.importProducts(await excel(Array.from({ length: 501 }, (_, index) => input(index, '0.01'))), actor)).rejects.toThrow('500')
  const after = await db.productSku.findUniqueOrThrow({ where: { id: before.id } })
  expect(after.basePrice.toString()).toBe(before.basePrice.toString())
  const sheet = await load(await exportService.exportInventory({ tenantId: tenants[0] }))
  expect(sheet.rowCount).toBe(501)
  expect(sheet.getRow(501).getCell(3).value).toBe('导入验收真实名称')
  expect(new Set(sheet.getRows(2, 500)!.map(row => row.getCell(4).value)).size).toBe(500)
})

it('combines order/customer filters with tenant scope and writes formula-like customer names as literal XLSX text', async () => {
  const orders = await load(await exportService.exportOrders({ status: 'pending_quote', customerId }, { tenantId: tenants[0] }))
  expect(orders.rowCount).toBe(2)
  expect(orders.getRow(2).getCell(2).value).toBe('=SUM(1,1)')
  expect(orders.getRow(2).getCell(3).value).toBe('待报价')
  expect(orders.getRow(2).getCell(5).value).toBe(19.9)
  expect(orders.getRow(2).getCell(6).value).toBe(18.9)
  expect(orders.getRow(2).getCell(8).value).toBe('2026-01-01 08:00:00')
  const customers = await load(await exportService.exportCustomers({ keyword: '验收甲', status: 'active' }, { tenantId: tenants[0] }))
  expect(customers.rowCount).toBe(2)
  expect(customers.getRow(2).getCell(1).value).toBe('=SUM(1,1)')
  expect(typeof customers.getRow(2).getCell(1).value).toBe('string')
})
