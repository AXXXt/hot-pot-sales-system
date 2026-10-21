import { test, expect } from '@playwright/test'

test('copies a SKU with its picture, package and planning settings but without stock or an old code', async ({ page }) => {
  let body: any
  const product: any = { id: 1, name: '牛筋丸', subtitle: '牛筋丸', code: 'P-001', brandId: 1, categoryId: 1, status: 'active', images: ['/a.jpg', '/b.jpg'], skus: [{ id: 11, skuCode: 'P-001-01', specText: '500克/袋', saleUnit: '袋', basePrice: '20', minOrderQty: 1, stockNum: 100, reservedNum: 10, status: 'active', imageUrl: '/b.jpg', packagingUnits: [{ unit: '箱', factor: 20 }], lowStockThreshold: 30, leadTimeDays: 4, safetyStock: 10, batchTracking: false }] }
  await page.addInitScript(() => localStorage.setItem('accessToken', 'workflow-test'))
  await page.route('**/api/v1/**', route => {
    const path = new URL(route.request().url()).pathname
    let data: any = []
    if (path.endsWith('/auth/profile')) data = { user: { id: 1, userType: 'super_admin' }, permissions: [], menus: [] }
    if (path.endsWith('/brands')) data = [{ id: 1, name: '品牌', code: 'P' }]
    if (path.endsWith('/product-categories')) data = [{ id: 1, name: '丸滑', codeSegment: 'WanHua' }]
    if (path.endsWith('/products/1')) data = product
    if (path.endsWith('/products/1/skus')) { body = route.request().postDataJSON(); data = { id: 12, ...body, skuCode: 'P-001-02', stockNum: 0, status: 'active' }; product.skus.push(data) }
    return route.fulfill({ json: { code: 0, data } })
  })
  await page.goto('/products/1/edit')
  await page.getByRole('button', { name: '复制规格' }).click()
  const dialog = page.getByRole('dialog')
  await expect(dialog.getByLabel('规格编码')).toHaveValue('P-001-02')
  await expect(dialog.getByLabel('每包装基础数量1')).toHaveValue('20')
  await expect(dialog.getByLabel('最低库存')).toHaveValue('30')
  await dialog.getByLabel('规格名', { exact: true }).fill('1000克/袋')
  await dialog.getByRole('button', { name: '保存', exact: true }).click()
  await expect(dialog).not.toBeVisible()
  expect(body).toMatchObject({ imageUrl: '/b.jpg', packagingUnits: [{ unit: '箱', factor: 20 }], lowStockThreshold: 30, leadTimeDays: 4, safetyStock: 10 })
  expect(body.stockNum).toBeUndefined(); expect(body.skuCode).toBeUndefined(); expect(body.reservedNum).toBeUndefined()
})

test('shows reservations and expiry warnings, saves replenishment drafts and separately assigns historical batches', async ({ page }) => {
  let planBody: any, assignBody: any
  const row: any = { skuId: 11, skuCode: 'P-01', productName: '牛筋丸', specText: '500克/袋', saleUnit: '袋', stockNum: 10, reservedNum: 7, pendingDemand: 7, availableNum: 3, lowStock: true, threshold: 6, sold28: 28, suggestedQuantity: 8, batchTracking: true, unknownBatchQuantity: 10 }
  const plans: any[] = []
  await page.addInitScript(() => localStorage.setItem('accessToken', 'planning-test'))
  await page.route('**/api/v1/**', route => {
    const path = new URL(route.request().url()).pathname
    let data: any = { items: [] }
    if (path.endsWith('/auth/profile')) data = { user: { id: 1, userType: 'super_admin' }, permissions: [], menus: [] }
    if (path.endsWith('/inventory/planning')) data = { items: [row], note: '按基础单位核算；待审预占不重复扣减。' }
    if (path.endsWith('/inventory/batches')) data = { items: [{ id: 1, ...row, quantity: 10, batchNo: '历史/未注明批次', state: '日期未知', expiryDate: '' }] }
    if (path.endsWith('/replenishment-plans')) {
      if (route.request().method() === 'POST') { planBody = route.request().postDataJSON(); plans.push({ id: 1, planNo: 'RP-TEST', status: 'draft', updatedAt: '2026-10-21T00:00:00Z', payload: { items: [{ ...row, quantity: planBody.items[0].quantity }] } }) }
      data = { items: plans }
    }
    if (path.endsWith('/batches/assign')) { assignBody = route.request().postDataJSON(); data = { id: 2, batchNo: 'B-01' } }
    return route.fulfill({ json: { code: 0, data } })
  })
  await page.goto('/inventory/planning')
  await expect(page.getByRole('heading', { name: '库存计划与批次' })).toBeVisible()
  const tableRow = page.getByRole('row').filter({ hasText: '牛筋丸' })
  await expect(tableRow).toContainText('日期未知 10')
  await tableRow.locator('label.el-checkbox').click()
  await page.getByRole('button', { name: '保存补货草稿' }).click()
  await page.getByRole('button', { name: '保存草稿', exact: true }).click()
  await expect(page.getByText('RP-TEST · 待采购')).toBeVisible()
  expect(planBody.items).toEqual([{ skuId: 11, quantity: 8 }])
  await page.getByRole('tab', { name: '批次与保质期' }).click()
  await page.getByRole('button', { name: '补登记批次' }).click()
  await page.getByLabel('补登记批次数量').fill('4')
  await page.getByLabel('补登记批次号').fill('B-01')
  await page.getByLabel('补登记到期日期').fill('2030-01-01')
  await page.getByRole('button', { name: '登记批次', exact: true }).click()
  await expect(page.locator('.el-message-box')).toContainText('总库存不变')
  expect(assignBody).toBeUndefined()
  await page.getByRole('button', { name: '确认登记', exact: true }).click()
  await expect(page.getByRole('button', { name: '登记批次', exact: true })).not.toBeVisible()
  expect(assignBody).toMatchObject({ fromBatchId: 1, quantity: 4, batchNo: 'B-01', expiryDate: '2030-01-01' })
})

for (const action of ['inventory.batch', 'order.create']) {
  test(`${action} lets staff review every row and only writes after the confirmation button`, async ({ page }) => {
    let confirmations = 0
    const item = { skuId: 11, productName: '牛筋丸', skuCode: 'P-01', specText: '500克/袋', saleUnit: '袋', beforeQty: 20 }
    const line = { skuId: 11, keyword: '牛筋丸', specText: '500克/袋', quantity: 2, unit: '箱', factor: 20, item, afterQty: 60, baseQuantity: 40, unitPrice: '18.50', amount: '740.00', candidates: [] }
    const draft: any = { id: 'draft-workflow', type: 'draft', action, version: 1, digest: 'trusted', status: 'draft', missing: [], payload: { mode: 'increase', reason: '到货', lines: [line], customerId: 1, customerName: '测试门店', customer: { id: 1, customerName: '测试门店' }, customerCandidates: [], orders: [{ brandId: 1, amount: '740.00' }] } }
    await page.addInitScript(() => localStorage.setItem('accessToken', 'ai-workflow-test'))
    await page.route('**/api/v1/**', route => {
      const path = new URL(route.request().url()).pathname
      let data: any = { items: [] }
      if (path.endsWith('/auth/profile')) data = { user: { id: 1, userType: 'super_admin' }, permissions: [], menus: [] }
      if (path.endsWith('/admin/ai/capabilities')) data = { enabled: true, allowWrites: true, canExecute: true, features: { inventory: true, orders: true, vision: true }, tools: ['inventory_batch_draft', 'order_list_draft'], scope: { allBrands: true } }
      if (path.endsWith('/admin/ai/conversations')) data = route.request().method() === 'POST' ? { id: 'conversation-workflow' } : []
      if (path.endsWith('/runs')) return route.fulfill({ contentType: 'text/event-stream', body: `event: result\ndata: ${JSON.stringify({ userMessage: { id: 'user', role: 'user', content: '处理清单' }, message: { id: 'assistant', role: 'assistant', content: '请核对清单', cards: [draft] } })}\n\n` })
      if (path.endsWith('/confirm')) { confirmations++; data = { id: 'execution-workflow', result: action === 'inventory.batch' ? { id: 1, items: [line], adjustmentNo: 'AI-BATCH-1' } : { id: 1, orders: [{ id: 1, orderNo: 'OD-1' }] } } }
      return route.fulfill({ json: { code: 0, data } })
    })
    await page.goto('/inventory/planning')
    await page.getByRole('button', { name: '打开AI运营助手' }).click()
    await expect(page.getByRole('button', { name: '照片', exact: true })).toBeVisible()
    await page.getByRole('textbox', { name: '向AI运营助手描述需求' }).fill('按清单处理，先生成草稿')
    await page.getByRole('button', { name: '发送', exact: true }).click()
    await expect(page.getByText('已保存的核对结果')).toBeVisible()
    expect(confirmations).toBe(0)
    await page.getByRole('button', { name: action === 'inventory.batch' ? '检查整单并执行' : '检查并创建订单草稿' }).click()
    await expect(page.locator('.el-message-box')).toContainText(action === 'inventory.batch' ? '20 → 60袋' : '740.00')
    await page.getByRole('button', { name: '返回检查', exact: true }).click()
    expect(confirmations).toBe(0)
    await page.getByRole('button', { name: action === 'inventory.batch' ? '检查整单并执行' : '检查并创建订单草稿' }).click()
    await page.getByRole('button', { name: '确认执行', exact: true }).click()
    await expect(page.getByText('已执行', { exact: true })).toBeVisible()
    expect(confirmations).toBe(1)
    if (action === 'order.create') await expect(page.getByText(/已创建1张订单草稿/)).toBeVisible()
  })
}
