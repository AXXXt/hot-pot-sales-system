import { randomUUID } from 'node:crypto'
import { PrismaClient } from '@prisma/client'
import { LeadService } from '../src/lead/lead.service'
import { StaffActor } from '../src/auth/staff-access.service'

const url = process.env.TEST_DATABASE_URL
let databaseTarget: URL
try { databaseTarget = new URL(url || '') } catch { throw Error('Valid isolated loopback mysql test target required') }
if (databaseTarget.protocol !== 'mysql:' || !['127.0.0.1', 'localhost', '[::1]'].includes(databaseTarget.hostname) || !databaseTarget.pathname.endsWith('_test')) throw Error('Loopback mysql *_test database required')
const db = new PrismaClient({ datasources: { db: { url } } }), tenants: number[] = [], customers: number[] = []
let actor: StaffActor, leadId: number, service: LeadService

beforeAll(async () => {
  for (let i = 0; i < 2; i++) tenants.push((await db.tenant.create({ data: { code: randomUUID(), name: 'Local lead conversion fixture' } })).id)
  const user = await db.user.create({ data: { tenantId: tenants[0], phone: randomUUID().slice(0, 20), name: 'Local scoped sales', userType: 'sales' } })
  for (let i = 0; i < 3; i++) customers.push((await db.customer.create({ data: { tenantId: i === 2 ? tenants[1] : tenants[0],
    customerName: 'Local conversion customer ' + i, salesOwnerId: i === 0 ? user.id : undefined, status: 'active' } })).id)
  leadId = (await db.lead.create({ data: { tenantId: tenants[0], phone: '13900001111', status: 'new', assignedToId: user.id } })).id
  actor = { id: user.id, tenantId: tenants[0], userType: 'sales', superAdmin: false, permissions: new Set(['lead:manage']), brandIds: [], customerIds: [customers[0]], leadIds: [leadId], fingerprint: randomUUID() }
  service = new LeadService(db as any, {} as any, { eval: async () => 1 })
})

afterAll(async () => {
  const where = { tenantId: { in: tenants } }
  if (tenants.length) { await db.auditLog.deleteMany({ where }); await db.lead.deleteMany({ where }); await db.customer.deleteMany({ where }); await db.user.deleteMany({ where }); await db.tenant.deleteMany({ where: { id: { in: tenants } } }) }
  await db.$disconnect()
})

it('searches only active same-tenant customers assigned to the actor', async () => {
  expect((await service.conversionCustomers('Local conversion', actor)).map(item => item.id)).toEqual([customers[0]])
  await db.customer.update({ where: { id: customers[0] }, data: { status: 'disabled' } })
  expect(await service.conversionCustomers('', actor)).toEqual([])
  await db.customer.update({ where: { id: customers[0] }, data: { status: 'active' } })
})

it('refuses conversion without an existing permitted active customer and never creates an account', async () => {
  const usersBefore = await db.user.count({ where: { tenantId: tenants[0] } })
  await expect(service.update(leadId, { status: 'converted' }, actor.id, actor)).rejects.toMatchObject({ response: { errorCode: 'LEAD_CUSTOMER_REQUIRED' } })
  for (const customerId of customers.slice(1)) await expect(service.update(leadId, { status: 'converted', customerId }, actor.id, actor)).rejects.toMatchObject({ status: 404 })
  expect(await db.lead.findUnique({ where: { id: leadId } })).toMatchObject({ status: 'new', customerId: null })
  expect(await db.user.count({ where: { tenantId: tenants[0] } })).toBe(usersBefore)
})

it('links an existing customer and its transition audit atomically without changing the customer or login state', async () => {
  const customerBefore = await db.customer.findUniqueOrThrow({ where: { id: customers[0] } })
  await service.update(leadId, { status: 'converted', customerId: customers[0] }, actor.id, actor)
  expect(await db.lead.findUniqueOrThrow({ where: { id: leadId } })).toMatchObject({ status: 'converted', customerId: customers[0] })
  const audit = await db.auditLog.findFirstOrThrow({ where: { tenantId: tenants[0], targetType: 'lead', targetId: String(leadId) }, orderBy: { id: 'desc' } })
  expect(audit.afterData).toMatchObject({ status: 'converted', customerId: customers[0] })
  expect(await db.customer.findUniqueOrThrow({ where: { id: customers[0] } })).toEqual(customerBefore)
})

it('rolls back a transition if its mandatory audit write fails', async () => {
  const before = await db.lead.findUniqueOrThrow({ where: { id: leadId } }), realTransaction = db.$transaction.bind(db)
  const operation = jest.spyOn(db, '$transaction').mockImplementationOnce((async (callback: unknown) => realTransaction(async tx =>
    (callback as any)(new Proxy(tx, { get(target, key) {
      if (key === 'auditLog') return { create: async () => { throw new Error('synthetic audit unavailable') } }
      return Reflect.get(target, key)
    } }))
  )) as any)
  try { await expect(service.update(leadId, { status: 'invalid' }, actor.id, actor)).rejects.toThrow('synthetic audit unavailable') }
  finally { operation.mockRestore() }
  expect(await db.lead.findUniqueOrThrow({ where: { id: leadId } })).toEqual(before)
})

it('retains an existing historical association when the customer later stops and a worker only updates the lead remark', async () => {
  await db.customer.update({ where: { id: customers[0] }, data: { status: 'disabled' } })
  try {
    await service.update(leadId, { remark: 'Local historical contact note' }, actor.id, actor)
    expect(await db.lead.findUniqueOrThrow({ where: { id: leadId } })).toMatchObject({ status: 'converted', customerId: customers[0], remark: 'Local historical contact note' })
  } finally { await db.customer.update({ where: { id: customers[0] }, data: { status: 'active' } }) }
})

it('adds follow-up after conversion without reverting the freshly-read state or its customer association', async () => {
  await service.addFollowUp(leadId, { content: 'Local converted customer follow-up' }, actor.id, actor)
  expect(await db.lead.findUniqueOrThrow({ where: { id: leadId } })).toMatchObject({ status: 'converted', customerId: customers[0] })
  expect(await db.leadFollowUp.count({ where: { leadId } })).toBe(1)
  const audit = await db.auditLog.findFirstOrThrow({ where: { tenantId: tenants[0], targetType: 'lead_follow_up' }, orderBy: { id: 'desc' } })
  expect(audit.afterData).toMatchObject({ leadId, content: 'Local converted customer follow-up' })
})

it('clears the association on leaving converted status and records the former customer in history', async () => {
  await service.update(leadId, { status: 'invalid' }, actor.id, actor)
  expect(await db.lead.findUniqueOrThrow({ where: { id: leadId } })).toMatchObject({ status: 'invalid', customerId: null })
  const audit = await db.auditLog.findFirstOrThrow({ where: { tenantId: tenants[0], targetType: 'lead', targetId: String(leadId) }, orderBy: { id: 'desc' } })
  expect(audit.beforeData).toMatchObject({ status: 'converted', customerId: customers[0] })
})
