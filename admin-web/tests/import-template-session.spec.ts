import { test, expect } from '@playwright/test'

test('selected customer id and multipart survive one shared 401 refresh without duplicating import', async ({ page }) => {
  await page.addInitScript(() => { localStorage.setItem('accessToken', 'old-import-access'); localStorage.setItem('refreshToken', 'synthetic-import-refresh') })
  let attempts = 0, refreshes = 0
  const targets: string[] = [], auths: string[] = []
  await page.route('**/api/v1/**', route => {
    const url = new URL(route.request().url()), path = url.pathname
    if (path.endsWith('/auth/profile')) return route.fulfill({ json: { code: 0, data: { user: { id: 1, userType: 'super_admin' }, permissions: [], menus: [] } } })
    if (path.endsWith('/auth/refresh-token')) { refreshes++; return route.fulfill({ json: { code: 0, data: { accessToken: 'new-import-access', refreshToken: 'new-import-refresh' } } }) }
    if (path.endsWith('/customers')) return route.fulfill({ json: { code: 0, data: { items: [{ id: 77, customerName: '目标客户', status: 'active' }], total: 1 } } })
    if (path.endsWith('/imports/products')) {
      attempts++; targets.push(url.searchParams.get('customerId') || ''); auths.push(route.request().headers().authorization || '')
      expect(route.request().headers()['content-type']).toContain('multipart/form-data; boundary=')
      if (attempts === 1) return route.fulfill({ status: 401, json: { message: '登录已过期' } })
      return route.fulfill({ json: { code: 0, data: { priceRuleCount: 1, productCount: 1, skuCount: 1 } } })
    }
    return route.fulfill({ json: { code: 0, data: path.endsWith('/products') ? { items: [], total: 0 } : [] } })
  })
  await page.goto('/products')
  await page.getByRole('combobox', { name: '协议价客户（可选）', exact: true }).click()
  await page.getByRole('option', { name: '目标客户（ID:77）', exact: true }).click()
  await page.locator('input[type=file]').setInputFiles({ name: 'agreement.xlsx', mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', buffer: Buffer.from('transport fixture') })
  await expect(page.getByText('导入完成：品牌 0，商品 1，SKU 1，协议价 1，跳过 0', { exact: true })).toBeVisible()
  expect(attempts).toBe(2); expect(refreshes).toBe(1); expect(targets).toEqual(['77', '77'])
  expect(auths).toEqual(['Bearer old-import-access', 'Bearer new-import-access'])
})

test('template downloads through the authenticated shared request and has a useful XLSX filename', async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem('accessToken', 'template-access'))
  let downloads = 0
  await page.route('**/api/v1/**', route => {
    const path = new URL(route.request().url()).pathname
    if (path.endsWith('/auth/profile')) return route.fulfill({ json: { code: 0, data: { user: { id: 1, userType: 'super_admin' }, permissions: [], menus: [] } } })
    if (path.endsWith('/imports/products/template')) {
      downloads++; expect(route.request().headers().authorization).toBe('Bearer template-access')
      // This browser case tests the binary transport only. Actual workbook content is covered by backend round-trip tests.
      return route.fulfill({ contentType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', body: Buffer.from('PK-test-binary-transport') })
    }
    return route.fulfill({ json: { code: 0, data: path.endsWith('/products') ? { items: [], total: 0 } : [] } })
  })
  await page.goto('/products')
  const downloaded = page.waitForEvent('download')
  await page.getByRole('button', { name: '下载导入模板', exact: true }).click()
  expect((await downloaded).suggestedFilename()).toBe('唯哆鲜商品导入模板.xlsx')
  expect(downloads).toBe(1)
})
