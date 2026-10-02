const { spawn } = require('node:child_process')
const { createWriteStream, mkdirSync } = require('node:fs')
const { createGzip } = require('node:zlib')
const { pipeline } = require('node:stream/promises')
const path = require('node:path')

async function main() {
  const output = path.join(__dirname, '.work', 'images.tar.gz')
  mkdirSync(path.dirname(output), { recursive: true })
  const images = process.argv.slice(2)
  const child = spawn('docker', ['save', ...(images.length ? images : ['weiduoxian-backend:20261002-1', 'mysql:8.4.3', 'redis:7.4.1', 'minio/minio:RELEASE.2025-01-20T14-49-07Z', 'nginx:1.27-alpine'])], { stdio: ['ignore', 'pipe', 'inherit'] })
  const completed = new Promise((resolve, reject) => {
    child.once('error', reject)
    child.once('exit', code => code === 0 ? resolve() : reject(new Error(`docker save exited ${code}`)))
  })
  await Promise.all([pipeline(child.stdout, createGzip({ level: 3 }), createWriteStream(output)), completed])
  console.log(`Images exported: ${output}`)
}
main().catch(error => { console.error(error.message); process.exitCode = 1 })
