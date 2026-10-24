import { test, expect, type Page } from '@playwright/test'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { pathToFileURL } from 'node:url'

const products = [
  { id: 1, name: '精选雪花肥牛卷', mainImageUrl: '/test-food.jpg', category: { id: 1, name: '肉类涮品' }, brand: { id: 1, name: '测试品牌' }, isNew: true, skus: [{ id: 11, skuCode: 'TEST-001', specText: '500g × 20袋', saleUnit: '箱', basePrice: '298', stockNum: 10, minOrderQty: 2 }] },
  { id: 2, name: '多规格羊肉卷', mainImageUrl: '/missing-food.jpg', category: { id: 1, name: '肉类涮品' }, skus: [{ id: 21, specText: '500g × 10袋', saleUnit: '箱', basePrice: '160', stockNum: 10, minOrderQty: 1 }, { id: 22, specText: '500g × 20袋', saleUnit: '箱', basePrice: '300', stockNum: 10, minOrderQty: 1 }] },
  { id: 3, name: '鲜蔬菌菇组合', mainImageUrl: '/test-greens.jpg', category: { id: 2, name: '蔬菜菌菇' }, skus: [{ id: 31, specText: '5kg', saleUnit: '箱', basePrice: '86', stockNum: 0, minOrderQty: 1 }] }
]

async function fixture(page: Page) {
  await page.addInitScript(() => {
    localStorage.setItem('webAccessToken', 'design-test-only')
    localStorage.setItem('webProfile', JSON.stringify({ customer: { id: 1, customerName: '测试门店' } }))
  })
  await page.route('**/test-food.jpg', route => route.fulfill({ contentType: 'image/jpeg', body: readFileSync(resolve('../official-site/assets/brand/hero.jpg')) }))
  await page.route('**/test-greens.jpg', route => route.fulfill({ contentType: 'image/jpeg', body: readFileSync(resolve('../official-site/assets/brand/greens.jpg')) }))
  await page.route('**/missing-food.jpg', route => route.fulfill({ status: 404 }))
  await page.route('**/api/v1/**', route => {
    const url = new URL(route.request().url())
    let data: unknown = {}
    if (url.pathname.endsWith('/auth/profile')) data = { user: { name: '测试用户' }, tenant: { name: '唯哆鲜' }, customer: { id: 1, customerName: '测试门店' } }
    if (url.pathname.endsWith('/product-categories')) data = [{ id: 1, name: '肉类涮品' }, { id: 2, name: '蔬菜菌菇' }]
    if (url.pathname.endsWith('/brands')) data = [{ id: 1, name: '测试品牌' }]
    if (url.pathname.endsWith('/products')) {
      const keyword = url.searchParams.get('keyword') || ''
      const category = url.searchParams.get('categoryId')
      const items = products.filter(item => item.name.includes(keyword) && (!category || String(item.category.id) === category))
      data = { items, total: items.length, page: 1, pageSize: 12 }
    }
    return route.fulfill({ json: { code: 0, data } })
  })
}

test('catalog preserves filters, real SKU cart actions and responsive layout', async ({ page }, info) => {
  const errors: string[] = []
  page.on('pageerror', error => errors.push(error.message))
  await fixture(page)
  await page.goto('/category')
  await expect(page.locator('.product-card')).toHaveCount(3)
  await expect(page.locator('.product-placeholder')).toHaveCount(1)
  await expect(page.getByRole('button', { name: '将鲜蔬菌菇组合加入进货单' })).toBeDisabled()
  await expect(page.getByRole('link', { name: '选规格' })).toHaveAttribute('href', '/products/2')
  await page.getByRole('button', { name: '将精选雪花肥牛卷加入进货单' }).click()
  expect(await page.evaluate(() => JSON.parse(localStorage.getItem('webCustomerCart') || '[]')[0].quantity)).toBe(2)
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
  await page.screenshot({ path: info.outputPath('catalog.png'), fullPage: true })
  if (info.project.name === 'desktop') {
    await expect(page.locator('.cart-summary strong')).toHaveText('¥596.00')
    await page.getByRole('button', { name: '移除精选雪花肥牛卷' }).click()
    await expect(page.locator('.cart-empty')).toBeVisible()
  }
  await page.getByRole('navigation', { name: '商品分类' }).getByRole('button', { name: '蔬菜菌菇' }).click()
  await expect(page.locator('.product-card')).toHaveCount(1)
  await page.getByRole('button', { name: '重置', exact: true }).click()
  await page.getByRole('textbox', { name: '搜索食材名称或编码' }).fill('不存在')
  await page.getByRole('textbox', { name: '搜索食材名称或编码' }).press('Enter')
  await expect(page.getByText('没有找到相关食材')).toBeVisible()
  expect(errors).toEqual([])
})

test('catalog request failure is retryable rather than an empty search result', async ({ page }) => {
  await fixture(page)
  await page.route('**/api/v1/products?**', route => route.fulfill({ status: 503, json: { message: '测试失败' } }))
  await page.goto('/category')
  await expect(page.getByText('商品加载失败，请重试')).toBeVisible()
  await expect(page.getByRole('button', { name: '重新加载', exact: true })).toBeEnabled()
})

test('official homepage keeps its brand, working contact form and mobile navigation', async ({ page }, info) => {
  const submissions: unknown[] = []
  await page.route('**/api/v1/leads/public', route => {
    submissions.push(route.request().postDataJSON())
    return route.fulfill({ json: { code: 0, data: {} }, headers: { 'access-control-allow-origin': '*' } })
  })
  await page.goto(pathToFileURL(resolve('../official-site/index.html')).href)
  await expect(page.getByRole('heading', { name: '唯哆鲜食品', exact: true })).toBeVisible()
  expect(await page.locator('.hero-photo').evaluate((image: HTMLImageElement) => image.naturalWidth)).toBeGreaterThan(0)
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
  await page.screenshot({ path: info.outputPath('official.png'), fullPage: true })
  if (info.project.name === 'mobile') {
    await page.getByRole('button', { name: '打开导航' }).click()
    await expect(page.locator('#nav')).toBeVisible()
    await page.locator('#nav').getByRole('link', { name: '供货与服务' }).click()
    await expect(page.locator('#nav')).toBeHidden()
  }
  await page.locator('#leadSubmit').click()
  await expect(page.getByRole('alert')).toHaveText('请输入正确的 11 位手机号')
  await page.getByLabel('手机号').fill('13800000000')
  await page.locator('#leadSubmit').click()
  await expect(page.getByRole('alert')).toHaveText('请先阅读并同意用户协议和隐私政策')
  expect(submissions).toHaveLength(0)
  await page.locator('#leadConsent').check()
  await page.locator('#leadSubmit').click()
  await expect(page.locator('#leadSuccess')).toBeVisible()
  expect(submissions).toHaveLength(1)
})
