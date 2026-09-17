const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')

const root = path.resolve(__dirname, '..')

function read(relativePath) {
  return fs.readFileSync(path.join(root, relativePath), 'utf8')
}

test('小程序定义 Pixso 食品品牌设计令牌', () => {
  const tokens = read('styles/tokens.wxss')

  assert.match(tokens, /--brand-primary:\s*#8D1C1C/i)
  assert.match(tokens, /--brand-deep:\s*#660A0A/i)
  assert.match(tokens, /--brand-accent:\s*#C43737/i)
  assert.match(tokens, /--brand-surface-pink:\s*#D99A9A/i)
  assert.match(tokens, /--brand-surface-warm:\s*#E6BF91/i)
  assert.match(tokens, /--brand-muted:\s*#9CABC2/i)
})

test('小程序保留四个中文 TabBar 路径', () => {
  const appConfig = JSON.parse(read('app.json'))
  const tabs = appConfig.tabBar.list.map((item) => ({ pagePath: item.pagePath, text: item.text }))

  assert.deepEqual(tabs, [
    { pagePath: 'pages/home/home', text: '首页' },
    { pagePath: 'pages/category/category', text: '分类' },
    { pagePath: 'pages/orders/orders', text: '订单' },
    { pagePath: 'pages/profile/profile', text: '我的' }
  ])
})

test('核心小程序模板不包含 Pixso 示例外语文案', () => {
  const files = [
    'pages/home/home.wxml',
    'pages/product-detail/product-detail.wxml',
    'pages/cart/cart.wxml',
    'pages/checkout/checkout.wxml',
    'pages/orders/orders.wxml',
    'pages/order-detail/order-detail.wxml',
    'pages/profile/profile.wxml',
    'pages/login/login.wxml'
  ]
  const content = files.map(read).join('\n')

  assert.doesNotMatch(content, /APPLY FILTER|CCOUPON|Rp\s|Pesanan|MasaKan/i)
})
