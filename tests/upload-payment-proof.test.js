const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const vm = require('node:vm')
const sessionHelpers = require('../utils/auth-session')

const tick = () => new Promise(resolve => setImmediate(resolve))
const uploaded = { code: 0, data: { url: 'https://fixture.invalid/private-proof.jpg' } }
const expired = { code: 401, message: '令牌无效或已过期', errorCode: 'AUTH_3005' }

function fixture() {
  const storage = new Map([['token', 'expired-A'], ['refreshToken', 'refresh-A']])
  const auth = {
    state: { token: 'expired-A', refreshToken: 'refresh-A', sessionVersion: 1 },
    setToken(token, options = {}) { if (!options.refresh && token !== this.state.token) this.state.sessionVersion++; this.state.token = token; storage.set('token', token) },
    setRefreshToken(token) { this.state.refreshToken = token; storage.set('refreshToken', token) },
    clearAuth() { this.state.sessionVersion++; this.state.token = ''; this.state.refreshToken = ''; storage.clear() }
  }
  const uploads = [], requests = [], toasts = []
  const wx = {
    getStorageSync: key => storage.get(key) || '', showLoading() {}, hideLoading() {},
    showToast: options => toasts.push(options.title),
    uploadFile: options => uploads.push(options), request: options => requests.push(options)
  }
  const requestModule = { exports: {} }
  vm.runInNewContext(fs.readFileSync('services/request.js', 'utf8'), {
    wx, module: requestModule,
    require: id => id.endsWith('config') ? { baseUrl: 'https://fixture.invalid' }
      : id.endsWith('store/index') ? { auth } : sessionHelpers
  })
  const uploadModule = { exports: {} }
  vm.runInNewContext(fs.readFileSync('services/api/upload.js', 'utf8'), {
    wx, module: uploadModule,
    require: id => id.endsWith('config') ? { baseUrl: 'https://fixture.invalid' }
      : id.endsWith('store/modules/auth') ? auth : id.endsWith('auth-session') ? sessionHelpers : requestModule.exports
  })
  const success = (call, payload = uploaded, statusCode = 201) => { call.success({ statusCode, data: JSON.stringify(payload) }); call.complete?.() }
  const refresh = () => {
    assert.equal(requests.length, 1)
    assert.match(requests[0].url, /\/auth\/refresh-token$/)
    requests[0].success({ statusCode: 200, data: { code: 0, data: { accessToken: 'fresh-A', refreshToken: 'next-A' } } })
    requests[0].complete?.()
  }
  return { auth, wx, uploads, requests, toasts, success, refresh, upload: uploadModule.exports.uploadPaymentProof, request: requestModule.exports.request }
}

test('uploads the selected local file with the existing multipart contract', async () => {
  const f = fixture(), task = f.upload('/qa-image.jpg')
  assert.equal(f.uploads[0].name, 'file')
  assert.equal(f.uploads[0].filePath, '/qa-image.jpg')
  assert.equal(f.uploads[0].url, 'https://fixture.invalid/api/v1/uploads/payment-proof')
  f.success(f.uploads[0])
  assert.equal((await task).data.url, uploaded.data.url)
})

test('refreshes an expired proof upload through the shared auth recovery and retries once', async () => {
  const f = fixture(), task = f.upload('/qa-image.jpg')
  const settled = task.then(value => ({ value }), error => ({ error }))
  f.success(f.uploads[0], expired, 401)
  await tick()
  assert.equal(f.requests.length, 1)
  f.refresh(); await tick()
  assert.equal(f.uploads.length, 2)
  assert.equal(f.uploads[1].header.Authorization, 'Bearer fresh-A')
  f.success(f.uploads[1])
  assert.equal((await settled).value.data.url, uploaded.data.url)
  assert.equal(f.auth.state.sessionVersion, 1)
})

test('does not repeat refresh when the retried upload is still unauthorized', async () => {
  const f = fixture(), task = f.upload('/qa-image.jpg')
  const settled = task.then(value => ({ value }), error => ({ error }))
  f.success(f.uploads[0], expired, 401); await tick()
  assert.equal(f.requests.length, 1)
  f.refresh(); await tick()
  f.success(f.uploads[1], expired, 401)
  assert.equal((await settled).error.code, 401)
  assert.equal(f.uploads.length, 2)
  assert.equal(f.requests.length, 1)
})

test('an HTTP 401 without a JSON body still uses the single authenticated retry', async () => {
  const f = fixture(), task = f.upload('/qa-image.jpg')
  f.uploads[0].success({ statusCode: 401, data: 'Unauthorized' })
  await tick(); f.refresh(); await tick()
  f.success(f.uploads[1])
  assert.equal((await task).code, 0)
  assert.equal(f.requests.length, 1)
})

test('JSON requests and uploads share one overlapping refresh task', async () => {
  const f = fixture(), upload = f.upload('/qa-image.jpg')
  const uploadResult = upload.then(value => ({ value }), error => ({ error }))
  f.success(f.uploads[0], expired, 401)
  const read = f.request({ url: '/api/v1/orders/1', showLoading: false })
  const readCall = f.requests.find(call => call.url.endsWith('/orders/1'))
  readCall.success({ statusCode: 401, data: expired }); readCall.complete?.()
  await tick()
  assert.equal(f.requests.filter(call => call.url.endsWith('/auth/refresh-token')).length, 1)
  const refreshCall = f.requests.find(call => call.url.endsWith('/auth/refresh-token'))
  refreshCall.success({ statusCode: 200, data: { code: 0, data: { accessToken: 'fresh-A', refreshToken: 'next-A' } } }); refreshCall.complete?.()
  await tick()
  f.success(f.uploads[1])
  const retry = f.requests.filter(call => call.url.endsWith('/orders/1'))[1]
  retry.success({ statusCode: 200, data: { code: 0, data: { id: 1 } } }); retry.complete?.()
  assert.equal((await uploadResult).value.code, 0)
  assert.equal((await read).data.id, 1)
})

test('never accepts an old upload result or starts recovery after switching accounts', async () => {
  for (const statusCode of [201, 401]) {
    const f = fixture(), task = f.upload('/qa-image.jpg')
    const rejected = assert.rejects(task, error => error.code === 'AUTH_SESSION_CHANGED')
    f.auth.clearAuth(); f.auth.setToken('account-B'); f.auth.setRefreshToken('refresh-B')
    f.success(f.uploads[0], statusCode === 201 ? uploaded : expired, statusCode)
    await rejected
    assert.equal(f.requests.length, 0)
    assert.equal(f.auth.state.token, 'account-B')
  }
})

test('a stale refresh cannot overwrite a newer login or retry its private file', async () => {
  const f = fixture(), task = f.upload('/qa-image.jpg')
  const rejected = assert.rejects(task, error => error.code === 'AUTH_SESSION_CHANGED')
  f.success(f.uploads[0], expired, 401); await tick()
  assert.equal(f.requests.length, 1)
  f.auth.clearAuth(); f.auth.setToken('account-B'); f.auth.setRefreshToken('refresh-B')
  f.refresh(); await rejected
  assert.equal(f.uploads.length, 1)
  assert.equal(f.auth.state.token, 'account-B')
})

test('normal refresh within the same login does not discard a successful upload', async () => {
  const f = fixture(), task = f.upload('/qa-image.jpg')
  f.auth.setToken('fresh-A', { refresh: true })
  f.success(f.uploads[0])
  assert.equal((await task).code, 0)
})

test('leaving the originating page prevents a refreshed upload retry', async () => {
  const f = fixture(); let active = true
  const task = f.upload('/qa-image.jpg', { isActive: () => active })
  const rejected = assert.rejects(task, error => error.code === 'UPLOAD_ACTION_CANCELLED')
  f.success(f.uploads[0], expired, 401); await tick()
  assert.equal(f.requests.length, 1)
  active = false; f.refresh(); await rejected
  assert.equal(f.uploads.length, 1)
})

test('an upload with no refresh credential fails safely without anonymous re-upload', async () => {
  const f = fixture(); f.auth.state.refreshToken = ''; f.wx.getStorageSync = () => ''
  const task = f.upload('/qa-image.jpg')
  const rejected = assert.rejects(task, error => error.code === 401)
  f.success(f.uploads[0], expired, 401)
  await rejected
  assert.equal(f.uploads.length, 1)
  assert.equal(f.requests.length, 0)
})

test('upload failures show safe localized messages without local paths or credential details', async () => {
  const f = fixture(), task = f.upload('/private/account-A/image.jpg')
  const rejected = assert.rejects(task, error => {
    assert.match(error.message, /上传|网络|连接/)
    assert.doesNotMatch(JSON.stringify(error), /private\/account-A|Bearer|fixture-secret/)
    return true
  })
  f.uploads[0].fail({ errMsg: 'uploadFile:fail open /private/account-A/image.jpg Bearer fixture-secret' })
  await rejected
})

test('native synchronous upload errors do not expose paths or leave an unsafe rejection', async () => {
  const f = fixture()
  f.wx.uploadFile = () => { throw Error('native file error at /private/secret-image.jpg') }
  await assert.rejects(f.upload('/qa-image.jpg'), error => /上传/.test(error.message) && !JSON.stringify(error).includes('/private/'))
})

test('server validation remains understandable while unexpected server payloads are not displayed', async () => {
  const f = fixture(), invalid = f.upload('/qa-image.jpg')
  const invalidResult = assert.rejects(invalid, error => error.message === '仅支持 JPG、PNG、WebP 图片')
  f.success(f.uploads[0], { code: 400, message: '仅支持 JPG、PNG、WebP 图片' }, 400)
  await invalidResult
  const unsafe = f.upload('/qa-image.jpg')
  const safeResult = assert.rejects(unsafe, error => !JSON.stringify(error).includes('/private/secret'))
  f.success(f.uploads[1], { code: 500, message: 'SQL /private/secret: Bearer unsafe' }, 500)
  await safeResult
})

test('missing local paths are rejected before upload starts', async () => {
  const f = fixture()
  const task = f.upload('')
  const settled = task.then(() => false, () => true)
  if (f.uploads[0]) f.success(f.uploads[0])
  assert.equal(await settled, true)
  assert.equal(f.uploads.length, 0)
})

function pickerFixture(chooseMedia) {
  let page
  const auth = { state: { token: 'A', sessionVersion: 1 } }, toasts = []
  const wx = { chooseMedia, showToast: options => toasts.push(options.title) }
  vm.runInNewContext(fs.readFileSync('pages/order-detail/order-detail.js', 'utf8'), {
    Page: value => { page = value }, wx,
    require: id => id.endsWith('store/modules/auth') ? auth : id.endsWith('auth-session') ? sessionHelpers : {}
  })
  page.data = { ...page.data, orderId: '7' }; page._active = true
  page.setData = value => Object.assign(page.data, value)
  return { page, auth, toasts }
}

test('normal image picker cancellation is quiet', async () => {
  const f = pickerFixture(options => options.fail({ errMsg: 'chooseMedia:fail cancel' }))
  assert.equal(await f.page.choosePaymentProofFile(), null)
  assert.deepEqual(f.toasts, [])
})

test('non-cancel image permission failures give a useful safe message', async () => {
  const f = pickerFixture(options => options.fail({ errMsg: 'chooseMedia:fail privacy permission denied /private/image.jpg' }))
  assert.equal(await f.page.choosePaymentProofFile(), null)
  assert.equal(f.toasts.length, 1)
  assert.match(f.toasts[0], /授权|权限|选择图片/)
  assert.doesNotMatch(f.toasts[0], /private|image\.jpg/)
})

test('invalid picker success results ask the user to choose again', async () => {
  for (const result of [{}, { tempFiles: [] }, { tempFiles: [{ size: 10 }] }]) {
    const f = pickerFixture(options => options.success(result))
    assert.equal(await f.page.choosePaymentProofFile(), null)
    assert.equal(f.toasts.length, 1)
    assert.match(f.toasts[0], /重新选择|未获取/)
  }
})

test('synchronous picker errors remain safe and do not leave a rejected raw error', async () => {
  const f = pickerFixture(() => { throw Error('native picker /private/path failed') })
  assert.equal(await f.page.choosePaymentProofFile(), null)
  assert.equal(f.toasts.length, 1)
  assert.doesNotMatch(f.toasts[0], /private|path/)
})

test('picker errors after leaving or switching accounts do not appear on another screen', async () => {
  let pending
  const f = pickerFixture(options => { pending = options })
  const task = f.page.choosePaymentProofFile()
  f.page._active = false
  pending.fail({ errMsg: 'chooseMedia:fail permission denied' })
  assert.equal(await task, null)
  assert.deepEqual(f.toasts, [])
})
