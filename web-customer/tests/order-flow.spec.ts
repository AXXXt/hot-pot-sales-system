import { test, expect, type Page } from '@playwright/test'

async function loginFixture(page: Page) {
  await page.addInitScript(() => {
    localStorage.setItem('webAccessToken', 'browser-test-only')
    localStorage.setItem('webProfile', JSON.stringify({ user: { name: 'Test' }, customer: { id: 10, customerName: '测试客户' } }))
  })
}

async function checkWidth(page: Page) {
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true)
}

test('legal documents are readable without logging in', async ({ page }, testInfo) => {
  await page.goto('/legal/privacy')
  await expect(page.getByRole('heading', { name: '隐私政策', exact: true })).toBeVisible()
  await expect(page.getByText('河南唯多鲜食品有限公司', { exact: false }).first()).toBeVisible()
  await checkWidth(page)
  await page.screenshot({ path: testInfo.outputPath('privacy.png'), fullPage: true })
  await page.goto('/legal/terms')
  await expect(page.getByRole('heading', { name: '用户协议', exact: true })).toBeVisible()
})

test('customer confirms credit payment and cannot double submit', async ({ page }, testInfo) => {
  await loginFixture(page)
  let status = 'pending_confirm'
  const requests: unknown[] = []
  await page.route('**/api/v1/orders/100', route => route.fulfill({ json: { code: 0, data: {
    id: 100, orderNo: 'OD-LAUNCH-TEST-100', status, createdAt: '2026-10-01T10:00:00Z',
    totalAmount: '100', payableAmount: '100', discountAmount: '0',
    customer: { customerName: '测试客户', creditRemaining: '200' },
    items: [{ id: 1, skuId: 1, productName: '测试商品', quantity: 2, unitPrice: '50', amount: '100' }]
  } } }))
  await page.route('**/api/v1/orders/100/submit-finance', async route => {
    requests.push(route.request().postDataJSON())
    status = 'pending_finance'
    await route.fulfill({ json: { code: 0, data: {} } })
  })
  await page.goto('/orders/100')
  await page.getByRole('button', { name: '确认报价并支付' }).click()
  await expect(page.getByRole('button', { name: '确认并提交' })).toBeDisabled()
  await checkWidth(page)
  await page.screenshot({ path: testInfo.outputPath('payment-dialog.png'), fullPage: true })
  await page.getByText('账期支付', { exact: true }).click()
  await page.getByRole('button', { name: '确认并提交' }).click()
  await expect(page.getByText('待审核', { exact: true })).toBeVisible()
  expect(requests).toEqual([{ creditRequested: true }])
  await expect(page.getByRole('button', { name: '确认报价并支付' })).toHaveCount(0)
})

test('failed draft submission keeps the retry action available', async ({ page }) => {
  await loginFixture(page)
  let status = 'draft'
  let attempts = 0
  await page.route('**/api/v1/orders/101', route => route.fulfill({ json: { code: 0, data: {
    id: 101, orderNo: 'OD-DRAFT-101', status, totalAmount: '100', payableAmount: '100', items: []
  } } }))
  await page.route('**/api/v1/orders/101/submit', route => {
    attempts++
    if (attempts === 1) return route.fulfill({ status: 500, json: { message: '测试失败，请重试' } })
    status = 'pending_quote'
    return route.fulfill({ json: { code: 0, data: {} } })
  })
  await page.goto('/orders/101')
  await page.getByRole('button', { name: '继续提交订单' }).click()
  await expect(page.getByRole('button', { name: '继续提交订单' })).toBeEnabled()
  await page.getByRole('button', { name: '继续提交订单' }).click()
  await expect(page.getByText('待报价', { exact: true })).toBeVisible()
  expect(attempts).toBe(2)
})

test('transfer retry reuses the uploaded proof and requires explicit consent', async ({ page }) => {
  await loginFixture(page)
  let status = 'pending_confirm'
  let uploads = 0
  let attempts = 0
  await page.route('**/api/v1/orders/102', route => route.fulfill({ json: { code: 0, data: {
    id: 102, orderNo: 'OD-TRANSFER-102', status, totalAmount: '100', payableAmount: '100', items: []
  } } }))
  await page.route('**/api/v1/uploads/payment-proof', route => {
    uploads++
    expect(route.request().headers()['content-type']).toContain('multipart/form-data; boundary=')
    return route.fulfill({ json: { code: 0, data: { url: 'payment-proofs/test.png' } } })
  })
  await page.route('**/api/v1/orders/102/submit-finance', route => {
    attempts++
    expect(route.request().postDataJSON()).toEqual({ paymentProof: 'payment-proofs/test.png' })
    if (attempts === 1) return route.fulfill({ status: 500, json: { message: '测试失败，请重试' } })
    status = 'pending_finance'
    return route.fulfill({ json: { code: 0, data: {} } })
  })
  await page.goto('/orders/102')
  await page.getByRole('button', { name: '确认报价并支付' }).click()
  await page.locator('input[type="file"]').setInputFiles({ name: 'proof.png', mimeType: 'image/png', buffer: Buffer.from('browser transport fixture') })
  await expect(page.getByRole('button', { name: '确认并提交' })).toBeDisabled()
  await page.getByText('我同意为核验本次付款处理所上传的凭证信息', { exact: true }).click()
  await page.getByRole('button', { name: '确认并提交' }).click()
  await expect(page.getByText('凭证已上传，提交失败后可直接重试。')).toBeVisible()
  await expect(page.getByRole('button', { name: '确认并提交' })).toBeEnabled()
  await page.getByRole('button', { name: '确认并提交' }).click()
  await expect(page.getByText('待审核', { exact: true })).toBeVisible()
  expect(uploads).toBe(1)
  expect(attempts).toBe(2)
})
