const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const vm = require('node:vm')
const sessionHelpers = require('../utils/auth-session')

function load(file, dependencies, wx) {
  let page
  const module = { exports: {} }
  vm.runInNewContext(fs.readFileSync(file, 'utf8'), {
    Page: value => { page = value }, module, wx,
    require: id => id.endsWith('auth-session') ? sessionHelpers : dependencies[id]
  })
  if (!page) return module.exports
  page.data = { ...page.data }; page._active = true
  page.setData = value => Object.assign(page.data, value)
  return page
}

function checkoutFixture({ draft = false } = {}) {
  let dialog
  const events = [], toasts = [], navigation = []
  const groups = [{ brandId: 1, brandText: '品牌一', items: [{ skuId: 11, quantity: 1 }] }, { brandId: 2, brandText: '品牌二', items: [{ skuId: 22, quantity: 1 }] }]
  const auth = { state: { token: 'A', sessionVersion: 1, customer: { id: 7 } } }
  const wx = {
    showToast: options => toasts.push(options.title), showModal: options => { dialog = options },
    switchTab: options => navigation.push(options)
  }
  const page = load('pages/checkout/checkout.js', {
    '../../store/modules/auth': auth,
    '../../store/modules/cart': { getCheckoutGroups: () => groups, removeItemsBySkuIds: ids => events.push(['remove', ...ids]) },
    '../../services/api/order': {
      createOrder: async input => { events.push(['create', input.items[0].skuId]); if (input.items[0].skuId === 22) throw Error('品牌二库存不足'); return { data: { id: 1, orderNo: 'QA-1' } } },
      submitOrder: async id => { events.push(['submit', id]); if (draft) throw Error('暂未提交') }
    },
    '../../services/api/product': {}, '../../services/order-reminders': { requestOrderReminders: async () => {} }
  }, wx)
  Object.assign(page.data, { isEmpty: false, validating: false })
  page.refreshCart = async () => true; page.renderCart = () => {}
  return { page, wx, events, toasts, navigation, get dialog() { return dialog } }
}

test('partial checkout modal failure retains created orders and remaining cart items without replay', async () => {
  const f = checkoutFixture()
  await f.page.submit()
  assert.equal(f.page.data.submitting, false)
  assert.deepEqual(f.events, [['create', 11], ['submit', 1], ['remove', 11], ['create', 22]])
  assert.equal(typeof f.dialog.fail, 'function')
  f.dialog.fail({ errMsg: 'showModal:fail native bridge /private/fixture unavailable' })
  assert.equal(f.navigation.length, 1)
  assert.equal(f.navigation[0].url, '/pages/orders/orders')
  assert.match(f.toasts[0], /订单已创建/)
  assert.doesNotMatch(f.toasts.join(), /private|native bridge/)
  assert.equal(f.events.filter(event => event[0] === 'create').length, 2)
  assert.equal(f.events.filter(event => event[0] === 'remove').length, 1)
})

test('a created draft remains recoverable when both its result modal and navigation fail', async () => {
  const f = checkoutFixture({ draft: true })
  await f.page.submit()
  assert.match(f.dialog.content, /草稿/)
  const original = f.dialog
  assert.equal(typeof original.fail, 'function')
  original.fail({ errMsg: 'showModal:fail unavailable' })
  f.navigation[0].fail({ errMsg: 'switchTab:fail unavailable' })
  assert.equal(f.dialog, original)
  assert.match(f.toasts.at(-1), /订单.*查看/)
  assert.equal(f.page.data.submitting, false)
  assert.equal(f.events.filter(event => event[0] === 'submit').length, 1)
})

test('checkout result cancellation is not treated as failure and does not force navigation', async () => {
  for (const outcome of ['success', 'fail']) {
    const f = checkoutFixture()
    await f.page.submit()
    if (outcome === 'success') f.dialog.success({ confirm: false, cancel: true })
    else f.dialog.fail?.({ errMsg: 'showModal:fail cancel' })
    assert.equal(f.page.data.submitting, false)
    assert.equal(f.navigation.length, 0)
    assert.deepEqual(f.toasts, [])
  }
})

test('native checkout result exceptions still release the lock and recover the created order', async () => {
  const f = checkoutFixture()
  f.wx.showModal = () => { throw Error('native dialog error /private/fixture') }
  await assert.doesNotReject(f.page.submit())
  assert.equal(f.page.data.submitting, false)
  assert.equal(f.navigation.length, 1)
  assert.match(f.toasts.join(), /订单已创建/)
  assert.equal(f.events.filter(event => event[0] === 'create').length, 2)
})

test('confirming an available checkout result still opens its created orders once', async () => {
  const f = checkoutFixture()
  await f.page.submit()
  f.dialog.success({ confirm: true, cancel: false })
  assert.equal(f.navigation.length, 1)
  assert.equal(f.navigation[0].url, '/pages/orders/orders')
  assert.equal(f.events.filter(event => event[0] === 'create').length, 2)
})

test('invalid modal cancelText parameters are platform failures rather than user cancellation', async () => {
  const f = checkoutFixture()
  await f.page.submit()
  f.dialog.fail({ errMsg: 'showModal:fail invalid cancelText length' })
  assert.equal(f.navigation.length, 1)
  assert.match(f.toasts[0], /订单已创建/)
})

test('a failed order-navigation retry dialog provides a manual recovery hint without submitting again', () => {
  const f = checkoutFixture()
  f.page.switchToOrders([{ order: { id: 1, orderNo: 'QA-1' } }])
  f.navigation[0].fail({ errMsg: 'switchTab:fail unavailable' })
  assert.equal(typeof f.dialog.fail, 'function')
  f.dialog.fail({ errMsg: 'showModal:fail unavailable' })
  assert.match(f.toasts.at(-1), /订单.*查看/)
  assert.equal(f.events.length, 0)
})

function repeatFixture() {
  let dialog
  const added = [], toasts = [], navigation = [], calls = []
  const wx = {
    showToast: options => toasts.push(options.title), showModal: options => { dialog = options },
    navigateTo: options => navigation.push(options)
  }
  const service = load('services/repeat-order.js', {
    './api/order': { getOrderDetail: async () => { calls.push('read'); return { data: { status: 'completed', items: [{ skuId: 11, quantity: 8 }] } } } },
    './api/product': { validateCart: async () => { calls.push('validate'); return { data: { items: [{ skuId: 11, productId: 1, price: '9.90', stockNum: 3, minOrderQty: 1 }] } } } },
    '../store/modules/cart': { state: { cartItems: [] }, addItem: item => added.push(item) }
  }, wx)
  const page = load('pages/orders/orders.js', {
    '../../services/api/order': {}, '../../store/modules/auth': { state: { token: 'A' } },
    '../../utils/order-navigation': {}, '../../services/repeat-order': service
  }, wx)
  return { page, service, wx, added, toasts, navigation, calls, get dialog() { return dialog } }
}

test('a repeat-purchase modal failure opens the cart without adding the adjusted items twice', async () => {
  const f = repeatFixture()
  await f.page.onOrderAction({ detail: { id: 'repeat' }, currentTarget: { dataset: { id: 1 } } })
  assert.equal(f.page.data.repeatBuying, false)
  assert.equal(f.added.length, 1); assert.equal(f.added[0].quantity, 3)
  assert.equal(typeof f.dialog.fail, 'function')
  f.dialog.fail({ errMsg: 'showModal:fail native unavailable /private/fixture' })
  assert.equal(f.navigation[0].url, '/pages/cart/cart')
  assert.match(f.toasts[0], /已加入.*购物车/)
  assert.doesNotMatch(f.toasts.join(), /private|native/)
  assert.deepEqual(f.calls, ['read', 'validate'])
  assert.equal(f.added.length, 1)
})

test('repeat-purchase cancellation leaves the existing cart intact without error or forced navigation', async () => {
  for (const outcome of ['success', 'fail']) {
    const f = repeatFixture()
    await f.page.onOrderAction({ detail: { id: 'repeat' }, currentTarget: { dataset: { id: 1 } } })
    if (outcome === 'success') f.dialog.success({ confirm: false, cancel: true })
    else f.dialog.fail?.({ errMsg: 'showModal:fail cancel' })
    assert.equal(f.page.data.repeatBuying, false)
    assert.equal(f.added.length, 1)
    assert.equal(f.navigation.length, 0)
    assert.deepEqual(f.toasts, [])
  }
})

test('repeat-purchase native dialog and navigation exceptions keep items and show manual recovery', async () => {
  const f = repeatFixture()
  f.wx.showModal = () => { throw Error('dialog /private/fixture failure') }
  f.wx.navigateTo = () => { throw Error('navigation /private/fixture failure') }
  await f.page.onOrderAction({ detail: { id: 'repeat' }, currentTarget: { dataset: { id: 1 } } })
  assert.equal(f.page.data.repeatBuying, false)
  assert.equal(f.added.length, 1)
  assert.match(f.toasts.at(-1), /已加入.*购物车/)
  assert.doesNotMatch(f.toasts.join(), /private|failure/)
  assert.deepEqual(f.calls, ['read', 'validate'])
})

test('confirming an available repeat result opens the cart without a second add', async () => {
  const f = repeatFixture()
  await f.page.onOrderAction({ detail: { id: 'repeat' }, currentTarget: { dataset: { id: 1 } } })
  f.dialog.success({ confirm: true, cancel: false })
  assert.equal(f.navigation.length, 1)
  assert.equal(f.navigation[0].url, '/pages/cart/cart')
  assert.equal(f.added.length, 1)
  assert.deepEqual(f.toasts, [])
})

test('cart navigation failure after an ordinary repeat result never calls business APIs again', () => {
  const f = repeatFixture()
  f.service.showRepeatResult({ added: 1, skipped: 0, adjusted: 0 })
  assert.equal(typeof f.navigation[0].fail, 'function')
  f.navigation[0].fail({ errMsg: 'navigateTo:fail unavailable' })
  assert.match(f.toasts[0], /购物车/)
  assert.equal(f.added.length, 0)
  assert.deepEqual(f.calls, [])
})
