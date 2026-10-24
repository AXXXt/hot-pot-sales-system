import { test, expect } from '@playwright/test'

test('automatic report tasks explain the channel and recovery, show quota errors and recover from a failed pause', async ({ page }) => {
  let enabled = true, pauses = 0
  await page.addInitScript(() => localStorage.setItem('accessToken', 'local-ai-schedule-fixture'))
  await page.route('**/api/v1/**', route => {
    const path = new URL(route.request().url()).pathname
    let data: any = { items: [], total: 0 }
    if (path.endsWith('/auth/profile')) data = { user: { id: 1, userType: 'super_admin' }, permissions: [], menus: [] }
    if (path.endsWith('/admin/ai/settings')) data = { enabled: true, hasKey: true, encryptionReady: true, features: {}, dailyRequests: 3 }
    if (path.endsWith('/admin/ai/schedules')) {
      if (route.request().method() === 'POST') return route.fulfill({ status: 400, json: { message: '最多启用10个自动任务' } })
      data = [{ id: 'fixture-task', name: '本地报告恢复验收', enabled, running: enabled, nextRunAt: '2035-01-01T01:00:00Z', lastRunAt: null, lastResult: null }]
    }
    if (path.endsWith('/admin/ai/schedules/fixture-task')) {
      if (++pauses === 1) return route.fulfill({ status: 503, json: { message: '本地模拟暂停失败，请重试' } })
      enabled = false; data = { count: 1 }
    }
    return route.fulfill({ json: { code: 0, data } })
  })
  await page.goto('/ai-settings')
  await page.getByRole('tab', { name: '自动任务', exact: true }).click()
  await expect(page.getByText(/也不发送微信提醒。每个账号最多启用10个任务/)).toBeVisible()
  await expect(page.getByText(/报告正在生成，中断后会自动恢复/)).toBeVisible()
  await page.getByPlaceholder('例如：每日工作清单').fill('本地任务配额验收')
  await page.getByRole('button', { name: '添加任务', exact: true }).click()
  await expect(page.locator('.settings-error')).toContainText('最多启用10个自动任务')
  await page.getByRole('button', { name: '暂停', exact: true }).click()
  await expect(page.locator('.settings-error')).toContainText('本地模拟暂停失败，请重试')
  await expect(page.getByRole('button', { name: '暂停', exact: true })).toBeEnabled()
  await page.getByRole('button', { name: '暂停', exact: true }).click()
  await expect(page.getByText(/已暂停 · 最近/)).toBeVisible()
  await expect(page.getByRole('button', { name: '暂停', exact: true })).toHaveCount(0)
  expect(pauses).toBe(2)
})
