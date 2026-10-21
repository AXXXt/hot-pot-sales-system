import { test, expect } from '@playwright/test'

test('gallery supports swiping, buttons, thumbnails and full-size preview with isolated image failures', async ({ page }) => {
  const product = { id: 1, name: '牛筋丸', mainImageUrl: '/images/a.png', images: ['/images/a.png', '/images/b.png', '/images/broken.png'], brand: { name: '品牌' }, skus: [] }
  await page.addInitScript(() => localStorage.setItem('webAccessToken', 'gallery-test'))
  await page.route('**/api/v1/**', route => {
    const path = new URL(route.request().url()).pathname
    return route.fulfill({ json: { code: 0, data: path.endsWith('/auth/profile') ? { user: { id: 1 }, customer: { id: 1 } } : path.endsWith('/products/1') ? product : [] } })
  })
  await page.route('**/images/*.png', route => route.request().url().includes('broken') ? route.fulfill({ status: 404 }) : route.fulfill({ contentType: 'image/png', body: Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jR1sAAAAASUVORK5CYII=', 'base64') }))
  await page.goto('/products/1')
  await expect(page.locator('.gallery-count')).toHaveText('1 / 3')
  await page.getByRole('button', { name: '下一张商品图片', exact: true }).click()
  await expect(page.locator('.gallery-count')).toHaveText('2 / 3')
  await page.getByRole('button', { name: '查看第2张大图', exact: true }).click()
  await expect(page.locator('.el-image-viewer__wrapper')).toBeVisible()
  await page.keyboard.press('Escape')
  await expect(page.locator('.el-image-viewer__wrapper')).toHaveCount(0)
  await page.getByRole('button', { name: '切换到第3张商品图片', exact: true }).click()
  await expect(page.locator('.gallery-count')).toHaveText('3 / 3')
  await expect(page.getByText('图片加载失败，请查看其他图片')).toBeVisible()
  // 浏览器实际滚动与触摸滑动共享 scroll-snap 和 scroll 处理。
  await page.locator('.gallery-viewport').evaluate(el => el.scrollTo({ left: 0, behavior: 'instant' }))
  await expect(page.locator('.gallery-count')).toHaveText('1 / 3')
  await expect(page.getByRole('button', { name: '查看第1张大图', exact: true })).toBeVisible()
  expect(await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth)).toBe(false)
})
