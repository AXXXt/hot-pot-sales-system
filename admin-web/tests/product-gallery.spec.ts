import { test, expect } from '@playwright/test'

test('multiple uploads preserve selection order, survive one failure, reorder and persist removals', async ({ page }) => {
  let product: any = { id: 1, name: '牛筋丸', subtitle: '牛筋丸', managementLabel: '品牌丸滑', code: 'P-001', brandId: 1, categoryId: 1, status: 'active', mainImageUrl: 'https://example.com/old.jpg', skus: [] }
  const writes: any[] = []
  let upload = 0
  await page.addInitScript(() => localStorage.setItem('accessToken', 'gallery-test'))
  await page.route('**/api/v1/**', async route => {
    const req = route.request(); const path = new URL(req.url()).pathname
    let data: any = []
    if (path.endsWith('/auth/profile')) data = { user: { id: 1, userType: 'super_admin' }, permissions: [], menus: [] }
    if (path.endsWith('/brands')) data = [{ id: 1, name: '品牌', code: 'B' }]
    if (path.endsWith('/product-categories')) data = [{ id: 1, name: '丸滑', codeSegment: 'W' }]
    if (path.endsWith('/uploads/product-image')) {
      upload++
      if (upload === 2) return route.fulfill({ status: 500, json: { code: 500, message: '图片上传失败' } })
      await new Promise(resolve => setTimeout(resolve, 120))
      data = { url: `https://example.com/new-${upload}.jpg` }
    }
    if (path.endsWith('/products/1')) {
      if (req.method() === 'PATCH') { writes.push(req.postDataJSON()); product = { ...product, ...req.postDataJSON() } }
      data = product
    }
    return route.fulfill({ json: { code: 0, data } })
  })
  await page.goto('/products/1/edit')
  await expect(page.locator('.product-image-card')).toHaveCount(1)
  const image = (name: string) => ({ name, mimeType: 'image/png', buffer: Buffer.from('mock png') })
  await page.locator('input[type=file]').setInputFiles([image('1.png'), image('2.png'), image('3.png')])
  await expect(page.getByRole('button', { name: '保存商品', exact: true })).toBeDisabled()
  await expect(page.locator('.product-image-card')).toHaveCount(3)
  await expect(page.getByRole('button', { name: '保存商品', exact: true })).toBeEnabled()
  expect(await page.locator('.product-image-card img').evaluateAll(nodes => nodes.map(node => (node as HTMLImageElement).src))).toEqual([product.mainImageUrl, 'https://example.com/new-1.jpg', 'https://example.com/new-3.jpg'])
  await page.getByRole('button', { name: '将第3张设为主图', exact: true }).click()
  await page.getByRole('button', { name: '删除第2张图片', exact: true }).click()
  await page.getByRole('button', { name: '保存商品', exact: true }).click()
  await expect(page.getByText('商品保存成功，正式编码：P-001', { exact: true })).toBeVisible()
  expect(writes[0]).toMatchObject({ images: ['https://example.com/new-3.jpg', 'https://example.com/new-1.jpg'], mainImageUrl: 'https://example.com/new-3.jpg' })
  await page.reload()
  await expect(page.locator('.product-image-card')).toHaveCount(2)
  await page.getByRole('button', { name: '删除第1张图片', exact: true }).click()
  await page.getByRole('button', { name: '删除第1张图片', exact: true }).click()
  await page.getByRole('button', { name: '保存商品', exact: true }).click()
  await expect.poll(() => writes.length).toBe(2)
  expect(writes[1]).toMatchObject({ images: [], mainImageUrl: '' })
  await page.locator('input[type=file]').setInputFiles(Array.from({ length: 10 }, (_, i) => image(`${i}.png`)))
  await expect(page.getByText('每个商品最多9张图片，还可添加9张')).toBeVisible()
  expect(upload).toBe(3)
})
