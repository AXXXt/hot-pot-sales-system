import { test, expect } from '@playwright/test'

test('planning can load beyond 500 rows with a real total, preserves retries and states the notification boundary', async ({ page }) => {
  test.setTimeout(60000)
  const calls: number[] = []
  let failPage2 = true
  await page.addInitScript(() => localStorage.setItem('accessToken', 'local-planning-fixture'))
  await page.route('**/api/v1/**', route => {
    const url = new URL(route.request().url()), path = url.pathname
    let data: any = { items: [], total: 0 }
    if (path.endsWith('/auth/profile')) data = { user: { id: 1, userType: 'super_admin' }, permissions: [], menus: [] }
    if (path.endsWith('/inventory/planning')) {
      const current = Number(url.searchParams.get('page') || 1); calls.push(current)
      if (current === 2 && failPage2) { failPage2 = false; return route.fulfill({ status: 503, json: { message: 'local transient fixture failure' } }) }
      const start = (current - 1) * 100
      data = { total: 501, page: current, pageSize: 100, hasMore: current < 6, note: '库存按基础销售单位显示', items: Array.from({ length: Math.min(100, 501 - start) }, (_, index) => ({
        skuId: start + index + 1, skuCode: `QA-${start + index + 1}`, productName: `QA第${start + index + 1}`, specText: '袋', saleUnit: '袋', stockNum: 0, reservedNum: 0,
        availableNum: 0, lowStock: true, threshold: 10, suggestedQuantity: 10
      })) }
    }
    return route.fulfill({ json: { code: 0, data } })
  })
  await page.goto('/inventory/planning')
  await expect(page.getByText(/已加载 100 \/ 501 个可见规格/)).toBeVisible()
  await expect(page.getByText('低库存和临期目前在后台展示，未自动发送微信提醒；请定期查看并人工跟进。')).toBeVisible()
  await page.getByRole('button', { name: '加载更多规格' }).click()
  await expect(page.getByText('加载更多失败，请重试；已加载内容已保留')).toBeVisible()
  await expect(page.getByText(/已加载 100 \/ 501 个可见规格/)).toBeVisible()
  for (let next = 2; next <= 6; next++) {
    await page.getByRole('button', { name: '加载更多规格' }).click()
    await expect(page.getByText(new RegExp(`已加载 ${Math.min(next * 100, 501)} \\/ 501 个可见规格`))).toBeVisible()
  }
  await expect(page.getByRole('button', { name: '加载更多规格' })).toHaveCount(0)
  expect(calls).toEqual([1, 2, 2, 3, 4, 5, 6])
  const overview = page.getByRole('tabpanel', { name: '预警与补货' })
  await overview.locator('thead .el-checkbox').click()
  await expect(page.getByRole('button', { name: '保存补货草稿' })).toBeDisabled()
})

test('a failed replenishment retries the same intent but changed quantities receive a fresh request identity', async ({ page }) => {
  const posts: any[] = []
  await page.addInitScript(() => localStorage.setItem('accessToken', 'local-plan-retry-fixture'))
  await page.route('**/api/v1/**', route => {
    const path = new URL(route.request().url()).pathname
    let data: any = { items: [], total: 0 }
    if (path.endsWith('/auth/profile')) data = { user: { id: 1, userType: 'super_admin' }, permissions: [], menus: [] }
    if (path.endsWith('/inventory/planning')) data = { items: [{ skuId: 1, skuCode: 'QA-ONE', productName: '本地补货验收', specText: '袋', saleUnit: '袋', availableNum: 0, suggestedQuantity: 10 }], total: 1 }
    if (path.endsWith('/inventory/replenishment-plans') && route.request().method() === 'POST') {
      posts.push(route.request().postDataJSON())
      if (posts.length < 3) return route.fulfill({ status: 503, json: { message: '本地模拟回执丢失，请重试' } })
      data = { id: 7 }
    }
    return route.fulfill({ json: { code: 0, data } })
  })
  await page.goto('/inventory/planning')
  await page.getByRole('tabpanel', { name: '预警与补货' }).locator('thead .el-checkbox').click()
  const save = page.getByRole('button', { name: '保存补货草稿' })
  await save.click()
  await expect(save).toBeDisabled()
  await page.getByRole('button', { name: '返回检查', exact: true }).click()
  expect(posts).toHaveLength(0)
  for (let attempt = 0; attempt < 2; attempt++) {
    await save.click(); await page.getByRole('button', { name: '保存草稿', exact: true }).click()
    await expect.poll(() => posts.length).toBe(attempt + 1)
    await expect(save).toBeEnabled()
  }
  expect(posts[0].requestId).toBe(posts[1].requestId)
  await page.getByRole('spinbutton', { name: 'QA-ONE补货数量' }).fill('11')
  await page.getByRole('spinbutton', { name: 'QA-ONE补货数量' }).blur()
  await save.click(); await page.getByRole('button', { name: '保存草稿', exact: true }).click()
  await expect.poll(() => posts.length).toBe(3)
  expect(posts[2].requestId).not.toBe(posts[1].requestId)
  expect(posts[2].items).toEqual([{ skuId: 1, quantity: 11 }])
})

test('batch pagination retains unknown-date stock and requires an explicit confirmation before registering dates', async ({ page }) => {
  const assignments: any[] = []
  await page.addInitScript(() => localStorage.setItem('accessToken', 'local-batch-fixture'))
  await page.route('**/api/v1/**', route => {
    const url = new URL(route.request().url()), path = url.pathname
    let data: any = { items: [], total: 0 }
    if (path.endsWith('/auth/profile')) data = { user: { id: 1, userType: 'super_admin' }, permissions: [], menus: [] }
    if (path.endsWith('/inventory/batches')) {
      const next = url.searchParams.get('page') === '2'
      data = { total: 2, hasMore: !next, items: [{ id: next ? 2 : 1, productName: '历史库存验收', specText: '袋', batchNo: next ? 'EXPIRED-QA' : '历史/未注明批次', quantity: next ? 3 : 10, saleUnit: '袋', productionDate: '', expiryDate: next ? '2020-01-01' : '', state: next ? '已到期' : '日期未知' }] }
    }
    if (path.endsWith('/inventory/batches/assign')) { assignments.push(route.request().postDataJSON()); data = { id: 9 } }
    return route.fulfill({ json: { code: 0, data } })
  })
  await page.goto('/inventory/planning')
  await page.getByRole('tab', { name: '批次与保质期' }).click()
  await expect(page.getByText('已加载 1 / 2 条有库存批次。')).toBeVisible()
  await page.getByRole('button', { name: '加载更多批次' }).click()
  await expect(page.getByText('已加载 2 / 2 条有库存批次。')).toBeVisible()
  await expect(page.getByRole('tabpanel', { name: '批次与保质期' }).getByText('已到期', { exact: true })).toBeVisible()
  await page.getByRole('button', { name: '补登记批次', exact: true }).click()
  const dialog = page.getByRole('dialog', { name: '补登记历史批次' })
  await dialog.getByRole('spinbutton', { name: '补登记批次数量' }).fill('4')
  await dialog.getByRole('textbox', { name: '补登记批次号' }).fill('QA-REGISTERED')
  await dialog.getByRole('textbox', { name: '补登记到期日期' }).fill('2035-01-01')
  await dialog.getByRole('button', { name: '登记批次', exact: true }).click()
  await page.getByRole('button', { name: '返回检查', exact: true }).click()
  expect(assignments).toHaveLength(0)
  await dialog.getByRole('button', { name: '登记批次', exact: true }).click()
  await page.getByRole('button', { name: '确认登记', exact: true }).click()
  await expect.poll(() => assignments.length).toBe(1)
  expect(assignments[0]).toMatchObject({ fromBatchId: 1, quantity: 4, batchNo: 'QA-REGISTERED', expiryDate: '2035-01-01' })
})

test('replenishment CSV downloads preserve Unicode and quotes while neutralizing leading formula and control characters', async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem('accessToken', 'local-csv-fixture'))
  await page.route('**/api/v1/**', route => {
    const path = new URL(route.request().url()).pathname
    let data: any = { items: [], total: 0 }
    if (path.endsWith('/auth/profile')) data = { user: { id: 1, userType: 'super_admin' }, permissions: [], menus: [] }
    if (path.endsWith('/inventory/replenishment-plans')) data = { items: [{ id: 1, planNo: 'RP-QA-CSV', status: 'draft', payload: { items: [{ productName: ' \t=SUM(1,1)', skuCode: '@QA', specText: '爆汁"牛筋丸\n500克', quantity: 10, saleUnit: '袋' }] } }] }
    return route.fulfill({ json: { code: 0, data } })
  })
  await page.goto('/inventory/planning')
  await page.getByRole('tab', { name: '补货草稿' }).click()
  await page.getByRole('button', { name: 'RP-QA-CSV · 待采购' }).click()
  const [download] = await Promise.all([page.waitForEvent('download'), page.getByRole('button', { name: '导出清单' }).click()])
  const stream = await download.createReadStream(), parts: Buffer[] = []
  for await (const part of stream!) parts.push(Buffer.from(part))
  const csv = Buffer.concat(parts).toString('utf8')
  expect(download.suggestedFilename()).toBe('RP-QA-CSV.csv')
  expect(csv).toContain('"\' \t=SUM(1,1)"')
  expect(csv).toContain('"\'@QA"')
  expect(csv).toContain('"爆汁""牛筋丸\n500克"')
  expect(csv).toContain('"10","袋"')
})
