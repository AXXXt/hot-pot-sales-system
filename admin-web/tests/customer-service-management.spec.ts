import { expect, test, type Page } from '@playwright/test'

async function fixture(page: Page) {
  const levels: any[] = [], requests = [{ id: 1, requestNo: 'SRTEST1', type: 'profile_change', subject: '更正QA资料', status: 'pending', customer: { customerName: 'QA门店' }, createdAt: '2026-10-24T00:00:00Z' }]
  const detail: any = { ...requests[0], description: '仅隔离UI测试', version: 0, events: [{ at: '2026-10-24T00:00:00Z', status: 'pending', message: '已提交' }] }
  const writes: Array<{ path: string; body: any }> = []
  const customer: any = { id: 2, customerName: 'QA门店', contactName: 'QA联系人', contactPhone: '13900000000', address: 'QA地址', status: 'active', salesOwnerId: null }
  await page.addInitScript(() => { localStorage.setItem('accessToken', 'synthetic-service-admin'); localStorage.setItem('refreshToken', 'synthetic-refresh') })
  await page.route('**/api/v1/**', async route => {
    const path = new URL(route.request().url()).pathname, method = route.request().method()
    if (method !== 'GET') writes.push({ path, body: route.request().postDataJSON() })
    let data: any = { items: [], total: 0 }
    if (path.endsWith('/auth/profile')) data = { user: { id: 7, userType: 'super_admin' }, permissions: [], menus: [] }
    if (path.endsWith('/legal/consent')) data = { accepted: true }
    if (path.endsWith('/brands')) data = [{ id: 1, name: 'QA品牌', status: 'active' }]
    if (path.endsWith('/customer-levels/readiness')) data = { registrationReady: levels.some(row => row.status === 'active'), defaultLevel: levels[0] || null, warning: levels.length ? '' : '缺少启用的 normal 等级，新客户无法提交注册申请' }
    if (path.endsWith('/customer-levels')) {
      if (method === 'POST') levels.push({ id: 1, ...route.request().postDataJSON(), status: 'active', brand: { name: 'QA品牌' }, _count: { customers: 0 } })
      data = method === 'POST' ? levels[0] : levels
    }
    if (path.endsWith('/customer-levels/1')) { Object.assign(levels[0], route.request().postDataJSON()); data = levels[0] }
    if (path.endsWith('/service-requests')) data = { items: requests, total: requests.length }
    if (path.endsWith('/service-requests/1')) {
      if (method === 'PATCH') {
        const body = route.request().postDataJSON()
        Object.assign(detail, { status: body.status, version: detail.version + 1, resolution: body.message })
        detail.events.push({ at: new Date().toISOString(), status: body.status, message: body.message })
        requests[0].status = body.status
      }
      data = detail
    }
    if (path.endsWith('/customers/sales-owners')) data = { canAssign: true, items: [{ id: 9, name: 'QA负责业务员' }] }
    if (path.endsWith('/customers/2')) { if (method === 'PATCH') Object.assign(customer, route.request().postDataJSON()); data = customer }
    if (path.endsWith('/customer-price-rules') || path.endsWith('/repayments')) data = []
    if (path.endsWith('/product-visibility')) data = { mode: 'factory', products: [], productIds: [], visibleProductCount: 0 }
    await route.fulfill({ json: { code: 0, data } })
  })
  return { writes, detail }
}

test('warns about a missing registration level and supports create, edit and Chinese-confirmed disable', async ({ page }) => {
  const { writes } = await fixture(page)
  await page.goto('/customer-levels')
  await expect(page.getByText('缺少启用的 normal 等级，新客户无法提交注册申请')).toBeVisible()
  await page.getByRole('button', { name: '新建等级', exact: true }).click()
  const dialog = page.getByRole('dialog', { name: '新建客户等级' })
  await dialog.locator('.el-select').first().click(); await page.getByRole('option', { name: 'QA品牌', exact: true }).click()
  await dialog.getByRole('textbox').nth(0).fill('普通客户')
  await dialog.getByRole('textbox').nth(1).fill('normal')
  await dialog.getByRole('textbox').nth(2).fill('0.95')
  await dialog.getByRole('button', { name: '保存等级', exact: true }).click()
  await expect(dialog).not.toBeVisible()
  expect(writes[0].body).toMatchObject({ brandId: 1, code: 'normal', discountRate: '0.95' })
  await page.getByRole('button', { name: '编辑', exact: true }).click()
  const editing = page.getByRole('dialog', { name: '编辑客户等级' })
  await expect(editing.getByRole('textbox').nth(1)).toBeDisabled()
  await editing.getByRole('textbox').nth(0).fill('普通采购客户')
  await editing.getByRole('button', { name: '保存等级', exact: true }).click()
  await expect(editing).not.toBeVisible()
  await page.getByRole('button', { name: '停用', exact: true }).click()
  await page.getByRole('button', { name: '确认', exact: true }).click()
  await expect.poll(() => writes.some(item => item.body.status === 'disabled')).toBe(true)
})

test('records customer-visible processing and closure while passing the current revision', async ({ page }) => {
  const { writes } = await fixture(page)
  await page.goto('/service-requests')
  await page.getByRole('button', { name: '查看处理', exact: true }).click()
  const dialog = page.getByRole('dialog', { name: '服务申请处理' })
  await expect(dialog.getByText('仅隔离UI测试')).toBeVisible()
  await dialog.getByRole('textbox').fill('已受理，人工核对资料')
  await dialog.getByRole('button', { name: '记录处理进度', exact: true }).click()
  await expect(dialog.getByText('已受理，人工核对资料', { exact: true })).toBeVisible()
  expect(writes[0].body).toMatchObject({ status: 'processing', expectedVersion: 0 })
  await dialog.locator('.el-select').first().click(); await page.getByRole('option', { name: '处理完成', exact: true }).click()
  await dialog.getByRole('textbox').fill('已通过人工渠道回复客户')
  await dialog.getByRole('button', { name: '记录处理进度', exact: true }).click()
  await expect(dialog.getByText('已结案', { exact: true })).toBeVisible()
  expect(writes[1].body).toMatchObject({ status: 'completed', expectedVersion: 1 })
  await expect(dialog.getByRole('button', { name: '记录处理进度' })).toHaveCount(0)
})

test('customer editing exposes only eligible owner candidates and preserves untouched details', async ({ page }) => {
  const { writes } = await fixture(page)
  await page.goto('/customers/2')
  await page.getByRole('button', { name: '编辑信息', exact: true }).click()
  const dialog = page.getByRole('dialog', { name: '编辑客户信息' })
  await dialog.locator('.el-select').first().click(); await page.getByRole('option', { name: 'QA负责业务员', exact: true }).click()
  await dialog.getByRole('button', { name: '保存', exact: true }).click()
  await expect(dialog).not.toBeVisible()
  expect(writes.find(item => item.path.endsWith('/customers/2'))?.body).toMatchObject({ salesOwnerId: 9, contactName: 'QA联系人', contactPhone: '13900000000', address: 'QA地址' })
})
