import { expect, test, type Page } from '@playwright/test'
async function fixture(page: Page, failFirst = false) {
  const profile = { user: { id: 1, userType: 'customer_user', name: 'QA客户' }, customer: { id: 1, customerName: 'QA门店', status: 'active' }, brands: [] }
  const writes: any[] = [], rows: any[] = []
  await page.addInitScript(profile => { localStorage.setItem('webAccessToken', 'synthetic-customer'); localStorage.setItem('webProfile', JSON.stringify(profile)) }, profile)
  await page.route('**/api/v1/**', async route => {
    const path = new URL(route.request().url()).pathname
    let data: any = { items: [], total: 0 }
    if (path.endsWith('/auth/profile')) data = profile
    if (path.endsWith('/legal/consent')) data = { accepted: true }
    if (path.endsWith('/cart')) data = []
    if (path.endsWith('/service-requests/order-options')) data = [{ id: 12, orderNo: 'QA-ORDER-12' }]
    if (path.endsWith('/service-requests/mine')) {
      if (route.request().method() === 'POST') {
        const body = route.request().postDataJSON(); writes.push(body)
        if (failFirst && writes.length === 1) return route.fulfill({ status: 503, json: { message: '测试网络暂不可用' } })
        data = { id: 1, ...body, status: 'pending', requestNo: 'SRTEST1', createdAt: '2026-10-24T00:00:00Z', events: [{ at: '2026-10-24T00:00:00Z', status: 'pending', message: '已提交，等待工作人员处理' }] }
        rows.push(data)
      } else data = { items: rows, total: rows.length }
    }
    if (path.endsWith('/service-requests/mine/1')) data = rows[0]
    await route.fulfill({ json: { code: 0, data } })
  })
  return writes
}

test('customer submits an order-associated service request and sees pending progress', async ({ page }) => {
  const writes = await fixture(page)
  await page.goto('/service-requests')
  await page.getByRole('button', { name: '提交申请', exact: true }).click()
  const form = page.getByRole('dialog', { name: '提交服务申请' })
  await form.getByRole('textbox').nth(0).fill('QA售后问题')
  await form.getByRole('textbox').last().fill('仅功能测试，需要人工核实包装')
  await form.locator('.el-select').nth(1).click(); await page.getByRole('option', { name: 'QA-ORDER-12', exact: true }).click()
  await form.getByRole('button', { name: '提交申请', exact: true }).click()
  await expect(form).not.toBeVisible()
  const detail = page.getByRole('dialog', { name: '申请处理进度' })
  await expect(detail.getByText('已提交，等待工作人员处理')).toBeVisible()
  expect(writes).toHaveLength(1); expect(writes[0].orderId).toBe(12)
  expect(writes[0].clientKey).toMatch(/^[a-f0-9-]{36}$/)
})

test('a failed submission keeps the form and the same retry key, including on mobile', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 })
  const writes = await fixture(page, true)
  await page.goto('/service-requests?type=account_closure')
  const form = page.getByRole('dialog', { name: '提交服务申请' })
  await form.getByRole('textbox').nth(0).fill('QA注销咨询')
  await form.getByRole('textbox').last().fill('请人工联系核实，不执行删除')
  await form.getByRole('button', { name: '提交申请', exact: true }).click()
  await expect(page.getByText('测试网络暂不可用').first()).toBeVisible()
  await expect(form.getByRole('textbox').nth(0)).toHaveValue('QA注销咨询')
  await form.getByRole('button', { name: '提交申请', exact: true }).click()
  await expect(form).not.toBeVisible()
  expect(writes).toHaveLength(2); expect(writes[1].clientKey).toBe(writes[0].clientKey)
  expect(writes[1].type).toBe('account_closure')
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
})
