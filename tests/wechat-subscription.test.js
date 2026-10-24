const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const vm = require('node:vm')

function bindingFixture({ token = 'buyer-A', bind = async () => ({ data: { bound: true } }), modal } = {}) {
  const auth = { state: { token } }, calls = [], logins = []
  const context = {
    module: { exports: {} },
    require: id => id.endsWith('logistics') ? require('../utils/logistics') : id.endsWith('auth-session') ? require('../utils/auth-session') : id.includes('store/') ? auth : { bindOpenid: (code, transfer) => { calls.push(code); return bind(code, transfer) } },
    wx: { login: options => logins.push(options), ...(modal ? { showModal: modal } : {}) }
  }
  vm.runInNewContext(fs.readFileSync('services/wechat.js', 'utf8'), context)
  return { ...context.module.exports, auth, calls, logins }
}

test('first successful login binds once and merges simultaneous launch/reminder requests', async () => {
  const f = bindingFixture()
  const first = f.bindCurrentWechat(), second = f.bindCurrentWechat()
  assert.equal(first, second)
  assert.equal(f.logins.length, 1)
  await f.logins[0].success({ code: 'wechat-code' })
  assert.equal(await first, true)
  assert.equal(await f.bindCurrentWechat(), true)
  assert.deepEqual(f.calls, ['wechat-code'])
})

test('does not bind the previous Wechat login result to a newly switched account', async () => {
  const f = bindingFixture()
  const task = f.bindCurrentWechat()
  f.auth.state.token = 'buyer-B'
  await f.logins[0].success({ code: 'old-account-code' })
  assert.equal(await task, false)
  assert.equal(f.calls.length, 0)
})

test('failed binding and failed Wechat login remain retryable without breaking phone login', async () => {
  const f = bindingFixture({ bind: async () => { throw Error('offline') } })
  const first = f.bindCurrentWechat()
  await f.logins[0].success({ code: 'one' })
  assert.equal(await first, false)
  const second = f.bindCurrentWechat()
  f.logins[1].fail({ errMsg: 'login failed' })
  assert.equal(await second, false)
  const loggedOut = bindingFixture({ token: '' })
  assert.equal(await loggedOut.bindCurrentWechat(), false)
  assert.equal(loggedOut.logins.length, 0)
})

test('background binding never transfers; an explicit reminder action confirms and uses a fresh code', async () => {
  const modals = [], flags = []
  const f = bindingFixture({ modal: value => modals.push(value), bind: async (_code, transfer) => {
    flags.push(transfer)
    return { data: transfer ? { bound: true } : { bound: false, reason: 'bound_elsewhere', account: '181****2005' } }
  } })
  const task = f.bindWechatForReminders()
  await f.logins[0].success({ code: 'before-confirmation' })
  await new Promise(resolve => setImmediate(resolve))
  assert.equal(modals.length, 1)
  assert.match(modals[0].content, /原账号将不再接收/)
  assert.deepEqual(flags, [false])
  modals[0].success({ confirm: true })
  await new Promise(resolve => setImmediate(resolve))
  await f.logins[1].success({ code: 'fresh-after-confirmation' })
  assert.equal(await task, true)
  assert.deepEqual(flags, [false, true])
})

test('cancelling an account switch leaves the association unchanged and never submits a transfer', async () => {
  const modals = [], flags = []
  const f = bindingFixture({ modal: value => modals.push(value), bind: async (_code, transfer) => {
    flags.push(transfer); return { data: { bound: false, reason: 'bound_elsewhere', account: '181****2005' } }
  } })
  const task = f.bindWechatForReminders()
  await f.logins[0].success({ code: 'check-owner' })
  await new Promise(resolve => setImmediate(resolve))
  modals[0].success({ confirm: false })
  assert.equal(await task, false)
  assert.deepEqual(flags, [false])
  assert.equal(f.logins.length, 1)
})

function reminderFixture(result = 'accept', templates) {
  let definition, requests = 0, bound = 0, options
  const context = {
    Component: value => { definition = value },
    require: id => id.endsWith('logistics') ? require('../utils/logistics') : id.endsWith('auth-session') ? require('../utils/auth-session') : id.includes('store/modules/auth') ? { state: { token: 'A' } } : id.endsWith('api/auth')
      ? { getSubscribeTemplate: async () => ({ data: { templateId: 'confirmed-template', templates } }) }
      : { bindCurrentWechat: async () => { bound++; return true }, bindWechatForReminders: async () => { bound++; return true } },
    wx: { requestSubscribeMessage: value => { requests++; options = value } }
  }
  vm.runInNewContext(fs.readFileSync('components/business/shipment-reminder/shipment-reminder.js', 'utf8'), context)
  const component = { data: { ...definition.data, noticeOptions: [] }, properties: { eligible: true, status: '' }, ...definition.methods,
    triggerEvent() {} }
  component.setData = data => {
    for (const [key, value] of Object.entries(data)) {
      const match = /^noticeOptions\[(\d+)\]\.selected$/.exec(key)
      if (match) component.data.noticeOptions[Number(match[1])].selected = value
      else component.data[key] = value
    }
  }
  definition.lifetimes.attached.call(component)
  return { component, definition, requests: () => requests, bound: () => bound,
    options: () => options,
    respond: () => options.success({ 'confirmed-template': result }), fail: () => options.fail({}) }
}

test('prefetch does not open the subscription prompt; an explicit tap opens once and reports actual acceptance', async () => {
  const f = reminderFixture()
  await Promise.resolve()
  assert.equal(f.requests(), 0)
  f.component.onSubscribe()
  f.component.onSubscribe()
  assert.equal(f.requests(), 1)
  await f.respond()
  assert.equal(f.component.data.busy, false)
  assert.match(f.component.data.message, /已同意1种提醒，每种可发送一条/)
})

test('subscription rejection or transport error never claims notification is enabled', async () => {
  const f = reminderFixture('reject')
  await Promise.resolve()
  f.component.onSubscribe()
  await f.respond()
  assert.match(f.component.data.message, /未同意/)
  assert.equal(f.bound(), 1, 'only the independent initial identity bind should run')
  f.component.onSubscribe()
  f.fail()
  assert.match(f.component.data.message, /未能开启/)
  assert.equal(f.component.data.busy, false)
})

test('ineligible or detached reminder does not open prompts or update an unloaded component', async () => {
  const f = reminderFixture()
  await Promise.resolve()
  f.component.properties.eligible = false
  f.component.onSubscribe()
  assert.equal(f.requests(), 0)
  f.definition.lifetimes.detached.call(f.component)
  await f.component.requestSubscription()
  assert.equal(f.component.data.message, '')
})

test('one explicit request batches only selected distinct future templates and handles partial consent', async () => {
  const catalog = [
    { event: 'order.quoted', title: '报价完成', templateId: 'quote' },
    { event: 'order.approved', title: '审核通过', templateId: 'approved' },
    { event: 'order.shipped', title: '发货提醒', templateId: 'shipment' }
  ]
  const f = reminderFixture('accept', catalog)
  await Promise.resolve()
  f.component.onToggle({ currentTarget: { dataset: { index: 1 } } })
  const promise = f.component.requestSubscription()
  assert.deepEqual(Array.from(f.options().tmplIds), ['quote', 'shipment'])
  await f.options().success({ quote: 'accept', shipment: 'reject' })
  assert.equal(await promise, true)
  assert.match(f.component.data.message, /已同意1种提醒.*其余提醒未开启/)
  f.component.properties.status = 'pending_shipment'
  f.component.updateChoices()
  assert.deepEqual(Array.from(f.component.data.noticeOptions, item => item.event), ['order.shipped'])
  f.component.properties.status = 'shipped'
  f.component.updateChoices()
  assert.equal(f.component.data.noticeOptions.length, 0)
})

test('business requests use all future templates and apply again on a later user action', async () => {
  const f = reminderFixture('accept', [
    { event: 'order.quoted', title: '报价完成', templateId: 'quote' },
    { event: 'order.approved', title: '审核通过', templateId: 'approved' },
    { event: 'order.shipped', title: '发货提醒', templateId: 'shipment' }
  ])
  await Promise.resolve()
  f.component.properties.status = 'pending_confirm'
  f.component.updateChoices()
  f.component.data.noticeOptions.forEach(item => { item.selected = false })
  for (let action = 0; action < 2; action++) {
    const task = f.component.requestSubscription({ automatic: true })
    assert.deepEqual(Array.from(f.options().tmplIds), ['approved', 'shipment'])
    await f.options().success({ approved: 'accept', shipment: 'accept' })
    assert.equal(await task, true)
    assert.equal(f.requests(), action + 1, 'remembering consent does not create unlimited quota')
  }
})

test('leaving during the permission prompt does not trigger an identity transfer afterwards', async () => {
  const f = reminderFixture()
  await Promise.resolve()
  const task = f.component.requestSubscription({ automatic: true })
  f.definition.lifetimes.detached.call(f.component)
  await f.respond()
  assert.equal(await task, false)
  assert.equal(f.bound(), 1, 'only initial background binding ran')
})
