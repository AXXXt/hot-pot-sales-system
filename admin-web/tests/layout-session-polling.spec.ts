import { test, expect } from '@playwright/test'

test('a delayed lead poll cannot notify a user after logout', async ({ page }) => {
  await page.clock.install()
  let release!: () => void, seen!: () => void
  const pending = new Promise<void>(resolve => { release = resolve })
  const started = new Promise<void>(resolve => { seen = resolve })
  await page.addInitScript(() => localStorage.setItem('accessToken', 'qa-layout-session'))
  await page.route('**/api/v1/**', async route => {
    const path = new URL(route.request().url()).pathname
    if (path.endsWith('/leads/stats')) {
      seen(); await pending
      return route.fulfill({ json: { code: 0, data: { newCount: 4 } } }).catch(() => {})
    }
    let data: any = {}
    if (path.endsWith('/auth/profile')) data = { user: { id: 1, name: 'QA管理员', userType: 'super_admin' }, permissions: [], menus: [] }
    if (path.endsWith('/dashboard/stats')) data = { visibility: { inventory: false }, recentOrders: [], lowStockItems: [], salesTrend: [], topProducts: [] }
    return route.fulfill({ json: { code: 0, data } })
  })
  await page.goto('/dashboard')
  await expect(page.getByRole('button', { name: '退出', exact: true })).toBeVisible()
  await page.clock.fastForward(61_000)
  await started
  await page.getByRole('button', { name: '退出', exact: true }).click()
  await expect(page).toHaveURL(/\/login/)
  release()
  await page.clock.fastForward(1000)
  await expect(page.getByText('新获客线索', { exact: true })).toHaveCount(0)
})
