import { test, expect } from '@playwright/test'

test('partial stocktake drafts preserve uncounted rows and require all counts before completion', async ({ page }) => {
  const saved: any[] = [], completed: any[] = []
  const take = { id: 1, stocktakeNo: 'QA-PD-1', status: 'draft', itemCount: 2, createdAt: '2026-10-23T01:00:00Z', items: [
    { skuId: 11, systemQty: 10, countedQty: null, sku: { specText: '500克', product: { name: 'QA商品' } } },
    { skuId: 12, systemQty: 2, countedQty: null, sku: { specText: '200克', product: { name: 'QA商品' } } }
  ] }
  await page.addInitScript(() => localStorage.setItem('accessToken', 'stocktake-count-test'))
  await page.route('**/api/v1/**', route => {
    const path = new URL(route.request().url()).pathname
    let data: any = { items: [], total: 0 }
    if (path.endsWith('/auth/profile')) data = { user: { id: 1, userType: 'super_admin' }, permissions: [], menus: [] }
    if (path.endsWith('/brands') || path.endsWith('/product-categories')) data = []
    if (path.endsWith('/inventory/stocktakes')) data = { items: [take], total: 1 }
    if (path.endsWith('/stocktakes/1')) data = take
    if (path.endsWith('/stocktakes/1/items')) {
      const body = route.request().postDataJSON(); saved.push(body)
      for (const item of body.items) Object.assign(take.items.find(row => row.skuId === item.skuId)!, item)
      data = take
    }
    if (path.endsWith('/stocktakes/1/complete')) { completed.push(route.request().postDataJSON()); take.status = 'completed'; data = take }
    return route.fulfill({ json: { code: 0, data } })
  })
  await page.goto('/inventory')
  await page.getByRole('tab', { name: '库存盘点', exact: true }).click()
  await page.getByRole('button', { name: '录入盘点', exact: true }).click()
  const dialog = page.getByRole('dialog', { name: '录入盘点' })
  await dialog.getByRole('spinbutton').first().fill('0')
  await dialog.getByRole('button', { name: '完成盘点', exact: true }).click()
  await expect(page.getByText('请填写所有规格的实盘数，未清点不能按0处理', { exact: true })).toBeVisible()
  expect(completed).toHaveLength(0)
  await dialog.getByRole('button', { name: '保存草稿', exact: true }).click()
  await expect(dialog).not.toBeVisible()
  expect(saved).toHaveLength(1)
  expect(saved[0].items).toEqual([{ skuId: 11, countedQty: 0 }])
  expect(take.items[1].countedQty).toBeNull()
  await page.getByRole('button', { name: '录入盘点', exact: true }).click()
  await dialog.getByRole('spinbutton').nth(1).fill('2')
  await dialog.getByRole('button', { name: '完成盘点', exact: true }).click()
  await expect(dialog).not.toBeVisible()
  expect(completed[0].items.map((row: any) => row.countedQty)).toEqual([0, 2])
})

test('cancelling a stocktake has explicit Chinese choices, does not submit on backout and preserves recorded zeroes read-only', async ({ page }) => {
  let cancellations = 0
  const take = { id: 2, stocktakeNo: 'QA-PD-CANCEL', status: 'draft', itemCount: 2, createdAt: '2026-10-24T00:00:00Z', items: [
    { skuId: 11, systemQty: 10, countedQty: 0, sku: { specText: '500克', product: { name: 'QA商品' } } },
    { skuId: 12, systemQty: 2, countedQty: null, sku: { specText: '200克', product: { name: 'QA商品' } } }
  ] }
  await page.addInitScript(() => localStorage.setItem('accessToken', 'local-stocktake-cancel'))
  await page.route('**/api/v1/**', route => {
    const path = new URL(route.request().url()).pathname
    let data: any = { items: [], total: 0 }
    if (path.endsWith('/auth/profile')) data = { user: { id: 1, userType: 'super_admin' }, permissions: [], menus: [] }
    if (path.endsWith('/brands') || path.endsWith('/product-categories')) data = []
    if (path.endsWith('/inventory/stocktakes')) data = { items: [take], total: 1 }
    if (path.endsWith('/stocktakes/2')) data = take
    if (path.endsWith('/stocktakes/2/cancel')) { cancellations++; take.status = 'cancelled'; data = take }
    return route.fulfill({ json: { code: 0, data } })
  })
  await page.goto('/inventory'); await page.getByRole('tab', { name: '库存盘点', exact: true }).click()
  await page.getByRole('button', { name: '取消', exact: true }).click()
  await page.getByRole('button', { name: '保留盘点', exact: true }).click()
  expect(cancellations).toBe(0)
  await page.getByRole('button', { name: '取消', exact: true }).click()
  await page.getByRole('button', { name: '确认取消', exact: true }).click()
  await expect.poll(() => cancellations).toBe(1)
  await expect(page.locator('.el-table__body-wrapper').getByText('已取消', { exact: true })).toBeVisible()
  await page.getByRole('button', { name: '查看', exact: true }).click()
  const dialog = page.getByRole('dialog', { name: '盘点单详情' })
  await expect(dialog.getByText('盘点单已完成或已取消，仅可查看')).toBeVisible()
  await expect(dialog.getByRole('button', { name: '完成盘点' })).toHaveCount(0)
  expect(take.items.map(item => item.countedQty)).toEqual([0, null])
})
