import { test, expect, type Page, type Route } from '@playwright/test'
const success = (route: Route, data: any = []) => route.fulfill({ json: { code: 0, data } })

async function admin(page: Page, handler: (route: Route, path: string) => Promise<void>) {
  await page.addInitScript(() => localStorage.setItem('accessToken', 'synthetic-finance-return'))
  await page.route('**/api/v1/**', route => {
    const path = new URL(route.request().url()).pathname
    if (path.endsWith('/auth/profile')) return success(route, { user: { id: 1, userType: 'super_admin' }, permissions: [], menus: [] })
    return handler(route, path)
  })
}

test('finance return requires a reason, cancellation sends nothing and a failed save keeps the reason for retry', async ({ page }) => {
  const order: any = { id: 501, orderNo: 'SYNTHETIC-RETURN', status: 'pending_finance', totalAmount: '19.9', payableAmount: '19.9', createdAt: '2026-10-24T00:00:00Z', items: [], statusLogs: [], refunds: [], customer: {} }
  const reasons: string[] = []
  await admin(page, async (route, path) => {
    if (path.endsWith('/orders/501/reject-finance')) {
      const reason = route.request().postDataJSON().reason; reasons.push(reason)
      if (reasons.length === 1) return route.fulfill({ status: 503, json: { message: '审核暂不可用，请重试' } })
      order.status = 'pending_confirm'; order.financeRejection = { reason, rejectedAt: '2026-10-24T00:05:00Z' }
      order.statusLogs.push({ id: 1, fromStatus: 'pending_finance', toStatus: 'pending_confirm', remark: reason, createdAt: '2026-10-24T00:05:00Z' })
      return success(route, order)
    }
    return success(route, path.endsWith('/orders/501') ? order : [])
  })
  await page.goto('/orders/501')
  await page.getByRole('button', { name: '财务退回', exact: true }).click()
  const dialog = page.getByRole('dialog', { name: '财务退回', exact: true })
  await dialog.getByRole('button', { name: '取消', exact: true }).click()
  expect(reasons).toHaveLength(0)
  await page.getByRole('button', { name: '财务退回', exact: true }).click()
  await dialog.getByRole('button', { name: '确认退回', exact: true }).click()
  expect(reasons).toHaveLength(0)
  const input = dialog.getByPlaceholder('例如：凭证金额与应付金额不一致，请核对后重新提交')
  await input.fill('  金额不一致，请更换凭证  ')
  await dialog.getByRole('button', { name: '确认退回', exact: true }).click()
  await expect(page.getByText('审核暂不可用，请重试', { exact: true }).first()).toBeVisible()
  await expect(input).toHaveValue('  金额不一致，请更换凭证  ')
  await dialog.getByRole('button', { name: '确认退回', exact: true }).click()
  await expect(dialog).toBeHidden()
  expect(reasons).toEqual(['金额不一致，请更换凭证', '金额不一致，请更换凭证'])
  await expect(page.getByText('付款审核已退回', { exact: true })).toBeVisible()
  await expect(page.getByText('金额不一致，请更换凭证', { exact: true }).first()).toBeVisible()
  await expect(page.getByRole('button', { name: '财务退回', exact: true })).toHaveCount(0)
})

test('agreement validity uses Beijing dates and rejects an inverted range before sending', async ({ page }) => {
  const rules: any[] = [{ id: 7, skuId: 2, price: '8.80', startAt: '2026-11-01T00:00:00.000Z', endAt: '2026-11-03T00:00:00.000Z', sku: { id: 2, name: '500克/袋', basePrice: '12' }, product: { name: '隔离商品' } }]
  const writes: any[] = []
  await admin(page, async (route, path) => {
    if (path.endsWith('/customer-price-rules') && route.request().method() === 'POST') {
      const body = route.request().postDataJSON(); writes.push(body); Object.assign(rules[0], body)
      return success(route, rules[0])
    }
    if (path.endsWith('/customer-price-rules')) return success(route, rules)
    if (path.endsWith('/customers/1')) return success(route, { id: 1, customerName: '隔离客户', status: 'active', createdAt: '2026-10-24T00:00:00Z' })
    if (path.endsWith('/products')) return success(route, { items: [{ id: 3, name: '隔离商品', skus: [{ id: 2, name: '500克/袋', basePrice: '12' }] }] })
    if (path.endsWith('/product-visibility')) return success(route, { mode: 'all', products: [], productIds: [], visibleProductCount: 1 })
    return success(route)
  })
  await page.goto('/customers/1')
  await expect(page.getByText('2026-11-01 08:00:00 至 2026-11-03 08:00:00')).toBeVisible()
  await page.getByRole('row').filter({ hasText: '隔离商品' }).getByRole('button', { name: '编辑', exact: true }).click()
  const dialog = page.getByRole('dialog', { name: '编辑协议价' })
  await expect(dialog.getByPlaceholder('留空立即生效')).toHaveValue('2026-11-01 08:00:00')
  await dialog.getByPlaceholder('留空长期有效').fill('2026-10-31 08:00:00')
  await dialog.getByPlaceholder('留空长期有效').press('Tab')
  await dialog.getByRole('button', { name: '保存', exact: true }).click()
  expect(writes).toHaveLength(0)
  await expect(page.getByText('结束时间必须晚于开始时间', { exact: true })).toBeVisible()
  await dialog.getByPlaceholder('留空长期有效').fill('2026-11-04 08:00:00')
  await dialog.getByPlaceholder('留空长期有效').press('Tab')
  await dialog.getByRole('button', { name: '保存', exact: true }).click()
  await expect(dialog).toBeHidden()
  expect(writes).toEqual([{ customerId: 1, skuId: 2, price: '8.80', startAt: '2026-11-01T08:00:00+08:00', endAt: '2026-11-04T08:00:00+08:00' }])
})
