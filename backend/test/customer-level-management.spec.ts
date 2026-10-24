import { CustomerService } from '../src/customer/customer.service'
import { StaffActor } from '../src/auth/staff-access.service'

const actor: StaffActor = { id: 7, tenantId: 3, userType: 'super_admin', superAdmin: true, permissions: new Set(), brandIds: [], customerIds: null, leadIds: null, fingerprint: 'fixture' }
function fixture() {
  const level = { id: 9, tenantId: 3, brandId: 2, name: '普通客户', code: 'normal', status: 'active' }
  const tx = {
    customerLevel: { create: jest.fn(async ({ data }) => ({ ...level, ...data })), findFirst: jest.fn(async () => level), update: jest.fn(async ({ data }) => ({ ...level, ...data })) },
    auditLog: { create: jest.fn() }
  }
  const db = {
    brand: { findFirst: jest.fn(async () => ({ id: 2 })) },
    customerLevel: { findMany: jest.fn(async () => [level]), findFirst: jest.fn(async () => level) },
    user: { findMany: jest.fn(async (_args: any) => [{ id: 7, name: '本租户员工' }]) },
    $transaction: jest.fn(async callback => callback(tx))
  }
  return { tx, db, service: new CustomerService(db as any, {} as any) }
}

it('reports a missing default before registration is attempted and deterministically selects the oldest enabled normal level', async () => {
  const { db, service } = fixture()
  db.customerLevel.findMany.mockResolvedValueOnce([])
  await expect(service.levelReadiness(actor)).resolves.toMatchObject({ registrationReady: false, defaultLevel: null })
  await expect(service.levelReadiness(actor)).resolves.toMatchObject({ registrationReady: true, defaultLevel: { id: 9 } })
  expect(db.customerLevel.findMany).toHaveBeenCalledWith(expect.objectContaining({ where: { tenantId: 3, code: 'normal', status: 'active' }, orderBy: { id: 'asc' } }))
})

it('rejects zero, oversized and over-precision discounts before any write', async () => {
  const { tx, service } = fixture()
  for (const discountRate of ['0', '-1', '1.2', '0.12345', 'nan']) {
    await expect(service.createLevel({ brandId: 2, code: 'fixture', name: '等级', discountRate }, actor)).rejects.toMatchObject({ status: 400 })
  }
  expect(tx.customerLevel.create).not.toHaveBeenCalled()
})

it('creates and audits levels together and keeps status changes tenant-scoped', async () => {
  const { service, tx } = fixture()
  await service.createLevel({ brandId: 2, code: 'normal', name: ' 等级 ', discountRate: '0.95' }, actor)
  expect(tx.customerLevel.create).toHaveBeenCalledWith({ data: expect.objectContaining({ tenantId: 3, name: '等级', discountRate: '0.95' }) })
  await service.updateLevel(9, { status: 'disabled' }, actor)
  expect(tx.customerLevel.findFirst).toHaveBeenCalledWith({ where: { id: 9, tenantId: 3 } })
  expect(tx.auditLog.create).toHaveBeenCalledTimes(2)
})

it('does not broaden sales-owner candidates and excludes phone/credentials from their projection', async () => {
  const { service, db } = fixture()
  const restricted = { ...actor, userType: 'sales', superAdmin: false, customerIds: [1] }
  await expect(service.salesOwners(restricted)).resolves.toMatchObject({ canAssign: false })
  expect(db.user.findMany).toHaveBeenLastCalledWith(expect.objectContaining({ where: expect.objectContaining({ tenantId: 3, id: 7, status: 'active' }), select: { id: true, name: true } }))
  await expect(service.salesOwners(actor)).resolves.toMatchObject({ canAssign: true })
  expect(db.user.findMany.mock.calls[1]![0].where).not.toHaveProperty('id')
})
