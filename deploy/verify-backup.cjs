const { spawn, execFileSync } = require('node:child_process')
const { createReadStream } = require('node:fs')
const { createGunzip } = require('node:zlib')
const { pipeline } = require('node:stream/promises')
const { randomUUID } = require('node:crypto')
const path = require('node:path')

const name = `weiduoxian-restore-check-${randomUUID().slice(0, 8)}`
const docker = args => execFileSync('docker', args, { encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'] })
async function main() {
  const sql = path.resolve(process.argv[2])
  try {
    docker(['run', '-d', '--rm', '--name', name, '--network', 'none', '-e', 'MYSQL_ROOT_PASSWORD=restore-check-only', '-e', 'MYSQL_DATABASE=restore_check', 'mysql:8.4.3', '--innodb-buffer-pool-size=134217728', '--performance-schema=OFF'])
    let ready = false
    for (let attempt = 0; attempt < 60; attempt++) {
      try {
        docker(['exec', name, 'mysql', '-uroot', '-prestore-check-only', 'restore_check', '-e', 'SELECT 1'])
        ready = true
        break
      } catch { await new Promise(resolve => setTimeout(resolve, 2000)) }
    }
    if (!ready) throw new Error('Restore database did not become ready')
    const child = spawn('docker', ['exec', '-i', name, 'mysql', '-uroot', '-prestore-check-only', 'restore_check'], { stdio: ['pipe', 'pipe', 'pipe'] })
    let diagnostic = ''
    child.stderr.on('data', chunk => { diagnostic += chunk.toString() })
    const finished = new Promise((resolve, reject) => {
      child.once('error', reject)
      child.once('exit', code => code === 0 ? resolve() : reject(new Error(`Restore failed: ${diagnostic}`)))
    })
    await Promise.all([pipeline(createReadStream(sql), createGunzip(), child.stdin), finished])
    const counts = docker(['exec', name, 'mysql', '-uroot', '-prestore-check-only', '--batch', '--skip-column-names', 'restore_check', '-e', "SELECT (SELECT COUNT(*) FROM _prisma_migrations WHERE finished_at IS NOT NULL), (SELECT COUNT(*) FROM users WHERE user_type='super_admin' AND status='active'), (SELECT COUNT(*) FROM tenants), (SELECT COUNT(*) FROM permissions);"]).trim()
    if (counts !== '15\t1\t1\t15') throw new Error(`Unexpected restored counts: ${counts}`)
    console.log('PASS backup restored: 15 migrations, 1 active super admin, 1 tenant, 15 permissions')
  } finally {
    try { docker(['rm', '-f', '-v', name]) } catch {}
  }
}
main().catch(error => { console.error(error.message); process.exitCode = 1 })
