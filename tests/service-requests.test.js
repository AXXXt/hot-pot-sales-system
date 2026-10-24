const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const vm = require('node:vm')
const session = require('../utils/auth-session')
const tick = () => new Promise(resolve => setImmediate(resolve))

function fixture(overrides = {}) {
  let page
  const auth = { state: { token: 'account-A', sessionVersion: 1 } }, toasts = []
  const api = {
    getServiceRequests: async () => ({ data: { items: [], page: 1, total: 0 } }),
    getServiceOrderOptions: async () => ({ data: [] }),
    getServiceRequest: async id => ({ data: { id, type: 'profile_change', status: 'pending', events: [] } }),
    serviceRequestKey: () => '00000000-0000-4000-8000-000000000001', ...overrides
  }
  vm.runInNewContext(fs.readFileSync('pages/service-requests/service-requests.js', 'utf8'), {
    Page: value => { page = value },
    require: id => id.endsWith('store/modules/auth') ? auth : id.endsWith('auth-session') ? session
      : id.endsWith('utils/format') ? require('../utils/format') : api,
    wx: { showToast: value => toasts.push(value.title), navigateTo() {}, stopPullDownRefresh() {} }
  })
  page.data = JSON.parse(JSON.stringify(page.data))
  page.setData = values => {
    for (const [path, value] of Object.entries(values)) {
      const keys = path.split('.'); let target = page.data
      for (const key of keys.slice(0, -1)) target = target[key]
      target[keys[keys.length - 1]] = value
    }
  }
  page.onLoad({}); page._active = true
  return { page, auth, api, toasts, switchAccount() { auth.state.token = 'account-B'; auth.state.sessionVersion++ } }
}

test('old service-request list and details never render after the customer changes', async () => {
  let finishList, finishDetail
  const f = fixture({
    getServiceRequests: () => new Promise(resolve => { finishList = resolve }),
    getServiceRequest: () => new Promise(resolve => { finishDetail = resolve })
  })
  const list = f.page.loadList(true)
  f.switchAccount()
  finishList({ data: { items: [{ id: 1, subject: 'Private old account' }], total: 1 } })
  await list
  assert.equal(f.page.data.items.length, 0)
  const detail = f.page.loadDetail(1)
  f.switchAccount()
  finishDetail({ data: { id: 1, subject: 'Private old detail', events: [] } })
  await detail
  assert.equal(f.page.data.detail, null)
})

test('switching accounts clears a previous customer form before showing the page', async () => {
  const f = fixture()
  f.page._owner = session.captureSession(f.auth); f.page._started = true
  f.page.data.mode = 'compose'; f.page.data.form.subject = 'Private account-A request'
  f.switchAccount(); f.page.onShow(); await tick()
  assert.equal(f.page.data.mode, 'list')
  assert.equal(f.page.data.form.subject, '')
  assert.equal(f.page.data.detail, null)
})

test('submit only runs once while pending and preserves the same key for retry after a lost response', async () => {
  let calls = 0, fail
  const submitted = []
  const f = fixture({ createServiceRequest: body => {
    calls++; submitted.push(body)
    return new Promise((_, reject) => { fail = reject })
  } })
  f.page.openCreate('profile_change'); await tick()
  f.page.data.form.subject = '资料更正'; f.page.data.form.description = '仅隔离测试'
  const first = f.page.onSubmit()
  await f.page.onSubmit()
  assert.equal(calls, 1)
  fail(new Error('Network response lost')); await first
  assert.equal(f.page.data.submitting, false)
  const key = f.page.data.form.clientKey
  const retry = f.page.onSubmit()
  assert.equal(calls, 2)
  assert.equal(submitted[1].clientKey, key)
  fail(new Error('Still offline')); await retry
  assert.equal(f.page.data.form.subject, '资料更正')
})

test('a stale create response cannot open another customer private detail', async () => {
  let finish
  const f = fixture({ createServiceRequest: () => new Promise(resolve => { finish = resolve }) })
  f.page.openCreate('after_sales'); await tick()
  f.page.data.form.subject = '售后'; f.page.data.form.description = '包装异常'
  const pending = f.page.onSubmit()
  f.switchAccount(); finish({ data: { id: 91 } }); await pending
  assert.equal(f.page.data.detail, null)
  assert.equal(f.page.data.mode, 'compose')
})

test('a failed next page can be retried without skipping or duplicating the existing page', async () => {
  const pages = []
  let failNext = true
  const f = fixture({ getServiceRequests: async params => {
    pages.push(params.page)
    if (params.page === 2 && failNext) { failNext = false; throw new Error('Temporary failure') }
    return { data: { items: [{ id: params.page, type: 'delivery', status: 'pending', createdAt: '2026-10-24T00:00:00Z' }], total: 40 } }
  } })
  await f.page.loadList(true); await f.page.loadList(false)
  assert.equal(f.page.data.page, 1)
  f.page.onRetry(); await tick()
  assert.deepEqual(pages, [1, 2, 2])
  assert.equal(f.page.data.items.length, 2)
})

test('an inaccessible prefilled order is not silently attached to a request', async () => {
  const f = fixture()
  f.page.openCreate('invoice', 123)
  await tick()
  assert.equal(f.page.data.form.orderId, null)
  assert.equal(f.page.data.orderIndex, 0)
})

test('request retry keys use the expected UUID format without granting any authorization', () => {
  const source = fs.readFileSync('services/api/service-request.js', 'utf8')
  const context = { module: { exports: {} }, require: () => ({ request() {} }) }
  vm.runInNewContext(source, context)
  assert.match(context.module.exports.serviceRequestKey(), /^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/)
})
