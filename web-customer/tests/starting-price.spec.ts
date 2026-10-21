import { test, expect } from '@playwright/test'

test('multi-SKU cards show the lowest effective price with a starting label, including zero agreement prices', async ({ page }) => {
  const product: any = { id: 1, name: '牛筋丸', brand: { id: 1, name: '利至雁' }, skus: [
    { id: 11, skuCode: 'P-01', specText: '500克/袋', saleUnit: '袋', basePrice: '19.9', stockNum: 20, minOrderQty: 1 },
    { id: 12, skuCode: 'P-02', specText: '200克/袋', saleUnit: '袋', basePrice: '12.9', stockNum: 0, minOrderQty: 1 }
  ] }
  await page.addInitScript(() => localStorage.setItem('webAccessToken', 'price-test'))
  await page.route('**/api/v1/**', route => {
    const path = new URL(route.request().url()).pathname
    const data = path.endsWith('/auth/profile') ? { user: { id: 1 }, customer: { id: 1 } } : path.endsWith('/products') ? { items: [product], total: 1, page: 1, pageSize: 12 } : []
    return route.fulfill({ json: { code: 0, data } })
  })
  await page.goto('/category')
  await expect(page.locator('.product-price')).toContainText('12.90')
  await expect(page.locator('.product-price')).toContainText('起')
  await expect(page.getByRole('link', { name: '选规格', exact: true })).toBeVisible()
  product.skus[0].customerPrice = 0
  await page.reload()
  await expect(page.locator('.product-price')).toContainText('0.00')
  product.skus = [product.skus[0]]
  await page.reload()
  await expect(page.locator('.product-price')).toContainText('0.00')
  await expect(page.locator('.product-price')).not.toContainText('起')
})
