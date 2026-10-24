const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const vm = require('node:vm')
const { requestOrderReminders } = require('../services/order-reminders')
const tick = () => new Promise(resolve => setImmediate(resolve))

function detailFixture({ proof = '', method = 0, credit = true, consent = true, grant = false } = {}) {
  let page, resolveGrant, resolveUpload
  const events = [], submissions = [], auth = { state: { token: 'A' } }
  const permission = new Promise(resolve => { resolveGrant = resolve })
  const upload = new Promise(resolve => { resolveUpload = resolve })
  const wx = {
    showToast() {}, showLoading() {}, hideLoading() {},
    showActionSheet: options => { events.push('method'); method === null
      ? options.fail({}) : options.success({ tapIndex: method }) },
    showModal: options => {
      if ([options.confirmText, options.cancelText].some(text => text && [...text].length > 4)) {
        return options.fail?.({ errMsg: 'showModal:fail invalid button text length' })
      }
      options.success({ confirm: options.title === '付款凭证授权' ? consent : credit })
    },
    chooseMedia: options => options.success({ tempFiles: [{ tempFilePath: '/private-proof', size: 100 }] })
  }
  vm.runInNewContext(fs.readFileSync('pages/order-detail/order-detail.js', 'utf8'), {
    Page: value => { page = value }, wx,
    require: id => id.endsWith('wechat-privacy') ? { ensureWechatPrivacy: async () => {} } : id.endsWith('logistics') ? require('../utils/logistics') : id.endsWith('auth-session') ? require('../utils/auth-session') : id.endsWith('order-reminders') ? { requestOrderReminders }
      : id.includes('store/modules/auth') ? auth : id.endsWith('api/upload') ? {
        uploadPaymentProof: () => { events.push('upload'); return upload }
      } : {
        submitFinance: async (id, data) => { events.push('finance'); submissions.push({ id, ...data }) },
        submitOrder: async id => { events.push('draft'); submissions.push({ id }) }
      }
  })
  page.data = { ...page.data, orderId: '100', canSubmitFinance: true, paymentProof: proof }
  page.setData = value => Object.assign(page.data, value)
  page._active = true
  page.selectComponent = () => ({ requestSubscription: options => {
    assert.equal(options.automatic, true)
    events.push('subscribe')
    return permission
  } })
  page.loadDetail = async () => events.push('reload')
  return { page, events, submissions, auth, wx, grant: () => resolveGrant(grant),
    uploaded: () => resolveUpload({ data: { url: 'https://example.invalid/proof.jpg' } }) }
}

test('credit and existing-proof confirmation request once in the click stack and rejection still completes', async () => {
  for (const settings of [{ method: 0 }, { method: 1, proof: 'existing-proof' }]) {
    const f = detailFixture(settings)
    const task = f.page.onSubmitFinance()
    assert.deepEqual(f.events, ['subscribe'])
    await f.page.onSubmitFinance()
    assert.deepEqual(f.events, ['subscribe'])
    f.grant()
    await task
    assert.deepEqual(f.events, ['subscribe', 'method', 'finance', 'reload'])
    assert.equal(f.submissions.length, 1)
    assert.equal(f.submissions[0].id, '100')
    assert.equal(f.submissions[0].creditRequested || f.submissions[0].paymentProof,
      settings.method === 0 ? true : 'existing-proof')
    assert.equal(f.page.data.submittingFinance, false)
  }
})

test('new and replacement proof request before upload and never apply twice to one payment', async () => {
  for (const settings of [{ method: 1 }, { method: 2, proof: 'old-proof' }]) {
    const f = detailFixture(settings), task = f.page.onSubmitFinance()
    f.grant()
    await tick()
    assert.deepEqual(f.events, ['subscribe', 'method', 'upload'])
    assert.equal(f.submissions.length, 0)
    f.uploaded()
    await task
    assert.deepEqual(f.events, ['subscribe', 'method', 'upload', 'finance', 'reload'])
    assert.equal(f.submissions[0].paymentProof, 'https://example.invalid/proof.jpg')
  }
})

test('cancelling a payment choice, credit confirmation, or proof consent does not submit and releases the lock', async () => {
  for (const settings of [{ method: null }, { method: 0, credit: false }, { method: 1, consent: false }]) {
    const f = detailFixture(settings), task = f.page.onSubmitFinance()
    f.grant()
    await task
    assert.equal(f.submissions.length, 0)
    assert.equal(f.events.includes('upload'), false)
    assert.equal(f.page.data.submittingFinance, false)
  }
})

test('account changes and leaving during permission or proof upload never submit payment for another account', async () => {
  for (const mutate of [f => { f.auth.state.token = 'B' }, f => f.page.onUnload()]) {
    const f = detailFixture(), task = f.page.onSubmitFinance()
    mutate(f); f.grant(); await task
    assert.deepEqual(f.events, ['subscribe'])
    assert.equal(f.submissions.length, 0)

    const g = detailFixture({ method: 1 }), uploading = g.page.onSubmitFinance()
    g.grant(); await tick(); mutate(g); g.uploaded(); await uploading
    assert.equal(g.submissions.length, 0)
  }
})

test('draft submission requests before the business call, ignores overlaps, and stops if identity changes', async () => {
  const f = detailFixture()
  f.page.data.canSubmitDraft = true
  f.page.data.canSubmitFinance = false
  const task = f.page.onSubmitDraft()
  assert.deepEqual(f.events, ['subscribe'])
  await f.page.onSubmitDraft()
  f.grant(); await task
  assert.deepEqual(f.events, ['subscribe', 'draft', 'reload'])
  assert.equal(f.page.data.submittingDraft, false)

  const g = detailFixture()
  g.page.data.canSubmitDraft = true
  const pending = g.page.onSubmitDraft()
  g.auth.state.token = 'B'; g.grant(); await pending
  assert.equal(g.submissions.length, 0)
})

test('optional reminder exceptions and missing components do not prevent payment', async () => {
  for (const component of [null, { requestSubscription: () => { throw Error('unsupported') } },
    { requestSubscription: () => Promise.reject(Error('network')) }]) {
    const f = detailFixture()
    f.page.selectComponent = () => component
    await f.page.onSubmitFinance()
    assert.equal(f.submissions.length, 1)
    assert.equal(f.page.data.submittingFinance, false)
  }
})

test('terminal or unavailable actions do not request irrelevant templates', async () => {
  const f = detailFixture()
  f.page.data.canSubmitFinance = false
  await f.page.onSubmitFinance()
  await f.page.onSubmitDraft()
  assert.deepEqual(f.events, [])
})
