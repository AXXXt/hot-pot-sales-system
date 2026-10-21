import { test, expect } from '@playwright/test'

test('catalog, product detail and cart show the real product name with a separate brand', async ({ page }) => {
  const product = { id: 1, name: '利至雁丸滑', subtitle: '爆汁牛筋丸', managementLabel: '利至雁丸滑', brand: { id: 1, name: '利至雁' }, category: { id: 1, name: '丸滑' }, skus: [{ id: 11, skuCode: 'LIZHIYAN-WanHua-001-01', name: '500克/袋', specText: '500克/袋', saleUnit: '袋', basePrice: '20', stockNum: 10, minOrderQty: 1 }] }
  await page.addInitScript(() => localStorage.setItem('webAccessToken', 'product-name-test'))
  await page.route('**/api/v1/**', route => {
    const path = new URL(route.request().url()).pathname
    let data: unknown = {}
    if (path.endsWith('/auth/profile')) data = { user: { id: 1 }, customer: { id: 1, customerName: '测试门店' } }
    if (path.endsWith('/brands')) data = [product.brand]
    if (path.endsWith('/product-categories')) data = [product.category]
    if (path.endsWith('/products')) data = { items: [product], total: 1, page: 1, pageSize: 12 }
    if (path.endsWith('/products/1')) data = product
    return route.fulfill({ json: { code: 0, data } })
  })
  await page.goto('/category')
  await expect(page.locator('.product-name')).toHaveText('爆汁牛筋丸')
  await expect(page.locator('.sku-line')).toContainText('利至雁 · 500克/袋')
  await page.getByRole('button', { name: '将爆汁牛筋丸加入进货单' }).click()
  expect(await page.evaluate(() => JSON.parse(localStorage.getItem('webCustomerCart') || '[]')[0].name)).toBe('爆汁牛筋丸')
  await page.locator('.product-name').click()
  await expect(page.getByRole('heading', { name: '爆汁牛筋丸', exact: true })).toBeVisible()
  await expect(page.getByText('利至雁丸滑', { exact: true })).toHaveCount(0)
})
