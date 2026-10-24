import { expect, test, type Page } from '@playwright/test'

async function fixture(page: Page, options: { truncated?: boolean; inventory?: boolean; baseUrl?: string; failSettingsOnce?: boolean } = {}) {
  const patches: any[] = []
  let settingsReads = 0
  const settings = { enabled: true, baseUrl: options.baseUrl ?? 'https://api.deepseek.com/v1', textModel: 'fixture-model', visionModel: '', allowWrites: false, dailyRequests: 24, features: {}, hasKey: true, encryptionReady: true }
  await page.addInitScript(() => localStorage.setItem('accessToken', 'ai-dashboard-boundary-ui-fixture'))
  await page.route('**/api/v1/**', async route => {
    const path = new URL(route.request().url()).pathname
    let data: any = { items: [], total: 0 }
    if (path.endsWith('/auth/profile')) data = { user: { id: 1, name: '测试运营人员', userType: 'admin' }, permissions: ['dashboard:view', 'inventory:read', 'ai:configure'], roles: [], brands: [], menus: [] }
    if (path.endsWith('/dashboard/stats')) data = {
      inventoryWarnings: options.inventory === false ? null : options.truncated ? 500 : 1,
      inventoryTruncated: Boolean(options.truncated), visibility: { inventory: options.inventory !== false, orders: false, products: false, customers: false },
      lowStockItems: options.inventory === false ? [] : Array.from({ length: options.truncated ? 500 : 1 }, (_, id) => ({ id, productId: id + 1, productName: `预警商品${id}`, skuName: '袋', availableQty: 0, warningQty: 0 }))
    }
    if (path.endsWith('/admin/ai/settings')) {
      if (route.request().method() === 'PATCH') { patches.push(route.request().postDataJSON()); Object.assign(settings, patches[patches.length - 1]) }
      else if (options.failSettingsOnce && settingsReads++ === 0) return route.fulfill({ status: 503, json: { code: 503, message: 'QA配置加载失败' } })
      data = settings
    }
    if (path.endsWith('/admin/ai/capabilities')) data = { enabled: false, features: {}, tools: [], scope: {} }
    return route.fulfill({ json: { code: 0, data } })
  })
  return { patches }
}

test('truncated inventory states the 500-SKU scope and avoids claiming the count covers every SKU', async ({ page }) => {
  await fixture(page, { truncated: true })
  await page.goto('/dashboard')
  await expect(page.getByText('库存预警仅统计当前前 500 个商品规格，其他规格请到库存管理查看。')).toBeVisible({ timeout: 1500 })
  await expect(page.locator('.low-stock-item')).toHaveCount(5)
  await expect(page.locator('.low-stock-item').first()).toContainText('预警线 0')
  await expect(page.getByText('查看全部 500 个')).toHaveCount(0)
  await page.getByRole('button', { name: '查看库存管理' }).click()
  await expect(page).toHaveURL(/\/inventory$/)
})

test('untruncated inventory retains its complete count without a false truncation notice', async ({ page }) => {
  await fixture(page)
  await page.goto('/dashboard')
  await expect(page.getByRole('button', { name: '查看全部 1 个' })).toBeVisible()
  await expect(page.getByText(/库存预警仅统计当前前/)).toHaveCount(0)
})

test('inventory permission hiding also hides the truncated scope and does not show a false zero', async ({ page }) => {
  await fixture(page, { truncated: true, inventory: false })
  await page.goto('/dashboard')
  await expect(page.locator('.dashboard-page--tasks')).toBeVisible()
  await expect(page.getByRole('heading', { name: '高风险库存' })).toHaveCount(0)
  await expect(page.getByText('库存预警', { exact: true })).toHaveCount(0)
  await expect(page.getByText(/库存预警仅统计当前前/)).toHaveCount(0)
})

test('AI provider changes visibly require a new key while same-provider edits can retain the saved key', async ({ page }) => {
  await fixture(page)
  await page.goto('/ai-settings')
  await expect(page.getByPlaceholder('已保存密钥；留空保持原值')).toHaveValue('')
  const address = page.getByPlaceholder('https://工作空间.cn-beijing.maas.aliyuncs.com/compatible-mode/v1')
  await address.fill('https://dashscope.aliyuncs.com/compatible-mode/v1')
  await expect(page.getByText('当前服务地址需要重新输入 API Key 后保存。')).toBeVisible({ timeout: 1500 })
  await expect(page.getByPlaceholder('请为当前服务地址重新输入 API Key')).toHaveValue('')
  await address.fill('https://api.deepseek.com/v1/')
  await expect(page.getByPlaceholder('已保存密钥；留空保持原值')).toHaveValue('')
  await expect(page.getByText('当前服务地址需要重新输入 API Key 后保存。')).toHaveCount(0)
})

test('restoring an endpoint that no longer has a bound provider requires a replacement key', async ({ page }) => {
  await fixture(page, { baseUrl: '' })
  await page.goto('/ai-settings')
  await expect(page.getByPlaceholder('已保存密钥；留空保持原值')).toBeVisible()
  await page.getByPlaceholder('https://工作空间.cn-beijing.maas.aliyuncs.com/compatible-mode/v1').fill('https://api.deepseek.com/v1')
  await expect(page.getByText('当前服务地址需要重新输入 API Key 后保存。')).toBeVisible()
})

test('AI settings cannot save default fields after a failed load and can retry before preserving loaded values', async ({ page }) => {
  const { patches } = await fixture(page, { failSettingsOnce: true })
  await page.goto('/ai-settings')
  await expect(page.locator('.settings-error')).toContainText('QA配置加载失败')
  const save = page.getByRole('button', { name: '保存配置', exact: true })
  await expect(save).toBeDisabled({ timeout: 1500 })
  await save.click({ force: true })
  expect(patches).toHaveLength(0)
  await page.getByRole('button', { name: '重试加载配置' }).click()
  await expect(page.getByPlaceholder('填写账户可用的模型名称')).toHaveValue('fixture-model')
  await expect(save).toBeEnabled()
  await save.click()
  await expect.poll(() => patches.length).toBe(1)
  expect(patches[0]).toMatchObject({ enabled: true, baseUrl: 'https://api.deepseek.com/v1', textModel: 'fixture-model', dailyRequests: 24 })
  expect(patches[0]).not.toHaveProperty('apiKey')
})
