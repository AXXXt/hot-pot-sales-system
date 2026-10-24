import { CustomerService } from '../src/customer/customer.service'

function fixture(initialStatus = 'disabled') {
  let state = { status: initialStatus, userStatus: initialStatus, afterData: { action: 'submit_registration' } as Record<string, unknown> }
  let tail = Promise.resolve()
  const hooks: { insideAudit?: () => void; externalAudit?: () => Promise<void> } = {}
  const findUnique = jest.fn(async () => ({ id: 3, tenantId: 7, status: state.status, users: [{ status: state.userStatus, tenantId: 7 }] }))
  const auditLog = { findMany: jest.fn(async () => [{ targetId: '3', afterData: state.afterData }]) }
  const auditCreate = jest.fn(async ({ data }: any) => { hooks.insideAudit?.(); state.afterData = data.afterData; return {} })
  const prisma = {
    customer: { findUnique, update: jest.fn(async () => ({})) }, auditLog,
    $transaction: jest.fn(async (callback: any) => {
      let release: (() => void) | undefined, snapshot: typeof state | undefined
      const tx = {
        $queryRaw: async () => {
          const previous = tail
          tail = new Promise<void>(resolve => { release = resolve })
          await previous
          snapshot = structuredClone(state)
          return [{ id: 3 }]
        },
        customer: { findUnique, update: async ({ data }: any) => { state.status = data.status; return {} } },
        user: { updateMany: async ({ data }: any) => { state.userStatus = data.status; return { count: 1 } } },
        auditLog: { ...auditLog, create: auditCreate }
      }
      try { return await callback(tx) } catch (error) { if (snapshot) state = snapshot; throw error } finally { release?.() }
    })
  }
  const audit = { write: jest.fn(async ({ afterData }: any) => { await hooks.externalAudit?.(); state.afterData = afterData }) }
  return { service: new CustomerService(prisma as any, audit as any), prisma, audit, auditCreate, hooks, state: () => state }
}

it('rolls a status change and linked-user change back when its transactional decision audit fails', async () => {
  const f = fixture('active')
  f.auditCreate.mockRejectedValueOnce(new Error('isolated audit failure'))
  await expect(f.service.update(3, { status: 'disabled' })).rejects.toThrow('isolated audit failure')
  expect(f.state()).toMatchObject({ status: 'active', userStatus: 'active' })
  expect(f.audit.write).not.toHaveBeenCalled()
})

it('does not allow an approval to slip between a manual-disable commit and its decision audit', async () => {
  const f = fixture()
  let review: Promise<unknown> | undefined
  f.hooks.insideAudit = () => { if (f.state().status === 'disabled') { review = f.service.approve(3); review.catch(() => {}) } }
  // This reproduces the former transaction/audit gap; the fixed path must not call it.
  f.hooks.externalAudit = async () => { review = f.service.approve(3); await review }
  await f.service.update(3, { status: 'disabled' })
  expect(review).toBeDefined()
  await expect(review).rejects.toMatchObject({ status: 400 })
  expect(f.state()).toMatchObject({ status: 'disabled', userStatus: 'disabled', afterData: { status: 'disabled' } })
  expect(f.auditCreate).toHaveBeenCalledTimes(1)
  expect(f.audit.write).not.toHaveBeenCalled()
})

it('retains the existing single audit for an ordinary profile edit without adding status-decision transactions', async () => {
  const f = fixture('active')
  await f.service.update(3, { contactName: 'Local profile fixture' })
  expect(f.audit.write).toHaveBeenCalledTimes(1)
  expect(f.audit.write).toHaveBeenCalledWith(expect.objectContaining({ afterData: { contactName: 'Local profile fixture' } }))
  expect(f.prisma.$transaction).not.toHaveBeenCalled()
  expect(f.auditCreate).not.toHaveBeenCalled()
})
