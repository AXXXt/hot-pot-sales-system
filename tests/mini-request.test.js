const assert = require('node:assert/strict')
const test = require('node:test')
const path = require('node:path')

const workspaceRoot = path.resolve(__dirname, '..')

function loadRequest(initialStorage, requestHandler) {
  const storage = new Map(Object.entries(initialStorage))

  global.wx = {
    getStorageSync(key) { return storage.has(key) ? storage.get(key) : '' },
    setStorageSync(key, value) { storage.set(key, value) },
    removeStorageSync(key) { storage.delete(key) },
    showLoading() {},
    hideLoading() {},
    request: requestHandler
  }

  for (const modulePath of Object.keys(require.cache)) {
    if (modulePath.startsWith(workspaceRoot) && !modulePath.includes(`${path.sep}tests${path.sep}`)) {
      delete require.cache[modulePath]
    }
  }

  return { request: require('../services/request').request, storage }
}

test('失效令牌且无刷新令牌时以游客身份重试公共请求', async () => {
  const calls = []
  const { request, storage } = loadRequest({ token: 'expired-token' }, (options) => {
    calls.push(options)
    if (calls.length === 1) {
      options.success({
        statusCode: 401,
        data: { code: 401, message: '令牌无效或已过期', errorCode: 'AUTH_3005' }
      })
    } else {
      options.success({ statusCode: 200, data: { code: 0, data: { items: [{ id: 1 }] } } })
    }
    options.complete()
  })

  const response = await request({ url: '/api/v1/products', showLoading: false })

  assert.equal(calls.length, 2)
  assert.equal(calls[0].header.Authorization, 'Bearer expired-token')
  assert.equal(calls[1].header.Authorization, undefined)
  assert.equal(response.data.items.length, 1)
  assert.equal(storage.has('token'), false)
})

test('失效令牌且有刷新令牌时刷新后重试原请求', async () => {
  const calls = []
  const { request, storage } = loadRequest(
    { token: 'expired-token', refreshToken: 'valid-refresh-token' },
    (options) => {
      calls.push(options)
      if (options.url.endsWith('/auth/refresh-token')) {
        options.success({
          statusCode: 200,
          data: {
            code: 0,
            data: { accessToken: 'new-access-token', refreshToken: 'new-refresh-token' }
          }
        })
      } else if (options.header.Authorization === 'Bearer expired-token') {
        options.success({
          statusCode: 401,
          data: { code: 401, message: '令牌无效或已过期', errorCode: 'AUTH_3005' }
        })
      } else {
        options.success({ statusCode: 200, data: { code: 0, data: { items: [{ id: 2 }] } } })
      }
      options.complete()
    }
  )

  const response = await request({ url: '/api/v1/products', showLoading: false })

  assert.equal(calls.length, 3)
  assert.equal(calls[2].header.Authorization, 'Bearer new-access-token')
  assert.equal(response.data.items[0].id, 2)
  assert.equal(storage.get('token'), 'new-access-token')
  assert.equal(storage.get('refreshToken'), 'new-refresh-token')
})

for (const [errMsg, code, message] of [
  ['request:fail url not in domain list', 'SYS_DOMAIN_NOT_ALLOWED', '接口域名未配置'],
  ['request:fail ssl hand shake error', 'SYS_TLS_FAILED', 'HTTPS连接失败'],
  ['request:fail ERR_CERT_DATE_INVALID', 'SYS_TLS_FAILED', 'HTTPS连接失败'],
  ['request:fail timeout', 'SYS_NETWORK_TIMEOUT', '网络请求超时'],
  ['request:fail net::ERR_CONNECTION_RESET', 'SYS_CONNECTION_RESET', '网络连接被中断'],
  ['request:fail -101:net::ERR_CONNECTION_RESET', 'SYS_CONNECTION_RESET', '网络连接被中断'],
  ['request:fail unknown network error', 'SYS_NETWORK', '网络连接失败']
]) {
  test(`请求失败提供可读提示且不重复发送验证码：${code} ${errMsg}`, async () => {
    let calls = 0
    const { request } = loadRequest({}, options => {
      calls++
      assert.equal(options.timeout, 15000)
      options.fail({ errMsg })
      options.complete()
    })
    await assert.rejects(
      request({ url: '/api/v1/auth/send-code', method: 'POST', data: { phone: '18137222005' } }),
      error => error.code === code && error.message.startsWith(message) && error.errMsg === errMsg
    )
    assert.equal(calls, 1)
  })
}

test('服务端验证码错误提示原样保留', async () => {
  const payload = { code: 429, message: '验证码发送过于频繁，请稍后再试', errorCode: 'SMS_4290' }
  const { request } = loadRequest({}, options => {
    options.success({ statusCode: 429, data: payload })
    options.complete()
  })
  await assert.rejects(request({ url: '/api/v1/auth/send-code', method: 'POST' }), error => error === payload)
})
