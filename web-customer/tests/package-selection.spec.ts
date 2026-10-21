import { test, expect } from '@playwright/test'

test('switches a specification image and adds boxes as base units against the same stock', async ({ page }) => {
  const product: any = { id: 1, name: '牛筋丸', brand: { id: 1, name: '品牌' }, images: ['/a.jpg', '/b.jpg'], skus: [
    { id: 11, skuCode: 'P-01', specText: '500克/袋', saleUnit: '袋', basePrice: '20', customerPrice: '18.50', stockNum: 100, availableNum: 40, minOrderQty: 1, imageUrl: '/b.jpg', packagingUnits: [{ unit: '箱', factor: 20 }] },
    { id: 12, skuCode: 'P-02', specText: '200克/袋', saleUnit: '袋', basePrice: '12', stockNum: 10, availableNum: 0, minOrderQty: 1 }
  ] }
  await page.addInitScript(() => localStorage.setItem('webAccessToken', 'package-test'))
  await page.route('**/api/v1/**', route => {
    const path = new URL(route.request().url()).pathname
    const data = path.endsWith('/auth/profile') ? { user: { id: 1 }, customer: { id: 1 } } : path.endsWith('/products/1') ? product : []
    return route.fulfill({ json: { code: 0, data } })
  })
  await page.route(/\/[ab]\.jpg$/, route => route.fulfill({ contentType: 'image/svg+xml', body: '<svg xmlns="http://www.w3.org/2000/svg" width="100" height="100"><rect width="100" height="100" fill="#dce5dc"/></svg>' }))
  await page.goto('/products/1')
  await expect(page.getByRole('heading', { name: '牛筋丸' })).toBeVisible()
  await expect(page.locator('.gallery-slide').first().locator('img')).toHaveAttribute('src', '/b.jpg')
  await expect(page.getByRole('button', { name: /200克\/袋/ })).toBeDisabled()
  await page.locator('.package-row .el-select').click()
  await page.getByRole('option', { name: '箱（20袋）' }).click()
  await expect(page.locator('.price-panel .price')).toHaveText('¥370.00')
  await expect(page.locator('.price-panel')).toContainText('40袋')
  await expect(page.locator('.price-panel')).toContainText('可整2箱')
  await expect(page.locator('.price-panel')).toContainText('1箱')
  await expect(page.getByText('1箱＝20袋，进货单按袋核算。')).toBeVisible()
  await page.getByRole('spinbutton', { name: '采购数量' }).fill('2')
  await page.getByRole('button', { name: '加入进货单', exact: true }).click()
  await expect(page.getByText('已加入进货单')).toBeVisible()
  const stored = await page.evaluate(() => JSON.parse(localStorage.getItem('webCustomerCart') || '[]'))
  expect(stored).toHaveLength(1)
  expect(stored[0]).toMatchObject({ skuId: 11, quantity: 40, unit: '袋', price: '18.50', stockNum: 40 })
})
