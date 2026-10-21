import { expect, test, type Page } from '@playwright/test'
const releases = [3, 2].map(sequence => ({ id: `ai-20261021-${sequence}`, sequence, version: `1.${sequence - 1}.0`, title: sequence === 3 ? '图片拖放与版本管理' : '品牌与分类自动创建', notes: ['本次功能改进'], publishedAt: '2026-10-21T05:00:00Z', ready: true, supportsControl: sequence === 3 }))
async function fixture(page: Page, canManage = true) {
  let executions = 0
  await page.addInitScript(() => localStorage.setItem('accessToken', 'platform-test'))
  await page.route('**/api/v1/platform/**', async route => {
    const url = route.request().url()
    let data: any = { current: releases[0], latest: releases[0], releases, canManage, operation: null }
    if (url.endsWith('/plans')) data = { token: { payload: 'test', signature: 'test' }, id: 'job-1', type: 'rollback', from: releases[0], target: releases[1], notice: '业务数据保留，版本管理入口保持可用。' }
    if (url.endsWith('/operations')) { executions++; data = { id: 'job-1', type: 'rollback', source: releases[0].id, target: releases[1].id, status: 'queued', phase: 'queued', message: '等待安全发布任务启动' } }
    if (url.endsWith('/operations/job-1')) data = { id: 'job-1', type: 'rollback', source: releases[0].id, target: releases[1].id, status: 'succeeded', phase: 'finished', message: '版本切换完成，业务数据已保留' }
    await route.fulfill({ json: { code: 0, data } })
  })
  return () => executions
}
test('release center requires a reviewed confirmation before rollback', async ({ page }, info) => {
  const count = await fixture(page); await page.goto('/platform.html')
  await expect(page.getByRole('heading', { name: '版本与功能更新' })).toBeVisible()
  await page.getByRole('button', { name: '回滚到此版本' }).click()
  await expect(page.getByRole('dialog')).toContainText('v1.2.0回滚到 v1.1.0')
  expect((await page.locator('.el-message-box').boundingBox())!.width).toBeLessThanOrEqual(540)
  expect(count()).toBe(0); await page.getByRole('button', { name: '返回检查' }).click(); expect(count()).toBe(0)
  await page.screenshot({ path: info.outputPath('platform-releases.png'), fullPage: true })
  await page.getByRole('button', { name: '回滚到此版本' }).click(); await page.getByRole('button', { name: '确认回滚' }).click()
  await expect(page.getByText('版本切换完成', { exact: true })).toBeVisible(); expect(count()).toBe(1)
})
test('ordinary staff can read version notes without update or rollback controls', async ({ page }) => {
  await fixture(page, false); await page.goto('/platform.html')
  await expect(page.getByText('当前账号可查看更新记录；平台更新和回滚由超级管理员执行。')).toBeVisible()
  await expect(page.getByRole('button', { name: /回滚到此版本|更新到此版本/ })).toHaveCount(0)
})
test('version center fits a phone screen', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 }); await fixture(page); await page.goto('/platform.html')
  await expect(page.getByRole('heading', { name: '版本与功能更新' })).toBeVisible()
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
})
