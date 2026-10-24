const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')

const root = path.resolve(__dirname, '..')
const read = relativePath => fs.readFileSync(path.join(root, relativePath), 'utf8')

test('手机号不能通过公开激活接口直接换取 Token', () => {
  const controller = read('backend/src/auth/auth.controller.ts')
  const service = read('backend/src/auth/auth.service.ts')
  const api = read('services/api/auth.js')

  assert.doesNotMatch(controller, /@Post\('activate'\)/)
  assert.doesNotMatch(service, /async activate\(/)
  assert.doesNotMatch(api, /\/auth\/activate/)
})

test('审核通过后必须进入短信验证码登录', () => {
  const login = read('pages/login/login.js')
  const template = read('pages/login/login.wxml')

  assert.match(login, /onApprovedLogin\(\)/)
  assert.doesNotMatch(login, /activate\(phone\)/)
  assert.match(template, /bindtap="onApprovedLogin"/)
  assert.match(template, /验证码登录/)
})

test('客户禁用与驳回只更新状态并保留数据', () => {
  const service = read('backend/src/customer/customer.service.ts')
  const start = service.indexOf('async update(')
  const end = service.indexOf('async levels(')
  assert.ok(start >= 0 && end > start, '应定位到客户状态管理方法')
  const statusSection = service.slice(start, end)

  assert.match(statusSection, /tx\.customer\.update/)
  assert.match(statusSection, /tx\.user\.updateMany/)
  assert.doesNotMatch(statusSection, /customer\.delete/)
  assert.doesNotMatch(statusSection, /user\.deleteMany/)
})
