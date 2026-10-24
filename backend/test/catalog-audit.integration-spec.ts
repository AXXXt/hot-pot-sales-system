import { randomUUID } from 'node:crypto'
import { PrismaClient } from '@prisma/client'
import { PrismaService } from '../src/prisma.service'
import { BrandService } from '../src/brand/brand.service'
import { ProductService } from '../src/product/product.service'
import { StaffAccessService, StaffActor } from '../src/auth/staff-access.service'

const url = process.env.TEST_DATABASE_URL
if (!url) throw new Error('Isolated loopback TEST_DATABASE_URL ending in _test required')
const target = new URL(url)
if (target.protocol !== 'mysql:' || !['localhost', '127.0.0.1', '[::1]'].includes(target.hostname) || !target.pathname.endsWith('_test') || target.search) throw new Error('Isolated loopback TEST_DATABASE_URL ending in _test required')
const db = new PrismaClient({ datasources: { db: { url } } })
let tenantId = -1, adminId: number, brandId: number, categoryId: number, productId: number, skuId: number, actor: StaffActor
let brands: BrandService, products: ProductService
function productService(prisma: any = db) { return new ProductService(prisma, {} as any, {} as any, { write: async () => {} } as any) }
function brokenAudit() {
  return new Proxy(db, { get(original, key) {
    if (key !== '$transaction') return Reflect.get(original, key)
    return (run: any) => db.$transaction(tx => run(new Proxy(tx, { get(client, property) {
      return property === 'auditLog' ? { create: async () => { throw new Error('injected catalog audit failure') } } : Reflect.get(client, property)
    } })))
  } }) as unknown as PrismaService
}
beforeAll(async () => {
  tenantId = (await db.tenant.create({ data: { code: randomUUID(), name: 'Isolated catalog audit' } })).id
  adminId = (await db.user.create({ data: { tenantId, userType: 'super_admin', phone: 'ca-' + randomUUID().slice(0, 15), name: 'Audit operator' } })).id
  actor = await new StaffAccessService(db as unknown as PrismaService).actor(adminId)
  brandId = (await db.brand.create({ data: { tenantId, code: 'AUDIT', name: '原品牌' } })).id
  categoryId = (await db.productCategory.create({ data: { tenantId, code: 'AUDIT', name: '原分类' } })).id
  productId = (await db.product.create({ data: { tenantId, brandId, categoryId, code: 'AUDIT-001', name: '原品牌原分类', subtitle: '真实商品名' } })).id
  skuId = (await db.productSku.create({ data: { tenantId, productId, skuCode: 'AUDIT-001-01', specText: '500克/袋', saleUnit: '袋', basePrice: '19.90', minOrderQty: 1, stockNum: 22, reservedNum: 3 } })).id
  brands = new BrandService(db as unknown as PrismaService); products = productService()
})
beforeEach(async () => {
  await db.auditLog.deleteMany({ where: { tenantId } }); await db.stockBatch.deleteMany({ where: { tenantId } })
  await db.brand.update({ where: { id: brandId }, data: { name: '原品牌', status: 'active' } })
  await db.productCategory.update({ where: { id: categoryId }, data: { name: '原分类', status: 'active' } })
  await db.product.update({ where: { id: productId }, data: { name: '原品牌原分类' } })
  await db.productSku.update({ where: { id: skuId }, data: { status: 'active', basePrice: '19.90', batchTracking: false } })
})
afterAll(async () => {
  if (tenantId > 0) {
    for (const model of ['auditLog', 'stockBatch', 'productSku', 'product', 'productCategory', 'brand', 'user'] as const) await (db[model] as any).deleteMany({ where: { tenantId } })
    await db.tenant.delete({ where: { id: tenantId } })
  }
  await db.$disconnect()
})

it('audits brand create/edit/physical-delete with actual tenant/operator and preserves cascade label changes', async () => {
  const created = await brands.create(tenantId, { name: '临时品牌', code: 'TEMP' }, actor)
  await brands.delete(tenantId, created.id, actor)
  await brands.update(tenantId, brandId, { name: '新品牌', logoUrl: null, sortOrder: 9 }, actor)
  const rows = await db.auditLog.findMany({ where: { tenantId }, orderBy: { id: 'asc' } })
  expect(rows.map(x => x.action)).toEqual(['create', 'delete', 'update'])
  expect(rows.every(x => x.operatorId === adminId && x.tenantId === tenantId && x.targetType === 'brand')).toBe(true)
  expect(rows[2].beforeData).toMatchObject({ name: '原品牌' }); expect(rows[2].afterData).toMatchObject({ name: '新品牌', logoUrl: null, sortOrder: 9 })
  expect((await db.product.findUniqueOrThrow({ where: { id: productId } })).name).toBe('新品牌原分类')
})

it('audits category create/edit/disable/restore without losing the product real name or code', async () => {
  const extra = await products.createCategory({ name: '临时分类', code: 'TEMP' }, tenantId, adminId)
  await products.deleteCategory(extra.id, tenantId, adminId)
  await products.updateCategory(categoryId, { name: '新分类', sortOrder: 7 }, tenantId, adminId)
  await products.deleteCategory(categoryId, tenantId, adminId); await products.restoreCategory(categoryId, tenantId, adminId)
  const rows = await db.auditLog.findMany({ where: { tenantId, targetType: 'product_category' }, orderBy: { id: 'asc' } })
  expect(rows).toHaveLength(5); expect(rows.every(x => x.operatorId === adminId)).toBe(true)
  expect(rows[2].beforeData).toMatchObject({ name: '原分类' }); expect(rows[2].afterData).toMatchObject({ name: '新分类', sortOrder: 7 })
  expect((await db.product.findUniqueOrThrow({ where: { id: productId } }))).toMatchObject({ name: '原品牌新分类', subtitle: '真实商品名', code: 'AUDIT-001' })
})

it('audits SKU create/edit/state while preserving stock and recording a real operator', async () => {
  const copied = await products.createSku(productId, { specText: '200克/袋', saleUnit: '袋', basePrice: '9.9', minOrderQty: 1 }, adminId)
  await products.updateSku(skuId, { basePrice: '20.90', batchTracking: true }, adminId)
  await products.updateSkuStatus(skuId, 'disabled', adminId); await products.updateSkuStatus(skuId, 'active', adminId)
  const rows = await db.auditLog.findMany({ where: { tenantId, targetType: 'product_sku' }, orderBy: { id: 'asc' } })
  expect(rows).toHaveLength(4); expect(rows.every(x => x.operatorId === adminId)).toBe(true)
  expect(rows[0].afterData).toMatchObject({ id: copied.id, stockNum: 0, reservedNum: 0 })
  expect(rows[1].beforeData).toMatchObject({ basePrice: '19.9', batchTracking: false }); expect(rows[1].afterData).toMatchObject({ basePrice: '20.9', batchTracking: true })
  expect((await db.productSku.findUniqueOrThrow({ where: { id: skuId } }))).toMatchObject({ stockNum: 22, reservedNum: 3 })
})

it('rolls back brand/category propagated labels and SKU legacy batches on audit failure', async () => {
  await expect(new BrandService(brokenAudit()).update(tenantId, brandId, { name: '不可提交品牌' }, actor)).rejects.toThrow('injected catalog audit failure')
  await expect(productService(brokenAudit()).updateCategory(categoryId, { name: '不可提交分类' }, tenantId, adminId)).rejects.toThrow('injected catalog audit failure')
  await expect(productService(brokenAudit()).updateSku(skuId, { batchTracking: true }, adminId)).rejects.toThrow('injected catalog audit failure')
  expect((await db.brand.findUniqueOrThrow({ where: { id: brandId } })).name).toBe('原品牌')
  expect((await db.productCategory.findUniqueOrThrow({ where: { id: categoryId } })).name).toBe('原分类')
  expect((await db.product.findUniqueOrThrow({ where: { id: productId } })).name).toBe('原品牌原分类')
  expect((await db.productSku.findUniqueOrThrow({ where: { id: skuId } })).batchTracking).toBe(false)
  expect(await db.stockBatch.count({ where: { tenantId } })).toBe(0); expect(await db.auditLog.count({ where: { tenantId } })).toBe(0)
})
