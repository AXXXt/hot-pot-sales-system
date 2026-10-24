import { test, expect } from '@playwright/test'

test('an employee without page permission sees an actionable state without requesting protected data', async ({ page }) => {
  const protectedCalls: string[] = []
  await page.addInitScript(() => localStorage.setItem('accessToken', 'qa-no-page-access'))
  await page.route('**/api/v1/**', route => {
    const path = new URL(route.request().url()).pathname
    if (path.endsWith('/auth/profile')) return route.fulfill({ json: { code: 0, data: { user: { id: 9, userType: 'warehouse', name: 'QA待分配员工' }, permissions: [], menus: [] } } })
    if (/dashboard\/stats|products|customers|users/.test(path)) protectedCalls.push(path)
    return route.fulfill({ json: { code: 0, data: {} } })
  })
  await page.goto('/dashboard')
  await expect(page.getByText('暂无访问权限', { exact: true })).toBeVisible()
  await expect(page.getByText('请从左侧导航进入已授权功能；如没有可用功能，请联系管理员配置岗位权限。')).toBeVisible()
  await expect(page.getByRole('button', { name: '返回工作台' })).toHaveCount(0)
  await page.goto('/products')
  await expect(page.getByText('暂无访问权限', { exact: true })).toBeVisible()
  expect(protectedCalls).toEqual([])
  await expect(page.getByRole('button', { name: '退出', exact: true })).toBeVisible()
})
