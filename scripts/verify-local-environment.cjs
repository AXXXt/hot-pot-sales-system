// Real local HTTP/browser checks. No catalog, customer or order records are created.
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const { chromium } = require('../web-customer/node_modules/@playwright/test')
const { localConfig } = require('./local-environment.cjs')
const api = 'http://127.0.0.1:3000/api/v1'
const output = path.resolve(__dirname, '../.wx-local-runtime')

async function read(route, token) {
  const response = await fetch(api + route, { headers: token ? { Authorization: `Bearer ${token}` } : {} })
  assert.equal(response.status, 200, route)
  return (await response.json()).data
}

async function main() {
  localConfig()
  fs.mkdirSync(output, { recursive: true })
  const health = await fetch('http://127.0.0.1:3000/health/ready')
  assert.equal(health.status, 200)
  assert.equal((await fetch(api + '/orders')).status, 401)
  const browser = await chromium.launch({ channel: 'msedge', headless: true })
  try {
    for (const site of [
      { name: 'admin', port: 5173, phone: '13800000000', placeholder: '请输入管理员手机号', button: '登录', target: '/dashboard', tokenKey: 'accessToken', routes: ['/dashboard/stats', '/products', '/customers', '/orders', '/inventory/stock', '/admin/brands'] },
      { name: 'customer', port: 5174, phone: '18137222005', placeholder: '请输入手机号', button: '登录采购台', target: '/home', tokenKey: 'webAccessToken', routes: ['/auth/profile', '/products', '/brands', '/product-categories', '/orders', '/customers/me/price-rules'] }
    ]) {
      const page = await browser.newPage({ viewport: { width: 1440, height: 960 } })
      const errors = []
      page.on('pageerror', error => errors.push(error.message))
      // Forbid accidental requests to production during this local test.
      await page.route('**/*', route => {
        const url = new URL(route.request().url())
        if (url.hostname === '127.0.0.1' || url.protocol === 'data:') return route.continue()
        return route.abort()
      })
      await page.goto(`http://127.0.0.1:${site.port}/login`)
      await page.getByPlaceholder(site.placeholder, { exact: true }).fill(site.phone)
      const sent = page.waitForResponse(response => response.url() === api + '/auth/send-code')
      await page.getByRole('button', { name: '获取验证码', exact: true }).click()
      assert.equal((await sent).status(), 201)
      await page.getByPlaceholder('请输入验证码', { exact: true }).fill('123456')
      if (site.name === 'customer') await page.locator('.agreement .el-checkbox').click()
      await page.getByRole('button', { name: site.button, exact: true }).click()
      await page.waitForURL(`**${site.target}`, { timeout: 20000 })
      const token = await page.evaluate(key => localStorage.getItem(key), site.tokenKey)
      assert.ok(token)
      for (const route of site.routes) await read(route, token)
      if (site.name === 'customer') {
        const denied = await fetch(api + '/system-configs', { headers: { Authorization: `Bearer ${token}` } })
        assert.equal(denied.status, 403, 'Customer cannot read administrative settings')
      }
      await page.waitForTimeout(500)
      assert.deepEqual(errors, [])
      await page.screenshot({ path: path.join(output, `${site.name}-local.png`), fullPage: true })
      await page.setViewportSize({ width: 390, height: 844 })
      await page.waitForTimeout(200)
      assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth))
      await page.close()
      await fetch(api + '/auth/logout', { method: 'POST', headers: { Authorization: `Bearer ${token}` } })
      console.log(`${site.name}: real SMS-code login, ${site.routes.length} API reads, desktop/mobile rendering passed`)
      await new Promise(resolve => setTimeout(resolve, 10500))
    }
    const page = await browser.newPage()
    await page.goto('http://127.0.0.1:5180')
    assert.equal(await page.locator('[data-client-link]').first().getAttribute('href'), 'http://127.0.0.1:5174/login')
    assert.equal(await page.locator('[data-catalog-link]').first().getAttribute('href'), 'http://127.0.0.1:5174/category')
    console.log('Official site links point to the local customer website')
  } finally { await browser.close() }
}
main().catch(error => { console.error(error.message); process.exitCode = 1 })
