const fs = require('node:fs')
const path = require('node:path')
const { createHash } = require('node:crypto')
const { execFileSync } = require('node:child_process')
const identity = process.argv[2]
if (!/^ai-\d{8}-\d+$/.test(identity || '')) throw new Error('Provide a release ID')
const root = path.resolve(__dirname, '..')
const info = JSON.parse(fs.readFileSync(path.join(__dirname, 'releases', `${identity}.json`)))
if (info.id !== identity) throw new Error('Release metadata mismatch')
const output = path.join(__dirname, '.work', identity)
if (fs.existsSync(output)) throw new Error('Release folder exists; never replace a staged artifact')
fs.mkdirSync(output, { recursive: true })
for (const [source, destination] of [['admin-web/dist', 'sites/admin'], ['admin-web/dist-platform', 'sites/platform']]) {
  fs.cpSync(path.join(root, source), path.join(output, destination), { recursive: true })
}
const files = directory => fs.readdirSync(directory, { withFileTypes: true }).flatMap(entry => entry.isDirectory() ? files(path.join(directory, entry.name)) : [path.join(directory, entry.name)]).sort()
const hash = file => createHash('sha256').update(fs.readFileSync(file)).digest('hex')
for (const [site, name] of [['admin', 'admin-manifest.json'], ['platform', 'platform-manifest.json']]) {
  const base = path.join(output, 'sites', site)
  const manifest = { release: identity, files: files(base).map(file => ({ path: path.relative(base, file).replaceAll('\\', '/'), sha256: hash(file) })) }
  fs.writeFileSync(path.join(output, name), JSON.stringify(manifest, null, 2))
}
const adminFiles = files(path.join(output, 'sites/admin')).filter(file => file.endsWith('.js')).map(file => fs.readFileSync(file, 'utf8')).join('')
if (!adminFiles.includes(identity) || !adminFiles.includes(info.version)) throw new Error('Build the admin app with matching VITE_PLATFORM_VERSION and VITE_PLATFORM_RELEASE_ID')
for (const name of ['platform-worker.py', 'install-platform-control.py', 'weiduoxian-platform-worker.service', 'weiduoxian-platform-worker.path', 'weiduoxian-platform-worker.timer']) {
  fs.writeFileSync(path.join(output, name), fs.readFileSync(path.join(__dirname, name), 'utf8').replaceAll('\r\n', '\n'))
}
fs.writeFileSync(path.join(output, 'release-info.json'), JSON.stringify(info, null, 2))
const archive = `${output}.tar.gz`
execFileSync('tar', ['-czf', archive, '-C', output, '.'])
console.log(JSON.stringify({ release: identity, archive, sha256: hash(archive), bytes: fs.statSync(archive).size, adminAssets: JSON.parse(fs.readFileSync(path.join(output, 'admin-manifest.json'))).files.length }))
