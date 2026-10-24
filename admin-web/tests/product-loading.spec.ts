import { test, expect } from '@playwright/test'

test('product editing is disabled until detail loads and remains protected after failure until retry succeeds', async ({ page }) => {
  let release!: () => void
  const blocked = new Promise<void>(resolve => { release = resolve })
  let reads = 0, writes = 0
  await page.addInitScript(() => localStorage.setItem('accessToken', 'isolated-loading-regression'))
  await page.route('**/api/v1/**', async route => {
    const request = route.request(), path = new URL(request.url()).pathname
    let data: any = []
    if (path.endsWith('/auth/profile')) data = { user: { id: 1, userType: 'super_admin' }, permissions: [], menus: [] }
    if (path.endsWith('/brands')) data = [{ id: 1, name: '测试品牌', code: 'T' }]
    if (path.endsWith('/product-categories')) data = [{ id: 1, name: '测试分类', codeSegment: 'C' }]
    if (path.endsWith('/products/1')) {
      if (request.method() === 'PATCH') writes++
      else if (++reads === 1) { await blocked; return route.fulfill({ status: 503, json: { code: 503, message: '隔离测试暂不可用' } }) }
      data = { id: 1, code: 'T-C-001', subtitle: '原商品名称', managementLabel: '测试品牌测试分类', brandId: 1, categoryId: 1, status: 'active', images: [], skus: [] }
    }
    await route.fulfill({ json: { code: 0, data } })
  })
  await page.goto('/products/1/edit')
  await expect(page.getByLabel('商品名称', { exact: true })).toBeDisabled()
  await expect(page.getByRole('button', { name: '保存商品', exact: true })).toBeDisabled()
  await expect(page.getByRole('button', { name: '新建规格', exact: true })).toBeDisabled()
  await expect(page.getByLabel('选择商品图片', { exact: true })).toBeDisabled()
  release()
  await expect(page.getByText('商品资料加载失败，请重试后再编辑', { exact: true })).toBeVisible()
  await expect(page.getByRole('button', { name: '保存商品', exact: true })).toBeDisabled()
  expect(writes).toBe(0)
  await page.getByRole('button', { name: '重新加载', exact: true }).click()
  await expect(page.getByLabel('商品名称', { exact: true })).toHaveValue('原商品名称')
  await expect(page.getByLabel('商品名称', { exact: true })).toBeEnabled()
  await page.getByLabel('商品名称', { exact: true }).fill('修改商品名称')
  await page.getByRole('button', { name: '保存商品', exact: true }).click()
  await expect.poll(() => writes).toBe(1)
})
