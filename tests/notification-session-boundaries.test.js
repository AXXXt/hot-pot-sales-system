const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const vm = require('node:vm')
const session = require('../utils/auth-session')
const { requestOrderReminders } = require('../services/order-reminders')
const tick = () => new Promise(resolve => setImmediate(resolve))

function reminderFixture() {
  let definition, binds = 0
  const auth = { state: { token: 'account-A', sessionVersion: 1 } }, prompts = []
  vm.runInNewContext(fs.readFileSync('components/business/shipment-reminder/shipment-reminder.js', 'utf8'), {
    Component: value => { definition = value },
    require: id => id.endsWith('auth-session') ? session : id.includes('store/modules/auth') ? auth
      : id.endsWith('api/auth') ? { getSubscribeTemplate: async () => ({ data: { templates: [
        { event: 'order.quoted', title: '报价', templateId: 'quote-fixture' },
        { event: 'order.shipped', title: '发货', templateId: 'shipment-fixture' }
      ] } }) } : { bindCurrentWechat: async () => true,
        bindWechatForReminders: async () => { binds++; return true } },
    wx: { requestSubscribeMessage: options => prompts.push(options) }
  })
  const component = { data: { ...definition.data, noticeOptions: [] }, properties: { eligible: true, status: 'draft' },
    ...definition.methods, triggerEvent() {}, setData(value) { Object.assign(this.data, value) } }
  definition.lifetimes.attached.call(component)
  return { component, definition, auth, prompts, binds: () => binds,
    switchAccount() { auth.state.token = 'account-B'; auth.state.sessionVersion++ } }
}

test('malformed native success cannot leave the optional reminder promise pending or block the business', async () => {
  const f = reminderFixture(); await tick()
  const pending = requestOrderReminders({ selectComponent: () => f.component })
  await assert.doesNotReject(async () => f.prompts[0].success(null))
  assert.equal(await pending, false)
  assert.equal(f.component.data.busy, false)
  assert.equal(f.binds(), 0)
})

test('a new account gets its own reminder request and an old result cannot overwrite its busy state', async () => {
  const f = reminderFixture(); await tick()
  const old = f.component.requestSubscription({ automatic: true })
  f.switchAccount()
  const current = f.component.requestSubscription({ automatic: true })
  assert.equal(f.prompts.length, 2)
  assert.notEqual(old, current)
  await f.prompts[0].success({ 'quote-fixture': 'accept', 'shipment-fixture': 'accept' })
  assert.equal(await old, false)
  assert.equal(f.component.data.busy, true)
  assert.equal(f.component.data.message, '')
  assert.equal(f.binds(), 0)
  await f.prompts[1].success({ 'quote-fixture': 'accept', 'shipment-fixture': 'accept' })
  assert.equal(await current, true)
  assert.equal(f.binds(), 1)
})

test('a stale native failure releases its own lock without showing account-A status to account-B', async () => {
  const f = reminderFixture(); await tick()
  const old = f.component.requestSubscription({ automatic: true })
  f.switchAccount(); f.prompts[0].fail({ errMsg: 'private fixture failure' })
  assert.equal(await old, false)
  assert.equal(f.component.data.busy, false)
  assert.equal(f.component.data.message, '')
})

test('normal token refresh shares the pending request within the same login session', async () => {
  const f = reminderFixture(); await tick()
  const first = f.component.requestSubscription({ automatic: true })
  f.auth.state.token = 'rotated-token'
  assert.equal(f.component.requestSubscription({ automatic: true }), first)
  assert.equal(f.prompts.length, 1)
  await f.prompts[0].success({ 'quote-fixture': 'accept' })
  assert.equal(await first, true)
})

for (const preference of ['accept', 'reject', 'ban', 'filter']) {
  test(`a remembered ${preference} result still requests once for each later business click`, async () => {
    const f = reminderFixture(); await tick()
    for (let click = 0; click < 2; click++) {
      const pending = requestOrderReminders({ selectComponent: () => f.component })
      assert.equal(f.prompts.length, click + 1)
      await f.prompts[click].success({ 'quote-fixture': preference, 'shipment-fixture': preference })
      assert.equal(await pending, preference === 'accept')
    }
    assert.equal(f.binds(), preference === 'accept' ? 2 : 0)
  })
}

function inboxFixture(api = {}) {
  let page
  const toasts = [], navigations = [], auth = { state: { token: 'account-A', sessionVersion: 1 } }
  vm.runInNewContext(fs.readFileSync('pages/notifications/notifications.js', 'utf8'), {
    Page: value => { page = value },
    require: id => id.endsWith('auth-session') ? session : id.endsWith('store/modules/auth') ? auth
      : id.endsWith('utils/format') ? require('../utils/format') : api,
    wx: { showToast: value => toasts.push(value.title), navigateTo: value => navigations.push(value.url) }
  })
  page.data = { ...page.data, items: [{ id: 3, orderId: 10, content: 'account-A private content' }], unreadCount: 1 }
  page._active = true
  page.setData = value => Object.assign(page.data, value)
  return { page, auth, toasts, navigations,
    switchAccount() { auth.state.token = 'account-B'; auth.state.sessionVersion++ } }
}

test('hiding the inbox clears private messages, counters and outstanding loading flags', () => {
  const { page } = inboxFixture()
  Object.assign(page.data, { error: 'private fixture error', loading: true, marking: true, total: 1, page: 1 })
  page.onHide()
  assert.equal(page.data.items.length, 0)
  assert.equal(page.data.unreadCount, 0)
  assert.equal(page.data.error, '')
  assert.equal(page.data.loading, false)
  assert.equal(page.data.marking, false)
})

test('an old inbox failure cannot display a previous-account error after switching accounts', async () => {
  let fail
  const f = inboxFixture({ getNotifications: () => new Promise((_, reject) => { fail = reject }) })
  const pending = f.page.load(true)
  f.switchAccount(); fail(new Error('account-A private failure'))
  await pending
  assert.equal(f.page.data.error, '')
  assert.equal(f.page.data.items.length, 0)
})

for (const action of ['onOpen', 'onReadAll']) {
  test(`a stale ${action} failure does not toast or navigate under a different account`, async () => {
    let fail
    const rejection = () => new Promise((_, reject) => { fail = reject })
    const f = inboxFixture({ readNotification: rejection, readAllNotifications: rejection })
    const pending = f.page[action]({ currentTarget: { dataset: { id: 3 } } })
    f.switchAccount(); fail(new Error('account-A private read failure'))
    await pending
    assert.equal(f.toasts.length, 0)
    assert.equal(f.navigations.length, 0)
  })
}
