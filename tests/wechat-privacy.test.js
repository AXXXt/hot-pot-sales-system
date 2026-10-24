const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const vm = require('node:vm')

function privacy(wx) {
  const module = { exports: {} }
  vm.runInNewContext(fs.readFileSync('services/wechat-privacy.js', 'utf8'), { wx, module })
  return module.exports.ensureWechatPrivacy
}

test('platform privacy success resolves without treating the business checkbox as a platform grant', async () => {
  let calls = 0
  await privacy({ requirePrivacyAuthorize(options) { calls++; options.success() } })()
  assert.equal(calls, 1)
})

test('platform privacy refusal and synchronous API failure stop image selection with a readable error', async () => {
  for (const action of [options => options.fail({ errMsg: 'denied' }), () => { throw new Error('private native exception') }]) {
    await assert.rejects(privacy({ requirePrivacyAuthorize: action })(), error => error.code === 'WECHAT_PRIVACY_REJECTED' && !error.message.includes('private'))
  }
})

test('older runtimes continue to their native image permission flow', async () => {
  await privacy({})()
})
