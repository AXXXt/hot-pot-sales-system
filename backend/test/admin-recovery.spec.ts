import { UserService } from '../src/user/user.service'

function fixture() {
  const users: { id: number; tenantId: number; userType: string; status: string; customerId: number | null; name: string; userRoles: any[] }[] = [
    { id: 1, tenantId: 7, userType: 'super_admin', status: 'active', customerId: null, name: 'Owner', userRoles: [] },
    { id: 2, tenantId: 7, userType: 'admin', status: 'active', customerId: null, name: 'Manager', userRoles: [] },
    { id: 3, tenantId: 7, userType: 'sales', status: 'active', customerId: null, name: 'Staff', userRoles: [] }
  ]
  const select = ({ where }: any) => users.find(user => (where.id === undefined || user.id === where.id) && user.tenantId === where.tenantId) || null
  const update = jest.fn(async ({ where, data }: any) => { const user = users.find(item => item.id === where.id)!; Object.assign(user, data); return user })
  const db = {
    $queryRaw: jest.fn().mockResolvedValue([{ id: 7 }]),
    user: { findFirst: jest.fn(async (args: any) => select(args)), findUnique: jest.fn(), update,
      count: jest.fn(async ({ where }: any) => users.filter(user => user.tenantId === where.tenantId && user.id !== where.id?.not && user.userType === 'super_admin' && user.status === 'active' && !user.customerId).length) },
    role: { count: jest.fn().mockResolvedValue(0), findFirst: jest.fn().mockResolvedValue({ id: 5 }) }, customer: { findFirst: jest.fn().mockResolvedValue({ id: 9 }) },
    permission: { count: jest.fn(async ({ where }: any) => where.id.in.length) },
    rolePermission: { deleteMany: jest.fn(), createMany: jest.fn(), findMany: jest.fn().mockResolvedValue([]) },
    userRole: { count: jest.fn().mockResolvedValue(1), deleteMany: jest.fn(), createMany: jest.fn(), findMany: jest.fn().mockResolvedValue([{ roleId: 5, role: { permissions: [{}] } }]) },
    $transaction: jest.fn(async (callback: any): Promise<any> => callback(db))
  }
  const actor = (id: number) => ({ id, tenantId: 7, superAdmin: id === 1, userType: id === 1 ? 'super_admin' : 'admin', permissions: new Set(['role:manage']), brandIds: [], customerIds: null, leadIds: null, fingerprint: 'fixture' })
  return { users, db, actor, service: new UserService(db as any, { verifyCode: async () => true } as any, { write: jest.fn() } as any) }
}

it.each([{ status: 'disabled' }, { userType: 'sales' }, { customerId: 9 }])('does not let an operator lock their own account out: %p', async dto => {
  const f = fixture()
  await expect(f.service.updateUser(1, dto, f.actor(1))).rejects.toMatchObject({ status: 403 })
  expect(f.db.user.update).not.toHaveBeenCalled()
})

it('does not let an ordinary role manager promote themselves to super administrator', async () => {
  const f = fixture()
  await expect(f.service.updateUser(2, { userType: 'super_admin' }, f.actor(2))).rejects.toMatchObject({ status: 403 })
  expect(f.db.user.update).not.toHaveBeenCalled()
})

it('does not let an ordinary role manager disable the last super administrator', async () => {
  const f = fixture()
  await expect(f.service.updateUser(1, { status: 'disabled' }, f.actor(2))).rejects.toMatchObject({ status: 403 })
  expect(f.db.user.update).not.toHaveBeenCalled()
})

it('does not let a non-super operator remove their own last management role', async () => {
  const f = fixture()
  await expect(f.service.updateUser(2, { roleIds: [] }, f.actor(2))).rejects.toMatchObject({ status: 403 })
  expect(f.db.userRole.deleteMany).not.toHaveBeenCalled()
})

it('still permits legitimate ordinary staff suspension by a super administrator', async () => {
  const f = fixture()
  expect(await f.service.updateUser(3, { status: 'disabled' }, f.actor(1))).toMatchObject({ id: 3, status: 'disabled' })
})

it('does not count a legacy customer-linked super administrator as the last independent recovery account', async () => {
  const f = fixture()
  f.users.push({ id: 4, tenantId: 7, userType: 'super_admin', status: 'active', customerId: 9, name: 'Legacy linked owner', userRoles: [] })
  await expect(f.service.updateUser(1, { status: 'disabled' }, f.actor(4))).rejects.toMatchObject({ status: 403 })
  expect(f.db.user.count).toHaveBeenCalled()
  expect(f.db.user.update).not.toHaveBeenCalled()
})

it('does not let a role manager erase their own last management permission', async () => {
  const f = fixture()
  await expect(f.service.assignPermissions(5, { permissionIds: [] }, f.actor(2))).rejects.toMatchObject({ status: 403 })
  expect(f.db.rolePermission.deleteMany).not.toHaveBeenCalled()
})

it('rechecks delegated management permissions after acquiring the tenant lock', async () => {
  const f = fixture()
  f.db.userRole.count.mockResolvedValueOnce(0)
  await expect(f.service.updateUser(3, { status: 'disabled' }, f.actor(2))).rejects.toMatchObject({ status: 403 })
  expect(f.db.user.update).not.toHaveBeenCalled()
})

it('does not introduce a customer-linked super administrator by promoting an already linked ordinary employee', async () => {
  const f = fixture()
  f.users[2].customerId = 9
  await expect(f.service.updateUser(3, { userType: 'super_admin' }, f.actor(1))).rejects.toMatchObject({ status: 403 })
  expect(f.db.user.update).not.toHaveBeenCalled()
})
