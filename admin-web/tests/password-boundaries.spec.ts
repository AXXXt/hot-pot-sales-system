import { test, expect } from '@playwright/test'

const fixturePassword = 'Synthetic password boundary 2026!'
const setupToken = 'x'.repeat(43)

test('empty login fields stop submission and never send a code or password request', async ({ page }) => {
  const writes: string[] = []
  await page.route('**/api/v1/**', route => { writes.push(route.request().url()); return route.fulfill({ json: { code: 0, data: {} } }) })
  await page.goto('/login')
  await page.locator('.agreement .el-checkbox').click()
  await page.getByRole('button', { name: '登录', exact: true }).click()
  await expect(page.getByText('请输入有效手机号', { exact: true })).toBeVisible()
  await expect(page.getByText('请输入登录密码', { exact: true })).toBeVisible()
  await page.getByLabel('账号（手机号）').fill('13800000000')
  await page.getByRole('button', { name: '登录', exact: true }).click()
  expect(writes).toEqual([])
})

test('rate-limited login presents the server delay without retrying, refreshing or sending SMS', async ({ page }) => {
  const calls: string[] = []
  await page.route('**/api/v1/**', route => {
    calls.push(new URL(route.request().url()).pathname)
    return route.fulfill({ status: 429, json: { code: 429, errorCode: 'AUTH_PASSWORD_RATE_LIMIT', message: '尝试次数过多，请15分钟后重试' } })
  })
  await page.goto('/login')
  await page.getByLabel('账号（手机号）').fill('13800000000')
  await page.getByLabel('登录密码', { exact: true }).fill(fixturePassword)
  await page.locator('.agreement .el-checkbox').click()
  await page.getByRole('button', { name: '登录', exact: true }).click()
  await expect(page.locator('p[role=alert]')).toContainText('15分钟后重试')
  expect(calls).toEqual(['/api/v1/auth/password/login'])
})

test('a missing setup fragment never verifies or exposes a password form', async ({ page }) => {
  const calls: string[] = []
  await page.route('**/api/v1/**', route => { calls.push(route.request().url()); return route.fulfill({ json: { code: 0, data: {} } }) })
  await page.goto('/password/setup')
  await expect(page.locator('p[role=alert]')).toContainText('密码设置链接无效或已过期')
  await expect(page.getByLabel('新密码', { exact: true })).toHaveCount(0)
  expect(calls).toHaveLength(0)
})

test('setup rejects invalid code-point length without silently truncating input', async ({ page }) => {
  let writes = 0
  await page.route('**/api/v1/**', route => {
    const path = new URL(route.request().url()).pathname
    if (path.endsWith('/setup')) writes++
    return route.fulfill({ json: { code: 0, data: { account: '138****0000' } } })
  })
  await page.goto('/password/setup#token=' + setupToken)
  const password = page.getByLabel('新密码', { exact: true })
  await expect(password).toBeVisible()
  for (const value of ['', 'short', ' '.repeat(15), 'A'.repeat(129), '🔐'.repeat(129)]) {
    await password.fill(value)
    await page.getByLabel('再次输入新密码').fill(value)
    await page.getByRole('button', { name: '设置密码', exact: true }).click()
    await expect(page.locator('p[role=alert]')).toContainText('15～128个字符')
  }
  await expect(password).toHaveValue('🔐'.repeat(129))
  expect(writes).toBe(0)
})

test('wrong current password preserves the session; successful change clears it and returns to login', async ({ page }) => {
  const changes: any[] = [], paths: string[] = []
  await page.addInitScript(() => { localStorage.setItem('accessToken', 'synthetic-old-access'); localStorage.setItem('refreshToken', 'synthetic-old-refresh') })
  await page.route('**/api/v1/**', route => {
    const path = new URL(route.request().url()).pathname; paths.push(path)
    if (path.endsWith('/auth/profile')) return route.fulfill({ json: { code: 0, data: { user: { id: 7, userType: 'admin' }, permissions: [], menus: [] } } })
    if (path.endsWith('/password/change')) {
      changes.push(route.request().postDataJSON())
      return changes.length === 1
        ? route.fulfill({ status: 401, json: { code: 401, errorCode: 'AUTH_PASSWORD_INVALID', message: '账号或密码错误，或账号暂不可用' } })
        : route.fulfill({ json: { code: 0, data: { configured: true } } })
    }
    return route.fulfill({ json: { code: 0, data: {} } })
  })
  await page.goto('/password/change')
  const save = page.getByRole('button', { name: '保存新密码并重新登录' })
  await save.click()
  await expect(page.locator('p[role=alert]')).toContainText('请输入当前密码')
  expect(changes).toHaveLength(0)
  await page.getByLabel('当前密码', { exact: true }).fill('Synthetic incorrect old password')
  await page.getByLabel('新密码', { exact: true }).fill(fixturePassword)
  await page.getByLabel('再次输入新密码').fill(fixturePassword)
  await save.click()
  await expect(page.locator('p[role=alert]')).toContainText('账号或密码错误')
  expect(await page.evaluate(() => localStorage.getItem('accessToken'))).toBe('synthetic-old-access')
  expect(paths.filter(path => path.endsWith('/refresh-token'))).toHaveLength(0)
  await page.getByLabel('当前密码', { exact: true }).fill('Synthetic correct old password')
  await save.click()
  await expect(page).toHaveURL(/\/login$/)
  expect(await page.evaluate(() => localStorage.getItem('accessToken'))).toBeNull()
  expect(await page.evaluate(() => localStorage.getItem('refreshToken'))).toBeNull()
  expect(changes[1]).toEqual({ currentPassword: 'Synthetic correct old password', password: fixturePassword })
  expect(await page.evaluate(() => JSON.stringify(localStorage))).not.toContain(fixturePassword)
})

for (const count of [65, 128]) {
  test(`setup preserves all ${count} non-BMP characters and submits the same password`, async ({ page }) => {
    const value = '🔐'.repeat(count), writes: any[] = []
    await page.route('**/api/v1/**', route => {
      if (new URL(route.request().url()).pathname.endsWith('/setup')) writes.push(route.request().postDataJSON())
      return route.fulfill({ json: { code: 0, data: { account: '138****0000' } } })
    })
    await page.goto('/password/setup#token=' + setupToken)
    await page.getByLabel('新密码', { exact: true }).fill(value)
    await page.getByLabel('再次输入新密码').fill(value)
    await expect(page.getByLabel('新密码', { exact: true })).toHaveValue(value)
    await page.getByRole('button', { name: '设置密码', exact: true }).click()
    await expect(page.getByRole('heading', { name: '登录密码已设置' })).toBeVisible()
    expect(writes).toEqual([{ token: setupToken, password: value }])
  })
}

test('login preserves non-BMP input and blocks 129 code points instead of truncating', async ({ page }) => {
  const writes: any[] = []
  await page.route('**/api/v1/**', route => {
    writes.push(route.request().postDataJSON())
    return route.fulfill({ status: 401, json: { code: 401, errorCode: 'AUTH_PASSWORD_INVALID', message: '测试密码未匹配' } })
  })
  await page.goto('/login')
  await page.getByLabel('账号（手机号）').fill('13800000000')
  await page.locator('.agreement .el-checkbox').click()
  await page.getByLabel('登录密码', { exact: true }).fill('🔐'.repeat(129))
  await page.getByRole('button', { name: '登录', exact: true }).click()
  await expect(page.getByText('密码最多128个字符，请检查输入', { exact: true })).toBeVisible()
  expect(writes).toHaveLength(0)
  await page.getByLabel('登录密码', { exact: true }).fill('🔐'.repeat(128))
  await page.getByRole('button', { name: '登录', exact: true }).click()
  await expect(page.locator('p[role=alert]')).toContainText('测试密码未匹配')
  expect(writes).toHaveLength(1)
  expect(writes[0].password).toBe('🔐'.repeat(128))
})

test('password change preserves current, new and confirmation Unicode values', async ({ page }) => {
  const writes: any[] = [], current = '🔐'.repeat(65), next = '🗝️'.repeat(64)
  await page.addInitScript(() => { localStorage.setItem('accessToken', 'synthetic-unicode-access') })
  await page.route('**/api/v1/**', route => {
    const path = new URL(route.request().url()).pathname
    if (path.endsWith('/auth/profile')) return route.fulfill({ json: { code: 0, data: { user: { id: 7, userType: 'admin' }, permissions: [], menus: [] } } })
    if (path.endsWith('/password/change')) writes.push(route.request().postDataJSON())
    return route.fulfill({ json: { code: 0, data: {} } })
  })
  await page.goto('/password/change')
  await page.getByLabel('当前密码', { exact: true }).fill(current)
  await page.getByLabel('新密码', { exact: true }).fill(next)
  await page.getByLabel('再次输入新密码').fill(next)
  await page.getByRole('button', { name: '保存新密码并重新登录' }).click()
  await expect(page).toHaveURL(/\/login$/)
  expect(writes).toEqual([{ currentPassword: current, password: next }])
})
