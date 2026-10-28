const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const vm = require('node:vm')
const session = require('../utils/auth-session')
const cartPresentation = require('../utils/cart-presentation')

const item = (quantity = 2) => ({
  productId: 1, skuId: 11, brandId: 7, quantity, available: true,
  snapshot: { name: '已选商品', price: '5.00', priceUnit: '袋' }
})
const valid = (extra = {}) => ({ data: { items: [{
  productId: 1, skuId: 11, brandId: 7, name: '已校验商品', brandName: '测试品牌',
  price: '5.00', unit: '袋', stockNum: 3, minOrderQty: 1, available: true, ...extra
}], invalidSkuIds: [] } })

function fixture(initial = [item()], validate = async () => valid()) {
  const module = { exports: {} }, storage = new Map([['cartItems', initial]])
  vm.runInNewContext(fs.readFileSync('store/modules/cart.js', 'utf8'), {
    module, require: () => ({ getStorage: key => storage.get(key), setStorage: (key, value) => storage.set(key, value) })
  })
  const cart = module.exports, toasts = [], navigation = [], dialogs = [], calls = []
  const auth = { state: { token: 'fixture-session', sessionVersion: 1 } }
  let page, implementation = validate
  vm.runInNewContext(fs.readFileSync('pages/cart/cart.js', 'utf8'), {
    Page: value => { page = value },
    wx: {
      showToast: options => toasts.push(options.title), showModal: options => dialogs.push(options),
      navigateTo: options => navigation.push(options.url), switchTab: options => navigation.push(options.url),
      stopPullDownRefresh() {}
    },
    require: id => id.endsWith('modules/cart') ? cart : id.endsWith('modules/auth') ? auth
      : id.endsWith('auth-session') ? session
        : id.endsWith('cart-presentation') ? cartPresentation
        : { validateCart: ids => { calls.push(Array.from(ids)); return implementation(ids) } }
  })
  page.data = { ...page.data }; page._active = true
  page.setData = value => Object.assign(page.data, value)
  return { cart, page, auth, toasts, navigation, dialogs, calls,
    respondWith: callback => { implementation = callback } }
}
const event = { currentTarget: { dataset: { index: 0 } } }

test('a quantity above authoritative available stock is retained but cannot proceed to checkout', async () => {
  const f = fixture([item(5)])
  await f.page.loadCart()
  assert.equal(f.cart.state.cartItems[0].quantity, 5)
  assert.equal(f.page.data.checkoutDisabled, true)
  assert.match(f.page.data.items[0].unavailableReason, /库存|可用/)
  f.page.onCheckout()
  assert.equal(f.navigation.length, 0)
})

test('an old quantity below the new minimum remains adjustable and checkout stays blocked', async () => {
  const f = fixture([item(1)], async () => valid({ minOrderQty: 3, stockNum: 5 }))
  await f.page.loadCart()
  assert.equal(f.cart.state.cartItems[0].quantity, 1)
  assert.equal(f.page.data.checkoutDisabled, true)
  assert.match(f.page.data.items[0].unavailableReason, /起订/)
  f.page.onIncrease(event)
  assert.equal(f.cart.state.cartItems[0].quantity, 3)
  assert.equal(f.page.data.checkoutDisabled, false)
})

test('the plus action cannot exceed currently validated stock', async () => {
  const f = fixture([item(3)])
  await f.page.loadCart()
  f.page.onIncrease(event)
  assert.equal(f.cart.state.cartItems[0].quantity, 3)
  assert.match(f.toasts.join(), /库存|可用/)
})

test('the minus action cannot reduce a valid quantity below its current minimum', async () => {
  const f = fixture([item(3)], async () => valid({ minOrderQty: 3, stockNum: 5 }))
  await f.page.loadCart()
  f.page.onDecrease(event)
  assert.equal(f.cart.state.cartItems[0].quantity, 3)
  assert.match(f.toasts.join(), /起订/)
})

test('failed validation keeps items but cannot restore checkout from old available flags', async () => {
  const f = fixture([item()], async () => { throw Error('untrusted transport detail') })
  await f.page.loadCart()
  assert.equal(f.cart.state.cartItems[0].quantity, 2)
  assert.equal(f.page.data.loading, false)
  assert.equal(f.page.data.checkoutDisabled, true)
  assert.match(f.page.data.validationError, /重试|校验/)
  f.page.renderCart()
  f.page.onCheckout()
  assert.equal(f.navigation.length, 0)
  assert.equal(typeof f.page.onRetryValidation, 'function')
  f.respondWith(async () => valid())
  await f.page.onRetryValidation()
  assert.equal(f.page.data.validationError, '')
  assert.equal(f.page.data.checkoutDisabled, false)
})

test('malformed authoritative stock cannot silently enable checkout using stale data', async () => {
  const f = fixture([item()], async () => valid({ stockNum: undefined }))
  await f.page.loadCart()
  assert.equal(f.cart.state.cartItems[0].quantity, 2)
  assert.equal(f.page.data.checkoutDisabled, true)
  assert.match(f.page.data.validationError, /校验|重试/)
})

test('a response belonging to the previous account cannot overwrite current cart metadata', async () => {
  let finish
  const f = fixture([item()], () => new Promise(resolve => { finish = resolve }))
  const pending = f.page.loadCart()
  f.auth.state.token = 'new-fixture-session'; f.auth.state.sessionVersion++
  finish(valid({ name: '旧账号专属信息' }))
  await pending
  assert.equal(f.cart.state.cartItems[0].snapshot.name, '已选商品')
  assert.equal(f.page.data.checkoutDisabled, true)
})

test('normal same-session token refresh does not invalidate a valid cart check', async () => {
  let finish
  const f = fixture([item()], () => new Promise(resolve => { finish = resolve }))
  const pending = f.page.loadCart()
  f.auth.state.token = 'refreshed-fixture-session'
  finish(valid())
  await pending
  assert.equal(f.page.data.checkoutDisabled, false)
})

test('adding the same SKU again requires validation instead of reusing an old valid page state', async () => {
  const f = fixture()
  await f.page.loadCart()
  f.cart.addItem({ ...item(5), snapshot: { name: '重新加入的商品', price: '5.00' } })
  f.page.renderCart()
  f.page.onCheckout()
  assert.equal(f.page.data.checkoutDisabled, true)
  assert.equal(f.navigation.length, 0)
})

test('a stale removal dialog cannot delete items belonging to a newly signed-in account', async () => {
  const f = fixture()
  await f.page.loadCart()
  f.page.onRemove(event)
  f.auth.state.token = 'new-fixture-session'; f.auth.state.sessionVersion++
  f.cart.setCartItems([item(7)])
  f.dialogs[0].success({ confirm: true })
  assert.equal(f.cart.state.cartItems.length, 1)
  assert.equal(f.cart.state.cartItems[0].quantity, 7)
})

test('quantity violations remain visible with adjustment actions and a failed validation has a retry entry', () => {
  const markup = fs.readFileSync('pages/cart/cart.wxml', 'utf8')
  assert.match(markup, /cart-item__actions[^>]+wx:if="\{\{item\.canAdjust\}\}"/)
  assert.match(markup, /bindtap="onRetryValidation"/)
})

test('decreasing an excessive quantity restores availability only once it reaches the validated range', async () => {
  const f = fixture([item(5)])
  await f.page.loadCart()
  f.page.onDecrease(event)
  assert.equal(f.cart.state.cartItems[0].quantity, 4)
  assert.equal(f.page.data.checkoutDisabled, true)
  f.page.onDecrease(event)
  assert.equal(f.cart.state.cartItems[0].quantity, 3)
  assert.equal(f.page.data.checkoutDisabled, false)
  f.page.onCheckout()
  assert.deepEqual(f.navigation, ['/pages/checkout/checkout'])
})

test('a sold-out or inaccessible SKU stays unavailable without deleting its selected quantity', async () => {
  for (const response of [valid({ stockNum: 0, available: false }), { data: { items: [], invalidSkuIds: [11] } }]) {
    const f = fixture([item(2)], async () => response)
    await f.page.loadCart()
    assert.equal(f.cart.state.cartItems[0].quantity, 2)
    assert.equal(f.page.data.items[0].canAdjust, false)
    assert.equal(f.page.data.hasQuantityInvalid, false)
    assert.equal(f.page.data.checkoutDisabled, true)
    f.page.onIncrease(event)
    assert.equal(f.cart.state.cartItems[0].quantity, 2)
  }
})

test('invalid cached quantities do not get silently clamped and can be repaired with an intentional increment', async () => {
  for (const quantity of [0, -1, 1.5, Number.NaN, Number.POSITIVE_INFINITY]) {
    const f = fixture([item(quantity)])
    await f.page.loadCart()
    assert.equal(Object.is(f.cart.state.cartItems[0].quantity, quantity), true)
    assert.equal(f.page.data.checkoutDisabled, true)
    assert.equal(f.page.data.items[0].quantityText, '待调整')
    f.page.onIncrease(event)
    assert.equal(f.page.data.checkoutDisabled, false)
    assert.equal(Number.isSafeInteger(f.cart.state.cartItems[0].quantity), true)
  }
})

test('the validation result checks the latest quantity when the SKU itself did not change', async () => {
  let finish
  const f = fixture([item()], () => new Promise(resolve => { finish = resolve }))
  const pending = f.page.loadCart()
  f.cart.updateQuantity({ productId: 1, skuId: 11, quantity: 8 })
  finish(valid())
  await pending
  assert.equal(f.cart.state.cartItems[0].quantity, 8)
  assert.equal(f.page.data.checkoutDisabled, true)
})

test('a changed SKU set invalidates the old response instead of marking the new item unavailable', async () => {
  let finish
  const f = fixture([item()], () => new Promise(resolve => { finish = resolve }))
  const pending = f.page.loadCart()
  f.cart.addItem({ ...item(1), productId: 2, skuId: 22 })
  finish(valid())
  await pending
  assert.equal(f.cart.state.cartItems.length, 2)
  assert.equal(f.cart.state.cartItems[1].available, true)
  assert.match(f.page.data.validationError, /重试/)
  assert.equal(f.page.data.checkoutDisabled, true)
})

test('an older validation request cannot replace the later successful result', async () => {
  const resolvers = []
  const f = fixture([item()], () => new Promise(resolve => resolvers.push(resolve)))
  const first = f.page.loadCart(), second = f.page.loadCart()
  resolvers[1](valid({ stockNum: 10 }))
  await second
  resolvers[0](valid({ stockNum: 0, available: false }))
  await first
  assert.equal(f.cart.state.cartItems[0].snapshot.stockNum, 10)
  assert.equal(f.page.data.loading, false)
  assert.equal(f.page.data.checkoutDisabled, false)
})

test('leaving and reopening the cart discards the response from the previous visit', async () => {
  const resolvers = []
  const f = fixture([item()], () => new Promise(resolve => resolvers.push(resolve)))
  const previous = f.page.onShow()
  f.page.onHide()
  const current = f.page.onShow()
  resolvers[0](valid({ name: '旧页面结果' }))
  await previous
  assert.equal(f.cart.state.cartItems[0].snapshot.name, '已选商品')
  assert.equal(f.page.data.loading, true)
  resolvers[1](valid({ name: '当前页面结果' }))
  await current
  assert.equal(f.cart.state.cartItems[0].snapshot.name, '当前页面结果')
  assert.equal(f.page.data.checkoutDisabled, false)
})

test('an unauthenticated user can open login but cannot skip validation into checkout', async () => {
  const f = fixture()
  f.auth.state.token = ''
  await f.page.loadCart()
  f.page.onCheckout()
  assert.equal(f.calls.length, 0)
  assert.match(f.navigation[0], /^\/pages\/login\/login\?redirect=/)
})

test('existing checkout validation also refuses a quantity-invalid line without any checkout source change', async () => {
  const f = fixture([item(8)])
  let checkout
  vm.runInNewContext(fs.readFileSync('pages/checkout/checkout.js', 'utf8'), {
    Page: value => { checkout = value }, wx: { showToast() {} },
    require: id => id.endsWith('modules/cart') ? f.cart : id.endsWith('modules/auth') ? f.auth
      : id.endsWith('auth-session') ? session : id.endsWith('api/product') ? { validateCart: async () => valid() } : {}
  })
  checkout.data = { ...checkout.data }; checkout.setData = data => Object.assign(checkout.data, data)
  assert.equal(await checkout.refreshCart(false), false)
  assert.equal(f.cart.state.cartItems[0].quantity, 8)
  assert.equal(f.cart.getCheckoutItems().length, 0)
})

test('a malformed cached minimum cannot make the plus action erase an item after a failed check', async () => {
  const seeded = item(2)
  Object.assign(seeded.snapshot, { stockNum: 5, minOrderQty: 'invalid' })
  const f = fixture([seeded], async () => { throw Error('offline') })
  await f.page.loadCart()
  f.page.onIncrease(event)
  assert.equal(f.cart.state.cartItems.length, 1)
  assert.equal(f.cart.state.cartItems[0].quantity, 2)
  assert.equal(f.page.data.checkoutDisabled, true)
})

test('the minus action cannot silently remove a nonnumeric cached quantity without confirmation', async () => {
  const f = fixture([item(Number.NaN)])
  await f.page.loadCart()
  f.page.onDecrease(event)
  assert.equal(f.cart.state.cartItems.length, 1)
  assert.equal(Number.isNaN(f.cart.state.cartItems[0].quantity), true)
  assert.equal(f.navigation.length, 0)
})
