import { test, expect } from '@playwright/test'
import { readFileSync } from 'node:fs'
const legal = JSON.parse(readFileSync(new URL('../../constants/legal.json', import.meta.url), 'utf8'))

test('password and SMS login both require an unchecked explicit agreement and send the viewed version', async ({ page }) => {
  const attempts: Array<{ path: string; body: any }> = []
  await page.route('**/api/v1/**', route => {
    attempts.push({ path: new URL(route.request().url()).pathname, body: route.request().postDataJSON() })
    return route.fulfill({ status: 400, json: { code: 400, message: 'QA invalid credential' } })
  })
  await page.goto('/login')
  const checkbox = page.getByRole('checkbox', { name: '我已阅读并同意' })
  await expect(checkbox).not.toBeChecked()
  await page.getByLabel('账号（手机号）').fill('13800000000')
  await page.getByLabel('登录密码', { exact: true }).fill('QA synthetic passphrase 2026!')
  await page.getByRole('button', { name: '登录', exact: true }).click()
  await expect(page.getByRole('alert')).toContainText('请先阅读并同意')
  expect(attempts).toHaveLength(0)
  await page.locator('.agreement .el-checkbox').click()
  await page.getByRole('button', { name: '登录', exact: true }).click()
  await expect.poll(() => attempts.length).toBe(1)
  expect(attempts[0]).toMatchObject({ path: '/api/v1/auth/password/login', body: {
    consentAccepted: true, consentVersion: legal.version, consentChannel: 'admin_web'
  } })
  await page.getByText('验证码登录', { exact: true }).click()
  await page.getByLabel('验证码', { exact: true }).fill('123456')
  await page.getByRole('button', { name: '登录', exact: true }).click()
  await expect.poll(() => attempts.length).toBe(2)
  expect(attempts[1]).toMatchObject({ path: '/api/v1/auth/login', body: { consentAccepted: true, consentVersion: legal.version, consentChannel: 'admin_web' } })
})

test('both public documents show the same version and keep unconfirmed operating facts visible', async ({ page }) => {
  for (const type of ['terms', 'privacy']) {
    await page.goto('/legal/' + type)
    await expect(page.getByRole('heading', { level: 1 })).toHaveText(type === 'privacy' ? '隐私政策' : '用户协议')
    await expect(page.getByText(`版本 ${legal.version}`, { exact: true })).toBeVisible()
    await expect(page.getByRole('alert')).toContainText('审阅稿')
  }
})
