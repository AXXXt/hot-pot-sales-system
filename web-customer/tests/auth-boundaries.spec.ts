import { expect, test, type Page } from '@playwright/test'

// Every API request below is intercepted. Checkbox interactions apply only to these mock fixtures, never to real agreements or SMS.

const profile = { user: { id: 1, name: 'QA采购用户', phone: '13900000000', userType: 'customer_user' }, tenant: { id: 1, name: 'QA租户' }, customer: { id: 1, customerName: 'QA采购门店', status: 'active' }, brands: [] }
async function fixture(page: Page, loggedIn = false) {
  const calls: string[] = [], errors: string[] = []
  let sends = 0, logins = 0
  page.on('pageerror', error => errors.push(error.message))
  await page.addInitScript(({ loggedIn, profile }) => {
    localStorage.clear()
    if (loggedIn) { localStorage.setItem('webAccessToken', 'fixture-access'); localStorage.setItem('webRefreshToken', 'fixture-refresh'); localStorage.setItem('webProfile', JSON.stringify(profile)) }
  }, { loggedIn, profile })
  await page.route('**/api/v1/**', route => {
    const path = new URL(route.request().url()).pathname; calls.push(path)
    let data: any = { items: [], total: 0 }
    if (path.endsWith('/auth/send-code') && ++sends === 1) return route.fulfill({ status: 503, json: { message: 'QA短信服务暂不可用' } })
    if (path.endsWith('/auth/login')) {
      if (++logins === 1) return route.fulfill({ status: 400, json: { message: 'QA验证码错误或已过期' } })
      data = { accessToken: 'fixture-access', refreshToken: 'fixture-refresh' }
    }
    if (path.endsWith('/auth/logout')) return route.fulfill({ status: 503, json: { message: 'QA退出服务暂不可用' } })
    if (path.endsWith('/auth/profile')) data = profile
    if (/\/(brands|product-categories)$/.test(path)) data = []
    return route.fulfill({ json: { code: 0, data } })
  })
  return { calls, errors }
}

test('rejects invalid phone and nonnumeric or incomplete verification code before making auth requests', async ({ page }) => {
  const { calls } = await fixture(page)
  await page.goto('/login')
  await page.getByPlaceholder('请输入手机号').fill('10000000000')
  await page.getByRole('button', { name: '获取验证码', exact: true }).click()
  await expect(page.getByText('请输入有效手机号', { exact: true })).toBeVisible({ timeout: 1500 })
  expect(calls.some(path => path.endsWith('/send-code'))).toBe(false)
  await page.getByPlaceholder('请输入手机号').fill('13900000000')
  await page.getByPlaceholder('请输入验证码').fill('12ab')
  await page.getByText('我已阅读并同意', { exact: true }).click()
  await page.getByRole('button', { name: '登录采购台' }).click()
  await expect(page.getByText('请输入6位数字验证码')).toBeVisible()
  expect(calls.some(path => path.endsWith('/auth/login'))).toBe(false)
})

test('requires agreement and preserves input after a wrong code, then retries successfully', async ({ page }) => {
  const { calls, errors } = await fixture(page)
  await page.goto('/login')
  await page.getByPlaceholder('请输入手机号').fill('13900000000')
  await page.getByPlaceholder('请输入验证码').fill('123456')
  await page.getByRole('button', { name: '登录采购台' }).click()
  await expect(page.getByText('请先阅读并同意用户协议和隐私政策')).toBeVisible()
  expect(calls.some(path => path.endsWith('/auth/login'))).toBe(false)
  await page.getByText('我已阅读并同意', { exact: true }).click()
  await page.getByRole('button', { name: '登录采购台' }).click()
  await expect(page.getByText('QA验证码错误或已过期')).toBeVisible()
  await expect(page.getByPlaceholder('请输入手机号')).toHaveValue('13900000000')
  await expect(page.getByRole('button', { name: '登录采购台' })).toBeEnabled()
  await page.getByRole('button', { name: '登录采购台' }).click()
  await expect(page).toHaveURL(/\/home$/)
  expect(errors).toEqual([])
})

test('recovers after SMS failure without unhandled errors and starts a retryable countdown only after success', async ({ page }) => {
  const { errors } = await fixture(page)
  await page.goto('/login')
  await page.clock.install()
  await page.getByPlaceholder('请输入手机号').fill('13900000000')
  await page.getByRole('button', { name: '获取验证码', exact: true }).click()
  await expect(page.getByText('QA短信服务暂不可用')).toBeVisible()
  await expect(page.getByRole('button', { name: '获取验证码', exact: true })).toBeEnabled()
  await page.getByRole('button', { name: '获取验证码', exact: true }).click()
  await expect(page.getByRole('button', { name: /60秒/ })).toBeDisabled()
  await page.clock.runFor(61000)
  await expect(page.getByRole('button', { name: '获取验证码', exact: true })).toBeEnabled()
  expect(errors).toEqual([])
})

test('remote logout failure still clears local private data and leaves the protected page', async ({ page }) => {
  const { errors } = await fixture(page, true)
  await page.goto('/profile')
  await page.getByRole('button', { name: '退出登录', exact: true }).click()
  await expect(page).toHaveURL(/\/login$/, { timeout: 1500 })
  expect(await page.evaluate(() => [localStorage.getItem('webAccessToken'), localStorage.getItem('webRefreshToken'), localStorage.getItem('webProfile')])).toEqual([null, null, null])
  expect(errors).toEqual([])
})

test('mobile login, public agreements and empty catalog/order/cart pages remain usable', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 })
  await fixture(page, true)
  for (const [path, text] of [['/login', '客户登录'], ['/legal/privacy', '隐私政策'], ['/legal/terms', '用户协议'], ['/category', '没有找到相关食材'], ['/orders', '暂无订单'], ['/cart', '进货单还是空的，去挑选食材吧。']]) {
    await page.goto(path)
    await expect(page.getByText(text, { exact: path !== '/cart' }).first()).toBeVisible()
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), path).toBe(true)
  }
})

test('refreshes a cached credit limit before displaying protected pages and offers retry without showing stale credit', async ({ page }) => {
  await fixture(page, true)
  await page.addInitScript(() => { const cached = JSON.parse(localStorage.getItem('webProfile')!); cached.customer.creditRemaining = '100.00'; localStorage.setItem('webProfile', JSON.stringify(cached)) })
  let reads = 0
  await page.route('**/api/v1/auth/profile', route => ++reads === 1
    ? route.fulfill({ status: 503, json: { message: 'QA账户资料暂不可用' } })
    : route.fulfill({ json: { code: 0, data: { ...profile, customer: { ...profile.customer, creditRemaining: '0.00' } } } }))
  await page.goto('/home')
  await expect(page.getByText('账户资料加载失败，请重试')).toBeVisible({ timeout: 1500 })
  await expect(page.locator('.account-strip')).toHaveCount(0)
  await page.getByRole('button', { name: '重试账户资料' }).click()
  await expect(page.locator('.account-strip').getByText('¥0.00')).toBeVisible()
  await expect(page.locator('.account-strip').getByText('¥100.00')).toHaveCount(0)
  expect(reads).toBe(2)
})
