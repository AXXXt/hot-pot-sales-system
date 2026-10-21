// Exercise the separate local simulator against the real local API, without orders.
const assert = require('node:assert/strict')
const path = require('node:path')
const automator = require('../.codex-mini-automator/node_modules/miniprogram-automator')
const wait = ms => new Promise(resolve => setTimeout(resolve, ms))
async function main() {
  const mini = await automator.connect({ wsEndpoint: 'ws://127.0.0.1:9421' })
  try {
    const info = await mini.evaluate(() => ({
      version: wx.getAccountInfoSync().miniProgram.envVersion,
      platform: wx.getDeviceInfo().platform,
      baseUrl: require('config.js').baseUrl
    }))
    assert.equal(info.version, 'develop')
    assert.equal(info.platform, 'devtools')
    assert.equal(info.baseUrl, 'http://127.0.0.1:3000', 'Local login verification requires explicitly preparing --local-backend; never send its test SMS request to production')
    await mini.callWxMethod('reLaunch', { url: '/pages/login/login' })
    await wait(3000)
    const login = await mini.currentPage()
    assert.equal(login.path, 'pages/login/login')
    await login.setData({ step: 'login', phone: '18137222005', code: '123456', agree: true })
    await login.callMethod('onSendCode')
    for (let i = 0; i < 30 && !(await login.data('countdown')); i++) await wait(200)
    assert.ok(await login.data('countdown'), 'Local SMS request must succeed before login')
    await login.callMethod('onLoginSubmit')
    await wait(4000)
    const home = await mini.currentPage()
    assert.equal(home.path, 'pages/home/home')
    for (let i = 0; i < 30 && await home.data('loading'); i++) await wait(200)
    assert.equal(await home.data('error'), false)
    assert.ok(await mini.evaluate(() => Boolean(wx.getStorageSync('token'))))
    await mini.screenshot({ path: path.join(require('node:os').homedir(), 'Desktop', '唯多鲜-界面验证', 'mini-local-login.png') })
    console.log('Native simulator: real local SMS request, customer login and home loading passed')
  } finally { mini.disconnect() }
}
main().catch(error => { console.error(error.message); process.exitCode = 1 })
