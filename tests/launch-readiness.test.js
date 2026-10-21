const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const vm = require('node:vm')
const root = path.resolve(__dirname, '..')

test('mini release targets the HTTPS production API', () => {
  const config = require('../config')
  assert.equal(config.baseUrl, 'https://weiduoxian.cn')
  assert.equal(config.isDevelopment, false)
})

function detailPage(submitOrder) {
  let page
  vm.runInNewContext(fs.readFileSync(path.join(root, 'pages/order-detail/order-detail.js'), 'utf8'), {
    Page: definition => { page = definition },
    require: () => ({ submitOrder }),
    wx: { showToast() {} }
  })
  page.data = { ...page.data, orderId: '100', canSubmitDraft: true }
  page.setData = data => Object.assign(page.data, data)
  page.loadDetail = async () => {}
  return page
}

test('mini draft submission suppresses overlapping requests', async () => {
  let calls = 0
  let resolve
  const pending = new Promise(done => { resolve = done })
  const page = detailPage(async () => { calls++; await pending })
  const first = page.onSubmitDraft()
  await page.onSubmitDraft()
  assert.equal(calls, 1)
  resolve()
  await first
  assert.equal(page.data.submittingDraft, false)
})

test('mini draft remains retryable after a request fails', async () => {
  const page = detailPage(async () => { throw new Error('temporary failure') })
  await page.onSubmitDraft()
  assert.equal(page.data.submittingDraft, false)
  assert.equal(page.data.canSubmitDraft, true)
})

test('legal documents are bundled, reachable and explicitly marked as drafts', () => {
  const app = require('../app.json')
  const legal = require('../constants/legal.json')
  assert.deepEqual(require('../constants/legal'), legal)
  assert.ok(app.pages.includes('pages/legal/legal'))
  assert.match(legal.version, /draft/)
  assert.ok(legal.documents.terms.sections.length > 0)
  assert.ok(legal.documents.privacy.sections.length > 0)
  const login = fs.readFileSync(path.join(root, 'pages/login/login.wxml'), 'utf8')
  assert.match(login, /catchtap="openTerms"/)
  assert.match(login, /catchtap="openPrivacy"/)
})
