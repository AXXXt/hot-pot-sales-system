const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')

const root = path.resolve(__dirname, '..')

function read(relativePath) {
  return fs.readFileSync(path.join(root, relativePath), 'utf8')
}

test('所有小程序页面和共享组件不再使用旧版渐变与酒红配色', () => {
  function files(directory) {
    return fs.readdirSync(path.join(root, directory), { withFileTypes: true }).flatMap(entry => {
      const file = `${directory}/${entry.name}`
      return entry.isDirectory() ? files(file) : [file]
    })
  }
  for (const file of [...files('pages'), ...files('components')].filter(file => file.endsWith('.wxss'))) {
    assert.doesNotMatch(read(file), /(?:linear|radial)-gradient\(|#(?:8d1c1c|660a0a|d99a9a|ead9d7)\b/i, file)
  }
})

test('小程序定义统一的中性底色和品牌强调色', () => {
  const tokens = read('styles/tokens.wxss')

  assert.match(tokens, /--brand-primary:\s*#222625/i)
  assert.match(tokens, /--brand-accent:\s*#C4461B/i)
  assert.match(tokens, /--brand-secondary:\s*#43715B/i)
  assert.match(tokens, /--bg-canvas:\s*#FFFFFF/i)
  assert.match(tokens, /--radius-md:\s*8rpx/i)
  assert.doesNotMatch(tokens, /gradient\(/i)
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
