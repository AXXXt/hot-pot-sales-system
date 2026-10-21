import { test, expect, type Page } from '@playwright/test'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

const sku = { id: 11, name: '整箱', specText: '500g × 20袋', saleUnit: '箱', basePrice: '298', stockNum: 30, minOrderQty: 2 }
const product = { id: 1, name: '精选雪花肥牛卷', mainImageUrl: '/fixture.jpg', brand: { id: 1, name: '测试品牌' }, skus: [sku, { ...sku, id: 12, stockNum: 1, name: '库存不足规格' }], description: '本地排版测试商品' }
const order = { id: 100, orderNo: 'OD-20261003-100', status: 'pending_confirm', createdAt: '2026-10-03T01:00:00Z', payableAmount: '596', totalAmount: '596', customer: { customerName: '测试门店', creditRemaining: '12000' }, items: [{ id: 1, skuId: 11, productName: product.name, skuSpecText: sku.specText, quantity: 2, unitPrice: '298', amount: '596' }], itemCount: 2, productNames: [product.name] }
async function fixture(page: Page) {
  await page.addInitScript(() => {
    localStorage.setItem('webAccessToken', 'theme-test-only')
    localStorage.setItem('webProfile', JSON.stringify({ user: { name: '测试用户', phone: '13800000000' }, tenant: { name: '唯哆鲜' }, customer: { id: 1, customerName: '测试门店', contactName: '测试联系人', address: '河南省郑州市测试路 100 号', creditRemaining: '12000', status: 'active' } }))
    localStorage.setItem('webCustomerCart', JSON.stringify([{ skuId: 11, productId: 1, brandId: 1, brandName: '测试品牌', name: '精选雪花肥牛卷', spec: '500g × 20袋', price: '298', unit: '箱', quantity: 2, stockNum: 30, minOrderQty: 2, available: true }]))
  })
  await page.route('**/fixture.jpg', route => route.fulfill({ contentType: 'image/jpeg', body: readFileSync(resolve('../official-site/assets/brand/hero.jpg')) }))
  await page.route('**/api/v1/**', route => {
    const path = new URL(route.request().url()).pathname
    let data: unknown = {}
    if (path.endsWith('/products')) data = { items: [product], total: 1 }
    if (path.endsWith('/products/1')) data = product
    if (path.endsWith('/cart-validation')) data = { items: [{ skuId: 11, productId: 1, brandId: 1, brandName: '测试品牌', name: product.name, spec: sku.specText, unit: '箱', price: '298', stockNum: 30, minOrderQty: 2, available: true }], invalidSkuIds: [] }
    if (path.endsWith('/orders')) data = { items: [order], total: 1 }
    if (path.endsWith('/orders/100')) data = order
    return route.fulfill({ json: { code: 0, data } })
  })
}
test('remaining customer pages share the theme and fit desktop and mobile', async ({ page }, info) => {
  const errors: string[] = []
  page.on('pageerror', error => errors.push(error.message))
  await fixture(page)
  for (const [path, title] of [['/home','测试门店'], ['/products/1', product.name], ['/cart','进货单'], ['/checkout','确认下单'], ['/orders','我的订单'], ['/orders/100',order.orderNo], ['/profile','我的账户']]) {
    await page.goto(path)
    await expect(page.getByRole('heading', { name: title, exact: true }).first()).toBeVisible()
    await expect(page.locator('.el-loading-mask')).toHaveCount(0)
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), path).toBe(true)
    await page.screenshot({ path: info.outputPath(path.replaceAll('/', '-') + '.png'), fullPage: true })
  }
  expect(errors).toEqual([])
})
test('SKU stock and zero agreement price are respected', async ({ page }) => {
  await fixture(page)
  await page.route('**/api/v1/products/1', route => route.fulfill({ json: { code: 0, data: { ...product, skus: [{ ...sku, customerPrice: '0' }, product.skus[1]] } } }))
  await page.goto('/products/1')
  await expect(page.locator('.price-panel .price')).toHaveText('¥0.00')
  await expect(page.locator('.sku-list button').nth(1)).toBeDisabled()
  await expect(page.getByRole('spinbutton')).toHaveValue('2')
})
test('login keeps the logo visible on all viewports', async ({ page }, info) => {
  await page.goto('/login')
  await expect(page.getByRole('img', { name: '唯哆鲜' })).toBeVisible()
  await expect(page.getByRole('textbox', { name: /手机号/ })).toBeVisible()
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
  await page.screenshot({ path: info.outputPath('login.png'), fullPage: true })
})
