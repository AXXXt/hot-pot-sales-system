import { test, expect } from '@playwright/test'

for (const width of [1440, 390]) {
  test(`admin modules and navigation fit ${width}px`, async ({ page }, info) => {
    test.setTimeout(90000)
    await page.setViewportSize({ width, height: 960 })
    const errors: string[] = []
    page.on('pageerror', error => errors.push(error.message))
    await page.addInitScript(() => localStorage.setItem('accessToken', 'theme-test-only'))
    await page.route('**/api/v1/**', route => {
      const path = new URL(route.request().url()).pathname
      let data: unknown = { items: [], total: 0 }
      if (path.endsWith('/auth/profile')) data = { user: { id: 1, name: '测试管理员' }, permissions: ['dashboard:view','product:read','product:create','product:update','brand:manage','inventory:read','customer:manage','lead:read','order:read','role:manage','audit:read'], menus: [] }
      if (/\/(brands|product-categories|customer-levels|customer-price-rules|roles|permissions|system-configs|assignees|repayments)$/.test(path)) data = []
      if (path.endsWith('/product-visibility')) data = { mode: 'all', productIds: [] }
      if (path.endsWith('/dashboard/stats')) data = { todayOrders: 12, todayRevenue: 3580, yesterdayOrders: 10, yesterdayRevenue: 2800, pendingQuotes: 3, pendingShipments: 2, trend: [{ date: '2026-10-01', revenue: 1500 }, { date: '2026-10-02', revenue: 2800 }, { date: '2026-10-03', revenue: 3580 }], orderStatuses: [{ name: '待报价', value: 3 }, { name: '已完成', value: 9 }] }
      if (path.endsWith('/customers/1')) data = { id: 1, customerName: '测试门店', status: 'active', contactName: '测试联系人', phone: '13800000000', creditLimit: '12000', creditRemaining: '12000', level: { name: '普通客户' } }
      if (path.endsWith('/orders/1')) data = { id: 1, orderNo: 'OD-TEST-100', status: 'pending_quote', customer: { customerName: '测试门店' }, totalAmount: '596', payableAmount: '596', items: [], statusLogs: [], refunds: [] }
      return route.fulfill({ json: { code: 0, data } })
    })
    for (const path of ['/dashboard','/products','/products/brands','/products/categories','/products/create','/inventory','/customers','/customers/1','/leads','/orders','/orders/1','/users','/audit-logs','/system']) {
      await page.goto(path)
      await expect(page.locator('.main')).toBeVisible()
      await expect(page.locator('.loading-state')).toHaveCount(0)
      await page.waitForTimeout(350)
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), path).toBe(true)
      await page.screenshot({ path: info.outputPath(path.replaceAll('/', '-') + '.png'), fullPage: true })
      if (path === '/dashboard') {
        await page.getByRole('tab', { name: '经营概览' }).click()
        await page.waitForTimeout(300)
        await page.screenshot({ path: info.outputPath('overview.png'), fullPage: true })
      }
    }
    if (width === 390) {
      await page.getByRole('button', { name: '切换导航' }).click()
      await expect(page.locator('.sidebar')).toBeInViewport()
      await page.getByRole('button', { name: '关闭导航' }).click({ position: { x: 350, y: 300 } })
      await expect(page.locator('.sidebar')).not.toBeInViewport()
    }
    expect(errors).toEqual([])
  })
}
test('admin login uses the same brand treatment', async ({ page }, info) => {
  await page.goto('/login')
  await expect(page.getByRole('img', { name: '唯哆鲜' })).toBeVisible()
  await page.screenshot({ path: info.outputPath('admin-login.png'), fullPage: true })
})
