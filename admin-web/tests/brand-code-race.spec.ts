import { test, expect } from '@playwright/test'

test('a late brand code suggestion cannot overwrite a manually entered prefix', async ({ page }) => {
  let resolveSuggestion!: () => void
  let suggestionStarted!: () => void
  const started = new Promise<void>(resolve => { suggestionStarted = resolve })
  const gate = new Promise<void>(resolve => { resolveSuggestion = resolve })
  await page.addInitScript(() => localStorage.setItem('accessToken', 'qa-brand-test'))
  await page.route('**/api/v1/**', async route => {
    const path = new URL(route.request().url()).pathname
    let data: any = []
    if (path.endsWith('/auth/profile')) data = { user: { id: 1, userType: 'super_admin' }, permissions: [], menus: [] }
    if (path.endsWith('/admin/brands/code-suggestion')) {
      suggestionStarted()
      await gate
      data = { code: 'AUTOMATIC' }
    }
    await route.fulfill({ json: { code: 0, data } })
  })
  await page.goto('/products/brands')
  await page.getByRole('button', { name: '新建品牌', exact: true }).click()
  const dialog = page.getByRole('dialog', { name: '新建品牌' })
  await dialog.getByLabel('品牌名称', { exact: true }).fill('验收品牌')
  const code = dialog.getByLabel('品牌编码前缀', { exact: true })
  await code.focus()
  await started
  await code.fill('MYCODE')
  const response = page.waitForResponse('**/admin/brands/code-suggestion?*')
  resolveSuggestion()
  await response
  await expect(code).toHaveValue('MYCODE')
  await expect(dialog.getByRole('button', { name: '保存', exact: true })).toBeEnabled()
})
