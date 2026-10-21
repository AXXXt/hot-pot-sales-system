import { test, expect } from '@playwright/test'

test('editing an AI draft preserves the specification and sale unit and supports publication', async ({ page }) => {
  let status = 'disabled'
  let skuBody: any
  await page.addInitScript(() => localStorage.setItem('accessToken', 'catalog-test'))
  await page.route('**/api/v1/**', async route => {
    const url = new URL(route.request().url())
    let data: any = []
    if (url.pathname.endsWith('/auth/profile')) data = { user: { id: 1, userType: 'super_admin', name: '管理员' }, permissions: [], menus: [] }
    if (url.pathname.endsWith('/brands')) data = [{ id: 1, name: '测试品牌', code: 'TEST' }]
    if (url.pathname.endsWith('/product-categories')) data = [{ id: 1, name: '鸭血', codeSegment: 'YaXue' }]
    if (url.pathname.endsWith('/products/1/status')) { status = route.request().postDataJSON().status; data = { id: 1, status } }
    if (url.pathname.endsWith('/products/1')) data = { id: 1, name: '测试品牌鸭血', code: 'TEST-001', brandId: 1, categoryId: 1, status,
      skus: [{ id: 11, skuCode: 'TEST-001-01', specText: '500克/袋', saleUnit: '袋', basePrice: '29.90', minOrderQty: 1, stockNum: 0, status: 'active' }] }
    if (url.pathname.endsWith('/skus/11')) { skuBody = route.request().postDataJSON(); data = { id: 11, ...skuBody } }
    return route.fulfill({ json: { code: 0, data } })
  })
  await page.goto('/products/1/edit')
  await expect(page.getByText('该商品当前已下架', { exact: false })).toBeVisible()
  await page.getByRole('button', { name: '编辑', exact: true }).click()
  const dialog = page.getByRole('dialog')
  await expect(dialog.getByLabel('规格名', { exact: true })).toHaveValue('500克/袋')
  await expect(dialog.getByLabel('销售单位', { exact: true })).toHaveValue('袋')
  await dialog.getByRole('button', { name: '保存', exact: true }).click()
  await expect(dialog).not.toBeVisible()
  expect(skuBody).toMatchObject({ specText: '500克/袋', saleUnit: '袋', basePrice: '29.9' })
  expect(skuBody.stockNum).toBeUndefined()
  await page.getByRole('button', { name: '上架商品', exact: true }).click()
  await page.getByRole('button', { name: '确认上架', exact: true }).click()
  await expect(page.getByText('商品已上架，但暂无有货规格', { exact: false })).toBeVisible()
  expect(status).toBe('active')
})

test('creating a product opens its own specification editor', async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem('accessToken', 'catalog-test'))
  await page.route('**/api/v1/**', async route => {
    const path = new URL(route.request().url()).pathname
    let data: any = []
    if (path.endsWith('/auth/profile')) data = { user: { id: 1, userType: 'super_admin' }, permissions: [], menus: [] }
    if (path.endsWith('/brands')) data = [{ id: 1, name: '品牌', code: 'TEST' }]
    if (path.endsWith('/product-categories')) data = [{ id: 1, name: '分类', codeSegment: 'Cat' }]
    if (path.endsWith('/products') || path.endsWith('/products/7')) data = { id: 7, name: '品牌分类', code: 'TEST-001', brandId: 1, categoryId: 1, status: 'active', skus: [] }
    return route.fulfill({ json: { code: 0, data } })
  })
  await page.goto('/products/create')
  const selects = page.locator('.el-select')
  await selects.nth(0).click()
  await page.getByRole('option', { name: '品牌', exact: true }).click()
  await selects.nth(1).click()
  await page.getByRole('option', { name: '分类', exact: true }).click()
  await page.getByLabel('商品名称', { exact: true }).fill('实际商品名称')
  await page.getByRole('button', { name: '保存商品', exact: true }).click()
  await expect(page).toHaveURL(/\/products\/7\/edit$/)
  await expect(page.getByRole('button', { name: '新建规格' })).toBeVisible()
})

test('real product names are editable while labels and codes remain automatic', async ({ page }) => {
  let product = { id: 1, name: '爆汁牛筋丸', displayName: '爆汁牛筋丸', managementLabel: '利至雁丸滑', subtitle: '爆汁牛筋丸', code: 'LIZHIYAN-WanHua-001', brandId: 1, categoryId: 1, status: 'active', skus: [] }
  const writes: any[] = []
  await page.addInitScript(() => localStorage.setItem('accessToken', 'catalog-test'))
  await page.route('**/api/v1/**', async route => {
    const req = route.request(); const path = new URL(req.url()).pathname
    let data: any = []
    if (path.endsWith('/auth/profile')) data = { user: { id: 1, userType: 'super_admin' }, permissions: [], menus: [] }
    if (path.endsWith('/brands')) data = [{ id: 1, name: '利至雁', code: 'LIZHIYAN' }]
    if (path.endsWith('/product-categories')) data = [{ id: 1, name: '丸滑', codeSegment: 'WanHua' }]
    if (path.endsWith('/products/1')) {
      if (req.method() === 'PATCH') { const body = req.postDataJSON(); writes.push(body); product = { ...product, ...body, name: body.subtitle, displayName: body.subtitle } }
      data = product
    }
    return route.fulfill({ json: { code: 0, data } })
  })
  await page.goto('/products/1/edit')
  const name = page.getByLabel('商品名称', { exact: true })
  await expect(name).toHaveValue('爆汁牛筋丸')
  await expect(page.getByLabel('管理标签', { exact: true })).toHaveValue('利至雁丸滑')
  await expect(page.getByLabel('管理标签', { exact: true })).not.toBeEditable()
  await name.fill('   ')
  await page.getByRole('button', { name: '保存商品', exact: true }).click()
  await expect(page.getByText('请填写真实商品名称', { exact: true })).toBeVisible()
  expect(writes).toHaveLength(0)
  await name.fill('手打牛筋丸')
  await page.getByRole('button', { name: '保存商品', exact: true }).click()
  await expect(page.getByText('商品保存成功，正式编码：LIZHIYAN-WanHua-001', { exact: true })).toBeVisible()
  expect(writes[0]).toMatchObject({ subtitle: '手打牛筋丸' })
  expect(writes[0].name).toBeUndefined()
  expect(writes[0].code).toBeUndefined()
  await page.reload()
  await expect(name).toHaveValue('手打牛筋丸')
  await expect(page.getByLabel('管理标签', { exact: true })).toHaveValue('利至雁丸滑')
})
