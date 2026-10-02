import { test, expect } from '@playwright/test'

test('refund dialog defaults to the remaining amount and closes after registration', async ({ page }, testInfo) => {
  await page.addInitScript(() => localStorage.setItem('accessToken', 'browser-test-only'))
  await page.route('**/api/v1/auth/profile', route => route.fulfill({ json: { code: 0, data: {
    user: { id: 1, name: 'Test admin', userType: 'super_admin' }, permissions: ['order:read', 'order:confirm'], menus: []
  } } }))
  const refunds = [{ id: 1, amount: '80', method: 'transfer' }]
  await page.route('**/api/v1/orders/100', route => route.fulfill({ json: { code: 0, data: {
    id: 100, orderNo: 'OD-REFUND-TEST', status: 'cancelled', customer: { customerName: 'Test customer' },
    totalAmount: '100', payableAmount: '100', items: [], statusLogs: [], refunds
  } } }))
  const requests: unknown[] = []
  await page.route('**/api/v1/orders/100/refund', route => {
    const body = route.request().postDataJSON()
    requests.push(body)
    refunds.push({ id: 2, amount: body.amount, method: body.method })
    return route.fulfill({ json: { code: 0, data: refunds[1] } })
  })
  await page.goto('/orders/100')
  await page.getByRole('button', { name: '退款登记', exact: true }).click()
  await expect(page.getByText('剩余可登记退款：¥20.00')).toBeVisible()
  await expect(page.getByRole('spinbutton')).toHaveValue('20.00')
  await page.screenshot({ path: testInfo.outputPath('refund-dialog.png'), fullPage: true })
  await page.getByRole('button', { name: '确认退款', exact: true }).click()
  await expect(page.getByRole('dialog')).toBeHidden()
  expect(requests).toEqual([{ amount: '20', method: 'transfer' }])
  await page.getByRole('button', { name: '退款登记', exact: true }).click()
  await expect(page.getByText('该订单已全部登记退款')).toBeVisible()
})
