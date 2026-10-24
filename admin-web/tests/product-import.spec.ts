import { test, expect, type Page } from '@playwright/test'

async function productPage(page: Page, onImport: (route: any) => any = route => route.fulfill({ json: { code: 0, data: { brandCount: 1, productCount: 1, skuCount: 2, priceRuleCount: 0, skipped: 1 } } })) {
  await page.addInitScript(() => localStorage.setItem('accessToken', 'qa-import-ui'))
  await page.route('**/api/v1/**', route => {
    const path = new URL(route.request().url()).pathname
    if (path.endsWith('/imports/products')) return onImport(route)
    const data = path.endsWith('/auth/profile')
      ? { user: { id: 1, userType: 'super_admin' }, permissions: [], menus: [] }
      : path.endsWith('/products') ? { items: [], total: 0 } : []
    return route.fulfill({ json: { code: 0, data } })
  })
  await page.goto('/products')
  await expect(page.getByRole('heading', { name: '商品管理', exact: true })).toBeVisible()
}

test('explains the real-name XLSX columns and inventory/code rules with a selectable example', async ({ page }) => {
  let requests = 0
  await productPage(page, route => { requests++; return route.fulfill({ json: { code: 0, data: {} } }) })
  await expect(page.locator('input[type=file]')).toHaveAttribute('accept', '.xlsx')
  await page.getByRole('button', { name: '导入格式说明' }).click()
  const dialog = page.getByRole('dialog', { name: '商品导入格式说明' })
  await expect(dialog).toContainText('不支持.xls或CSV')
  await expect(dialog).toContainText('原副标题')
  await expect(dialog).toContainText('库存列只能留空或填0')
  await expect(dialog).toContainText('新商品的“商品编码”列留空')
  await expect(dialog).toContainText('填写时请先在页面选择目标客户')
  await expect(dialog.getByRole('textbox', { name: '可复制的商品导入示例' })).toHaveValue('品牌\t分类\t商品名称\t规格\t单位\t基础价\t起订量\n请替换为已有品牌\t请替换为已有分类\t爆汁牛筋丸\t500克/袋\t袋\t19.90\t1')
  await expect(dialog.getByRole('textbox', { name: '可复制的商品导入示例' })).toHaveAttribute('readonly', '')
  expect(requests).toBe(0)
})

test('rejects legacy XLS and oversized files before sending a request', async ({ page }) => {
  let requests = 0
  await productPage(page, route => { requests++; return route.fulfill({ json: { code: 0, data: {} } }) })
  const input = page.locator('input[type=file]')
  await input.setInputFiles({ name: 'legacy.xls', mimeType: 'application/vnd.ms-excel', buffer: Buffer.from('legacy-file') })
  await expect(page.getByText('仅支持.xlsx文件，请在Excel中另存为Excel工作簿后上传', { exact: true })).toBeVisible()
  await input.setInputFiles({ name: 'too-large.xlsx', mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', buffer: Buffer.alloc(5 * 1024 * 1024 + 1) })
  await expect(page.getByText('文件不能超过5MB，请拆分后导入', { exact: true })).toBeVisible()
  expect(requests).toBe(0)
})

test('shows bounded backend row errors and the total without losing the first error', async ({ page }) => {
  await productPage(page, route => route.fulfill({ status: 400, json: { code: 400, errorCode: 'IMP_1002', message: '导入校验失败',
    data: { errorCount: 25, errors: Array.from({ length: 25 }, (_, i) => ({ row: i + 2, message: `请修正第${i + 2}行`, privateValue: 'not-visible' })) } } }))
  // Request/response UI is mocked; real XLSX decoding and database rollback are covered in backend tests.
  await page.locator('input[type=file]').setInputFiles({ name: 'rows.xlsx', mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', buffer: Buffer.from('mock-workbook') })
  const dialog = page.getByRole('dialog', { name: '商品导入未完成' })
  await expect(dialog).toContainText('本次导入未写入任何数据')
  await expect(dialog).toContainText('共25处错误，以下展示前20处')
  await expect(dialog.locator('.el-table__body tbody tr')).toHaveCount(20)
  await expect(dialog).toContainText('请修正第2行')
  await expect(dialog).not.toContainText('请修正第22行')
  await expect(dialog).not.toContainText('not-visible')
})

test('keeps the multipart contract and reports actual success counts', async ({ page }) => {
  let requestBody = ''
  await productPage(page, route => {
    requestBody = route.request().postData() || ''
    expect(route.request().headers()['content-type']).toContain('multipart/form-data; boundary=')
    expect(route.request().headers().authorization).toBe('Bearer qa-import-ui')
    return route.fulfill({ json: { code: 0, data: { brandCount: 1, productCount: 1, skuCount: 2, priceRuleCount: 0, skipped: 1 } } })
  })
  await page.locator('input[type=file]').setInputFiles({ name: 'products.xlsx', mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', buffer: Buffer.from('mock-workbook') })
  await expect(page.getByText('导入完成：品牌 1，商品 1，SKU 2，协议价 0，跳过 1', { exact: true })).toBeVisible()
  expect(requestBody).toContain('name="file"; filename="products.xlsx"')
})
