const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const vm = require('node:vm')
const path = require('node:path')

function fixture(response, options = {}) {
  let page
  const storage = new Map([['pendingPhone', '13911112222'], ['pendingStep', 'pending'], ['pendingStatusTicket', 'local-test-status-ticket']])
  if (options.noTicket) storage.delete('pendingStatusTicket')
  const toasts = [], calls = [], auth = { state: {} }
  vm.runInNewContext(fs.readFileSync(path.join(__dirname, '../pages/login/login.js'), 'utf8'), {
    Page: definition => { page = definition },
    require: id => ({
      '../../services/api/auth': {
        checkStatus: async (phone, ticket) => { calls.push({ kind: 'status', phone, ticket }); if (options.expired) throw { errorCode: 'AUTH_STATUS_TICKET_EXPIRED' }; if (options.statusReply) return options.statusReply(); return { data: response } },
        verifyRegistrationStatus: async input => { calls.push({ kind: 'verify', input }); return { data: { ...response, statusTicket: 'fresh-local-ticket' } } }
      },
      '../../services/wechat': {}, '../../store/modules/auth': auth,
      '../../utils/storage': {
        getStorage: (key, fallback) => storage.get(key) || fallback,
        removeStorage: key => storage.delete(key), setStorage: (key, value) => storage.set(key, value)
      },
      '../../constants/legal': require('../constants/legal.json')
    })[id],
    wx: { showToast: options => toasts.push(options.title), stopPullDownRefresh() {} }
  })
  page.setData = data => Object.assign(page.data, data)
  page.data.phone = '13911112222'
  return { page, storage, toasts, calls, auth }
}

test('pulling registration status retains the pending phone and does not claim rejection', async () => {
  const { page, storage, toasts } = fixture({ exists: true, customerStatus: 'disabled', reviewStatus: 'pending' })
  await page.checkStatusSilent(page.data.phone)
  assert.equal(page.data.step, 'pending')
  assert.equal(page.data.phone, '13911112222')
  assert.equal(storage.get('pendingStep'), 'pending')
  assert.equal(page.data.reviewRejected, false)
  assert.equal(toasts.length, 0)
})

test('rejected registrations retain the phone when returning to edit and require fresh consent/code', async () => {
  const { page } = fixture({ exists: true, customerStatus: 'disabled', reviewStatus: 'rejected' })
  await page.checkStatusSilent(page.data.phone)
  assert.equal(page.data.reviewRejected, true)
  page.data.code = '000000'
  page.data.agree = true
  page.onEditApplication()
  assert.equal(page.data.step, 'register')
  assert.equal(page.data.phone, '13911112222')
  assert.equal(page.data.code, '')
  assert.equal(page.data.agree, false)
})

test('a stopped approved account does not show the rejected-application action', async () => {
  const { page } = fixture({ exists: true, customerStatus: 'disabled', reviewStatus: 'disabled' })
  await page.checkStatusSilent(page.data.phone)
  assert.equal(page.data.reviewDisabled, true)
  assert.equal(page.data.reviewRejected, false)
  assert.equal(page.data.approved, false)
})

test('lost or expired status tickets require a fresh SMS proof rather than claiming the phone is unregistered', async () => {
  for (const options of [{ noTicket: true }, { expired: true }]) {
    const { page, storage, calls, toasts } = fixture({}, options)
    page.data.pendingCustomer = { customerName: 'stale private store' }
    page.data.agree = true
    await page.checkStatusSilent(page.data.phone)
    assert.equal(page.data.step, 'login')
    assert.equal(page.data.statusVerification, true)
    assert.equal(page.data.agree, false)
    assert.equal(page.data.pendingCustomer, null)
    assert.equal(storage.has('pendingStatusTicket'), false)
    assert.equal(storage.get('pendingPhone'), '13911112222')
    assert.ok(!toasts.some(message => /未找到注册/.test(message)))
    if (options.noTicket) assert.equal(calls.length, 0)
  }
})

test('verificationRequired is a private-state challenge and not an unregistered application result', () => {
  const { page } = fixture({})
  page.applyReviewStatus({ verificationRequired: true }, false)
  assert.equal(page.data.step, 'login')
  assert.equal(page.data.statusVerification, true)
})

test('fresh SMS status verification stores the new ticket and does not log in or register another customer', async () => {
  const { page, storage, calls } = fixture({ exists: true, customerStatus: 'disabled', reviewStatus: 'pending', customerName: 'Verified fixture store' }, { noTicket: true })
  page.data.statusVerification = true; page.data.agree = true; page.data.code = '123456'
  page.onLoginSubmit()
  await new Promise(resolve => setImmediate(resolve))
  assert.equal(calls.length, 1)
  assert.equal(calls[0].kind, 'verify')
  assert.equal(calls[0].input.consentAccepted, true)
  assert.equal(calls[0].input.consentVersion, require('../constants/legal.json').version)
  assert.equal(calls[0].input.consentChannel, 'mini')
  assert.equal(page.data.step, 'pending')
  assert.equal(storage.get('pendingStatusTicket'), 'fresh-local-ticket')
  assert.equal(page.data.code, '')
})

test('a late private application response cannot appear after a new login or another phone was entered', async () => {
  for (const change of ['login', 'phone']) {
    let finish
    const { page, auth } = fixture({}, { statusReply: () => new Promise(resolve => { finish = resolve }) })
    const task = page.checkStatusSilent(page.data.phone)
    if (change === 'login') auth.state.token = 'another-account'
    else page.data.phone = '13933334444'
    finish({ data: { exists: true, customerStatus: 'disabled', reviewStatus: 'pending', customerName: 'Old private application' } })
    await task
    assert.equal(page.data.pendingCustomer, null)
    assert.equal(page.data.step, 'login')
  }
})

test('clearing a login removes a previous applicant phone and status ticket from the shared device', () => {
  const storage = new Map([['token', 'old-account'], ['pendingPhone', '13911112222'], ['pendingStep', 'pending'], ['pendingStatusTicket', 'old-private-ticket']])
  const module = { exports: {} }
  vm.runInNewContext(fs.readFileSync('store/modules/auth.js', 'utf8'), { module, require: () => ({
    getStorage: (key, fallback) => storage.get(key) || fallback,
    setStorage: (key, value) => storage.set(key, value), removeStorage: key => storage.delete(key)
  }) })
  module.exports.clearAuth()
  for (const key of ['token', 'pendingPhone', 'pendingStep', 'pendingStatusTicket']) assert.equal(storage.has(key), false)
})
