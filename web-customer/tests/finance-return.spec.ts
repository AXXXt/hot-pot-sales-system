import { test, expect } from '@playwright/test'

test('returned finance reason is visible and the original proof can be re-submitted without another upload', async ({ page }) => {
  await page.addInitScript(() => {
    localStorage.setItem('webAccessToken', 'synthetic-return')
    localStorage.setItem('webProfile', JSON.stringify({ user: { id: 2, name: 'Test' }, customer: { id: 10, customerName: '隔离客户' } }))
  })
  const detail: any = { id: 702, orderNo: 'SYNTHETIC-RETURN', status: 'pending_confirm', totalAmount: '19.9', payableAmount: '19.9', discountAmount: '0', items: [], paymentProof: 'payment-proofs/synthetic.png', customer: { customerName: '隔离客户', creditRemaining: '100' }, financeRejection: { reason: '凭证金额不符，请核对', rejectedAt: '2026-10-24T00:00:00Z' } }
  const submissions: any[] = []; let uploads = 0
  await page.route('**/api/v1/**', route => {
    const path = new URL(route.request().url()).pathname
    if (path.endsWith('/auth/profile')) return route.fulfill({ json: { code: 0, data: { user: { id: 2, name: 'Test' }, customer: { id: 10, customerName: '隔离客户' } } } })
    if (path.endsWith('/orders/702/submit-finance')) {
      submissions.push(route.request().postDataJSON()); detail.status = 'pending_finance'; detail.financeRejection = null
      return route.fulfill({ json: { code: 0, data: detail } })
    }
    if (path.endsWith('/uploads/payment-proof')) uploads++
    return route.fulfill({ json: { code: 0, data: path.endsWith('/orders/702') ? detail : [] } })
  })
  await page.goto('/orders/702')
  await expect(page.getByText('付款审核已退回', { exact: true })).toBeVisible()
  await expect(page.getByText('凭证金额不符，请核对', { exact: true })).toBeVisible()
  await page.getByRole('button', { name: '重新提交付款信息', exact: true }).click()
  await expect(page.getByRole('button', { name: '确认并提交', exact: true })).toBeDisabled()
  await page.getByText('我同意为核验本次付款处理所上传的凭证信息', { exact: true }).click()
  await page.getByRole('button', { name: '确认并提交', exact: true }).click()
  await expect(page.getByText('待审核', { exact: true })).toBeVisible()
  await expect(page.getByText('付款审核已退回', { exact: true })).toHaveCount(0)
  expect(submissions).toEqual([{ paymentProof: 'payment-proofs/synthetic.png' }]); expect(uploads).toBe(0)
})

test('a changed quote closes payment confirmation and refreshes the amount before any retry', async ({ page }) => {
  await page.addInitScript(() => { localStorage.setItem('webAccessToken', 'synthetic-quote'); localStorage.setItem('webProfile', JSON.stringify({ user: { id: 2 }, customer: { id: 10 } })) })
  let changed = false
  const bodies: any[] = []
  await page.route('**/api/v1/**', route => {
    const path = new URL(route.request().url()).pathname
    if (path.endsWith('/auth/profile')) return route.fulfill({ json: { code: 0, data: { user: { id: 2 }, customer: { id: 10 } } } })
    if (path.endsWith('/orders/703/submit-finance')) {
      bodies.push(route.request().postDataJSON()); changed = true
      return route.fulfill({ status: 400, json: { errorCode: 'ORD_QUOTE_CHANGED', message: '报价已更新，请核对最新金额后重新提交' } })
    }
    return route.fulfill({ json: { code: 0, data: { id: 703, orderNo: 'SYNTHETIC-QUOTE', status: 'pending_confirm', updatedAt: changed ? '2026-10-24T00:01:00Z' : '2026-10-24T00:00:00Z', totalAmount: changed ? '21' : '19.9', payableAmount: changed ? '21' : '19.9', items: [], customer: { creditRemaining: '100' } } } })
  })
  await page.goto('/orders/703')
  await page.getByRole('button', { name: '确认报价并支付', exact: true }).click()
  await page.getByText('账期支付', { exact: true }).click()
  await page.getByRole('button', { name: '确认并提交', exact: true }).click()
  await expect(page.getByRole('dialog', { name: '确认报价', exact: true })).toBeHidden()
  expect(bodies).toEqual([{ creditRequested: true, expectedUpdatedAt: '2026-10-24T00:00:00Z', expectedPayableAmount: '19.90' }])
  await expect(page.getByText('¥21.00', { exact: true }).first()).toBeVisible()
  await expect(page.getByRole('button', { name: '确认报价并支付', exact: true })).toBeEnabled()
})
