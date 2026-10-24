import { test, expect, type Page, type Route } from '@playwright/test'

async function mockApp(page: Page, handle: (route: Route, path: string) => Promise<void>) {
  await page.addInitScript(() => localStorage.setItem('accessToken', 'synthetic-catalog-lifecycle'))
  await page.route('**/api/v1/**', route => {
    const path = new URL(route.request().url()).pathname
    if (path.endsWith('/auth/profile')) return route.fulfill({ json: { code: 0, data: { user: { id: 1, userType: 'super_admin' }, permissions: [], menus: [] } } })
    return handle(route, path)
  })
}
const success = (route: Route, data: any = []) => route.fulfill({ json: { code: 0, data } })
const productRows = () => [{ id: 17, code: 'PRODUCT-001', displayName: '真实商品甲', name: '真实商品甲', status: 'active' },
  { id: 18, code: 'PRODUCT-002', displayName: '真实商品乙', name: '真实商品乙', status: 'disabled' }]

for (const operation of ['create', 'update'] as const) {
  test(`duplicate brand prefix during ${operation} retains the form for correction`, async ({ page }) => {
    const rows = [{ id: 5, name: 'Original brand', code: 'ORIGINAL', status: 'active' }], bodies: any[] = []
    await mockApp(page, async (route, path) => {
      if (path.endsWith('/code-suggestion')) return success(route, { code: 'DEPIN' })
      if (['POST', 'PATCH'].includes(route.request().method()) && /\/admin\/brands(?:\/5)?$/.test(path)) {
        const body = route.request().postDataJSON(); bodies.push(body)
        if (body.code === 'DEPIN') return route.fulfill({ status: 409, json: { code: 409, errorCode: 'BRD_1002', message: '品牌编码前缀已存在' } })
        if (operation === 'create') rows.push({ id: 6, ...body, status: 'active' }); else Object.assign(rows[0]!, body)
        return success(route, { id: 6, ...body })
      }
      return success(route, path.endsWith('/admin/brands') ? rows : [])
    })
    await page.goto('/products/brands')
    await page.getByRole('button', { name: operation === 'create' ? '新建品牌' : '编辑', exact: true }).click()
    const dialog = page.getByRole('dialog', { name: operation === 'create' ? '新建品牌' : '编辑品牌' })
    await dialog.getByLabel('品牌名称', { exact: true }).fill('New brand name')
    await dialog.getByLabel('品牌编码前缀', { exact: true }).fill('DEPIN')
    await dialog.getByRole('button', { name: '保存', exact: true }).click()
    await expect(page.getByText('品牌编码前缀已存在', { exact: true }).first()).toBeVisible()
    await expect(dialog).toBeVisible()
    await expect(dialog.getByLabel('品牌名称', { exact: true })).toHaveValue('New brand name')
    expect(rows).toEqual([{ id: 5, name: 'Original brand', code: 'ORIGINAL', status: 'active' }])
    await dialog.getByLabel('品牌编码前缀', { exact: true }).fill('NEWCODE')
    await dialog.getByRole('button', { name: '保存', exact: true }).click()
    await expect(dialog).toBeHidden()
    expect(bodies.map(body => body.code)).toEqual(['DEPIN', 'NEWCODE'])
  })
}

test('historical product delete can be cancelled, archives its list row and leaves the order snapshot readable', async ({ page }) => {
  const rows = productRows(), writes: string[] = []
  const orderItem = { id: 2, productId: 17, skuId: 19, productName: '下单时的旧商品名称', skuSpecText: '500克/袋', quantity: 2, unitPrice: '19.90', amount: '39.80', saleUnit: '袋' }
  await mockApp(page, async (route, path) => {
    if (route.request().method() === 'DELETE') { writes.push(path); rows.splice(0, 1); return success(route, { id: 17, status: 'archived' }) }
    if (path.endsWith('/products')) return success(route, { items: rows, total: rows.length })
    if (path.endsWith('/orders/25')) return success(route, { id: 25, orderNo: 'SYNTHETIC-HISTORY', status: 'completed', customer: { customerName: '模拟客户' }, totalAmount: '39.80', payableAmount: '39.80', items: [orderItem], statusLogs: [], refunds: [] })
    return success(route)
  })
  await page.goto('/products')
  const row = page.getByRole('row').filter({ hasText: 'PRODUCT-001' })
  await row.getByRole('button', { name: '删除', exact: true }).click()
  const dialog = page.getByRole('dialog', { name: '删除商品' })
  await expect(dialog).toContainText('历史订单会保留')
  await dialog.getByRole('button', { name: '取消', exact: true }).click()
  expect(writes).toHaveLength(0)
  await row.getByRole('button', { name: '删除', exact: true }).click()
  await dialog.getByRole('button', { name: '确认删除', exact: true }).click()
  await expect(row).toHaveCount(0)
  expect(writes).toEqual(['/api/v1/products/17'])
  await page.goto('/orders/25')
  await expect(page.getByText('下单时的旧商品名称', { exact: true })).toBeVisible()
  await expect(page.getByText('500克/袋', { exact: true })).toBeVisible()
  expect(orderItem).toMatchObject({ quantity: 2, unitPrice: '19.90', amount: '39.80', productId: 17, skuId: 19 })
})

test('copying a disabled SKU keeps its options and zero values but starts a fresh empty specification', async ({ page }) => {
  const original = { id: 19, skuCode: 'PRODUCT-09', specText: '500克/袋', saleUnit: '袋', basePrice: '0', minOrderQty: 3, stockNum: 80, reservedNum: 15, status: 'disabled',
    imageUrl: '/b.jpg', packagingUnits: [{ unit: '箱', factor: 20 }], lowStockThreshold: 0, leadTimeDays: 4, safetyStock: 0, batchTracking: true }
  const product: any = { id: 17, name: '真实商品甲', subtitle: '真实商品甲', code: 'PRODUCT', brandId: 4, categoryId: 3, status: 'active', images: ['/a.jpg', '/b.jpg'], skus: [original] }
  let body: any
  await mockApp(page, async (route, path) => {
    if (path.endsWith('/brands')) return success(route, [{ id: 4, name: 'Brand', code: 'BRAND' }])
    if (path.endsWith('/product-categories')) return success(route, [{ id: 3, name: 'Category' }])
    if (path.endsWith('/products/17/skus')) { body = route.request().postDataJSON(); const copied = { id: 20, skuCode: 'PRODUCT-10', stockNum: 0, reservedNum: 0, status: 'active', ...body }; product.skus.push(copied); return success(route, copied) }
    return success(route, path.endsWith('/products/17') ? product : [])
  })
  await page.goto('/products/17/edit')
  await page.getByRole('button', { name: '复制规格' }).click()
  const dialog = page.getByRole('dialog', { name: '新建商品规格' })
  await expect(dialog.getByLabel('规格编码')).toHaveValue('PRODUCT-10')
  await expect(dialog.getByLabel('最低库存')).toHaveValue('0')
  await expect(dialog.getByLabel('安全库存')).toHaveValue('0')
  await expect(dialog.getByLabel('每包装基础数量1')).toHaveValue('20')
  await dialog.getByLabel('规格名', { exact: true }).fill('200克/袋')
  await dialog.getByRole('button', { name: '保存', exact: true }).click()
  await expect(dialog).toBeHidden()
  expect(body).toMatchObject({ specText: '200克/袋', basePrice: '0', minOrderQty: 3, imageUrl: '/b.jpg', packagingUnits: [{ unit: '箱', factor: 20 }], lowStockThreshold: 0, safetyStock: 0, leadTimeDays: 4, batchTracking: true })
  for (const key of ['id', 'skuCode', 'stockNum', 'reservedNum', 'status']) expect(body).not.toHaveProperty(key)
  expect(original).toMatchObject({ stockNum: 80, reservedNum: 15, status: 'disabled', skuCode: 'PRODUCT-09' })
  await expect(page.getByRole('row').filter({ hasText: 'PRODUCT-10' })).toContainText('0（出入库调整）')
})

test('SKU disable can be cancelled, handles a rejected update and then enables again without changing inventory', async ({ page }) => {
  const sku = { id: 19, skuCode: 'PRODUCT-01', specText: '500克/袋', saleUnit: '袋', basePrice: '19.90', minOrderQty: 1, stockNum: 22, reservedNum: 3, status: 'active' }
  const writes: any[] = []
  await mockApp(page, async (route, path) => {
    if (path.endsWith('/skus/19/status')) {
      const body = route.request().postDataJSON(); writes.push(body)
      if (writes.length === 1) return route.fulfill({ status: 409, json: { code: 409, message: '规格状态已变化，请刷新后重试' } })
      Object.assign(sku, body); return success(route, sku)
    }
    if (path.endsWith('/products/17')) return success(route, { id: 17, name: '真实商品甲', code: 'PRODUCT', status: 'active', skus: [sku] })
    return success(route)
  })
  await page.goto('/products/17/edit')
  const row = page.getByRole('row').filter({ hasText: 'PRODUCT-01' })
  await row.getByRole('button', { name: '禁用', exact: true }).click()
  await page.getByRole('dialog', { name: '操作确认' }).getByRole('button', { name: '取消', exact: true }).click()
  expect(writes).toHaveLength(0)
  for (let step = 0; step < 2; step++) {
    await row.getByRole('button', { name: '禁用', exact: true }).click()
    await page.getByRole('dialog', { name: '操作确认' }).getByRole('button', { name: '确认禁用', exact: true }).click()
    if (!step) await expect(page.getByText('规格状态已变化，请刷新后重试', { exact: true })).toBeVisible()
  }
  await expect(row.getByRole('button', { name: '启用', exact: true })).toBeVisible()
  await row.getByRole('button', { name: '启用', exact: true }).click()
  await page.getByRole('dialog', { name: '操作确认' }).getByRole('button', { name: '确认启用', exact: true }).click()
  await expect(row.getByRole('button', { name: '禁用', exact: true })).toBeVisible()
  expect(writes).toEqual([{ status: 'disabled' }, { status: 'disabled' }, { status: 'active' }])
  expect(sku).toMatchObject({ stockNum: 22, reservedNum: 3, status: 'active' })
})

test('product list state and bulk confirmation buttons are Chinese and cancelling never writes', async ({ page }) => {
  const rows = productRows(), writes: string[] = []
  await mockApp(page, async (route, path) => {
    if (['PATCH', 'DELETE'].includes(route.request().method())) { writes.push(path); return success(route) }
    return success(route, path.endsWith('/products') ? { items: rows, total: 2 } : [])
  })
  await page.goto('/products')
  const first = page.getByRole('row').filter({ hasText: 'PRODUCT-001' })
  const second = page.getByRole('row').filter({ hasText: 'PRODUCT-002' })
  for (const [row, label] of [[first, '下架'], [second, '上架']] as const) {
    await row.getByRole('button', { name: label, exact: true }).click()
    const dialog = page.getByRole('dialog', { name: '操作确认' })
    await expect(dialog.getByRole('button', { name: `确认${label}`, exact: true })).toBeVisible()
    await dialog.getByRole('button', { name: '取消', exact: true }).click()
  }
  await first.locator('label.el-checkbox').click()
  await page.getByRole('button', { name: '批量下架', exact: true }).click()
  let dialog = page.getByRole('dialog', { name: '批量下架确认' })
  await expect(dialog.getByRole('button', { name: '确认下架', exact: true })).toBeVisible()
  await dialog.getByRole('button', { name: '取消', exact: true }).click()
  await page.getByRole('button', { name: '批量删除', exact: true }).click()
  dialog = page.getByRole('dialog', { name: '批量删除商品' })
  await expect(dialog.getByRole('button', { name: '确认删除', exact: true })).toBeVisible()
  await dialog.getByRole('button', { name: '取消', exact: true }).click()
  expect(writes).toHaveLength(0)
})

test('confirmed Chinese product actions keep their original single-row and selected-row request boundaries', async ({ page }) => {
  const rows = productRows(), writes: Array<{ path: string; body: any }> = []
  await mockApp(page, async (route, path) => {
    if (route.request().method() === 'PATCH') {
      const body = route.request().postDataJSON(); writes.push({ path, body })
      if (path.endsWith('/products/18/status')) rows[1]!.status = body.status
      if (path.endsWith('/batch-status')) for (const row of rows) if (body.productIds.includes(row.id)) row.status = body.status
      if (path.endsWith('/batch-archive')) for (let index = rows.length - 1; index >= 0; index--) if (body.productIds.includes(rows[index]!.id)) rows.splice(index, 1)
      return success(route, { updatedCount: body.productIds?.length || 1 })
    }
    return success(route, path.endsWith('/products') ? { items: rows, total: rows.length } : [])
  })
  await page.goto('/products')
  const first = page.getByRole('row').filter({ hasText: 'PRODUCT-001' })
  const second = page.getByRole('row').filter({ hasText: 'PRODUCT-002' })
  await second.getByRole('button', { name: '上架', exact: true }).click()
  await page.getByRole('dialog', { name: '操作确认' }).getByRole('button', { name: '确认上架', exact: true }).click()
  await expect(second.getByRole('button', { name: '下架', exact: true })).toBeVisible()
  await first.locator('label.el-checkbox').click()
  await second.locator('label.el-checkbox').click()
  await page.getByRole('button', { name: '批量下架', exact: true }).click()
  await page.getByRole('dialog', { name: '批量下架确认' }).getByRole('button', { name: '确认下架', exact: true }).click()
  await expect(first.getByRole('button', { name: '上架', exact: true })).toBeVisible()
  await expect(second.getByRole('button', { name: '上架', exact: true })).toBeVisible()
  await first.locator('label.el-checkbox').click()
  await page.getByRole('button', { name: '批量删除', exact: true }).click()
  await page.getByRole('dialog', { name: '批量删除商品' }).getByRole('button', { name: '确认删除', exact: true }).click()
  await expect(first).toHaveCount(0)
  await expect(second).toBeVisible()
  expect(writes).toEqual([
    { path: '/api/v1/products/18/status', body: { status: 'active' } },
    { path: '/api/v1/products/batch-status', body: { productIds: [17, 18], status: 'disabled' } },
    { path: '/api/v1/products/batch-archive', body: { productIds: [17] } }
  ])
})
