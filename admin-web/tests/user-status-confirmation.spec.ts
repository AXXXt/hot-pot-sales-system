import { test, expect } from '@playwright/test'

test('user status confirmation matches the intended change and cancellation writes nothing', async ({ page }) => {
  const rows = [{ id: 41, name: 'QA正常账号', phone: '13900000000', userType: 'customer_user', status: 'active', roles: [] },
    { id: 42, name: 'QA停用账号', phone: '13900000001', userType: 'sales', status: 'disabled', roles: [] }]
  const changes: any[] = []
  await page.addInitScript(() => localStorage.setItem('accessToken', 'user-status-fixture'))
  await page.route('**/api/v1/**', async route => {
    const path = new URL(route.request().url()).pathname
    let data: any = { items: [], total: 0 }
    if (path.endsWith('/auth/profile')) data = { user: { id: 1, userType: 'super_admin' }, permissions: [], menus: [] }
    if (path.endsWith('/users')) data = { items: rows, total: 2 }
    if (path.endsWith('/roles')) data = []
    if (/\/users\/\d+$/.test(path) && route.request().method() === 'PATCH') {
      const patch = route.request().postDataJSON(); const row = rows.find(x => path.endsWith('/' + x.id))!
      changes.push({ id: row.id, ...patch }); Object.assign(row, patch); data = row
    }
    await route.fulfill({ json: { code: 0, data } })
  })
  await page.goto('/users')
  const active = page.getByRole('row').filter({ hasText: 'QA正常账号' })
  await expect(active).toContainText('客户账号')
  await active.getByRole('button', { name: '禁用', exact: true }).click()
  const dialog = page.getByRole('dialog', { name: '状态变更' })
  await expect(dialog).toContainText('确认禁用 QA正常账号？')
  await dialog.getByRole('button', { name: '取消', exact: true }).click()
  expect(changes).toHaveLength(0)
  const disabled = page.getByRole('row').filter({ hasText: 'QA停用账号' })
  await disabled.getByRole('button', { name: '启用', exact: true }).click()
  await expect(dialog).toContainText('确认启用 QA停用账号？')
  await dialog.getByRole('button', { name: '确定', exact: true }).click()
  await expect(disabled.getByRole('button', { name: '禁用', exact: true })).toBeVisible()
  expect(changes).toEqual([{ id: 42, status: 'active' }])
})
