const test = require('node:test')
const assert = require('node:assert/strict')
const vm = require('node:vm')
const fs = require('node:fs')
const path = require('node:path')
const { localMiniConfig } = require('../scripts/prepare-local-mini.cjs')
const { waitForPorts, verifyEngine } = require('../scripts/wait-local-services.cjs')

test('an empty Docker response or a hung engine cannot count as ready', () => {
  assert.throws(() => verifyEngine(() => ({ status: 0, stdout: '' })), /not responding/)
  assert.throws(() => verifyEngine(() => ({ error: { code: 'ETIMEDOUT' } })), /not responding/)
})

test('startup waits for Windows ports even after containers become healthy', async () => {
  let attempts = 0
  let clock = 0
  await waitForPorts({
    probe: async () => ++attempts < 3 ? ['MySQL 127.0.0.1:3307'] : [],
    now: () => clock, sleep: async ms => { clock += ms }, log: () => {}, timeoutMs: 10, intervalMs: 2
  })
  assert.equal(attempts, 3)
  assert.equal(clock, 4)
})

test('unreachable Docker ports fail with bounded actionable diagnostics', async () => {
  let clock = 0
  await assert.rejects(waitForPorts({
    probe: async () => ['MySQL 127.0.0.1:3307', 'Redis 127.0.0.1:6379'],
    now: () => clock, sleep: async ms => { clock += ms }, log: () => {}, timeoutMs: 5, intervalMs: 2
  }), error => error.code === 'LOCAL_PORTS_UNREACHABLE' && /No migration was run/.test(error.message))
  assert.equal(clock, 5)
})

test('startup checks host connectivity before backup and migration', () => {
  const script = fs.readFileSync(path.join(__dirname, '../scripts/local-dev.ps1'), 'utf8')
  assert.ok(script.indexOf('scripts/wait-local-services.cjs') < script.indexOf("'scripts/local-environment.cjs') migrate"))
  const migration = fs.readFileSync(path.join(__dirname, '../scripts/local-environment.cjs'), 'utf8')
  const section = migration.slice(migration.indexOf("process.argv[2] === 'migrate'"))
  assert.ok(section.indexOf('if (check.status !== 0)') < section.indexOf('backup()'))
})

test('migration preflight releases the Windows Prisma DLL before generation', () => {
  const script = fs.readFileSync(path.join(__dirname, '../scripts/local-environment.cjs'), 'utf8')
  const section = script.slice(script.indexOf("process.argv[2] === 'migrate'"))
  assert.match(section, /spawnSync\(process\.execPath, \[path\.join\(__dirname, 'wait-local-services\.cjs'\)\]/)
  assert.doesNotMatch(section, /verifyDatabase\(|PrismaClient|require\('\.\/wait-local-services\.cjs'\)/)
  assert.ok(section.indexOf('if (check.status !== 0)') < section.indexOf("['generate']"))
})

function config(version, platform, options) {
  const context = { module: { exports: {} }, wx: {
    getAccountInfoSync: () => ({ miniProgram: { envVersion: version } }),
    getDeviceInfo: () => ({ platform })
  } }
  vm.runInNewContext(localMiniConfig(options), context)
  return context.module.exports
}

test('generated projects connect to production by default, including the developer-tools simulator', () => {
  for (const version of ['develop', 'trial', 'release', 'unknown']) {
    for (const platform of ['devtools', 'ios', 'android']) {
      assert.equal(config(version, platform).baseUrl, 'https://weiduoxian.cn')
      assert.equal(config(version, platform).isDevelopment, false)
    }
  }
})

test('an explicitly selected local backend only applies to the developer-tools simulator', () => {
  const options = { localBackend: true }
  assert.equal(config('develop', 'devtools', options).baseUrl, 'http://127.0.0.1:3000')
  assert.equal(config('develop', 'devtools', options).isDevelopment, true)
  for (const version of ['trial', 'release', 'unknown']) {
    for (const platform of ['devtools', 'ios', 'android']) {
      assert.equal(config(version, platform, options).baseUrl, 'https://weiduoxian.cn')
      assert.equal(config(version, platform, options).isDevelopment, false)
    }
  }
  assert.equal(config('develop', 'ios', options).baseUrl, 'https://weiduoxian.cn')
  assert.equal(require('../config').baseUrl, 'https://weiduoxian.cn')
})

test('an unavailable WeChat environment API defaults to production', () => {
  for (const options of [undefined, { localBackend: true }]) {
    const context = { module: { exports: {} } }
    vm.runInNewContext(localMiniConfig(options), context)
    assert.equal(context.module.exports.baseUrl, 'https://weiduoxian.cn')
  }
})

test('local infrastructure keeps existing volumes and loopback-only ports', () => {
  const compose = fs.readFileSync(path.join(__dirname, '../docker-compose.dev.yml'), 'utf8')
  assert.match(compose, /^name: miniprogram/m)
  for (const port of ['3307:3306', '6379:6379', '9000:9000', '9001:9001']) {
    assert.ok(compose.includes(`127.0.0.1:${port}`))
  }
  for (const volume of ['mysql_data', 'redis_data', 'minio_data']) assert.ok(compose.includes(volume))
})

test('local generated folders never enter the production mini package', () => {
  const ignore = require('../project.config.json').packOptions.ignore
  for (const file of ['.wx-local-project/config.js', '.wx-local-runtime/services.json']) {
    assert.ok(ignore.some(rule => rule.type === 'prefix' && file.startsWith(rule.value)))
  }
})
