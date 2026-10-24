import { test, expect } from '@playwright/test'

const categoryRows = () => [
  { id: 1, name: '父分类', parentId: null, status: 'active', historicalProductCount: 0 },
  { id: 2, name: '子分类', parentId: 1, status: 'active', historicalProductCount: 0 },
  { id: 3, name: '孙分类', parentId: 2, status: 'active', historicalProductCount: 0 },
  { id: 4, name: '其他一级分类', parentId: null, status: 'active', historicalProductCount: 0 },
  { id: 5, name: '已停用分类', parentId: null, status: 'disabled', historicalProductCount: 0 }
]

test('category parent choices exclude itself, every descendant and disabled categories', async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem('accessToken', 'qa-category-boundary'))
  await page.route('**/api/v1/**', route => {
    const path = new URL(route.request().url()).pathname
    const data = path.endsWith('/auth/profile')
      ? { user: { id: 1, userType: 'super_admin' }, permissions: [], menus: [] }
      : categoryRows()
    return route.fulfill({ json: { code: 0, data } })
  })
  await page.goto('/products/categories')
  await page.getByRole('row').filter({ hasText: '父分类' }).getByRole('button', { name: '编辑', exact: true }).click()
  await page.getByRole('dialog').locator('.el-select__wrapper').click()
  await expect(page.getByRole('option', { name: '其他一级分类', exact: true })).toBeVisible()
  for (const name of ['父分类', '子分类', '孙分类', '已停用分类']) await expect(page.getByRole('option', { name, exact: true })).toHaveCount(0)
})

test('clearing a category parent persists null and returns it to the top level', async ({ page }) => {
  const rows = categoryRows(), updates: any[] = []
  await page.addInitScript(() => localStorage.setItem('accessToken', 'qa-category-clear-parent'))
  await page.route('**/api/v1/**', route => {
    const path = new URL(route.request().url()).pathname
    let data: any = rows
    if (path.endsWith('/auth/profile')) data = { user: { id: 1, userType: 'super_admin' }, permissions: [], menus: [] }
    if (path.endsWith('/product-categories/3') && route.request().method() === 'PATCH') {
      const body = route.request().postDataJSON(); updates.push(body); Object.assign(rows[2]!, body); data = rows[2]
    }
    return route.fulfill({ json: { code: 0, data } })
  })
  await page.goto('/products/categories')
  await page.getByRole('row').filter({ hasText: '孙分类' }).getByRole('button', { name: '编辑', exact: true }).click()
  const dialog = page.getByRole('dialog', { name: '编辑分类' })
  await dialog.locator('.el-select').hover()
  await dialog.locator('.el-select__clear').click()
  await dialog.getByRole('button', { name: '保存', exact: true }).click()
  await expect(dialog).not.toBeVisible()
  expect(updates).toEqual([{ name: '孙分类', sortOrder: 0, parentId: null }])
  await page.getByRole('row').filter({ hasText: '孙分类' }).getByRole('button', { name: '编辑', exact: true }).click()
  await expect(page.getByRole('dialog').getByRole('combobox')).toHaveValue('')
})

test('a parent without direct products warns about safe disabling and follows the server deletion mode', async ({ page }) => {
  const rows = categoryRows()
  await page.addInitScript(() => localStorage.setItem('accessToken', 'qa-category-parent-deletion'))
  await page.route('**/api/v1/**', route => {
    const path = new URL(route.request().url()).pathname
    let data: any = rows
    if (path.endsWith('/auth/profile')) data = { user: { id: 1, userType: 'super_admin' }, permissions: [], menus: [] }
    if (path.endsWith('/product-categories/1') && route.request().method() === 'DELETE') {
      rows[0]!.status = 'disabled'; data = { id: 1, deletionMode: 'disabled', linkedProductCount: 0 }
    }
    return route.fulfill({ json: { code: 0, data } })
  })
  await page.goto('/products/categories')
  await page.getByRole('row').filter({ hasText: '父分类' }).getByRole('button', { name: '删除', exact: true }).click()
  const confirm = page.getByRole('dialog', { name: '删除分类' })
  await expect(confirm).toContainText('还有子分类，删除后将安全停用且可恢复')
  await expect(confirm).not.toContainText('永久删除')
  await confirm.getByRole('button', { name: '确认删除', exact: true }).click()
  await expect(page.getByText('分类已安全停用，可随时恢复', { exact: true })).toBeVisible()
  await expect(page.getByRole('row').filter({ hasText: '父分类' }).getByRole('button', { name: '恢复', exact: true })).toBeVisible()
})

test('staff with brand management permission can edit assigned brands but cannot see brand creation', async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem('accessToken', 'qa-brand-staff'))
  await page.route('**/api/v1/**', route => {
    const path = new URL(route.request().url()).pathname
    const data = path.endsWith('/auth/profile')
      ? { user: { id: 7, userType: 'sales' }, permissions: ['brand:manage'], menus: [] }
      : [{ id: 4, name: '授权品牌', code: 'ASSIGNED', status: 'active' }]
    return route.fulfill({ json: { code: 0, data } })
  })
  await page.goto('/products/brands')
  await expect(page.getByRole('heading', { name: '品牌管理', exact: true })).toBeVisible()
  await expect(page.getByRole('button', { name: '新建品牌', exact: true })).toHaveCount(0)
  await page.getByRole('button', { name: '编辑', exact: true }).click()
  await expect(page.getByRole('dialog', { name: '编辑品牌' })).toBeVisible()
  await expect(page.getByRole('dialog').getByLabel('品牌名称', { exact: true })).toHaveValue('授权品牌')
})

test('brand image and description can be explicitly removed and remain empty after reopening', async ({ page }) => {
  const brand = { id: 4, name: '测试品牌', code: 'TEST', status: 'active',
    logoUrl: 'https://example.com/old.png', description: '旧说明' }
  const updates: any[] = []
  await page.addInitScript(() => localStorage.setItem('accessToken', 'qa-brand-clear-image'))
  await page.route('**/api/v1/**', route => {
    const path = new URL(route.request().url()).pathname
    let data: any = [brand]
    if (path.endsWith('/auth/profile')) data = { user: { id: 7, userType: 'super_admin' }, permissions: [], menus: [] }
    if (path.endsWith('/admin/brands/4') && route.request().method() === 'PATCH') {
      const body = route.request().postDataJSON()
      updates.push(body)
      Object.assign(brand, body)
      data = brand
    }
    return route.fulfill({ json: { code: 0, data } })
  })
  await page.goto('/products/brands')
  await page.getByRole('button', { name: '编辑', exact: true }).click()
  const dialog = page.getByRole('dialog', { name: '编辑品牌' })
  await dialog.getByRole('textbox', { name: '品牌图片', exact: true }).fill('')
  await dialog.getByRole('textbox', { name: '品牌说明', exact: true }).fill('')
  await dialog.getByRole('button', { name: '保存', exact: true }).click()
  await expect(dialog).not.toBeVisible()
  expect(updates[0]).toMatchObject({ logoUrl: null, description: null })
  await page.getByRole('button', { name: '编辑', exact: true }).click()
  await expect(dialog.getByRole('textbox', { name: '品牌图片', exact: true })).toHaveValue('')
  await expect(dialog.getByRole('textbox', { name: '品牌说明', exact: true })).toHaveValue('')
})
