const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const vm = require('node:vm')
const tick = () => new Promise(resolve => setImmediate(resolve))
const deferred = () => { let resolve; const promise = new Promise(done => { resolve = done }); return { promise, resolve } }

function fixture(overrides = {}) {
  let page, state = 'pending_confirm', picker
  const auth = { state: { token: 'A', sessionVersion: 1 } }
  const events = { reads: 0, payments: 0, uploads: 0, hideLoading: 0, toasts: [], cancellations: 0, receipts: 0 }
  const upload = deferred()
  const wx = {
    showToast: options => events.toasts.push(options.title),
    showLoading() {}, hideLoading: () => { events.hideLoading++ },
    showActionSheet: options => options.success({ tapIndex: 1 }),
    showModal: options => options.success({ confirm: true }),
    chooseMedia: options => { picker = options; page.onHide?.() },
    ...overrides.wx
  }
  const orderApi = {
    getOrderDetail: async () => { events.reads++; return { data: { id: 4, orderNo: 'QA-4', status: state, payableAmount: '19.90', items: [{ productName: '当前商品', amount: '19.90' }] } } },
    submitFinance: async () => { events.payments++; state = 'pending_finance' },
    cancelOrder: async () => { events.cancellations++; state = 'cancelled' },
    completeOrder: async () => { events.receipts++; state = 'completed' }, submitOrder: async () => {},
    ...overrides.orderApi
  }
  vm.runInNewContext(fs.readFileSync('pages/order-detail/order-detail.js', 'utf8'), {
    Page: value => { page = value }, wx, setTimeout,
    require: id => id.endsWith('store/modules/auth') ? auth
      : id.endsWith('auth-session') ? require('../utils/auth-session')
      : id.endsWith('logistics') ? require('../utils/logistics')
      : id.endsWith('wechat-privacy') ? { ensureWechatPrivacy: overrides.privacy || (async () => {}) }
      : id.endsWith('api/order') ? orderApi
      : id.endsWith('api/upload') ? { uploadPaymentProof: async (_path, options) => {
        events.uploads++; const value = await upload.promise
        if (options.isActive()) return value
        throw Error('上传已取消')
      } }
      : { requestOrderReminders: async () => {} }
  })
  page.data = { ...page.data }
  page.setData = value => Object.assign(page.data, value)
  return { page, auth, events, wx, upload, picker: () => picker, setState: value => { state = value } }
}

async function enter(f) {
  await f.page.onLoad({ id: '4' })
  await f.page.onShow?.()
  await tick()
}

test('returning to a cached order detail reloads a backend cancellation with one initial request', async () => {
  const f = fixture()
  await enter(f)
  assert.equal(f.events.reads, 1)
  assert.equal(f.page.data.statusText, '待确认报价')
  f.page.onHide?.()
  f.setState('cancelled')
  await f.page.onShow?.()
  await tick()
  assert.equal(f.events.reads, 2)
  assert.equal(f.page.data.statusText, '已取消')
  assert.equal(f.page.data.canSubmitFinance, false)
})

test('a finance return exposes its reason and retry while leaving the page clears the private reason', async () => {
  const f = fixture({ orderApi: { getOrderDetail: async () => ({ data: { id: 4, status: 'pending_confirm', paymentProof: 'private-old-proof', financeRejection: { reason: '凭证金额不符' } } }) } })
  await enter(f)
  assert.equal(f.page.data.financeRejectionReason, '凭证金额不符')
  assert.equal(f.page.data.canSubmitFinance, true)
  assert.equal(f.page.data.paymentProof, 'private-old-proof')
  f.page.onUnload()
  assert.equal(f.page.data.financeRejectionReason, '')
  assert.equal(f.page.data.paymentProof, '')
})

test('order detail exposes amount adjustment history and clears it when the session leaves', async () => {
  const f = fixture({ orderApi: { getOrderDetail: async () => ({ data: {
    id: 4, status: 'pending_confirm', totalAmount: '30', payableAmount: '29.5',
    adjustAmount: '-0.5', priceAdjustments: [{ id: 7, beforeAmount: '30',
      afterAmount: '29.5', reason: '订单优惠', createdAt: '2026-10-24T00:00:00.000Z' }]
  } }) } })
  await enter(f)
  assert.equal(f.page.data.adjustAmount, '-0.50')
  assert.equal(f.page.data.priceAdjustments[0].reason, '订单优惠')
  assert.equal(f.page.data.priceAdjustments[0].beforeAmount, '30.00')
  assert.equal(f.page.data.priceAdjustments[0].afterAmount, '29.50')
  f.page.onUnload()
  assert.equal(f.page.data.priceAdjustments.length, 0)
  assert.equal(f.page.data.adjustAmount, '0.00')
})

test('a rejected WeChat privacy authorization stops before media selection, upload or payment submission', async () => {
  const f = fixture({ privacy: async () => { throw { code: 'WECHAT_PRIVACY_REJECTED', message: '请先同意微信隐私保护指引后再选择图片' } } })
  await enter(f)
  await f.page.onSubmitFinance()
  assert.equal(f.picker(), undefined)
  assert.equal(f.events.uploads, 0)
  assert.equal(f.events.payments, 0)
  assert.equal(f.page.data.submittingFinance, false)
  assert.equal(f.events.toasts[0], '请先同意微信隐私保护指引后再选择图片')
})

test('finance confirmation carries the displayed revision and a stale quote refreshes without silently submitting a new amount', async () => {
  const bodies = []; let reads = 0
  const f = fixture({ orderApi: {
    getOrderDetail: async () => ({ data: { id: 4, status: 'pending_confirm', updatedAt: ++reads === 1 ? '2026-10-24T00:00:00.000Z' : '2026-10-24T00:01:00.000Z', payableAmount: reads === 1 ? '19.90' : '21.00' } }),
    submitFinance: async (_id, body) => { bodies.push(body); throw { errorCode: 'ORD_QUOTE_CHANGED', message: '报价已更新，请核对最新金额后重新提交' } }
  } })
  await enter(f)
  await f.page.submitFinanceData({ creditRequested: true }, f.page.actionContext())
  assert.equal(bodies.length, 1)
  assert.deepEqual(JSON.parse(JSON.stringify(bodies[0])), { creditRequested: true, expectedUpdatedAt: '2026-10-24T00:00:00.000Z', expectedPayableAmount: '19.90' })
  assert.equal(f.page.data.payableAmount, '21.00')
  assert.equal(f.page.data.financeRevision, '2026-10-24T00:01:00.000Z')
  assert.equal(reads, 2)
})

test('a request from before leaving cannot replace a fresh response after returning to the same order', async () => {
  const old = deferred()
  let calls = 0
  const f = fixture({ orderApi: { getOrderDetail: async () => ++calls === 1 ? old.promise : { data: { orderNo: 'QA-current', status: 'cancelled' } } } })
  f.page.onLoad({ id: '4' }); f.page.onShow?.()
  f.page.onHide?.(); await f.page.onShow?.()
  old.resolve({ data: { orderNo: 'QA-old', status: 'pending_confirm' } })
  await tick()
  assert.equal(f.page.data.orderNo, 'QA-current')
  assert.equal(f.page.data.statusText, '已取消')
  assert.equal(f.page.data.loading, false)
})

for (const callbackFirst of [false, true]) {
  test(`native picker survives hide/show and uploads once when selection callback is ${callbackFirst ? 'before' : 'after'} onShow`, async () => {
    const f = fixture()
    await enter(f)
    const task = f.page.onSubmitFinance()
    await tick()
    assert.equal(typeof f.picker()?.success, 'function')
    const selected = () => f.picker().success({ tempFiles: [{ tempFilePath: '/qa-proof.png', size: 100 }] })
    if (callbackFirst) { selected(); await tick(); await f.page.onShow?.() }
    else { await f.page.onShow?.(); selected(); await tick() }
    assert.equal(f.events.uploads, 1)
    assert.equal(f.events.reads, 1)
    f.upload.resolve({ data: { url: 'https://example.invalid/qa-proof.png' } })
    await task
    assert.equal(f.events.payments, 1)
    assert.equal(f.events.reads, 2)
    assert.equal(f.page.data.statusText, '待审核')
    assert.equal(f.page.data.submittingFinance, false)
  })
}

test('leaving during an upload cannot submit payment even after the same page is shown again', async () => {
  const f = fixture()
  await enter(f)
  const task = f.page.onSubmitFinance()
  await tick()
  f.picker().success({ tempFiles: [{ tempFilePath: '/qa-proof.png', size: 100 }] })
  await tick(); await f.page.onShow?.()
  assert.equal(f.events.uploads, 1)
  f.page.onHide?.()
  f.setState('cancelled')
  await f.page.onShow?.()
  f.upload.resolve({ data: { url: 'https://example.invalid/qa-proof.png' } })
  await task; await tick()
  assert.equal(f.events.payments, 0)
  assert.equal(f.page.data.statusText, '已取消')
  assert.equal(f.page.data.submittingFinance, false)
  assert.equal(f.events.hideLoading, 1)
})

test('switching accounts while a native picker is open never uploads or submits the previous account', async () => {
  const f = fixture()
  await enter(f)
  const task = f.page.onSubmitFinance()
  await tick()
  f.auth.state.token = 'B'; f.auth.state.sessionVersion++
  f.setState('cancelled')
  await f.page.onShow?.()
  f.picker().success({ tempFiles: [{ tempFilePath: '/qa-proof.png', size: 100 }] })
  await task
  assert.equal(f.events.uploads, 0)
  assert.equal(f.events.payments, 0)
  assert.equal(f.page.data.statusText, '已取消')
  assert.equal(f.page.data.submittingFinance, false)
})

test('cancelling the native picker releases the payment lock and refreshes changes made while hidden', async () => {
  const f = fixture()
  await enter(f)
  const task = f.page.onSubmitFinance()
  await tick()
  f.setState('cancelled')
  await f.page.onShow()
  assert.equal(f.events.reads, 1)
  f.picker().fail({ errMsg: 'chooseMedia:fail cancel' })
  await task
  assert.equal(f.events.uploads, 0)
  assert.equal(f.events.payments, 0)
  assert.equal(f.events.reads, 2)
  assert.equal(f.page.data.statusText, '已取消')
  assert.equal(f.page.data.submittingFinance, false)
})

test('an old upload completion does not close a newly started upload or unlock its action', async () => {
  const f = fixture()
  await enter(f)
  const oldTask = f.page.onSubmitFinance()
  await tick(); f.picker().success({ tempFiles: [{ tempFilePath: '/qa-old.png', size: 100 }] })
  await tick(); await f.page.onShow()
  f.page.onHide(); await f.page.onShow()
  const newer = deferred()
  f.upload.promise = newer.promise
  const newTask = f.page.onSubmitFinance()
  await tick(); f.picker().success({ tempFiles: [{ tempFilePath: '/qa-new.png', size: 100 }] })
  await tick(); await f.page.onShow()
  assert.equal(f.events.uploads, 2)
  f.upload.resolve({ data: { url: 'https://example.invalid/old.png' } })
  await oldTask
  assert.equal(f.events.payments, 0)
  assert.equal(f.events.hideLoading, 1)
  assert.equal(f.page.data.submittingFinance, true)
  newer.resolve({ data: { url: 'https://example.invalid/new.png' } })
  await newTask
  assert.equal(f.events.payments, 1)
  assert.equal(f.events.hideLoading, 2)
  assert.equal(f.page.data.submittingFinance, false)
})

for (const method of ['onCancel', 'onConfirmReceipt']) {
  test(`${method} ignores a delayed confirmation after unloading or switching accounts`, async () => {
    for (const invalidate of [f => f.page.onUnload(), f => { f.auth.state.token = 'B'; f.auth.state.sessionVersion++ }]) {
      let modal
      const f = fixture({ wx: { showModal: options => { modal = options } } })
      await enter(f)
      const task = f.page[method]()
      invalidate(f)
      modal.success({ confirm: true })
      await task
      assert.equal(f.events.cancellations, 0)
      assert.equal(f.events.receipts, 0)
      assert.equal(f.events.toasts.length, 0)
    }
  })
}

for (const stage of ['付款菜单', '账期确认']) {
  for (const cancelled of [false, true]) {
    test(`${stage} ${cancelled ? 'cancellation is quiet' : 'native failure displays a safe message'} and releases the action`, async () => {
      const fail = options => options.fail({ errMsg: cancelled ? 'native:fail cancel' : 'native:fail /private/card.png Bearer QA-only-placeholder' })
      const wx = stage === '付款菜单'
        ? { showActionSheet: fail }
        : { showActionSheet: options => options.success({ tapIndex: 0 }), showModal: fail }
      const f = fixture({ wx })
      await enter(f)
      await f.page.onSubmitFinance()
      assert.equal(f.events.payments, 0)
      assert.equal(f.events.uploads, 0)
      assert.equal(f.page.data.submittingFinance, false)
      assert.equal(f.events.toasts.length, cancelled ? 0 : 1)
      if (!cancelled) {
        assert.match(f.events.toasts[0], /暂不可用|重试/)
        assert.doesNotMatch(f.events.toasts[0], /private|Bearer|card\.png/)
      }
    })
  }
}

test('a synchronous native choice error is sanitized and a delayed failure after unloading stays quiet', async () => {
  const f = fixture({ wx: { showActionSheet() { throw Error('native /private/card.png') } } })
  await enter(f); await f.page.onSubmitFinance()
  assert.equal(f.events.toasts.length, 1)
  assert.doesNotMatch(f.events.toasts[0], /private|card\.png/)
  let menu
  const g = fixture({ wx: { showActionSheet: options => { menu = options } } })
  await enter(g)
  const task = g.page.onSubmitFinance()
  await tick(); g.page.onUnload()
  menu.fail({ errMsg: 'native:fail permission denied' })
  await task
  assert.equal(g.events.toasts.length, 0)
})
