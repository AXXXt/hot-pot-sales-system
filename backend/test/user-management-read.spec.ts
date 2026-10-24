import { UserService } from '../src/user/user.service'
import { StaffActor } from '../src/auth/staff-access.service'

function fixture(permissions: string[], superAdmin = false) {
  const actor: StaffActor = { id: 1, tenantId: 7, userType: superAdmin ? 'super_admin' : 'admin', superAdmin, permissions: new Set(permissions), brandIds: [12], customerIds: null, leadIds: null, fingerprint: 'readonly-fixture' }
  const user = { id: 301, tenantId: 7, name: 'Local management fixture', userRoles: [] }
  const db = {
    user: { findFirst: jest.fn(async (args: any) => ({ ...user, ...(args.select.brandAccess ? { brandAccess: [{ brandId: 12 }] } : {}) })), findMany: jest.fn().mockResolvedValue([user]), count: jest.fn().mockResolvedValue(1) },
    role: { findMany: jest.fn().mockResolvedValue([{ id: 3, permissions: [{ permissionId: 9, permission: { id: 9, code: 'order:read', name: 'Read orders', status: 'active' } }] }]) }
  }
  return { actor, db, service: new UserService(db as any, {} as any, {} as any) }
}

it.each([['role:manage'], ['ai:configure'], []])('does not select or expose employee brand grants without BOTH existing management permissions: %p', async (...permissions: string[]) => {
  const f = fixture(permissions)
  const result = await f.service.getUser(301, f.actor)
  expect(result).not.toHaveProperty('brandIds')
  expect(f.db.user.findFirst.mock.calls[0][0].select).not.toHaveProperty('brandAccess')
})

it('returns a named employee beyond the old 200-person authorization list with only manageable active tenant brands', async () => {
  const f = fixture(['role:manage', 'ai:configure'])
  expect(await f.service.getUser(301, f.actor)).toMatchObject({ id: 301, brandIds: [12] })
  expect(f.db.user.findFirst).toHaveBeenCalledWith(expect.objectContaining({ where: { id: 301, tenantId: 7 }, select: expect.objectContaining({
    brandAccess: { where: { tenantId: 7, brand: { tenantId: 7, status: 'active', id: { in: [12] } } }, select: { brandId: true } }
  }) }))
})

it('allows the existing super-administrator bypass but still limits brand grants to active brands in the same tenant', async () => {
  const f = fixture([], true)
  await f.service.getUser(301, f.actor)
  expect(f.db.user.findFirst.mock.calls[0][0].select.brandAccess).toEqual({ where: { tenantId: 7, brand: { tenantId: 7, status: 'active' } }, select: { brandId: true } })
})

it('keeps the paginated user list free from brand grant fields even for an authorized caller', async () => {
  const f = fixture(['role:manage', 'ai:configure'])
  const result = await f.service.listUsers(2, 20, f.actor)
  expect(f.db.user.findMany).toHaveBeenCalledWith(expect.objectContaining({ where: { tenantId: 7 }, skip: 20, take: 20 }))
  expect(f.db.user.findMany.mock.calls[0][0].select).not.toHaveProperty('brandAccess')
  expect(result.items[0]).not.toHaveProperty('brandIds')
})

it('prefills existing role permissions with tenant-scoped links and safe permission fields', async () => {
  const f = fixture(['role:manage'])
  expect(await f.service.listRoles(f.actor)).toEqual([{ id: 3, permissions: [{ permissionId: 9, permission: { id: 9, code: 'order:read', name: 'Read orders', status: 'active' } }] }])
  expect(f.db.role.findMany).toHaveBeenCalledWith(expect.objectContaining({ where: { tenantId: 7 }, include: expect.objectContaining({ permissions: {
    where: { tenantId: 7 }, select: { permissionId: true, permission: { select: { id: true, code: true, name: true, status: true } } }
  } }) }))
})
