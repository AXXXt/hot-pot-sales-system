// Container health does not guarantee Docker Desktop's Windows port forwarding is ready.
const net = require('node:net')
const { spawnSync } = require('node:child_process')
const services = [
  { name: 'MySQL', port: 3307 },
  { name: 'Redis', port: 6379 },
  { name: 'MinIO', port: 9000 }
]

function verifyEngine(run = spawnSync) {
  const result = run('docker', ['info', '--format', '{{.ServerVersion}}'], {
    encoding: 'utf8', timeout: 10000
  })
  if (result.error || result.status !== 0 || !/^\d+\.\d+/.test((result.stdout || '').trim())) {
    throw new Error('Docker engine is not responding. Start Docker Desktop first. If it reports WSL unresponsive, recover WSL or restart Windows after saving your work. Do not reset Docker or delete database volumes.')
  }
  console.log(`Docker engine ready: ${result.stdout.trim()}`)
}

function canConnect(port, timeoutMs = 1000) {
  return new Promise(resolve => {
    const socket = net.connect({ host: '127.0.0.1', port })
    const finish = ready => { socket.destroy(); resolve(ready) }
    socket.setTimeout(timeoutMs)
    socket.once('connect', () => finish(true))
    socket.once('error', () => finish(false))
    socket.once('timeout', () => finish(false))
  })
}

async function probePorts() {
  const failed = []
  for (const service of services) {
    if (!await canConnect(service.port)) failed.push(`${service.name} 127.0.0.1:${service.port}`)
  }
  return failed
}

async function waitForPorts({
  timeoutMs = 60000, intervalMs = 2000, probe = probePorts,
  now = Date.now, sleep = ms => new Promise(resolve => setTimeout(resolve, ms)), log = console.log
} = {}) {
  const deadline = now() + timeoutMs
  let lastMessage = ''
  while (true) {
    const failed = await probe()
    if (!failed.length) { log('Windows host ports ready: MySQL, Redis, MinIO'); return }
    const message = failed.join(', ')
    if (message !== lastMessage) { log(`Waiting for Windows host ports: ${message}`); lastMessage = message }
    if (now() >= deadline) {
      const error = new Error(`LOCAL_PORTS_UNREACHABLE: ${message}. Docker container health is not Windows connectivity. No migration was run. Docker Desktop port forwarding may need recovery; do not reset the database or delete volumes. Restarting Docker Desktop also interrupts other local containers.`)
      error.code = 'LOCAL_PORTS_UNREACHABLE'
      throw error
    }
    await sleep(Math.min(intervalMs, deadline - now()))
  }
}

async function verifyDatabase(env) {
  const { PrismaClient } = require('../backend/node_modules/@prisma/client')
  const url = new URL(env.DATABASE_URL)
  url.searchParams.set('connect_timeout', '3')
  url.searchParams.set('pool_timeout', '3')
  const client = new PrismaClient({ datasources: { db: { url: url.href } } })
  try {
    await client.$queryRawUnsafe('SELECT 1')
    console.log('Windows MySQL authenticated query: OK')
  } catch (error) {
    throw new Error(`Local MySQL query failed (${error.code || error.errorCode || 'connection error'}). Check backend/.env credentials and database availability; data was not reset.`)
  } finally { await client.$disconnect() }
}

if (require.main === module) {
  const { localConfig } = require('./local-environment.cjs')
  Promise.resolve().then(() => localConfig()).then(async env => {
    if (process.argv.includes('--engine')) { verifyEngine(); return }
    await waitForPorts()
    await verifyDatabase(env)
  }).catch(error => { console.error(error.message); process.exitCode = 1 })
}
module.exports = { canConnect, waitForPorts, verifyDatabase, verifyEngine }
