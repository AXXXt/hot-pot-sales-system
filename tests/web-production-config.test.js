const test = require('node:test')
const assert = require('node:assert/strict')
const path = require('node:path')
const { pathToFileURL } = require('node:url')

test('both production web builds reject local API addresses and accept same-origin APIs', async () => {
  const vite = await import(pathToFileURL(path.resolve(__dirname, '../web-customer/node_modules/vite/dist/node/index.js')).href)
  const previous = process.env.VITE_API_BASE_URL
  try {
    for (const site of ['web-customer', 'admin-web']) {
      const config = path.resolve(__dirname, '..', site, 'vite.config.ts')
      process.env.VITE_API_BASE_URL = 'http://127.0.0.1:3000/api/v1'
      await assert.rejects(vite.loadConfigFromFile({ command: 'build', mode: 'production' }, config, undefined, 'silent'), /禁止打包本地开发地址/)
      process.env.VITE_API_BASE_URL = '/api/v1'
      assert.ok(await vite.loadConfigFromFile({ command: 'build', mode: 'production' }, config, undefined, 'silent'))
    }
  } finally {
    if (previous === undefined) delete process.env.VITE_API_BASE_URL
    else process.env.VITE_API_BASE_URL = previous
  }
})
