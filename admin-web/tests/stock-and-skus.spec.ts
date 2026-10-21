import { test, expect } from '@playwright/test'

test('new specifications preview the next code in price-sorted lists and omit manual codes on save', async ({ page }) => {
  let body: any
  const product: any = { id: 1, name: '牛筋丸', subtitle: '牛筋丸', code: 'LIZHIYAN-WanHua-001', brandId: 1, categoryId: 1, status: 'active', skus: [
    { id: 12, skuCode: 'LIZHIYAN-WanHua-001-02', specText: '200克/袋', saleUnit: '袋', basePrice: '12.9', minOrderQty: 1, stockNum: 0, status: 'active' },
    { id: 11, skuCode: 'LIZHIYAN-WanHua-001-01', specText: '500克/袋', saleUnit: '袋', basePrice: '19.9', minOrderQty: 1, stockNum: 20, status: 'active' }
  ] }
  await page.addInitScript(() => localStorage.setItem('accessToken', 'sku-test'))
  await page.route('**/api/v1/**', route => {
    const path = new URL(route.request().url()).pathname
    let data: any = []
    if (path.endsWith('/auth/profile')) data = { user: { id: 1, userType: 'super_admin' }, permissions: [], menus: [] }
    if (path.endsWith('/brands')) data = [{ id: 1, name: '利至雁', code: 'LIZHIYAN' }]
    if (path.endsWith('/product-categories')) data = [{ id: 1, name: '丸滑', codeSegment: 'WanHua' }]
    if (path.endsWith('/products/1')) data = product
    if (path.endsWith('/products/1/skus')) { body = route.request().postDataJSON(); data = { id: 13, skuCode: product.code + '-03', ...body, status: 'active', stockNum: 0 }; product.skus.push(data) }
    return route.fulfill({ json: { code: 0, data } })
  })
  await page.goto('/products/1/edit')
  await page.getByRole('button', { name: '新建规格', exact: true }).click()
  const dialog = page.getByRole('dialog')
  await expect(dialog.getByLabel('规格编码')).toHaveValue('LIZHIYAN-WanHua-001-03')
  await expect(dialog.getByLabel('规格编码')).not.toBeEditable()
  await dialog.getByLabel('规格名', { exact: true }).fill('1000克/袋')
  await dialog.getByRole('button', { name: '保存', exact: true }).click()
  await expect(dialog).not.toBeVisible()
  expect(body.skuCode).toBeUndefined()
  expect(body.stockNum).toBeUndefined()
  await page.getByRole('button', { name: '新建规格', exact: true }).click()
  await expect(dialog.getByLabel('规格编码')).toHaveValue('LIZHIYAN-WanHua-001-04')
})

test('inventory drafts refresh their preview and require reviewed confirmation before executing', async ({ page }) => {
  let confirmations = 0
  let draft: any = { type: 'draft', id: '00000000-0000-4000-8000-000000000002', action: 'inventory.adjust', version: 1, digest: 'stock-1', status: 'draft', missing: [], payload: {
    keyword: '爆汁牛筋丸', specText: '500克/袋', unit: '袋', skuId: 11, mode: 'increase', quantity: 10, reason: '采购到货', candidates: [], truncated: false,
    item: { skuId: 11, productId: 1, productName: '爆汁牛筋丸', skuCode: 'P-001-01', specText: '500克/袋', saleUnit: '袋', beforeQty: 20 }, afterQty: 30, changeQty: 10
  } }
  const conversationId = '00000000-0000-4000-8000-000000000001'
  await page.addInitScript(() => localStorage.setItem('accessToken', 'inventory-test'))
  await page.route('**/api/v1/**', route => {
    const path = new URL(route.request().url()).pathname
    let data: any = { items: [] }
    if (path.endsWith('/auth/profile')) data = { user: { id: 1, name: '仓管', userType: 'warehouse' }, permissions: ['ai:use', 'ai:execute', 'inventory:read', 'inventory:adjust', 'product:read'], menus: [] }
    if (path.endsWith('/admin/ai/capabilities')) data = { enabled: true, allowWrites: true, canExecute: true, features: { inventory: true }, tools: ['inventory_adjust_draft'], scope: { allBrands: false, brandCount: 1 } }
    if (path.endsWith('/admin/ai/conversations')) data = route.request().method() === 'POST' ? { id: conversationId } : []
    if (path.endsWith('/runs')) {
      const result = { userMessage: { id: 'u', role: 'user', content: route.request().postDataJSON().text }, message: { id: 'a', role: 'assistant', content: '请核对库存调整草稿', cards: [draft] } }
      return route.fulfill({ contentType: 'text/event-stream', body: `event: result\ndata: ${JSON.stringify(result)}\n\n` })
    }
    if (path.endsWith('/drafts/' + draft.id)) { const payload = route.request().postDataJSON().payload; draft = { ...draft, version: 2, digest: 'stock-2', payload: { ...payload, afterQty: 20 + payload.quantity, changeQty: payload.quantity } }; data = draft }
    if (path.endsWith('/confirm')) { confirmations++; expect(route.request().postDataJSON()).toEqual({ version: 2, digest: 'stock-2' }); data = { id: 'execution', result: { ...draft.payload.item, afterQty: 35, adjustmentNo: 'AI-TEST-1' } } }
    return route.fulfill({ json: { code: 0, data } })
  })
  await page.goto('/products')
  await page.getByRole('button', { name: '打开AI运营助手' }).click()
  await expect(page.getByRole('button', { name: '一句话调库存' })).toBeVisible()
  await page.getByRole('textbox', { name: '向AI运营助手描述需求' }).fill('把爆汁牛筋丸500克/袋库存增加10袋')
  await page.getByRole('button', { name: '发送', exact: true }).click()
  await expect(page.getByText('当前 20袋 → 调整后 30袋')).toBeVisible()
  await page.getByRole('spinbutton', { name: '库存调整数量' }).fill('15')
  await expect(page.getByRole('button', { name: '检查并调整库存' })).toBeDisabled()
  await page.getByRole('button', { name: '保存修改' }).click()
  await expect(page.getByText('当前 20袋 → 调整后 35袋')).toBeVisible()
  await page.getByRole('button', { name: '检查并调整库存' }).click()
  await expect(page.getByText(/库存从20袋调整为35袋/)).toBeVisible()
  expect(confirmations).toBe(0)
  await page.getByRole('button', { name: '返回检查', exact: true }).click()
  expect(confirmations).toBe(0)
  await page.getByRole('button', { name: '检查并调整库存' }).click()
  await page.getByRole('button', { name: '确认执行', exact: true }).click()
  await expect(page.getByText(/出入库单 AI-TEST-1/)).toBeVisible()
  expect(confirmations).toBe(1)
})
