import { test, expect } from '@playwright/test'

test('only a real pending registration displays review actions, while disabled and rejected accounts stay distinct', async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem('accessToken', 'qa-review-status'))
  const updates: string[] = []
  await page.route('**/api/v1/**', route => {
    const path = new URL(route.request().url()).pathname
    let data: any = []
    if (path.endsWith('/auth/profile')) data = { user: { id: 1, userType: 'super_admin' }, permissions: [], menus: [] }
    if (path.endsWith('/customers')) data = { items: [
      { id: 1, customerName: '真实待审门店', status: 'disabled', reviewStatus: 'pending' },
      { id: 2, customerName: '已驳回门店', status: 'disabled', reviewStatus: 'rejected' },
      { id: 3, customerName: '人工停用门店', status: 'disabled', reviewStatus: 'disabled' },
      { id: 4, customerName: '正常门店', status: 'active', reviewStatus: 'approved' },
      { id: 5, customerName: '旧接口停用门店', status: 'disabled' }
    ], total: 5 }
    if (/\/customers\/\d+\/(approve|reject)$/.test(path)) updates.push(path)
    return route.fulfill({ json: { code: 0, data } })
  })
  await page.goto('/customers')
  const card = (name: string) => page.locator('.customer-card').filter({ hasText: name })
  await expect(card('真实待审门店').getByText('待审核', { exact: true })).toBeVisible()
  await expect(card('真实待审门店').getByRole('button', { name: '通过', exact: true })).toBeVisible()
  await expect(card('已驳回门店').getByText('已驳回', { exact: true })).toBeVisible()
  for (const name of ['人工停用门店', '旧接口停用门店']) await expect(card(name).getByText('已停用', { exact: true })).toBeVisible()
  for (const name of ['已驳回门店', '人工停用门店', '旧接口停用门店', '正常门店']) await expect(card(name).getByRole('button', { name: '通过', exact: true })).toHaveCount(0)
  await page.locator('.search-bar .el-select__wrapper').click()
  await expect(page.getByRole('option', { name: '未启用', exact: true })).toBeVisible()
  expect(updates).toHaveLength(0)
})
