const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const vm = require('node:vm')
const session = require('../utils/auth-session')
const cartPresentation = require('../utils/cart-presentation')

const selected = quantity => ({ productId: 1, skuId: 11, quantity, available: true,
  snapshot: { name: '已选商品', price: '5.00', priceUnit: '袋' } })
const valid = (extra = {}) => ({ data: { items: [{
  productId: 1, skuId: 11, brandId: 7, name: '校验后商品', price: '5.00', unit: '袋',
  minOrderQty: 1, stockNum: 22, available: true, ...extra
}], invalidSkuIds: [] } })

function fixture(quantity = 2, validate = async () => valid()) {
  const module = { exports: {} }, storage = new Map([['cartItems', [selected(quantity)]]])
  vm.runInNewContext(fs.readFileSync('store/modules/cart.js', 'utf8'), {
    module, require: () => ({ getStorage: key => storage.get(key), setStorage: (key, value) => storage.set(key, value) })
  })
  const cart = module.exports, auth = { state: { token: 'fixture-session', sessionVersion: 1 } }
  const events = [], navigation = [], toasts = [], dialogs = [], writes = [], calls = []
  let definition, implementation = validate
  vm.runInNewContext(fs.readFileSync('components/business/cart-sheet/cart-sheet.js', 'utf8'), {
    Component: value => { definition = value },
    wx: {
      showToast: options => toasts.push(options.title), showModal: options => dialogs.push(options),
      navigateTo: options => navigation.push(options.url), switchTab: options => navigation.push(options.url)
    },
    require: id => id.endsWith('modules/cart') ? cart : id.endsWith('modules/auth') ? auth
      : id.endsWith('auth-session') ? session
        : id.endsWith('cart-presentation') ? cartPresentation
        : { validateCart: ids => { calls.push(Array.from(ids)); return implementation(ids) } }
  })
  const sheet = { ...definition.methods, data: { ...definition.data, visible: true },
    properties: { visible: true }, _open: true, _attached: true, _pageActive: true,
    setData(data) { writes.push(data); Object.assign(this.data, data) },
    triggerEvent(name, detail) { events.push({ name, detail }) } }
  return { sheet, definition, cart, auth, events, navigation, toasts, dialogs, writes, calls,
    respondWith(callback) { implementation = callback },
    close() { sheet.properties.visible = false; sheet.data.visible = false; definition.observers.visible.call(sheet, false) } }
}
const event = { currentTarget: { dataset: { index: 0 } } }

test('the detail-page cart sheet does not increment 22 available bags into 23', async () => {
  const f = fixture(22)
  await f.sheet.loadCart()
  f.sheet.onIncrease(event)
  assert.equal(f.cart.state.cartItems[0].quantity, 22)
  assert.match(f.toasts.join(), /库存|可用/)
  assert.equal(f.events.filter(event => event.name === 'change').length, 0)
})

test('a quantity below a raised minimum can be increased even when checkout availability is false', async () => {
  const f = fixture(1, async () => valid({ minOrderQty: 3 }))
  await f.sheet.loadCart()
  assert.equal(f.sheet.data.checkoutDisabled, true)
  f.sheet.onIncrease(event)
  assert.equal(f.cart.state.cartItems[0].quantity, 3)
  assert.equal(f.sheet.data.checkoutDisabled, false)
})

test('the sheet does not reduce a valid order below its current minimum', async () => {
  const f = fixture(3, async () => valid({ minOrderQty: 3 }))
  await f.sheet.loadCart()
  f.sheet.onDecrease(event)
  assert.equal(f.cart.state.cartItems[0].quantity, 3)
  assert.match(f.toasts.join(), /起订/)
})

test('a failed sheet check cannot enable checkout from cached availability and has a successful retry', async () => {
  const f = fixture(2, async () => { throw Error('private transport fixture') })
  await f.sheet.loadCart()
  f.sheet.renderCart()
  f.sheet.onCheckout()
  assert.equal(f.sheet.data.checkoutDisabled, true)
  assert.equal(f.navigation.length, 0)
  assert.match(f.sheet.data.validationError, /重试|校验/)
  assert.equal(typeof f.sheet.onRetryValidation, 'function')
  f.respondWith(async () => valid())
  await f.sheet.onRetryValidation()
  assert.equal(f.sheet.data.checkoutDisabled, false)
  f.sheet.onCheckout()
  assert.deepEqual(f.navigation, ['/pages/checkout/checkout'])
})

test('closing the sheet discards its old successful validation response', async () => {
  let finish
  const f = fixture(2, () => new Promise(resolve => { finish = resolve }))
  const pending = f.sheet.loadCart()
  f.close()
  finish(valid({ name: '关闭后的旧结果' }))
  await pending
  assert.equal(f.cart.state.cartItems[0].snapshot.name, '已选商品')
  assert.equal(f.sheet.data.checkoutDisabled, true)
})

test('switching accounts discards a sheet response while ordinary token refresh remains valid', async () => {
  for (const changeAccount of [true, false]) {
    let finish
    const f = fixture(2, () => new Promise(resolve => { finish = resolve }))
    const pending = f.sheet.loadCart()
    f.auth.state.token = 'next-fixture-session'
    if (changeAccount) f.auth.state.sessionVersion++
    finish(valid({ name: '新回执' }))
    await pending
    assert.equal(f.cart.state.cartItems[0].snapshot.name, changeAccount ? '已选商品' : '新回执')
    assert.equal(f.sheet.data.checkoutDisabled, changeAccount)
  }
})

test('an old remove-confirmation callback cannot remove a new account cart item', async () => {
  const f = fixture(1)
  await f.sheet.loadCart()
  f.sheet.onDecrease(event)
  f.auth.state.token = 'new-fixture-session'; f.auth.state.sessionVersion++
  f.cart.setCartItems([selected(7)])
  f.dialogs[0].success({ confirm: true })
  assert.equal(f.cart.state.cartItems.length, 1)
  assert.equal(f.cart.state.cartItems[0].quantity, 7)
})

test('the sheet markup keeps quantity-error adjustments and provides explicit validation retry', () => {
  const markup = fs.readFileSync('components/business/cart-sheet/cart-sheet.wxml', 'utf8')
  assert.match(markup, /wx:if="\{\{item\.canAdjust\}\}"/)
  assert.match(markup, /bindtap="onRetryValidation"/)
})

test('a changed session after a successful check exposes retry rather than an unexplained disabled button', async () => {
  const f = fixture()
  await f.sheet.loadCart()
  f.auth.state.token = 'new-fixture-session'; f.auth.state.sessionVersion++
  f.sheet.renderCart()
  assert.equal(f.sheet.data.needsValidation, true)
  f.sheet.onCheckout()
  assert.equal(f.navigation.length, 0)
})

test('detaching the component discards pending data and performs no later UI writes', async () => {
  let finish
  const f = fixture(2, () => new Promise(resolve => { finish = resolve }))
  const pending = f.sheet.loadCart()
  f.definition.lifetimes.detached.call(f.sheet)
  const writes = f.writes.length
  finish(valid())
  await pending
  assert.equal(f.writes.length, writes)
  assert.equal(f.cart.state.cartItems[0].snapshot.name, '已选商品')
})

test('returning to a parent page reloads the sheet while the hidden-page response remains discarded', async () => {
  const resolvers = []
  const f = fixture(2, () => new Promise(resolve => resolvers.push(resolve)))
  const previous = f.sheet.loadCart()
  f.definition.pageLifetimes.hide.call(f.sheet)
  f.definition.pageLifetimes.show.call(f.sheet)
  resolvers[0](valid({ name: '旧页面商品' }))
  await previous
  assert.equal(f.cart.state.cartItems[0].snapshot.name, '已选商品')
  resolvers[1](valid({ name: '当前页面商品' }))
  await new Promise(resolve => setImmediate(resolve))
  assert.equal(f.cart.state.cartItems[0].snapshot.name, '当前页面商品')
  assert.equal(f.sheet.data.checkoutDisabled, false)
})

test('reopening the sheet cannot be overwritten by the preceding opening request', async () => {
  const resolvers = []
  const f = fixture(2, () => new Promise(resolve => resolvers.push(resolve)))
  const old = f.sheet.loadCart()
  f.close()
  f.sheet.properties.visible = true; f.sheet.data.visible = true
  const current = f.definition.observers.visible.call(f.sheet, true)
  resolvers[1](valid({ stockNum: 30 }))
  await current
  resolvers[0](valid({ stockNum: 0, available: false }))
  await old
  assert.equal(f.cart.state.cartItems[0].snapshot.stockNum, 30)
  assert.equal(f.sheet.data.checkoutDisabled, false)
})

test('an over-stock quantity is retained and can be decreased until checkout becomes legal', async () => {
  const f = fixture(24)
  await f.sheet.loadCart()
  assert.equal(f.cart.state.cartItems[0].quantity, 24)
  assert.equal(f.sheet.data.items[0].canAdjust, true)
  f.sheet.onDecrease(event)
  assert.equal(f.sheet.data.checkoutDisabled, true)
  f.sheet.onDecrease(event)
  assert.equal(f.cart.state.cartItems[0].quantity, 22)
  assert.equal(f.sheet.data.checkoutDisabled, false)
  assert.equal(f.events.filter(event => event.name === 'change').length, 2)
})

test('sold-out rows retain quantity and explicit remove still works with no checkout navigation', async () => {
  const f = fixture(2, async () => valid({ stockNum: 0, available: false }))
  await f.sheet.loadCart()
  assert.equal(f.cart.state.cartItems[0].quantity, 2)
  assert.equal(f.sheet.data.items[0].canAdjust, false)
  f.sheet.onCheckout()
  assert.equal(f.navigation.length, 0)
  f.sheet.onRemove(event)
  assert.equal(f.cart.state.cartItems.length, 0)
  assert.equal(f.sheet.data.isEmpty, true)
})
