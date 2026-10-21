// Local-only environment checks and backups; never seed or reset existing data.
const fs = require('node:fs')
const path = require('node:path')
const { spawnSync } = require('node:child_process')
const { parse } = require('../backend/node_modules/dotenv')
const root = path.resolve(__dirname, '..')

function localConfig() {
  const env = parse(fs.readFileSync(path.join(root, 'backend/.env')))
  if (env.NODE_ENV !== 'development') throw new Error('Expected local NODE_ENV=development')
  const database = new URL(env.DATABASE_URL)
  const redis = new URL(env.REDIS_URL)
  if (database.hostname !== '127.0.0.1' || database.port !== '3307' || database.pathname !== '/b2b_miniapp') {
    throw new Error('Refusing to use a database other than local b2b_miniapp on port 3307')
  }
  if (redis.hostname !== '127.0.0.1' || redis.port !== '6379' || env.MINIO_ENDPOINT !== '127.0.0.1' || env.MINIO_PORT !== '9000') {
    throw new Error('Redis and MinIO must use the existing local services')
  }
  if (env.SMS_PROVIDER !== 'development' || env.SMS_DEV_CODE !== '123456') {
    throw new Error('Expected the existing local development SMS configuration')
  }
  return env
}

function backup() {
  const env = localConfig()
  const database = new URL(env.DATABASE_URL)
  const folder = path.join(root, 'backup', 'local-alignment')
  fs.mkdirSync(folder, { recursive: true })
  const file = path.join(folder, `b2b_miniapp-${new Date().toISOString().replace(/[:.]/g, '-')}.sql`)
  const fd = fs.openSync(file, 'wx')
  try {
    const result = spawnSync('docker', ['exec', '-i', 'miniprogram-mysql-1', 'sh', '-c',
      'read -r MYSQL_PWD; export MYSQL_PWD; exec mysqldump -u "$1" --single-transaction --routines --triggers --no-tablespaces --set-gtid-purged=OFF --databases b2b_miniapp',
      'sh', decodeURIComponent(database.username)], {
      input: decodeURIComponent(database.password) + '\n', stdio: ['pipe', fd, 'pipe']
    })
    if (result.status !== 0 || fs.fstatSync(fd).size < 100) throw new Error('Local backup failed; migration was not started')
  } finally { fs.closeSync(fd) }
  console.log(`Local backup: ${file}`)
}

async function main() {
  try {
    if (process.argv[2] === 'backup') backup()
    else if (process.argv[2] === 'migrate') {
      const env = localConfig()
      // Windows keeps Prisma's native DLL loaded even after $disconnect().
      // Run the query in a child that exits before prisma generate replaces that DLL.
      const check = spawnSync(process.execPath, [path.join(__dirname, 'wait-local-services.cjs')], {
        cwd: root, env: { ...process.env, ...env }, stdio: 'inherit'
      })
      if (check.status !== 0) throw new Error('Local connectivity check failed; no backup or migration was started')
      backup()
      for (const args of [['generate'], ['migrate', 'deploy']]) {
        const result = spawnSync(process.execPath, ['node_modules/prisma/build/index.js', ...args], {
          cwd: path.join(root, 'backend'), env: { ...process.env, ...env }, stdio: 'inherit'
        })
        if (result.status !== 0) throw new Error(`Prisma ${args.join(' ')} failed`)
      }
    }
    else { localConfig(); console.log('Local configuration verified; production connections excluded') }
  } catch (error) { console.error(error.message); process.exitCode = 1 }
}
if (require.main === module) main()
module.exports = { localConfig }
