import { test, expect } from '@playwright/test'

test('conversion explicitly links a permitted existing customer and cancelling never changes the lead', async ({ page }) => {
  const writes: any[] = []
  const lead: any = { id: 11, phone: '13900001111', storeName: 'QA咨询门店', status: 'new', createdAt: '2026-10-24T00:00:00Z' }
  await page.addInitScript(() => localStorage.setItem('accessToken', 'local-lead-ui-fixture'))
  await page.route('**/api/v1/**', route => {
    const path = new URL(route.request().url()).pathname
    let data: any = {}
    if (path.endsWith('/auth/profile')) data = { user: { id: 1, name: 'QA运营', userType: 'super_admin' }, permissions: [], menus: [] }
    else if (path.endsWith('/leads/stats')) data = { newCount: 1 }
    else if (path.endsWith('/leads/assignees')) data = []
    else if (path.endsWith('/leads/conversion-customers')) data = [{ id: 21, customerName: 'QA已审核客户' }]
    else if (path.endsWith('/leads/11') && route.request().method() === 'PATCH') {
      const body = route.request().postDataJSON(); writes.push(body); Object.assign(lead, body); data = lead
    } else if (path.endsWith('/leads/11')) data = lead
    else if (path.endsWith('/leads')) data = { items: [lead], total: 1, page: 1, pageSize: 15 }
    return route.fulfill({ json: { code: 0, data } })
  })
  await page.goto('/leads')
  await page.getByRole('button', { name: '关联转化', exact: true }).click()
  const dialog = page.getByRole('dialog', { name: '关联客户并转化' })
  await expect(dialog.getByText('此操作只关联线索，不创建账号、不跳过短信验证或客户审核。', { exact: false })).toBeVisible()
  await expect(dialog.getByRole('button', { name: '确认关联' })).toBeDisabled()
  await dialog.getByRole('button', { name: '取消', exact: true }).click()
  expect(writes).toHaveLength(0)
  await page.getByRole('button', { name: '关联转化', exact: true }).click()
  await dialog.getByRole('combobox').click()
  await page.getByRole('option', { name: 'QA已审核客户（21）' }).click()
  await dialog.getByRole('button', { name: '确认关联', exact: true }).click()
  await expect.poll(() => writes.length).toBe(1)
  expect(writes).toEqual([{ status: 'converted', customerId: 21 }])
  await expect(page.locator('.el-table__body-wrapper').getByText('已转化', { exact: true })).toBeVisible()
  lead.customerId = null
  await page.getByRole('button', { name: '刷新', exact: true }).click()
  await expect(page.getByRole('button', { name: '补关联', exact: true })).toBeVisible()
  expect(writes).toHaveLength(1)
})
