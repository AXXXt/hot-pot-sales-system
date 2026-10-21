import { randomUUID } from 'node:crypto'
import { ConfigService } from '@nestjs/config'
import { PrismaClient } from '@prisma/client'
import { PrismaService } from '../src/prisma.service'
import { StaffAccessService, StaffActor } from '../src/auth/staff-access.service'
import { AiInventoryService } from '../src/ai/ai-inventory.service'
import { AiDraftService } from '../src/ai/ai-draft.service'
import { AiSettingsService } from '../src/ai/ai-settings.service'

const url = process.env.TEST_DATABASE_URL
if (!url || !new URL(url).pathname.endsWith('_test')) throw new Error('Isolated TEST_DATABASE_URL required')
const db = new PrismaClient({ datasources: { db: { url } } })
const tenants: number[] = []
let actor: StaffActor, drafts: AiDraftService, conversationId: string, skuId: number
const payload = { keyword: '牛筋丸', specText: '500克', mode: 'increase', quantity: 10, unit: '袋', reason: '采购入库' }

beforeAll(async () => {
  for (let i = 0; i < 2; i++) {
    const tenantId = (await db.tenant.create({ data: { code: randomUUID(), name: 'AI stock fixture' } })).id
    tenants.push(tenantId)
    const brand = await db.brand.create({ data: { tenantId, code: 'STOCK', name: '库存测试品牌' } })
    const product = await db.product.create({ data: { tenantId, brandId: brand.id, code: 'STOCK-001', name: '自动标签', subtitle: '牛筋丸' } })
    const first = await db.productSku.create({ data: { tenantId, productId: product.id, skuCode: i ? 'FOREIGN-01' : 'STOCK-001-01', specText: '500克/袋', saleUnit: '袋', basePrice: '19.9', minOrderQty: 1, stockNum: 20 } })
    if (!i) {
      skuId = first.id
      await db.productSku.create({ data: { tenantId, productId: product.id, skuCode: 'STOCK-001-02', specText: '200克/袋', saleUnit: '袋', basePrice: '12.9', minOrderQty: 1, stockNum: 0 } })
    }
  }
  const user = await db.user.create({ data: { tenantId: tenants[0], userType: 'super_admin', phone: 'test-' + randomUUID().slice(0, 12), name: 'Inventory tester' } })
  const prisma = db as unknown as PrismaService
  const access = new StaffAccessService(prisma)
  actor = await access.actor(user.id)
  const inventory = new AiInventoryService(prisma, access)
  const settings = new AiSettingsService(prisma, new ConfigService(), access)
  drafts = new AiDraftService(prisma, access, {} as any, settings, inventory)
  // Legacy feature documents do not yet contain an inventory property.
  await db.aiConfig.create({ data: { tenantId: actor.tenantId, enabled: true, allowWrites: true, features: { products: true, tasks: true } } })
  conversationId = (await db.aiConversation.create({ data: { tenantId: actor.tenantId, ownerId: actor.id, title: '库存调整验证', fingerprint: actor.fingerprint } })).id
})

afterAll(async () => {
  const where = { tenantId: { in: tenants } }
  for (const model of ['auditLog', 'stockMovement', 'stockAdjustment', 'aiActionExecution', 'aiActionDraft', 'aiMessage', 'aiConversation', 'aiConfig', 'user', 'productSku', 'product', 'brand'] as const) await (db[model] as any).deleteMany({ where })
  await db.tenant.deleteMany({ where: { id: { in: tenants } } })
  await db.$disconnect()
})

it('keeps ambiguous and foreign SKU requests as non-executable drafts without changing stock', async () => {
  const ambiguous = await drafts.create(actor, conversationId, 'inventory.adjust', { ...payload, specText: '' })
  expect(ambiguous.missing).toContain('请选择唯一商品规格')
  await expect(drafts.confirm(actor, ambiguous.id, ambiguous.version, ambiguous.digest)).rejects.toThrow('唯一')
  const foreign = await drafts.create(actor, conversationId, 'inventory.adjust', { ...payload, keyword: 'FOREIGN-01', specText: '' })
  expect((foreign.payload as any).candidates).toEqual([])
  expect(await db.stockMovement.count({ where: { tenantId: actor.tenantId } })).toBe(0)
})

it('applies a confirmed adjustment once, including parallel retries, with linked document, ledger and audits', async () => {
  const draft = await drafts.create(actor, conversationId, 'inventory.adjust', payload)
  expect(draft.missing).toEqual([])
  expect((await db.productSku.findUniqueOrThrow({ where: { id: skuId } })).stockNum).toBe(20)
  const confirmations = await Promise.all([1, 2].map(() => drafts.confirm(actor, draft.id, draft.version, draft.digest)))
  expect(confirmations[0].id).toBe(confirmations[1].id)
  expect(confirmations[0].result).toMatchObject({ beforeQty: 20, afterQty: 30, changeQty: 10 })
  const movement = await db.stockMovement.findMany({ where: { tenantId: actor.tenantId } })
  expect(movement).toHaveLength(1)
  expect(movement[0]).toMatchObject({ skuId, beforeQty: 20, afterQty: 30, changeQty: 10, operatorId: actor.id, type: 'manual_in', sourceType: 'adjustment' })
  expect(await db.stockAdjustment.count({ where: { tenantId: actor.tenantId } })).toBe(1)
  expect(await db.auditLog.count({ where: { tenantId: actor.tenantId } })).toBe(2)
})

it('rolls back a stale confirmation, then refreshes its snapshot on save before executing', async () => {
  const draft = await drafts.create(actor, conversationId, 'inventory.adjust', { ...payload, mode: 'set', quantity: 50 })
  await db.productSku.update({ where: { id: skuId }, data: { stockNum: 36 } })
  await expect(drafts.confirm(actor, draft.id, draft.version, draft.digest)).rejects.toThrow('已变化')
  expect((await db.aiActionDraft.findUniqueOrThrow({ where: { id: draft.id } })).status).toBe('draft')
  expect(await db.stockMovement.count({ where: { tenantId: actor.tenantId } })).toBe(1)
  const refreshed = await drafts.update(actor, draft.id, draft.version, draft.payload)
  expect(refreshed.payload).toMatchObject({ item: { beforeQty: 36 }, afterQty: 50, changeQty: 14 })
  await drafts.confirm(actor, refreshed.id, refreshed.version, refreshed.digest)
  expect((await db.productSku.findUniqueOrThrow({ where: { id: skuId } })).stockNum).toBe(50)
})

it('rejects unit conversion, insufficient stock and revoked business permissions without any write', async () => {
  for (const value of [{ ...payload, unit: '箱' }, { ...payload, mode: 'decrease', quantity: 51 }]) {
    const draft = await drafts.create(actor, conversationId, 'inventory.adjust', value)
    expect(draft.missing.length).toBeGreaterThan(0)
    await expect(drafts.confirm(actor, draft.id, draft.version, draft.digest)).rejects.toThrow()
  }
  await expect(drafts.create({ ...actor, superAdmin: false, permissions: new Set(['ai:use', 'inventory:read']) }, conversationId, 'inventory.adjust', payload)).rejects.toThrow('权限')
  const draft = await drafts.create(actor, conversationId, 'inventory.adjust', payload)
  await db.aiConfig.update({ where: { tenantId: actor.tenantId }, data: { features: { inventory: false } } })
  await expect(drafts.confirm(actor, draft.id, draft.version, draft.digest)).rejects.toThrow('未启用')
  expect((await db.productSku.findUniqueOrThrow({ where: { id: skuId } })).stockNum).toBe(50)
  expect(await db.stockMovement.count({ where: { tenantId: actor.tenantId } })).toBe(2)
})
