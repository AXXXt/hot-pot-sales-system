import { CustomerService } from '../src/customer/customer.service'

it('serializes conflicting reviews and commits one review decision with its customer and user changes', async () => {
  let status = 'disabled', userStatus = 'disabled', action = 'submit_registration'
  let tail: Promise<void> = Promise.resolve()
  const auditCreate = jest.fn(async ({ data }: any) => { action = data.afterData.action; return {} })
  const customer = { findUnique: jest.fn(async () => ({ id: 3, tenantId: 7, status, users: [{ status: userStatus, tenantId: 7 }] })) }
  const auditLog = { findMany: jest.fn(async () => [{ targetId: '3', afterData: { action } }]) }
  const prisma = { customer, auditLog, $transaction: async (callback: any) => {
    let release: (() => void) | undefined
    const tx = {
      $queryRaw: jest.fn(async () => {
        const previous = tail
        tail = new Promise<void>(resolve => { release = resolve })
        await previous
        return [{ id: 3 }]
      }),
      customer: { findUnique: customer.findUnique, update: async ({ data }: any) => { status = data.status; return {} } },
      user: { updateMany: async ({ data }: any) => { userStatus = data.status; return { count: 1 } } },
      auditLog: { ...auditLog, create: auditCreate }
    }
    try { return await callback(tx) } finally { release?.() }
  } }
  const audit = { write: jest.fn() }
  const service = new CustomerService(prisma as any, audit as any)
  const results = await Promise.allSettled([service.approve(3), service.reject(3, 'Concurrent fixture')])
  expect(results.filter(result => result.status === 'fulfilled')).toHaveLength(1)
  expect(results.filter(result => result.status === 'rejected')).toHaveLength(1)
  expect(auditCreate).toHaveBeenCalledTimes(1)
  expect(auditCreate).toHaveBeenCalledWith({ data: expect.objectContaining({ tenantId: 7, targetId: '3' }) })
  expect(status).toBe(userStatus)
  expect(action).toBe(status === 'active' ? 'approve' : 'reject')
  expect(audit.write).not.toHaveBeenCalled()
})
