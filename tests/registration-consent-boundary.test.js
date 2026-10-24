const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const vm = require('node:vm')

test('mini login and registration do not request credentials or submit profiles without fresh consent', () => {
  let page
  const calls = [], toasts = []
  vm.runInNewContext(fs.readFileSync('pages/login/login.js', 'utf8'), {
    Page: value => { page = value },
    require: id => ({
      '../../services/api/auth': { loginByPhone: () => calls.push('login'), registerOrLogin: () => calls.push('register') },
      '../../services/wechat': {}, '../../store/modules/auth': { state: {} }, '../../utils/storage': {}
    })[id],
    wx: { showToast: options => toasts.push(options.title) }
  })
  page.data = { ...page.data, phone: '13911112222', code: '123456', customerName: 'Local fixture', contactName: 'Local tester', agree: false }
  page.setData = data => Object.assign(page.data, data)
  page.onLoginSubmit()
  page.onSubmit()
  assert.deepEqual(calls, [])
  assert.equal(toasts.length, 2)
  assert.ok(toasts.every(message => /同意用户协议/.test(message)))
  assert.equal(page.data.submitting, false)
})
