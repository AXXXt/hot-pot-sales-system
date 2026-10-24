const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const vm = require('node:vm')
const sessionHelpers = require('../utils/auth-session')
const profileHelpers = require('../utils/profile')

function pageFixture(file, auth, dependencies, wx = {}) {
  let page
  vm.runInNewContext(fs.readFileSync(file, 'utf8'), {
    Page: value => { page = value }, wx: { showToast() {}, ...wx },
    require: id => id.endsWith('wechat-privacy') ? { ensureWechatPrivacy: async () => {} } : id.endsWith('logistics') ? require('../utils/logistics') : id.endsWith('auth-session') ? sessionHelpers
      : id.endsWith('store/modules/auth') ? auth : dependencies[id]
  })
  page.data = { ...page.data }
  page.setData = value => Object.assign(page.data, value)
  page._active = true
  return page
}

function profileDetailFixture(auth, getProfile, getMyPriceRules) {
  const page = pageFixture('pages/profile-detail/profile-detail.js', auth, {
    '../../store/index': { auth },
    '../../services/api/auth': { getProfile },
    '../../services/api/customer': { getMyPriceRules },
    '../../utils/profile': profileHelpers
  }, { setNavigationBarTitle() {} })
  page.data.type = 'prices'
  return page
}

test('returning to profile prices reloads the current agreement instead of the old page cache', async () => {
  const auth = { state: { token: 'A', sessionVersion: 1 }, setProfile() {}, setCustomer() {} }
  let price = '17.50', calls = 0
  const page = profileDetailFixture(auth, async () => ({ data: { customer: { id: 2 } } }), async () => {
    calls++
    return { data: [{ id: 1, product: { name: '真实商品名' }, price }] }
  })
  page.onShow()
  await page.loadData()
  assert.equal(page.data.priceItems[0].price, '17.50')
  page.onHide()
  assert.equal(page.data.priceItems.length, 0)
  price = '16.80'
  await page.onShow()
  assert.equal(page.data.priceItems[0].price, '16.80')
  assert.equal(calls, 2)
})

test('an old profile response cannot replace a newly signed-in customer', async () => {
  let finish, writes = 0
  const auth = { state: { token: 'A', sessionVersion: 1 }, setProfile() { writes++ }, setCustomer() { writes++ } }
  const page = profileDetailFixture(auth, () => new Promise(resolve => { finish = resolve }), async () => ({ data: [] }))
  const task = page.loadData()
  auth.state.token = 'B'; auth.state.sessionVersion++
  finish({ data: { customer: { id: 1, customerName: '旧客户' } } })
  await task
  assert.equal(writes, 0)
  assert.equal(page.data.loading, false)
  assert.equal(page.data.companyRows.length, 0)
  assert.match(page.data.error, /登录状态已变化/)
})

test('profile details accept a normal refresh and discard a price response after leaving', async () => {
  let finish
  const auth = { state: { token: 'A', sessionVersion: 1 }, setProfile() {}, setCustomer() {} }
  const page = profileDetailFixture(auth, async () => {
    auth.state.token = 'refreshed'
    return { data: { customer: { id: 2, customerName: '当前门店' } } }
  }, () => new Promise(resolve => { finish = resolve }))
  const task = page.loadData()
  await new Promise(resolve => setImmediate(resolve))
  assert.equal(typeof finish, 'function')
  page.onHide()
  finish({ data: [{ id: 1, product: { name: '旧页面价格' }, price: '17.50' }] })
  await task
  assert.equal(page.data.priceItems.length, 0)
  assert.equal(page.data.companyRows.length, 0)
})

for (const outcome of ['refresh', 'switch', 'logout']) {
  test(`order detail settles safely when its request causes ${outcome}`, async () => {
    let resolve
    const auth = { state: { token: 'old', sessionVersion: 1 } }
    const page = pageFixture('pages/order-detail/order-detail.js', auth, {
      '../../services/api/order': { getOrderDetail: () => new Promise(done => { resolve = done }) },
      '../../services/api/upload': {}, '../../services/order-reminders': {}
    })
    page.data.orderId = '2'
    const task = page.loadDetail('2')
    auth.state.token = outcome === 'logout' ? '' : 'new'
    if (outcome !== 'refresh') auth.state.sessionVersion++
    resolve({ data: { orderNo: 'QA-2', status: 'shipped', payableAmount: '19.90' } })
    await task
    assert.equal(page.data.loading, false)
    assert.equal(page.data.orderNo, outcome === 'refresh' ? 'QA-2' : '')
    assert.equal(page.data.canConfirm, outcome === 'refresh')
    assert.equal(Boolean(page.data.error), outcome !== 'refresh')
  })
}

test('checkout continues exactly once after refresh during creation and removes submitted items', async () => {
  const auth = { state: { token: 'old', sessionVersion: 1, customer: { id: 2 } } }
  const events = [], group = { brandId: 7, items: [{ skuId: 40, quantity: 1 }] }
  const page = pageFixture('pages/checkout/checkout.js', auth, {
    '../../store/modules/cart': {
      getCheckoutGroups: () => [group],
      removeItemsBySkuIds: ids => events.push(['remove', ...ids])
    },
    '../../services/api/product': {},
    '../../services/order-reminders': { requestOrderReminders: async () => {} },
    '../../services/api/order': {
      createOrder: async () => { auth.state.token = 'refreshed'; events.push('create'); return { data: { id: 2 } } },
      submitOrder: async id => events.push(['submit', id])
    }
  })
  Object.assign(page.data, { isEmpty: false, validating: false })
  page.refreshCart = async () => true
  page.renderCart = () => {}
  page.showOrderCreated = rows => { assert.equal(rows[0].submitted, true); events.push('done') }
  await page.submit()
  assert.deepEqual(events, ['create', ['submit', 2], ['remove', 40], 'done'])
  assert.equal(page.data.submitting, false)
})

test('inbox applies a successful response after token refresh within the same login session', async () => {
  const auth = { state: { token: 'old', sessionVersion: 1 } }
  const page = pageFixture('pages/notifications/notifications.js', auth, {
    '../../utils/format': require('../utils/format'),
    '../../services/api/notification': { getNotifications: async () => {
      auth.state.token = 'refreshed'
      return { data: { items: [{ id: 1, createdAt: '2026-10-23T01:00:00Z' }], total: 1, unreadCount: 1 } }
    } }
  })
  await page.load(true)
  assert.equal(page.data.items.length, 1)
  assert.equal(page.data.loading, false)
})

test('returning from a message unlocks inbox actions and allows marking all remaining messages read', async () => {
  const auth = { state: { token: 'A', sessionVersion: 1 } }
  let page, unread = 2, allReads = 0
  const items = [{ id: 1, orderId: 2 }, { id: 2, orderId: 2 }]
  page = pageFixture('pages/notifications/notifications.js', auth, {
    '../../utils/format': require('../utils/format'),
    '../../services/api/notification': {
      getNotifications: async () => ({ data: { items, total: 2, unreadCount: unread } }),
      readNotification: async () => { unread-- },
      readAllNotifications: async () => { allReads++; unread = 0 }
    }
  }, { navigateTo: () => page.onHide() })
  Object.assign(page.data, { items, unreadCount: 2 })
  await page.onOpen({ currentTarget: { dataset: { id: 1 } } })
  page.onShow()
  await new Promise(resolve => setImmediate(resolve))
  assert.equal(page.data.marking, false)
  await page.onReadAll()
  assert.equal(allReads, 1)
  assert.equal(page.data.unreadCount, 0)
})

test('an old read response cannot navigate after the inbox is hidden and reopened', async () => {
  let finish, navigations = 0
  const auth = { state: { token: 'A', sessionVersion: 1 } }
  const page = pageFixture('pages/notifications/notifications.js', auth, {
    '../../utils/format': require('../utils/format'),
    '../../services/api/notification': {
      getNotifications: async () => ({ data: { items: [], total: 0, unreadCount: 0 } }),
      readNotification: () => new Promise(resolve => { finish = resolve })
    }
  }, { navigateTo: () => { navigations++ } })
  page.data.items = [{ id: 1, orderId: 2 }]
  const task = page.onOpen({ currentTarget: { dataset: { id: 1 } } })
  page.onHide(); page.onShow(); finish()
  await task
  assert.equal(navigations, 0)
  assert.equal(page.data.marking, false)
})

test('customer logistics labels translate delivery codes and preserve readable historical values', () => {
  const { logisticsText } = require('../utils/logistics')
  assert.equal(logisticsText('tricycle'), '三轮车（同城）')
  assert.equal(logisticsText('cold-chain'), '冷链配送')
  assert.equal(logisticsText('regular'), '普货物流')
  assert.equal(logisticsText('客户自提'), '客户自提')
  assert.equal(logisticsText(null), '')
})
