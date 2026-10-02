const { chromium } = require('../web-customer/node_modules/playwright')
const assert = require('node:assert/strict')
const path = require('node:path')
const { mkdirSync } = require('node:fs')

async function main() {
  const ip = process.env.SMOKE_TUNNEL === 'true' ? '127.0.0.1' : '152.136.138.118'
  const out = path.join(__dirname, '.work', 'screenshots')
  mkdirSync(out, { recursive: true })
  const browser = await chromium.launch({ headless: true, channel: process.env.PLAYWRIGHT_CHANNEL || undefined, args: ['--no-proxy-server', `--host-resolver-rules=MAP weiduoxian.cn ${ip}, MAP *.weiduoxian.cn ${ip}`] })
  try {
    for (const viewport of [{ width: 1440, height: 1000 }, { width: 390, height: 844 }]) {
      for (const [name, url] of [['official', 'https://weiduoxian.cn/'], ['customer', 'https://app.weiduoxian.cn/login'], ['admin', 'https://admin.weiduoxian.cn/login']]) {
        const page = await browser.newPage({ viewport })
        const errors = []
        page.on('pageerror', error => errors.push(error.message))
        const response = await page.goto(url, { waitUntil: 'networkidle', timeout: 60000 })
        assert.equal(response.status(), 200)
        const height = await page.evaluate(() => document.documentElement.scrollHeight)
        for (let y = 0; y < height; y += viewport.height) {
          await page.evaluate(offset => scrollTo(0, offset), y)
          await page.waitForTimeout(150)
        }
        await page.evaluate(() => scrollTo(0, 0))
        await page.locator('img').evaluateAll(images => Promise.all(images.map(image => image.decode().catch(() => {}))))
        const state = await page.evaluate(() => ({
          text: document.body.innerText.length,
          overflow: document.documentElement.scrollWidth > innerWidth + 1,
          images: Array.from(document.images).filter(image => !image.complete || !image.naturalWidth).map(image => image.getAttribute('src'))
        }))
        assert.ok(state.text > 30)
        assert.deepEqual(errors, [])
        assert.deepEqual(state.images, [])
        await page.screenshot({ path: path.join(out, `${name}-${viewport.width}.png`), fullPage: true })
        console.log(JSON.stringify({ page: name, width: viewport.width, ...state, errors }))
        await page.close()
      }
    }
  } finally { await browser.close() }
}
main().catch(error => { console.error(error.message); process.exitCode = 1 })
