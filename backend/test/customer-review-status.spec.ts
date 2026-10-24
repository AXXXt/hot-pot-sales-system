import { BadRequestException } from '@nestjs/common'
import { CustomerService } from '../src/customer/customer.service'

function fixture() {
  const items = [
    { id: 1, tenantId: 7, status: 'active', users: [{ status: 'active' }] },
    { id: 2, tenantId: 7, status: 'disabled', users: [{ status: 'disabled' }] },
    { id: 3, tenantId: 7, status: 'disabled', users: [{ status: 'disabled' }] },
    { id: 4, tenantId: 7, status: 'disabled', users: [{ status: 'disabled' }] },
    { id: 5, tenantId: 7, status: 'active', users: [{ status: 'disabled' }] },
    { id: 6, tenantId: 7, status: 'active', users: [] }
  ]
  const logs = [
    { tenantId: 7, targetId: '2', afterData: { action: 'submit_registration' } },
    { tenantId: 7, targetId: '3', afterData: { action: 'reject' } },
    { tenantId: 7, targetId: '4', afterData: { status: 'disabled' } },
    { tenantId: 7, targetId: '4', afterData: { action: 'submit_registration' } }
  ]
  const findUnique = jest.fn().mockResolvedValue(items[3])
  const tx = {
    $queryRaw: jest.fn().mockResolvedValue([{ id: 4 }]),
    customer: { update: jest.fn(), findUnique }, user: { updateMany: jest.fn() },
    auditLog: { findMany: jest.fn().mockResolvedValue(logs), create: jest.fn() }
  }
  const prisma = {
    customer: { findMany: jest.fn().mockResolvedValue(items), count: jest.fn().mockResolvedValue(items.length), findUnique },
    auditLog: { findMany: jest.fn().mockResolvedValue(logs) },
    $transaction: jest.fn(async (callback: (db: typeof tx) => Promise<void>) => callback(tx))
  }
  const audit = { write: jest.fn() }
  return { items, logs, prisma, tx, audit, service: new CustomerService(prisma as any, audit as any) }
}

it('distinguishes pending applications, rejected applications and manual disabled accounts in one batch', async () => {
  const f = fixture()
  const result = await f.service.list({ page: 1, pageSize: 100 })
  expect(result.items.map((x: any) => x.reviewStatus)).toEqual(['approved', 'pending', 'rejected', 'disabled', 'disabled', 'approved'])
  expect(result.items.every(x => !('users' in x))).toBe(true)
  expect(f.prisma.auditLog.findMany).toHaveBeenCalledTimes(1)
  expect(f.prisma.auditLog.findMany.mock.calls[0][0]).toMatchObject({ orderBy: [{ createdAt: 'desc' }, { id: 'desc' }] })
})

it('looks up only the current tenant and current page customer decisions', async () => {
  const f = fixture()
  await f.service.list({ page: 1, pageSize: 10 }, { tenantId: 7, customerIds: [2, 3, 4] } as any)
  expect(f.prisma.auditLog.findMany).toHaveBeenCalledWith(expect.objectContaining({ where: expect.objectContaining({ tenantId: 7, targetId: { in: ['2', '3', '4'] } }) }))
  expect(f.prisma.customer.findMany).toHaveBeenCalledWith(expect.objectContaining({ where: { tenantId: 7, id: { in: [2, 3, 4] } } }))
})

it('adds a safe review state to details without exposing internal linked-user records', async () => {
  const f = fixture()
  const result = await f.service.detail(4)
  expect(result).toMatchObject({ id: 4, status: 'disabled', reviewStatus: 'disabled' })
  expect(result).not.toHaveProperty('users')
})

it.each(['approve', 'reject'] as const)('%s cannot treat a manually disabled account as a registration application', async action => {
  const f = fixture()
  await expect(f.service[action](4)).rejects.toBeInstanceOf(BadRequestException)
  expect(f.tx.customer.update).not.toHaveBeenCalled()
  expect(f.tx.user.updateMany).not.toHaveBeenCalled()
  expect(f.tx.auditLog.create).not.toHaveBeenCalled()
  expect(f.audit.write).not.toHaveBeenCalled()
})

it.each(['approve', 'reject'] as const)('%s remains available for an actual pending application', async action => {
  const f = fixture()
  f.prisma.customer.findUnique.mockResolvedValue(f.items[1])
  await expect(f.service[action](2)).resolves.toMatchObject({ id: 2 })
  expect(f.tx.customer.update).toHaveBeenCalled()
  expect(f.tx.user.updateMany).toHaveBeenCalled()
  expect(f.tx.user.updateMany).toHaveBeenCalledWith(expect.objectContaining({ where: { customerId: 2, tenantId: 7 } }))
  expect(f.tx.auditLog.create).toHaveBeenCalledWith({ data: expect.objectContaining({ tenantId: 7, targetId: '2' }) })
})
