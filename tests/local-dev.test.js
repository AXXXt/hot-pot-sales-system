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

function minioBuildFixture(reply, env = {}) {
  const calls = [], output = []
  const context = { module: { exports: {} }, __dirname: path.join(__dirname, '../scripts'), URL, process: { env },
    console: { log: value => output.push(value) },
    require: name => {
      if (name === 'node:child_process') return { spawnSync: (command, args) => { calls.push({ command, args }); return reply(args) } }
      if (name === 'node:fs') return new Proxy({}, { get: () => () => { throw new Error('Unexpected filesystem mutation') } })
      return require(name)
    } }
  vm.runInNewContext(fs.readFileSync(path.join(__dirname, '../scripts/build-local-minio.cjs'), 'utf8'), context)
  return { helper: context.module.exports, calls, output }
}

test('MinIO source fallback defaults to a dry plan without contacting Docker or the filesystem', () => {
  const f = minioBuildFixture(() => { throw new Error('Unexpected Docker call') })
  f.helper.main([])
  const plan = JSON.parse(f.output[0])
  assert.equal(plan.mode, 'plan-only')
  assert.equal(plan.dockerContacted, false)
  assert.equal(plan.productionImageBytesEquivalent, false)
  assert.equal(plan.sourceRevision, '827004cd6d3da8f49a5320c94ae74ae128156ed6')
  assert.equal(f.calls.length, 0)
})

test('MinIO source fallback refuses an existing target before creating logs, context or an image', () => {
  const f = minioBuildFixture(args => ({ status: 0, stdout: args[0] === 'context' ? JSON.stringify('unix:///var/run/docker.sock') : args[0] === 'info' ? 'linux' : 'sha256:existing-image' }))
  assert.throws(() => f.helper.main(['--build', '--tag', f.helper.originalTag]), /refuses to overwrite/)
  assert.equal(f.calls.length, 3)
  assert.ok(f.calls.every(call => call.command === 'docker' && !['build', 'tag', 'run', 'compose'].includes(call.args[0])))
})

test('MinIO source fallback rejects remote Docker overrides before any command is sent', () => {
  for (const endpoint of ['ssh://remote.example', 'tcp://192.0.2.10:2375']) {
    const f = minioBuildFixture(() => { throw new Error('Unexpected Docker call') }, { DOCKER_HOST: endpoint })
    assert.throws(() => f.helper.main(['--build']), /Only a local Docker/)
    assert.equal(f.calls.length, 0)
  }
  const helper = require('../scripts/build-local-minio.cjs')
  for (const endpoint of ['unix:///var/run/docker.sock', 'npipe:////./pipe/dockerDesktopLinuxEngine', 'tcp://127.0.0.1:2375', 'tcp://[::1]:2375']) assert.equal(helper.localEndpoint(endpoint), true)
  for (const endpoint of ['ssh://localhost', 'tcp://example.com:2375', 'npipe:////remote/pipe/docker']) assert.equal(helper.localEndpoint(endpoint), false)
})

test('MinIO source fallback rejects ambiguous plan/build requests and unapproved image tags', () => {
  const helper = require('../scripts/build-local-minio.cjs')
  assert.throws(() => helper.options(['--plan', '--build']), /cannot be combined/)
  assert.throws(() => helper.options(['--build', '--tag', 'minio/minio:latest']), /pinned/)
  assert.equal(helper.options(['--build', '--tag', helper.ciTag]).tag, helper.ciTag)
})

test('MinIO source fallback rejects remote builder overrides even with a local Docker context', () => {
  for (const env of [{ BUILDX_BUILDER: 'external-builder' }, { BUILDKIT_HOST: 'tcp://192.0.2.1:1234' }]) {
    const f = minioBuildFixture(() => { throw new Error('Unexpected Docker call') }, env)
    assert.throws(() => f.helper.main(['--build']), /external builder overrides/)
    assert.equal(f.calls.length, 0)
  }
})
