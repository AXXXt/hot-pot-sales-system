import { test, expect } from '@playwright/test'

test('a rejected inventory submission shows one error and retains the form', async ({ page }) => {
  let submissions = 0
  await page.addInitScript(() => localStorage.setItem('accessToken', 'inventory-notice-test'))
  await page.route('**/api/v1/**', route => {
    const path = new URL(route.request().url()).pathname
    let data: any = { items: [], total: 0 }
    if (path.endsWith('/auth/profile')) data = { user: { id: 1, userType: 'super_admin' }, permissions: [], menus: [] }
    if (path.endsWith('/brands') || path.endsWith('/product-categories')) data = []
    if (path.endsWith('/inventory/stock')) data = { items: [{ id: 11, productName: 'QA批次商品', specText: '500克/袋', saleUnit: '袋', stockNum: 0, reservedNum: 0, batchTracking: true }], total: 1 }
    if (path.endsWith('/inventory/adjustments') && route.request().method() === 'POST') {
      submissions++
      return route.fulfill({ status: 400, json: { code: 400, message: '请填写批次号及到期日期' } })
    }
    return route.fulfill({ json: { code: 0, data } })
  })
  await page.goto('/inventory')
  await page.getByRole('tab', { name: '手动出入库', exact: true }).click()
  await page.getByRole('button', { name: '新建出入库单', exact: true }).click()
  const dialog = page.getByRole('dialog', { name: '新建手动出入库单' })
  await dialog.getByRole('combobox').first().click()
  await page.getByRole('option', { name: 'QA批次商品 500克/袋（库存 0）', exact: true }).click()
  await dialog.getByPlaceholder('例如：期初库存、损耗、赠品、采购补录').fill('QA错误提示复验')
  await dialog.getByRole('button', { name: '保存并生效', exact: true }).click()
  await expect(page.locator('.el-message')).toHaveCount(1)
  await expect(page.locator('.el-message')).toContainText('请填写批次号及到期日期')
  await expect(dialog).toBeVisible()
  await expect(dialog.getByPlaceholder('例如：期初库存、损耗、赠品、采购补录')).toHaveValue('QA错误提示复验')
  expect(submissions).toBe(1)
})
