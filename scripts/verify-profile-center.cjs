// Read-only native UI acceptance against the isolated local development API.
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const automator = require('../.codex-mini-automator/node_modules/miniprogram-automator')
const output = path.join(require('node:os').homedir(), 'Desktop', '唯多鲜-界面验证', 'profile-upgrade')
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms))
async function ready(mini, route) {
  await mini.callWxMethod('reLaunch', { url: route })
  await sleep(1000)
  const page = await mini.currentPage()
  for (let i = 0; i < 60 && (await page.data('loading') || await page.data('overviewLoading')); i++) {
    await sleep(200)
  }
  assert.equal(await page.data('error') || '', '')
  return page
}
async function main() {
  fs.mkdirSync(output, { recursive: true })
  const mini = await automator.connect({ wsEndpoint: 'ws://127.0.0.1:9421' })
  try {
    const env = await mini.evaluate(() => ({
      version: wx.getAccountInfoSync().miniProgram.envVersion, platform: wx.getDeviceInfo().platform
    }))
    assert.deepEqual(env, { version: 'develop', platform: 'devtools' })
    let page = await ready(mini, '/pages/profile/profile')
    assert.equal(await page.data('hasProfile'), true, 'Log in through verify-local-mini.cjs first')
    assert.equal(await page.data('overviewError'), '')
    assert.equal((await page.data('orderEntries')).length, 3)
    await mini.screenshot({ path: path.join(output, '01-profile-local.png') })
    const entries = await page.data('orderEntries')
    for (const entry of entries) {
      await page.callMethod('goOrders', { currentTarget: { dataset: { status: entry.status } } })
      let orders
      for (let i = 0; i < 60; i++) {
        await sleep(200)
        orders = await mini.currentPage()
        if (orders.path === 'pages/orders/orders' && await orders.data('activeStatus') === entry.status && !(await orders.data('loading'))) break
      }
      assert.equal(await orders.data('activeStatus'), entry.status)
      assert.equal(await orders.data('error'), '')
      assert.ok((await orders.data('orders')).every(order => order.status === entry.status))
      page = await ready(mini, '/pages/profile/profile')
    }
    for (const type of ['company', 'address', 'credit', 'prices']) {
      page = await ready(mini, `/pages/profile-detail/profile-detail?type=${type}`)
      assert.equal(await page.data('type'), type)
      if (type === 'prices') {
        await page.callMethod('onSearch', { detail: { value: '__no_matching_sku__' } })
        assert.equal((await page.data('filteredPrices')).length, 0)
        await page.callMethod('clearSearch')
      }
      await mini.screenshot({ path: path.join(output, `02-${type}-local.png`) })
      if (type === 'prices' && (await page.data('filteredPrices')).length) {
        const rule = (await page.data('filteredPrices'))[0]
        await page.callMethod('openProduct', { currentTarget: { dataset: { id: rule.productId, sku: rule.skuId } } })
        let product
        for (let i = 0; i < 60; i++) {
          await sleep(200)
          product = await mini.currentPage()
          if (product.path === 'pages/product-detail/product-detail' && !(await product.data('loading'))) break
        }
        assert.equal(product.path, 'pages/product-detail/product-detail')
        assert.equal(await product.data('selectedSkuId'), String(rule.skuId))
      }
    }
    page = await ready(mini, '/pages/account-settings/account-settings')
    assert.equal(await page.data('loggedIn'), true)
    await mini.screenshot({ path: path.join(output, '03-settings-local.png') })
    page = await ready(mini, '/pages/help/help')
    await page.callMethod('toggleQuestion', { currentTarget: { dataset: { index: 0 } } })
    assert.equal(await page.data('expanded'), 0)
    await mini.screenshot({ path: path.join(output, '04-help-local.png') })
    page = await ready(mini, '/pages/profile/profile')
    await mini.callWxMethod('pageScrollTo', { scrollTop: 1000, duration: 0 })
    await sleep(500)
    await mini.screenshot({ path: path.join(output, '05-profile-services-local.png') })
    await mini.callWxMethod('pageScrollTo', { scrollTop: 0, duration: 0 })
    console.log('PASS: native profile, three order filters, four detail views, price search, settings and help.')
    console.log(`Screenshots: ${output}`)
  } finally { mini.disconnect() }
}
main().catch(error => { console.error(error.message); process.exitCode = 1 })
