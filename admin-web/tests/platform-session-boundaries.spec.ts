import { expect, test } from '@playwright/test'

// Synthetic local browser state only; no live account or version operation is used.
for (const nextSession of ['logged-out', 'account-B']) {
  test(`independent control UI ignores an old refresh result after ${nextSession}`, async ({ page }) => {
    await page.addInitScript(() => {
      localStorage.setItem('accessToken', 'expired-fixture-A')
      localStorage.setItem('refreshToken', 'refresh-fixture-A')
    })
    let release!: () => void, started = 0
    const gate = new Promise<void>(resolve => { release = resolve })
    await page.route('**/api/v1/**', async route => {
      const path = new URL(route.request().url()).pathname
      if (path.endsWith('/auth/refresh-token')) {
        started++; await gate
        return route.fulfill({ json: { code: 0, data: { accessToken: 'late-fixture-A', refreshToken: 'late-refresh-A' } } })
      }
      if ((path.endsWith('/platform/overview') || path.endsWith('/auth/profile')) && route.request().headers().authorization === 'Bearer expired-fixture-A') {
        return route.fulfill({ status: 401, json: { code: 401, message: 'Expired synthetic session' } })
      }
      return route.fulfill({ json: { code: 0, data: { canManage: false, releases: [], current: { id: 'fixture-release', version: '0', title: 'Local fixture', publishedAt: '2026-10-24T00:00:00Z' } } } })
    })
    await page.goto('/platform.html')
    await expect(page.getByRole('heading', { name: '版本与功能更新', exact: true })).toBeVisible()
    await expect.poll(() => started).toBe(1)
    await page.evaluate(next => {
      localStorage.setItem('adminSessionGeneration', 'synthetic-' + next)
      if (next === 'logged-out') { localStorage.removeItem('accessToken'); localStorage.removeItem('refreshToken') }
      else { localStorage.setItem('accessToken', 'fixture-B'); localStorage.setItem('refreshToken', 'refresh-B') }
    }, nextSession)
    release()
    await expect(page.locator('.release-alert')).toBeVisible()
    expect(await page.evaluate(() => [localStorage.getItem('accessToken'), localStorage.getItem('refreshToken')]))
      .toEqual(nextSession === 'logged-out' ? [null, null] : ['fixture-B', 'refresh-B'])
  })
}

test('independent fetch does not render an old overview under a new account', async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem('accessToken', 'synthetic-A'))
  let release!: () => void, started = false
  const gate = new Promise<void>(resolve => { release = resolve })
  await page.route('**/api/v1/platform/**', async route => {
    started = true; await gate
    return route.fulfill({ json: { code: 0, data: { canManage: true, releases: [], current: { id: 'fixture', version: '0', title: 'Old account private overview', publishedAt: '2026-10-24T00:00:00Z' } } } })
  })
  await page.goto('/platform.html')
  await expect.poll(() => started).toBe(true)
  await page.evaluate(() => { localStorage.setItem('adminSessionGeneration', 'synthetic-new-account'); localStorage.setItem('accessToken', 'synthetic-B') })
  release()
  await expect(page.locator('.release-alert')).toContainText('登录状态已变化')
  await expect(page.getByText('Old account private overview', { exact: true })).toHaveCount(0)
})

test('switching accounts while a release confirmation is open never submits the old plan', async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem('accessToken', 'synthetic-A'))
  let operations = 0
  const from = { id: 'ai-20261024-1', version: '0.1', title: 'Fixture from', sequence: 1, notes: [], publishedAt: '2026-10-24T00:00:00Z', ready: true }
  const target = { ...from, id: 'ai-20261024-2', version: '0.2', sequence: 2, title: 'Fixture target' }
  await page.route('**/api/v1/platform/**', route => {
    const path = new URL(route.request().url()).pathname
    if (path.endsWith('/operations')) operations++
    const data = path.endsWith('/plans') ? { from, target, notice: 'Local fixture only', token: { payload: 'fixture', signature: 'fixture' } }
      : { canManage: true, releases: [from, target], current: from }
    return route.fulfill({ json: { code: 0, data } })
  })
  await page.goto('/platform.html')
  await page.getByRole('button', { name: '更新到此版本', exact: true }).click()
  await expect(page.getByRole('dialog', { name: '确认平台版本切换' })).toBeVisible()
  await page.evaluate(() => { localStorage.setItem('adminSessionGeneration', 'synthetic-other-session'); localStorage.setItem('accessToken', 'synthetic-B') })
  await page.getByRole('button', { name: '确认更新', exact: true }).click()
  await expect(page.locator('.release-alert')).toContainText('登录状态已变化')
  expect(operations).toBe(0)
})
