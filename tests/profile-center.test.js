const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const vm = require('node:vm')
const root = path.resolve(__dirname, '..')
const { profileView, money } = require('../utils/profile')

function load(file, dependencies, wx = {}) {
  let page
  const module = { exports: {} }
  vm.runInNewContext(fs.readFileSync(path.join(root, file), 'utf8'), {
    Page: value => { page = value }, module, require: id => dependencies[id], wx
  })
  if (!page) return module.exports
  page.setData = data => Object.assign(page.data, data)
  return page
}

test('profile uses the real level, masks phone and distinguishes missing credit from zero', () => {
  const view = profileView({ customer: {
    id: 1, customerName: '门店', contactPhone: '13800000000', customerType: 'chain',
    customerLevelName: '普通客户', creditLimit: '100', creditUsed: '100', creditRemaining: '0'
  } })
  assert.equal(view.levelName, '普通客户')
  assert.equal(view.phone, '138****0000')
  assert.equal(view.creditRemaining, '0.00')
  assert.equal(profileView({}).creditEnabled, false)
  assert.equal(money(null), '暂未提供')
})

function repeatFixture() {
  return load('services/repeat-order.js', {
    './api/order': {}, './api/product': {}, '../store/modules/cart': {}
  })
}
test('repeat uses current prices including zero and combines duplicate historical SKUs', () => {
  const { buildRepeatItems } = repeatFixture()
  const result = buildRepeatItems([
    { skuId: 1, quantity: 2, unitPrice: '100' }, { skuId: 1, quantity: 1 }
  ], { items: [{ skuId: 1, productId: 1, price: '0', stockNum: 10, minOrderQty: 1 }] }, [])
  assert.equal(result.items.length, 1)
  assert.equal(result.items[0].quantity, 3)
  assert.equal(result.items[0].snapshot.price, '0')
})
test('repeat respects existing cart quantity, minimum and unavailable SKUs', () => {
  const { buildRepeatItems } = repeatFixture()
  const result = buildRepeatItems([
    { skuId: 1, quantity: 8 }, { skuId: 2, quantity: 1 }, { skuId: 3, quantity: 1 }
  ], { items: [
    { skuId: 1, price: 8, stockNum: 10, minOrderQty: 1 },
    { skuId: 2, price: 8, stockNum: 1, minOrderQty: 2 }
  ] }, [{ skuId: '1', quantity: 6 }])
  assert.equal(result.items[0].quantity, 4)
  assert.equal(result.adjusted, 1)
  assert.equal(result.skipped, 2)
})
test('repeat never substitutes historical price when validation omits price', () => {
  const { buildRepeatItems } = repeatFixture()
  assert.equal(buildRepeatItems([{ skuId: 1, quantity: 1, unitPrice: '5' }], {
    items: [{ skuId: 1, stockNum: 10 }]
  }, []).items.length, 0)
})
test('repeat service leaves existing cart intact when validation fails', async () => {
  const added = []
  const original = [{ skuId: 9, productId: 9, quantity: 2 }]
  const service = load('services/repeat-order.js', {
    './api/order': { getOrderDetail: async () => ({ data: {
      status: 'completed', items: [{ skuId: 1, quantity: 1 }]
    } }) },
    './api/product': { validateCart: async () => { throw new Error('网络不可用') } },
    '../store/modules/cart': { state: { cartItems: original }, addItem: item => added.push(item) }
  })
  await assert.rejects(service.repeatOrder(1), /网络不可用/)
  assert.equal(added.length, 0)
  assert.equal(original[0].quantity, 2)
})
test('repeat service keeps other-brand items and adds only validated items', async () => {
  const added = []
  const original = [{ skuId: 9, productId: 9, brandId: 2, quantity: 2 }]
  const service = load('services/repeat-order.js', {
    './api/order': { getOrderDetail: async () => ({ data: {
      status: 'completed', items: [{ skuId: 1, quantity: 1, unitPrice: '99' }]
    } }) },
    './api/product': { validateCart: async () => ({ data: {
      items: [{ skuId: 1, productId: 1, brandId: 1, price: '8', stockNum: 5 }]
    } }) },
    '../store/modules/cart': { state: { cartItems: original }, addItem: item => added.push(item) }
  })
  await service.repeatOrder(1)
  assert.equal(added[0].snapshot.price, '8')
  assert.equal(original[0].brandId, 2)
})
test('order tab consumes a requested filter once', () => {
  const urls = []
  const navigation = load('utils/order-navigation.js', {}, { switchTab: option => urls.push(option.url) })
  navigation.openOrders('shipped')
  assert.equal(navigation.consumeStatus(), 'shipped')
  assert.equal(navigation.consumeStatus(), null)
  assert.deepEqual(urls, ['/pages/orders/orders'])
})
test('profile clears cached private data on logout and errors are not displayed as zero counts', async () => {
  const auth = { state: { token: 'token' }, setProfile() {}, setCustomer() {} }
  const page = load('pages/profile/profile.js', {
    '../../store/index': { auth }, '../../utils/profile': { profileView },
    '../../utils/order-navigation': {}, '../../services/repeat-order': {},
    '../../services/api/notification': { getNotifications: async () => ({ data: { unreadCount: 2 } }) },
    '../../services/api/auth': { getProfile: async () => ({ data: { customer: { id: 1, customerName: '门店' } } }) },
    '../../services/api/order': { getOrderOverview: async () => { throw new Error('网络不可用') } }
  })
  await page.refreshProfile()
  assert.equal(page.data.hasProfile, true)
  assert.equal(page.data.overviewError, '网络不可用')
  assert.equal(page.data.orderEntries.length, 0)
  auth.state.token = ''
  await page.refreshProfile()
  assert.equal(page.data.isLoggedIn, false)
  assert.equal(page.data.hasProfile, false)
  assert.equal(page.data.recentOrders.length, 0)
})
test('address copies recipient, phone and address; prices preserve SKU navigation and support search', async () => {
  let clipboard = ''
  let url = ''
  const page = load('pages/profile-detail/profile-detail.js', {
    '../../utils/auth-session': require('../utils/auth-session'),
    '../../store/index': { auth: { state: { token: 'token' }, setProfile() {}, setCustomer() {} } },
    '../../services/api/auth': { getProfile: async () => ({ data: {
      customer: { customerName: '门店', contactName: '联系人', contactPhone: '13800000000', address: '地址' }
    } }) },
    '../../services/api/customer': { getMyPriceRules: async () => ({ data: [
      { id: 7, product: { id: 3, name: '牛肉' }, sku: { id: 4, specText: '1kg' }, price: '8' }
    ] }) },
    '../../utils/profile': { money, profileView }
  }, { setClipboardData: data => { clipboard = data.data }, navigateTo: data => { url = data.url } })
  await page.loadData()
  page.copyAddress()
  assert.equal(clipboard, '门店\n联系人\n13800000000\n地址')
  page.data.type = 'prices'
  await page.loadData()
  page.onSearch({ detail: { value: '1kg' } })
  assert.equal(page.data.filteredPrices.length, 1)
  page.openProduct({ currentTarget: { dataset: { id: 3, sku: 4 } } })
  assert.equal(url, '/pages/product-detail/product-detail?id=3&skuId=4')
  page.onSearch({ detail: { value: '不存在' } })
  assert.equal(page.data.filteredPrices.length, 0)
})
test('order filter wins over a stale list response and pagination appends', async () => {
  const pending = []
  const page = load('pages/orders/orders.js', {
    '../../store/modules/auth': { state: { token: 'token' } },
    '../../utils/order-navigation': {}, '../../services/repeat-order': {},
    '../../services/api/order': { getOrderList: params => new Promise(resolve => pending.push({ params, resolve })) }
  })
  const first = page.loadOrders()
  page.data.activeStatus = 'shipped'
  const second = page.loadOrders()
  pending[1].resolve({ data: { items: [{ id: 2, status: 'shipped' }], total: 2 } })
  await second
  pending[0].resolve({ data: { items: [{ id: 1 }], total: 1 } })
  await first
  assert.equal(page.data.orders[0].id, 2)
  const more = page.loadMore()
  assert.equal(pending[2].params.page, 2)
  assert.equal(pending[2].params.status, 'shipped')
  pending[2].resolve({ data: { items: [{ id: 3, status: 'shipped' }], total: 2 } })
  await more
  assert.equal(page.data.orders.length, 2)
  assert.equal(page.data.hasMore, false)
})
