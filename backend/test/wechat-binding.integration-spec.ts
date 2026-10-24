import { randomUUID } from 'node:crypto'
import { PrismaClient } from '@prisma/client'
import { bindVerifiedWechat } from '../src/auth/wechat-binding'

const url = process.env.TEST_DATABASE_URL
if (!url || !new URL(url).pathname.endsWith('_test')) throw new Error('Isolated TEST_DATABASE_URL required')
const db = new PrismaClient({ datasources: { db: { url } } })
let tenantId: number, otherTenantId: number, ownerId: number, currentId: number, otherId: number
const openid = 'fixture-' + randomUUID()
const wx = { codeToOpenid: jest.fn(async () => openid) }
beforeAll(async () => {
  tenantId = (await db.tenant.create({ data: { code: randomUUID(), name: 'Wechat binding fixture' } })).id
  otherTenantId = (await db.tenant.create({ data: { code: randomUUID(), name: 'Other fixture' } })).id
  const user = async (id: number, type: 'customer_user' | 'super_admin') => (await db.user.create({ data: {
    tenantId: id, userType: type, name: '测试', phone: 'B' + randomUUID().slice(0, 15)
  } })).id
  ownerId = await user(tenantId, 'super_admin'); currentId = await user(tenantId, 'customer_user'); otherId = await user(otherTenantId, 'customer_user')
})
beforeEach(async () => {
  await db.user.updateMany({ where: { id: { in: [ownerId, currentId, otherId] } }, data: { openid: null } })
  await db.user.update({ where: { id: ownerId }, data: { openid } })
  await db.auditLog.deleteMany({ where: { tenantId } })
})
afterAll(async () => {
  if (tenantId) {
    await db.auditLog.deleteMany({ where: { tenantId } })
    await db.user.deleteMany({ where: { tenantId: { in: [tenantId, otherTenantId] } } })
    await db.tenant.deleteMany({ where: { id: { in: [tenantId, otherTenantId] } } })
  }
  await db.$disconnect()
})
it('reports a conflict without changing either account, and requires confirmation to transfer', async () => {
  const conflict = await bindVerifiedWechat(db as any, wx as any, 'verified-code', currentId)
  expect(conflict).toMatchObject({ bound: false, reason: 'bound_elsewhere', account: '****' })
  expect((await db.user.findUniqueOrThrow({ where: { id: ownerId } })).openid).toBe(openid)
  expect((await db.user.findUniqueOrThrow({ where: { id: currentId } })).openid).toBeNull()
  expect(await bindVerifiedWechat(db as any, wx as any, 'fresh-code', currentId, true)).toEqual({ bound: true })
  expect((await db.user.findUniqueOrThrow({ where: { id: ownerId } })).openid).toBeNull()
  const current = await db.user.findUniqueOrThrow({ where: { id: currentId } })
  expect(current.openid).toBe(openid)
  expect(current.userType).toBe('customer_user')
  const audits = await db.auditLog.findMany({ where: { tenantId, module: 'wechat_binding' } })
  expect(audits).toHaveLength(1)
  expect(JSON.stringify(audits)).not.toContain(openid)
  expect(await bindVerifiedWechat(db as any, wx as any, 'repeat-code', currentId)).toEqual({ bound: true })
  expect(await db.auditLog.count({ where: { tenantId } })).toBe(1)
})
it('does not permit moving an association across tenants', async () => {
  expect(await bindVerifiedWechat(db as any, wx as any, 'verified-code', otherId, true)).toMatchObject({ bound: false, reason: 'transfer_not_allowed' })
  expect((await db.user.findUniqueOrThrow({ where: { id: ownerId } })).openid).toBe(openid)
})
it('rolls both associations back when the transfer audit cannot be persisted', async () => {
  const failing = { $transaction: (callback: any) => db.$transaction(tx => callback(new Proxy(tx, { get(target, key) {
    if (key === 'auditLog') return { create: async () => { throw Error('fixture audit outage') } }
    return Reflect.get(target, key)
  } }))) }
  expect(await bindVerifiedWechat(failing as any, wx as any, 'verified-code', currentId, true)).toMatchObject({ bound: false, reason: 'temporary_error' })
  expect((await db.user.findUniqueOrThrow({ where: { id: ownerId } })).openid).toBe(openid)
  expect((await db.user.findUniqueOrThrow({ where: { id: currentId } })).openid).toBeNull()
})
