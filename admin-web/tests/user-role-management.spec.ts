import { expect, test, type Page } from '@playwright/test'

async function fixture(page: Page, configure = true) {
  const permissionRows = [
    { id: 101, name: '查看订单', code: 'order:read', status: 'active' },
    { id: 102, name: '查看库存', code: 'inventory:read', status: 'active' }
  ]
  const roles: any[] = [{ id: 11, name: '测试只读角色', code: 'qa_reader', description: '原说明', status: 'active', _count: { userRoles: 1 }, permissions: [{ permissionId: 101, permission: permissionRows[0] }] }]
  const employee = { id: 1001, name: '第201位之后的员工', phone: '13900000000', userType: 'sales', status: 'active', roles: [{ id: 11, name: '测试只读角色' }], brandIds: [1] }
  const state = { roles, employee, writes: [] as Array<{ path: string; body: any }>, paths: [] as string[], failPermissions: false, failDetail: false, holdDetail: null as Promise<void> | null }
  await page.addInitScript(() => localStorage.setItem('accessToken', 'local-acl-browser-fixture'))
  await page.route('**/api/v1/**', async route => {
    const request = route.request(), path = new URL(request.url()).pathname, method = request.method()
    state.paths.push(path)
    let data: any = {}
    if (method !== 'GET') state.writes.push({ path, body: request.postDataJSON() })
    if (path.endsWith('/auth/profile')) data = { user: { id: 7, userType: 'admin', name: '本地角色管理员' }, permissions: ['role:manage', ...(configure ? ['ai:configure'] : [])], roles: [], brands: [], menus: [] }
    else if (path.endsWith('/users')) data = { items: [employee], total: 301 }
    else if (path.endsWith('/users/1001')) {
      if (state.holdDetail) await state.holdDetail
      if (state.failDetail) return route.fulfill({ status: 503, json: { code: 503, message: '本地详情失败' } })
      data = employee
    } else if (path.endsWith('/roles')) {
      if (method === 'POST') { const body = request.postDataJSON(); data = { id: 12, ...body, permissions: [], status: 'active', _count: { userRoles: 0 } }; roles.push(data) }
      else if (state.failPermissions) return route.fulfill({ status: 503, json: { code: 503, message: '本地权限读取失败' } })
      else data = roles
    } else if (path.endsWith('/roles/11') || path.endsWith('/roles/12')) {
      const role = roles.find(item => path.endsWith('/' + item.id))!
      Object.assign(role, request.postDataJSON()); data = role
    } else if (/\/roles\/\d+\/permissions$/.test(path)) {
      const role = roles.find(item => path.includes('/' + item.id + '/'))!
      role.permissions = request.postDataJSON().permissionIds.map((id: number) => ({ permissionId: id, permission: permissionRows.find(item => item.id === id) })); data = role.permissions
    } else if (path.endsWith('/permissions')) data = permissionRows
    else if (path.endsWith('/admin/ai/authorization')) data = { users: [{ id: 1, name: 'Old first employee', brandIds: [] }], brands: [{ id: 1, name: '品牌甲' }, { id: 2, name: '品牌乙' }], roles: [], permissions: [] }
    else if (path.endsWith('/authorization/users/1001/brands')) { employee.brandIds = request.postDataJSON().brandIds; data = { updated: true } }
    await route.fulfill({ json: { code: 0, data } })
  })
  return state
}

test('creates and edits role metadata without granting permissions, then explicitly replaces prefilled grants', async ({ page }) => {
  const state = await fixture(page)
  await page.goto('/users')
  await page.getByRole('button', { name: '角色与权限', exact: true }).click()
  await page.getByRole('button', { name: '新建角色', exact: true }).click()
  const create = page.getByRole('dialog', { name: '新建角色', exact: true })
  await create.getByRole('button', { name: '保存角色' }).click()
  await expect(page.getByText('请输入角色名称', { exact: true })).toBeVisible()
  expect(state.writes).toEqual([])
  await create.getByLabel('角色名称', { exact: true }).fill('验收仓库角色')
  await create.getByLabel('角色编码', { exact: true }).fill('qa_warehouse')
  await create.getByLabel('角色说明', { exact: true }).fill('人工选择权限')
  await create.getByRole('button', { name: '保存角色' }).click()
  await expect(create).toBeHidden()
  expect(state.writes).toEqual([{ path: '/api/v1/roles', body: { name: '验收仓库角色', code: 'qa_warehouse', description: '人工选择权限' } }])
  expect(state.roles[1].permissions).toEqual([])
  const createdRow = page.getByRole('row').filter({ hasText: '验收仓库角色' })
  await createdRow.getByRole('button', { name: '编辑角色' }).click()
  const edit = page.getByRole('dialog', { name: '编辑角色', exact: true })
  await expect(edit.getByLabel('角色编码', { exact: true })).toBeDisabled()
  await edit.getByLabel('角色名称', { exact: true }).fill('验收仓库角色已改名')
  await edit.getByRole('button', { name: '保存角色' }).click()
  await expect(edit).toBeHidden()
  expect(state.writes[1]).toEqual({ path: '/api/v1/roles/12', body: { name: '验收仓库角色已改名', description: '人工选择权限' } })
  const originalRow = page.getByRole('row').filter({ hasText: '测试只读角色' }).last()
  await originalRow.getByRole('button', { name: '分配权限' }).click()
  const permissions = page.getByRole('dialog', { name: '分配权限 · 测试只读角色' })
  await expect(permissions.getByRole('checkbox', { name: '查看订单' })).toBeChecked()
  await expect(permissions.getByRole('checkbox', { name: '查看库存' })).not.toBeChecked()
  await permissions.locator('.el-checkbox').filter({ hasText: '查看订单' }).click()
  await permissions.getByLabel('搜索权限').fill('库存')
  await permissions.locator('.el-checkbox').filter({ hasText: '查看库存' }).click()
  await permissions.getByRole('button', { name: '保存权限' }).click()
  const confirmation = page.getByRole('dialog', { name: '确认权限变更' })
  await expect(confirmation).toContainText('所选 1 项')
  await confirmation.getByRole('button', { name: '返回检查' }).click()
  expect(state.writes.filter(item => item.path.endsWith('/permissions'))).toEqual([])
  await permissions.getByRole('button', { name: '保存权限' }).click()
  await confirmation.getByRole('button', { name: '确认保存' }).click()
  await expect(permissions).toBeHidden()
  expect(state.writes.at(-1)).toEqual({ path: '/api/v1/roles/11/permissions', body: { permissionIds: [102] } })
  await originalRow.getByRole('button', { name: '分配权限' }).click()
  await expect(permissions.getByRole('checkbox', { name: '查看库存' })).toBeChecked()
  await expect(permissions.getByRole('checkbox', { name: '查看订单' })).not.toBeChecked()
})

test('does not treat a failed current permission read as an empty role grant', async ({ page }) => {
  const state = await fixture(page)
  await page.goto('/users')
  await page.getByRole('button', { name: '角色与权限', exact: true }).click()
  const row = page.getByRole('row').filter({ hasText: '测试只读角色' }).last()
  await expect(row.getByRole('button', { name: '分配权限' })).toBeVisible()
  state.failPermissions = true
  await row.getByRole('button', { name: '分配权限' }).click()
  const dialog = page.getByRole('dialog', { name: '分配权限 · 测试只读角色' })
  await expect(dialog.getByText('权限未加载成功，无法保存。请关闭后重新打开。')).toBeVisible()
  await expect(dialog.getByRole('button', { name: '保存权限' })).toBeDisabled()
  expect(state.writes).toEqual([])
})

test('reads employee 1001 independently from the capped staff list and only saves selected manageable brands', async ({ page }) => {
  const state = await fixture(page)
  let release!: () => void
  state.holdDetail = new Promise<void>(resolve => { release = resolve })
  await page.goto('/users')
  const row = page.getByRole('row').filter({ hasText: '第201位之后的员工' })
  await row.getByRole('button', { name: '品牌范围', exact: true }).click()
  const drawer = page.getByRole('dialog', { name: '员工品牌范围 · 第201位之后的员工' })
  await expect(drawer.getByRole('button', { name: '保存品牌范围' })).toBeDisabled()
  release()
  await expect(drawer.getByRole('checkbox', { name: '品牌甲' })).toBeChecked()
  await drawer.locator('.el-checkbox').filter({ hasText: '品牌甲' }).click()
  await drawer.locator('.el-checkbox').filter({ hasText: '品牌乙' }).click()
  await drawer.getByRole('button', { name: '保存品牌范围' }).click()
  const confirm = page.getByRole('dialog', { name: '确认品牌范围' })
  await confirm.getByRole('button', { name: '返回检查' }).click()
  expect(state.writes).toEqual([])
  await drawer.getByRole('button', { name: '保存品牌范围' }).click()
  await confirm.getByRole('button', { name: '确认保存' }).click()
  await expect(drawer).toBeHidden()
  expect(state.paths).toContain('/api/v1/users/1001')
  expect(state.writes).toEqual([{ path: '/api/v1/admin/ai/authorization/users/1001/brands', body: { brandIds: [2] } }])
})

test('brand detail failure blocks destructive empty saving and supports an explicit retry', async ({ page }) => {
  const state = await fixture(page)
  state.failDetail = true
  await page.goto('/users')
  await page.getByRole('row').filter({ hasText: '第201位之后的员工' }).getByRole('button', { name: '品牌范围', exact: true }).click()
  const drawer = page.getByRole('dialog', { name: '员工品牌范围 · 第201位之后的员工' })
  await expect(drawer.getByText('品牌范围未加载成功，暂不能保存。')).toBeVisible()
  await expect(drawer.getByRole('button', { name: '保存品牌范围' })).toBeDisabled()
  expect(state.writes).toEqual([])
  state.failDetail = false
  await drawer.getByRole('button', { name: '重新加载品牌范围' }).click()
  await expect(drawer.getByRole('checkbox', { name: '品牌甲' })).toBeChecked()
  await expect(drawer.getByRole('button', { name: '保存品牌范围' })).toBeEnabled()
})

test('a role manager without AI configuration cannot fetch or edit brand grants', async ({ page }) => {
  const state = await fixture(page, false)
  await page.goto('/users')
  const row = page.getByRole('row').filter({ hasText: '第201位之后的员工' })
  await expect(row).toBeVisible()
  await expect(row.getByRole('button', { name: '品牌范围', exact: true })).toHaveCount(0)
  expect(state.paths.some(path => path.includes('/authorization') || path.endsWith('/users/1001'))).toBe(false)
})

test('a permission confirmation opened before an account switch cannot submit for the new session', async ({ page }) => {
  const state = await fixture(page)
  await page.goto('/users')
  await page.getByRole('button', { name: '角色与权限', exact: true }).click()
  await page.getByRole('row').filter({ hasText: '测试只读角色' }).last().getByRole('button', { name: '分配权限' }).click()
  const dialog = page.getByRole('dialog', { name: '分配权限 · 测试只读角色' })
  await expect(dialog.getByRole('checkbox', { name: '查看订单' })).toBeChecked()
  await dialog.getByRole('button', { name: '保存权限' }).click()
  await page.evaluate(() => localStorage.setItem('adminSessionGeneration', 'different-local-test-account'))
  await page.getByRole('dialog', { name: '确认权限变更' }).getByRole('button', { name: '确认保存' }).click()
  await expect(page.getByRole('dialog', { name: '确认权限变更' })).toBeHidden()
  expect(state.writes).toEqual([])
})
