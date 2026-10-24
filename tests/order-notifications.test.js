const test = require('node:test')
const assert = require('node:assert/strict')
const vm = require('node:vm')
const fs = require('node:fs')
const { formatShanghaiMinute } = require('../utils/format')
const { requestOrderReminders } = require('../services/order-reminders')
function pageFixture(file, dependencies, wx = {}) {
  let page
  vm.runInNewContext(fs.readFileSync(file, 'utf8'), { Page: p => { page = p },
    require: id => id.endsWith('logistics') ? require('../utils/logistics') : id.endsWith('auth-session') ? require('../utils/auth-session') : dependencies[id], wx, setTimeout })
  page.data = { ...page.data }
  page.setData = value => Object.assign(page.data, value)
  return page
}

function checkoutFixture(groups = [{ brandId: 1 }]) {
  const events = [], auth = { state: { token: 'A', customer: { id: 1 } } }
  let finish
  const subscription = new Promise(resolve => { finish = resolve })
  const page = pageFixture('pages/checkout/checkout.js', {
    '../../store/modules/cart': { getCheckoutGroups: () => groups },
    '../../store/modules/auth': auth, '../../services/api/order': {}, '../../services/api/product': {},
    '../../services/order-reminders': { requestOrderReminders }
  }, { showToast() {} })
  page._active = true
  page.data.validating = false
  page.data.isEmpty = false
  page.selectComponent = () => ({ requestSubscription: () => { events.push('subscribe'); return subscription } })
  page.refreshCart = async () => { events.push('validate'); return true }
  page.createBrandOrder = async () => { events.push('create'); return { order: { id: 1 } } }
  page.renderCart = () => {}
  page.showOrderCreated = () => events.push('finish')
  return { page, auth, finish, events }
}

test('checkout requests reminders synchronously before validation, prevents double submission, and rejection still submits', async () => {
  const f = checkoutFixture()
  const task = f.page.onSubmit()
  assert.deepEqual(f.events, ['subscribe'])
  await f.page.onSubmit()
  f.finish(false)
  await task
  assert.deepEqual(f.events, ['subscribe', 'validate', 'create', 'finish'])
  assert.equal(f.page.data.submitting, false)
})
test('checkout without a mounted reminder still submits and does not wait for a template network request', async () => {
  const f = checkoutFixture()
  f.page.selectComponent = () => null
  await f.page.onSubmit()
  assert.deepEqual(f.events, ['validate', 'create', 'finish'])
})
test('checkout does not create an order after leaving or switching accounts during the permission prompt', async () => {
  for (const mutation of [f => { f.page._active = false }, f => { f.auth.state.token = 'B' }]) {
    const f = checkoutFixture(), task = f.page.onSubmit()
    mutation(f)
    f.finish(true)
    await task
    assert.deepEqual(f.events, ['subscribe'])
  }
})

test('one checkout click requests once across brand orders and does not continue a switched account', async () => {
  const groups = [{ brandId: 1 }, { brandId: 2 }], f = checkoutFixture(groups)
  const task = f.page.onSubmit()
  f.finish(true); await task
  assert.deepEqual(f.events, ['subscribe', 'validate', 'create', 'create', 'finish'])

  const g = checkoutFixture(groups)
  g.page.createBrandOrder = async () => { g.events.push('create'); g.auth.state.token = 'B'; return { order: { id: 1 } } }
  const switched = g.page.onSubmit()
  g.finish(true); await switched
  assert.deepEqual(g.events, ['subscribe', 'validate', 'create'])
})
test('notification inbox ignores a response from an account or page that has changed', async () => {
  let resolve
  const auth = { state: { token: 'A' } }
  const page = pageFixture('pages/notifications/notifications.js', {
    '../../store/modules/auth': auth,
    '../../services/api/notification': { getNotifications: () => new Promise(r => { resolve = r }) },
    '../../utils/format': { formatShanghaiMinute }
  })
  page._active = true
  const task = page.load(true)
  auth.state.token = 'B'
  resolve({ data: { items: [{ id: 1, content: 'A private order' }], total: 1, unreadCount: 1 } })
  await task
  assert.equal(page.data.items.length, 0)
})
test('notification timestamps consistently display Shanghai time', () => {
  assert.equal(formatShanghaiMinute('2026-10-22T08:03:00Z'), '2026-10-22 16:03')
})
