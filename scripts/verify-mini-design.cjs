// Simulator-only fixtures. No product, order or account data is written to the server.
const assert = require('node:assert/strict')
const fs = require('node:fs/promises')
const path = require('node:path')
const automator = require('../.codex-mini-automator/node_modules/miniprogram-automator')
// Keep screenshots outside the watched project; writing them inside triggers IDE recompilation.
const output = path.join(require('node:os').homedir(), 'Desktop', '唯多鲜-界面验证')
async function main() {
  await fs.mkdir(output, { recursive: true })
  let mini = await automator.connect({ wsEndpoint: 'ws://127.0.0.1:9420' })
  try {
    if (process.argv.includes('--remaining')) {
      await verifyRemainingPages(mini)
      console.log(JSON.stringify({ passed: true, output }))
      return
    }
    console.log('Connected; preparing page-only simulator fixtures')
    const home = await openPage(mini, '/pages/home/home')
    console.log('Home opened')
    await waitForLoad(home)
    await home.setData({
      loading: false, error: false,
      userInfo: { isLogin: true, companyName: '测试门店', creditRemaining: '12,800.00', creditDays: '30' },
      categories: [{ id: 1, name: '肉类涮品' }, { id: 2, name: '锅底调味' }, { id: 3, name: '蔬菜菌菇' }],
      products: [1, 2, 3].map(id => ({ id, name: '排版测试食材', image: '/assets/brand/editorial.jpg', spec: '500g × 20袋', price: '298', priceUnit: '箱', stockText: '库存充足', statusVariant: 'success' }))
    })
    await home.waitFor(500)
    assert.ok(await home.$('.home__cart'))
    await mini.screenshot({ path: path.join(output, 'mini-home.png') })
    console.log('Home screenshot complete')
    mini.disconnect()
    mini = await automator.connect({ wsEndpoint: 'ws://127.0.0.1:9420' })
    const detail = await openPage(mini, '/pages/product-detail/product-detail?id=1')
    console.log('Detail opened')
    await waitForLoad(detail)
    const product = { name: '精选雪花肥牛卷（排版测试）', brand_name: '测试品牌', category_name: '肉类涮品', subtitle: '薄切鲜香，适合日常涮煮。', description: '仅用于本地模拟器排版检查。' }
    const skus = [
      { id: 1, spec_text: '500g × 20袋', sale_unit: '箱', sale_price: '298', min_order_qty: 1, available_qty: 10 },
      { id: 2, spec_text: '500g × 10袋', sale_unit: '箱', sale_price: '160', min_order_qty: 2, available_qty: 5 }
    ]
    await detail.setData({ loading: false, error: '', skuLoading: false, skuError: '', product, skus, imageList: ['/assets/brand/editorial.jpg'] })
    console.log('Detail fixture loaded')
    await detail.callMethod('applySkuViewModel', product, skus)
    await detail.waitFor(500)
    await mini.screenshot({ path: path.join(output, 'mini-detail-top.png') })
    console.log('Detail top screenshot complete')
    await mini.pageScrollTo(430)
    await detail.waitFor(300)
    const choices = await detail.$$('.sku-item')
    assert.equal(choices.length, 2)
    await choices[1].tap()
    await detail.waitFor(300)
    assert.equal(await detail.data('selectedSkuId'), '2')
    assert.equal(await detail.data('quantity'), 2)
    assert.equal(await detail.data('estimatedTotal'), '¥320.00')
    await mini.screenshot({ path: path.join(output, 'mini-detail-options.png') })
    const stepper = await detail.$('#quantity-stepper')
    assert.ok(stepper)
    const increment = await stepper.$('#quantity-increment')
    assert.ok(increment)
    assert.equal(await increment.text(), '+')
    await increment.tap()
    await detail.waitFor(300)
    assert.equal(await detail.data('quantity'), 3)
    assert.equal(await detail.data('estimatedTotal'), '¥480.00')
    await mini.screenshot({ path: path.join(output, 'mini-detail-options.png') })
    const info = await mini.systemInfo()
    await verifyRemainingPages(mini)
    console.log(JSON.stringify({ passed: true, viewport: [info.windowWidth, info.windowHeight], output }))
  } finally {
    mini.disconnect()
    const cleanup = await automator.connect({ wsEndpoint: 'ws://127.0.0.1:9420' })
    try { await cleanup.callWxMethod('reLaunch', { url: '/pages/home/home' }) } finally { cleanup.disconnect() }
  }
}
async function openPage(mini, url) {
  await mini.callWxMethod('reLaunch', { url })
  // Match the SDK navigation settling delay before asking its page map.
  await new Promise(resolve => setTimeout(resolve, 3000))
  for (let attempt = 0; attempt < 30; attempt++) {
    try {
      const page = await mini.currentPage()
      if (page && page.path === url.slice(1).split('?')[0]) return page
    } catch { /* The devtools page map can lag behind native navigation. */ }
    await new Promise(resolve => setTimeout(resolve, 200))
  }
  throw new Error('Native page did not become ready')
}
async function waitForLoad(page) {
  for (let attempt = 0; attempt < 100; attempt++) {
    if (!(await page.data('loading'))) return
    await page.waitFor(300)
  }
  throw new Error('Page data did not settle before applying the local fixture')
}
async function verifyRemainingPages(mini) {
  const item = { id: 1, productId: 1, skuId: 1, name: '精选雪花肥牛卷（排版测试）', spec: '500g × 20袋', quantity: 2, price: '298', priceText: '298.00', unit: '箱', amount: '596.00', amountText: '596.00', available: true, brandText: '测试品牌' }
  const screens = [
    ['category', '/pages/category/category', { loading: false, error: false, products: [{ ...item, image: '/assets/brand/editorial.jpg', priceUnit: '箱', stockText: '库存充足' }], cartCount: 2 }],
    ['orders', '/pages/orders/orders', { loading: false, error: '', orders: [{ id: 1, orderNo: 'OD-20261003-100', timeText: '2026-10-03 09:00', statusText: '待确认报价', statusVariant: 'warning', summaryText: item.name, amountText: '¥596.00', actions: [{ id: 'detail', label: '查看详情' }] }] }],
    ['profile', '/pages/profile/profile', { isLoggedIn: true, storeName: '测试门店', levelName: '普通客户', city: '郑州市' }],
    ['cart', '/pages/cart/cart', { items: [item], totalAmount: '596.00', isEmpty: false, loading: false, validCount: 1, checkoutDisabled: false }],
    ['checkout', '/pages/checkout/checkout', { isEmpty: false, validating: false, totalAmount: '596.00', orderCount: 1, customerName: '测试门店', brandGroups: [{ brandId: 1, brandText: '测试品牌', items: [item], subtotal: '596.00' }] }],
    ['order-detail', '/pages/order-detail/order-detail', { loading: false, error: '', orderNo: 'OD-20261003-100', statusText: '待确认报价', statusVariant: 'warning', items: [item], totalAmount: '596.00', payableAmount: '596.00', customerName: '测试门店', customerContact: '测试联系人', canSubmitFinance: true }],
    ['profile-detail', '/pages/profile-detail/profile-detail?type=company', { loading: false, error: '', companyRows: [{ label: '企业名称', value: '测试门店' }, { label: '联系人', value: '测试联系人' }, { label: '审核状态', value: '已审核' }] }],
    ['login', '/pages/login/login', { step: 'login' }],
    ['register', '/pages/login/login?mode=register', { step: 'register' }]
  ]
  for (const [name, url, data] of screens) {
    // New connections discard stale native page handles between simulator routes.
    mini.disconnect()
    mini = await automator.connect({ wsEndpoint: 'ws://127.0.0.1:9420' })
    try {
    console.log(`Checking ${name}`)
    const page = await openPage(mini, url)
    await waitForLoad(page)
    await page.setData(data)
    await page.waitFor(500)
    await mini.screenshot({ path: path.join(output, `mini-${name}.png`) })
    if (name === 'category') {
      await page.setData({ error: true })
      await page.waitFor(200)
      await mini.screenshot({ path: path.join(output, 'mini-category-error.png') })
    }
    } finally { mini.disconnect() }
  }
}
main().catch(error => { console.error(error); process.exitCode = 1 })
