import { test, expect, type Page, type Route } from '@playwright/test'
const xlsx = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
const binary = Buffer.from([0x50, 0x4b, 3, 4, 0, 0, 0, 0])
async function setup(page: Page, handler: (route: Route, path: string) => Promise<void>) {
  await page.addInitScript(() => { localStorage.setItem('accessToken', 'synthetic-export-access'); localStorage.setItem('refreshToken', 'synthetic-export-refresh') })
  await page.route('**/api/v1/**', async route => {
    const path = new URL(route.request().url()).pathname
    if (path.endsWith('/auth/profile')) return route.fulfill({ json: { code: 0, data: { user: { id: 1, userType: 'super_admin' }, permissions: [], menus: [] } } })
    if (path.endsWith('/exports/inventory') || path.endsWith('/auth/refresh-token')) return handler(route, path)
    return route.fulfill({ json: { code: 0, data: { items: [], total: 0 } } })
  })
}
const download = (route: Route, disposition = 'attachment; filename="inventory-test.xlsx"') => route.fulfill({ body: binary, headers: { 'content-type': xlsx, 'access-control-expose-headers': 'Content-Disposition', ...(disposition ? { 'content-disposition': disposition } : {}) } })

test('inventory export uses shared 401 refresh and exposes scope without page filters', async ({ page }) => {
  let requests = 0, refreshed = 0
  await setup(page, async (route, path) => {
    if (path.endsWith('/auth/refresh-token')) { refreshed++; return route.fulfill({ json: { code: 0, data: { accessToken: 'synthetic-refreshed-export', refreshToken: 'synthetic-next-export' } } }) }
    requests++
    expect(new URL(route.request().url()).search).toBe('')
    if (requests === 1) return route.fulfill({ status: 401, json: { message: 'expired' } })
    expect(route.request().headers().authorization).toBe('Bearer synthetic-refreshed-export')
    return download(route, "attachment; filename*=UTF-8''%E5%BA%93%E5%AD%98.xlsx")
  })
  await page.goto('/inventory')
  await expect(page.getByText('导出当前账号可见的已上架商品及启用规格的账面库存，不随本页搜索、品牌或低库存筛选变化。')).toBeVisible()
  const event = page.waitForEvent('download'); await page.getByRole('button', { name: '导出已上架库存', exact: true }).click()
  expect((await event).suggestedFilename()).toBe('库存.xlsx'); expect(requests).toBe(2); expect(refreshed).toBe(1)
})

test('JSON error is readable and never saved as an Excel file', async ({ page }) => {
  await setup(page, route => route.fulfill({ json: { code: 1001, message: '库存导出暂不可用，请重试' } }))
  await page.goto('/inventory'); let downloads = 0; page.on('download', () => downloads++)
  await page.getByRole('button', { name: '导出已上架库存', exact: true }).click()
  await expect(page.getByText('库存导出暂不可用，请重试', { exact: true })).toBeVisible(); expect(downloads).toBe(0)
})

test('valid XLSX with optional disposition absent uses safe default filename', async ({ page }) => {
  await setup(page, route => download(route, ''))
  await page.goto('/inventory'); const event = page.waitForEvent('download'); await page.getByRole('button', { name: '导出已上架库存', exact: true }).click()
  expect((await event).suggestedFilename()).toBe('导出数据.xlsx')
})

test('late binary export from a previous session cannot download', async ({ page }) => {
  let finish!: () => void, started!: () => void
  const entered = new Promise<void>(resolve => { started = resolve }); const released = new Promise<void>(resolve => { finish = resolve })
  await setup(page, async route => { started(); await released; return download(route) })
  await page.goto('/inventory'); let downloads = 0; page.on('download', () => downloads++)
  await page.getByRole('button', { name: '导出已上架库存', exact: true }).click(); await entered
  await page.evaluate(() => localStorage.setItem('adminSessionGeneration', 'replacement-synthetic-session'))
  finish(); await expect(page.getByText('登录状态已变化', { exact: true })).toBeVisible(); expect(downloads).toBe(0)
})
