import { test, expect } from '@playwright/test'

test('customer editing waits for loaded details and preserves untouched contact fields', async ({ page }) => {
  const customer = { id: 2, customerName: 'QA延迟加载门店', contactName: 'QA联系人', contactPhone: '13900000000', address: 'QA验收地址', customerLevelId: 1, creditLimit: '100', creditDays: 7, creditUsed: '0', status: 'active', createdAt: '2026-10-23T00:00:00Z' }
  let releaseDetail!: () => void
  const detailReady = new Promise<void>(resolve => { releaseDetail = resolve })
  const updates: any[] = []
  await page.addInitScript(() => localStorage.setItem('accessToken', 'customer-loading-test'))
  await page.route('**/api/v1/**', async route => {
    const path = new URL(route.request().url()).pathname
    let data: any = { items: [], total: 0 }
    if (path.endsWith('/auth/profile')) data = { user: { id: 1, userType: 'super_admin' }, permissions: [], menus: [] }
    if (path.endsWith('/customer-levels')) data = [{ id: 1, name: '普通客户', discountRate: '1' }]
    if (path.endsWith('/customer-price-rules') || path.endsWith('/repayments')) data = []
    if (path.endsWith('/product-visibility')) data = { mode: 'factory', products: [], productIds: [], visibleProductCount: 0 }
    if (path.endsWith('/customers/2')) {
      if (route.request().method() === 'PATCH') {
        const body = route.request().postDataJSON()
        updates.push(body)
        Object.assign(customer, body)
      } else await detailReady
      data = customer
    }
    await route.fulfill({ json: { code: 0, data } })
  })
  await page.goto('/customers/2')
  const edit = page.getByRole('button', { name: '编辑信息', exact: true })
  await expect(edit).toBeDisabled()
  await expect(page.getByRole('button', { name: '启用客户', exact: true })).toBeDisabled()
  await edit.click({ force: true })
  await expect(page.getByRole('dialog')).not.toBeVisible()
  expect(updates).toHaveLength(0)
  releaseDetail()
  await expect(edit).toBeEnabled()
  await edit.click()
  const dialog = page.getByRole('dialog', { name: '编辑客户信息' })
  await expect(dialog.getByRole('textbox').nth(1)).toHaveValue(customer.contactName)
  await expect(dialog.getByRole('textbox').nth(2)).toHaveValue(customer.contactPhone)
  await expect(dialog.getByRole('textbox').nth(3)).toHaveValue(customer.address)
  await dialog.getByRole('textbox').nth(4).fill('50')
  await dialog.getByRole('button', { name: '保存', exact: true }).click()
  await expect(dialog).not.toBeVisible()
  expect(updates).toHaveLength(1)
  expect(updates[0]).toMatchObject({ contactName: 'QA联系人', contactPhone: '13900000000', address: 'QA验收地址', customerLevelId: 1, creditLimit: '50' })
})
