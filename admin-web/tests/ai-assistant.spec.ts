import { expect, test, type Page } from '@playwright/test'

const conversationId = '00000000-0000-4000-8000-000000000001'
const draftId = '00000000-0000-4000-8000-000000000002'
const draft = { type: 'draft', id: draftId, action: 'product.create', version: 1, digest: 'test-digest', status: 'draft', missing: [], expiresAt: '2026-10-21T10:00:00Z', payload: {
  brandId: 1, categoryId: 1, subtitle: '雪花肥牛卷', description: '', skus: [{ specText: '500g×20袋/箱', saleUnit: '箱', basePrice: '298.00', minOrderQty: 2 }], attachmentIds: [], warnings: []
} }

async function fixture(page: Page, canExecute = true) {
  let messages: any[] = []; let drafts: any[] = []
  const permissions = ['dashboard:view', 'order:read', 'product:read', 'product:create', 'ai:use', 'ai:configure', 'task:manage_own', 'analytics:view', 'role:manage', ...(canExecute ? ['ai:execute'] : [])]
  await page.addInitScript(() => localStorage.setItem('accessToken', 'ai-ui-test-only'))
  await page.route('**/api/v1/**', async route => {
    const path = new URL(route.request().url()).pathname
    let data: any = { items: [], total: 0 }
    if (path.endsWith('/auth/profile')) data = { user: { id: 1, name: '测试运营人员', userType: 'admin' }, permissions, roles: [], brands: [{ id: 1, name: '唯哆鲜' }], menus: [] }
    if (path.endsWith('/dashboard/stats')) data = { todayOrders: 12, todayRevenue: 3580, pendingQuotes: 3, pendingShipments: 2, inventoryWarnings: 1, trend: [], orderStatuses: [], lowStockItems: [], recentOrders: [] }
    if (path.endsWith('/admin/ai/capabilities')) data = { enabled: true, allowWrites: true, canConfigure: true, canExecute, features: { products: true, vision: true, analytics: true, tasks: true }, tools: ['product_draft', 'metrics_summary', 'tasks_list'], scope: { allBrands: false, brandCount: 1, ownCustomersOnly: false } }
    if (path.endsWith('/admin/ai/catalog-options')) data = { brands: [{ id: 1, name: '唯哆鲜' }], categories: [{ id: 1, name: '肉类涮品' }] }
    if (path.endsWith('/admin/ai/conversations')) data = route.request().method() === 'POST' ? { id: conversationId } : [{ id: conversationId, title: '商品录入' }]
    if (path.endsWith(`/conversations/${conversationId}`)) data = { id: conversationId, messages, drafts }
    if (path.endsWith('/attachments')) data = { id: '00000000-0000-4000-8000-000000000003' }
    if (path.endsWith('/attachments/00000000-0000-4000-8000-000000000003')) return route.fulfill({ contentType: 'image/png', body: Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Wl2nE0AAAAASUVORK5CYII=', 'base64') })
    if (path.endsWith('/runs')) {
      const input = route.request().postDataJSON()
      const runDraft = { ...draft, payload: { ...draft.payload, attachmentIds: input.attachmentIds || [] } }
      const message = { id: 'assistant-1', role: 'assistant', content: '已生成商品草稿，请检查后确认。', cards: [runDraft] }
      const userMessage = { id: 'user-1', role: 'user', content: input.text }
      messages = [userMessage, message]; drafts = [runDraft]
      return route.fulfill({ contentType: 'text/event-stream', body: `event: progress\ndata: {"text":"正在生成草稿"}\n\nevent: result\ndata: ${JSON.stringify({ userMessage, message })}\n\n` })
    }
    if (path.endsWith(`/drafts/${draftId}/confirm`)) data = { id: 'execution-1', result: { id: 9, name: '雪花肥牛卷', managementLabel: '唯哆鲜肉类涮品', code: 'WDX-RLSP-1', status: 'disabled' } }
    if (path.endsWith('/admin/ai/tasks')) data = { items: [] }
    if (path.endsWith('/admin/ai/settings')) data = { enabled: false, baseUrl: 'https://api.deepseek.com/v1', textModel: 'deepseek-chat', visionModel: '', allowWrites: false, dailyRequests: 100, features: { products: true, vision: false, analytics: true, tasks: true }, hasKey: true, encryptionReady: true }
    if (path.endsWith('/authorization')) data = { roles: [], users: [], brands: [], permissions: [] }
    return route.fulfill({ json: { code: 0, data } })
  })
}

test('floating assistant preserves the conversation across pages and requires confirmation', async ({ page }, info) => {
  await page.setViewportSize({ width: 1440, height: 1000 })
  const errors: string[] = []; page.on('pageerror', e => errors.push(e.message))
  await fixture(page)
  await page.goto('/dashboard')
  await page.getByRole('button', { name: '打开AI运营助手' }).click()
  await expect(page.getByRole('region', { name: 'AI运营助手' })).toBeVisible()
  const prompt = page.getByRole('textbox', { name: '向AI运营助手描述需求' })
  await prompt.fill('新增唯哆鲜雪花肥牛卷，500g×20袋一箱，298元一箱，2箱起订')
  await page.getByRole('button', { name: '发送', exact: true }).click()
  await expect(page.getByRole('button', { name: '检查并创建' })).toBeEnabled()
  await page.getByRole('menuitem', { name: '商品管理', exact: true }).click()
  await expect(page).toHaveURL(/\/products$/)
  await expect(page.getByLabel('商品名称', { exact: true })).toHaveValue('雪花肥牛卷')
  await expect(page.getByRole('button', { name: '检查并创建' })).toBeVisible()
  await page.screenshot({ path: info.outputPath('ai-product-draft.png'), fullPage: true })
  const confirmed = page.waitForRequest(request => request.url().endsWith(`/drafts/${draftId}/confirm`))
  await page.getByRole('button', { name: '检查并创建' }).click()
  await page.getByRole('button', { name: '确认执行', exact: true }).click()
  expect((await confirmed).postDataJSON()).toEqual({ version: 1, digest: 'test-digest' })
  await expect(page.getByText(/已创建：雪花肥牛卷/)).toBeVisible()
  expect(errors).toEqual([])
})

test('staff without AI execution permission can review but cannot submit a product', async ({ page }) => {
  await fixture(page, false)
  await page.goto('/dashboard')
  await page.getByRole('button', { name: '打开AI运营助手' }).click()
  await page.getByRole('textbox', { name: '向AI运营助手描述需求' }).fill('添加商品')
  await page.getByRole('button', { name: '发送', exact: true }).click()
  await expect(page.getByRole('button', { name: '检查并创建' })).toBeDisabled()
  await expect(page.getByText('需要开启业务写入，并拥有AI执行及对应业务权限。')).toBeVisible()
})

test('configuration provides one menu and six tabs without returning the saved key', async ({ page }, info) => {
  await fixture(page)
  await page.goto('/ai-settings')
  await expect(page.getByRole('heading', { name: 'AI 助手配置', exact: true })).toBeVisible()
  for (const name of ['模型连接', '能力与权限', '业务规则', '知识与模板', '自动任务', '用量与审计']) await expect(page.getByRole('tab', { name, exact: true })).toBeVisible()
  await expect(page.getByPlaceholder('已保存密钥；留空保持原值')).toHaveValue('')
  await page.screenshot({ path: info.outputPath('ai-settings.png'), fullPage: true })
})

test('the assistant fills a narrow screen and can be minimized', async ({ page }, info) => {
  await page.setViewportSize({ width: 390, height: 844 })
  await fixture(page)
  await page.goto('/dashboard')
  await page.getByRole('button', { name: '打开AI运营助手' }).click()
  await expect(page.getByRole('dialog', { name: 'AI运营助手' })).toBeVisible()
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
  await page.screenshot({ path: info.outputPath('ai-mobile.png'), fullPage: true })
  await page.getByRole('button', { name: '最小化AI助手' }).click()
  await expect(page.getByRole('button', { name: '打开AI运营助手' })).toBeVisible()
})

test('a packaging photo remains privately available for comparison with the product draft', async ({ page }) => {
  await fixture(page)
  await page.goto('/dashboard')
  await page.getByRole('button', { name: '打开AI运营助手' }).click()
  await page.locator('.ai-composer input[type=file]').setInputFiles({ name: 'packaging.png', mimeType: 'image/png', buffer: Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Wl2nE0AAAAASUVORK5CYII=', 'base64') })
  await expect(page.getByRole('img', { name: '待识别包装照片1' })).toBeVisible()
  await page.getByRole('textbox', { name: '向AI运营助手描述需求' }).fill('从照片添加商品，按箱销售')
  await page.getByRole('button', { name: '发送', exact: true }).click()
  await expect(page.getByRole('img', { name: '包装照片1', exact: true })).toBeVisible()
  await expect(page.getByText('点击照片放大核对字段')).toBeVisible()
})

test('the dashboard hides unauthorized figures instead of presenting them as zero', async ({ page }) => {
  await fixture(page)
  await page.route('**/api/v1/dashboard/stats', route => route.fulfill({ json: { code: 0, data: { todayOrders: 999, todayRevenue: 999, monthRevenue: 999, pendingQuotes: 999, visibility: { orders: false, inventory: true, products: false, customers: false }, inventoryWarnings: 0, lowStockItems: [], metricDefinition: '仅提供当前人员已授权的数据。' } } }))
  await page.goto('/dashboard')
  await expect(page.getByText('待报价订单', { exact: true })).toHaveCount(0)
  await expect(page.getByRole('heading', { name: '高风险库存', exact: true })).toBeVisible()
  await page.getByRole('tab', { name: '经营概览', exact: true }).click()
  await expect(page.getByText('今日有效订单额', { exact: true })).toHaveCount(0)
  await expect(page.getByRole('heading', { name: '客户概况', exact: true })).toHaveCount(0)
})

test('new brand and category suggestions are editable and named in the confirmation', async ({ page }) => {
  await fixture(page)
  await page.route('**/api/v1/admin/ai/catalog-options', route => route.fulfill({ json: { code: 0, data: { brands: [], categories: [], canCreateBrand: true, canCreateCategory: true } } }))
  const suggested = { ...draft, payload: { ...draft.payload, brandId: null, categoryId: null, brandName: '鲜味品牌', categoryName: '鸭血制品' } }
  await page.route('**/conversations/*/runs', route => route.fulfill({ contentType: 'text/event-stream', body: `event: result\ndata: ${JSON.stringify({ userMessage: { id: 'u-new', role: 'user', content: '创建商品及对应品牌分类' }, message: { id: 'a-new', role: 'assistant', content: '请核对新品牌和分类。', cards: [suggested] } })}\n\n` }))
  await page.goto('/dashboard')
  await page.getByRole('button', { name: '打开AI运营助手' }).click()
  await page.getByRole('textbox', { name: '向AI运营助手描述需求' }).fill('创建商品及对应品牌分类')
  await page.getByRole('button', { name: '发送', exact: true }).click()
  await expect(page.getByRole('textbox', { name: '新品牌名称' })).toHaveValue('鲜味品牌')
  await expect(page.getByRole('textbox', { name: '新分类名称' })).toHaveValue('鸭血制品')
  await page.getByRole('button', { name: '检查并创建' }).click()
  await expect(page.getByRole('dialog').getByText(/同时新建品牌“鲜味品牌”、分类“鸭血制品”/)).toBeVisible()
  await page.getByRole('button', { name: '返回检查', exact: true }).click()
})

test('an existing incomplete draft can add its missing brand and category without losing SKU fields', async ({ page }) => {
  await fixture(page)
  await page.route('**/api/v1/admin/ai/catalog-options', route => route.fulfill({ json: { code: 0, data: { brands: [], categories: [], canCreateBrand: true, canCreateCategory: true } } }))
  const incomplete = { ...draft, missing: ['品牌', '分类'], payload: { ...draft.payload, brandId: null, categoryId: null } }
  await page.route('**/conversations/*/runs', route => route.fulfill({ contentType: 'text/event-stream', body: `event: result\ndata: ${JSON.stringify({ userMessage: { id: 'u-missing', role: 'user', content: '商品录入' }, message: { id: 'a-missing', role: 'assistant', content: '请补齐。', cards: [incomplete] } })}\n\n` }))
  await page.route(`**/drafts/${draftId}`, async route => { const body = route.request().postDataJSON(); await route.fulfill({ json: { code: 0, data: { ...incomplete, version: 2, digest: 'saved-new-catalog', missing: [], payload: body.payload } } }) })
  await page.goto('/dashboard')
  await page.getByRole('button', { name: '打开AI运营助手' }).click()
  await page.getByRole('textbox', { name: '向AI运营助手描述需求' }).fill('商品录入')
  await page.getByRole('button', { name: '发送', exact: true }).click()
  await page.getByRole('textbox', { name: '新品牌名称' }).fill('鲜味品牌')
  await page.getByRole('textbox', { name: '新分类名称' }).fill('鸭血制品')
  const save = page.waitForRequest(request => request.method() === 'PATCH' && request.url().endsWith(`/drafts/${draftId}`))
  await page.getByRole('button', { name: '保存修改' }).click()
  expect((await save).postDataJSON().payload).toMatchObject({ brandId: null, categoryId: null, brandName: '鲜味品牌', categoryName: '鸭血制品', skus: draft.payload.skus })
  await expect(page.getByRole('button', { name: '检查并创建' })).toBeEnabled()
})

async function transfer(page: Page, files: Array<{ name: string; type: string; bytes?: number }>) {
  return page.evaluateHandle(items => { const data = new DataTransfer(); for (const file of items) data.items.add(new File([new Uint8Array(file.bytes || 100)], file.name, { type: file.type })); return data }, files)
}
test('dropping packaging photos attaches them and preserves unsent text across pages', async ({ page }) => {
  await fixture(page); await page.goto('/dashboard'); await page.getByRole('button', { name: '打开AI运营助手' }).click()
  const panel = page.getByRole('region', { name: 'AI运营助手' })
  const prompt = page.getByRole('textbox', { name: '向AI运营助手描述需求' }); await prompt.fill('用照片添加商品')
  const dataTransfer = await transfer(page, [{ name: '包装.png', type: 'image/png' }])
  await panel.dispatchEvent('dragenter', { dataTransfer }); await expect(page.getByText('松开即可添加包装照片')).toBeVisible()
  const upload = page.waitForRequest(request => request.method() === 'POST' && request.url().endsWith('/attachments'))
  await prompt.dispatchEvent('drop', { dataTransfer }); await upload
  await expect(page.getByText('松开即可添加包装照片')).toHaveCount(0)
  await expect(page.getByRole('img', { name: '待识别包装照片1' })).toBeVisible()
  await expect(prompt).toHaveValue('用照片添加商品')
  await page.getByRole('menuitem', { name: '商品管理', exact: true }).click()
  await expect(page.getByRole('img', { name: '待识别包装照片1' })).toBeVisible()
  const run = page.waitForRequest(request => request.url().endsWith('/runs'))
  await page.getByRole('button', { name: '发送', exact: true }).click()
  expect((await run).postDataJSON().attachmentIds).toHaveLength(1)
})
test('invalid drops reject the entire batch without uploading or navigating', async ({ page }) => {
  await fixture(page); await page.goto('/dashboard'); await page.getByRole('button', { name: '打开AI运营助手' }).click()
  let uploads = 0; page.on('request', r => { if (r.method() === 'POST' && r.url().endsWith('/attachments')) uploads++ })
  for (const files of [[{ name: 'a.pdf', type: 'application/pdf' }], [{ name: 'big.jpg', type: 'image/jpeg', bytes: 5 * 1024 * 1024 + 1 }], Array.from({ length: 4 }, (_, i) => ({ name: `${i}.png`, type: 'image/png' }))]) {
    const dataTransfer = await transfer(page, files)
    await page.locator('.ai-panel').dispatchEvent('drop', { dataTransfer })
    await expect(page.locator('.ai-error')).toBeVisible()
    await expect(page.getByRole('img', { name: /待识别包装照片/ })).toHaveCount(0)
  }
  expect(uploads).toBe(0); await expect(page).toHaveURL(/\/dashboard$/)
})
test('dragging cannot bypass disabled photo capability', async ({ page }) => {
  await fixture(page)
  await page.route('**/api/v1/admin/ai/capabilities', route => route.fulfill({ json: { code: 0, data: { enabled: true, allowWrites: true, canExecute: true, features: { products: true, vision: false }, tools: ['product_draft'], scope: { allBrands: false, brandCount: 1 } } } }))
  await page.goto('/dashboard'); await page.getByRole('button', { name: '打开AI运营助手' }).click()
  let uploads = 0; page.on('request', r => { if (r.method() === 'POST' && r.url().endsWith('/attachments')) uploads++ })
  await page.locator('.ai-panel').dispatchEvent('drop', { dataTransfer: await transfer(page, [{ name: 'photo.png', type: 'image/png' }]) })
  await expect(page.getByText('当前账号没有图片业务权限，或图片识别尚未启用。')).toBeVisible(); expect(uploads).toBe(0)
})
test('version notification shows changes once per account and opens release notes', async ({ page }) => {
  await fixture(page)
  const current = { id: 'ai-20261021-3', version: '1.2.0', sequence: 3, title: '图片拖放与平台版本管理', notes: ['支持直接拖入包装照片'], publishedAt: '2026-10-21T05:00:00Z' }
  await page.route('**/api/v1/platform/overview', route => route.fulfill({ json: { code: 0, data: { current, releases: [current], latest: current, canManage: false, operation: null } } }))
  await page.goto('/dashboard'); await expect(page.getByText('平台已更新至 v1.2.0')).toBeVisible()
  await page.getByRole('button', { name: '查看平台版本与更新' }).click()
  await expect(page.getByRole('dialog', { name: '平台版本与功能更新' }).getByText('支持直接拖入包装照片')).toBeVisible()
  await page.getByRole('button', { name: '知道了', exact: true }).click(); await page.reload()
  await expect(page.getByRole('button', { name: '查看平台版本与更新' })).toContainText('v1.2.0')
  await expect(page.getByText('平台已更新至 v1.2.0')).toHaveCount(0)
})
