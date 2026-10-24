import { test, expect } from '@playwright/test'
import { readFileSync } from 'node:fs'
const legal = JSON.parse(readFileSync(new URL('../../constants/legal.json', import.meta.url), 'utf8'))

const fixturePassword = 'A synthetic fixture passphrase 2026!'
const token = 't'.repeat(43)

test('password is the default and SMS remains available without being sent automatically', async ({ page }) => {
  const calls: Array<{ path: string; data: any }> = []
  await page.route('**/api/v1/**', route => {
    const path = new URL(route.request().url()).pathname
    calls.push({ path, data: route.request().method() === 'POST' ? route.request().postDataJSON() : null })
    if (path.endsWith('/auth/password/login')) return route.fulfill({ status: 401, json: { code: 401, message: '账号或密码错误，或账号暂不可用' } })
    return route.fulfill({ json: { code: 0, data: {} } })
  })
  await page.goto('/login')
  await expect(page.getByLabel('登录密码', { exact: true })).toBeVisible()
  await expect(page.getByRole('button', { name: '获取验证码' })).toHaveCount(0)
  await page.getByLabel('账号（手机号）').fill('13800000000')
  await page.getByLabel('登录密码', { exact: true }).fill(fixturePassword)
  await page.locator('.agreement .el-checkbox').click()
  await page.getByRole('button', { name: '登录', exact: true }).click()
  await expect(page.locator('p[role="alert"]')).toContainText('账号或密码错误')
  expect(calls.filter(x => x.path.endsWith('/auth/password/login'))).toEqual([{ path: '/api/v1/auth/password/login', data: { phone: '13800000000', password: fixturePassword,
    consentAccepted: true, consentVersion: legal.version, consentChannel: 'admin_web' } }])
  expect(calls.some(x => x.path.endsWith('/auth/send-code'))).toBe(false)
  await page.getByText('验证码登录', { exact: true }).click()
  await expect(page.getByLabel('验证码', { exact: true })).toBeVisible()
  await expect(page.getByRole('button', { name: '获取验证码' })).toBeVisible()
})

test('one-time setup validates confirmation, submits only the token and password, then clears the fragment', async ({ page }) => {
  const saves: any[] = []
  await page.route('**/api/v1/**', route => {
    const path = new URL(route.request().url()).pathname
    if (path.endsWith('/setup-info')) return route.fulfill({ json: { code: 0, data: { name: '测试管理员', account: '138****0000' } } })
    if (path.endsWith('/setup')) saves.push(route.request().postDataJSON())
    return route.fulfill({ json: { code: 0, data: { configured: true } } })
  })
  await page.goto('/password/setup#token=' + token)
  await expect(page.getByText('账号：138****0000')).toBeVisible()
  await page.getByLabel('新密码', { exact: true }).fill(fixturePassword)
  await page.getByLabel('再次输入新密码').fill('different')
  await page.getByRole('button', { name: '设置密码', exact: true }).click()
  await expect(page.getByRole('alert')).toContainText('两次输入的密码不一致')
  expect(saves).toHaveLength(0)
  await page.getByLabel('再次输入新密码').fill(fixturePassword)
  await page.getByRole('button', { name: '设置密码', exact: true }).click()
  await expect(page.getByRole('heading', { name: '登录密码已设置' })).toBeVisible()
  expect(saves).toEqual([{ token, password: fixturePassword }])
  expect(new URL(page.url()).hash).toBe('')
  expect(await page.evaluate(() => JSON.stringify(localStorage))).not.toContain(fixturePassword)
})

test('expired links expose no password form', async ({ page }) => {
  await page.route('**/api/v1/**', route => route.fulfill({ status: 400, json: { code: 400, message: '密码设置链接无效或已过期' } }))
  await page.goto('/password/setup#token=' + token)
  await expect(page.locator('p[role="alert"]')).toContainText('无效或已过期')
  await expect(page.getByLabel('新密码', { exact: true })).toHaveCount(0)
})

test('password login preserves existing permissions and redirects to the requested page', async ({ page }) => {
  await page.route('**/api/v1/**', route => {
    const path = new URL(route.request().url()).pathname
    let data: any = { items: [] }
    if (path.endsWith('/password/login')) data = { accessToken: 'fixture-access', refreshToken: 'fixture-refresh' }
    if (path.endsWith('/auth/profile')) data = { user: { id: 1, name: '管理员', userType: 'super_admin' }, permissions: [], menus: [] }
    return route.fulfill({ json: { code: 0, data } })
  })
  await page.goto('/login?redirect=/products')
  await page.getByLabel('账号（手机号）').fill('13800000000')
  await page.getByLabel('登录密码', { exact: true }).fill(fixturePassword)
  await page.locator('.agreement .el-checkbox').click()
  await page.getByRole('button', { name: '登录', exact: true }).click()
  await expect(page).toHaveURL(/\/products$/)
  await expect(page.getByRole('button', { name: '修改密码' })).toBeVisible()
})

test('login and setup remain readable at a small phone width', async ({ page }) => {
  await page.setViewportSize({ width: 375, height: 812 })
  await page.goto('/login')
  await expect(page.getByLabel('登录密码', { exact: true })).toBeVisible()
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(375)
  await page.route('**/api/v1/auth/password/setup-info', route => route.fulfill({ json: { code: 0, data: { account: '138****0000' } } }))
  await page.goto('/password/setup#token=' + token)
  await expect(page.getByLabel('新密码', { exact: true })).toBeVisible()
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(375)
})
