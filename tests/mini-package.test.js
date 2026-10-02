const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')

const root = path.resolve(__dirname, '..')
const project = require('../project.config.json')

function ignored(file) {
  return project.packOptions.ignore.some(({ type, value }) => {
    if (type === 'folder') return file === value || file.startsWith(`${value}/`)
    if (type === 'file') return file === value
    if (type === 'prefix') return file.startsWith(value)
    if (type === 'suffix') return file.endsWith(value)
    throw new Error(`Update package regression checks for rule type: ${type}`)
  })
}

function packageCandidates(directory = '') {
  return fs.readdirSync(path.join(root, directory), { withFileTypes: true }).flatMap(entry => {
    const file = directory ? `${directory}/${entry.name}` : entry.name
    if (ignored(file)) return []
    assert.equal(entry.isSymbolicLink(), false, `Do not package symbolic links: ${file}`)
    return entry.isDirectory() ? packageCandidates(file) : [file]
  })
}

test('mini package excludes web apps, backend, backups, development files and private keys', () => {
  assert.deepEqual(project.packOptions.include, [], 'Forced includes may override exclusions')
  for (const file of ['admin-web/src/main.ts', 'web-customer/dist/index.html',
    'official-site/index.html', 'backend/.env', 'deploy/.work/backups/data.tar.gz',
    'backup/database.sql', 'dev-docs/production_deployment.md', '.git/config',
    '.env.production', 'codex_sdk.pem', 'server.key', 'cert.pfx', 'backup.sql',
    'backend-dev.log', '.wx-auto-input.txt', 'skills-lock.json', 'start-dev.cmd']) {
    assert.equal(ignored(file), true, `Unexpected package input: ${file}`)
  }
  const folders = new Set(['assets', 'components', 'constants', 'pages', 'services', 'store', 'styles', 'utils'])
  const files = new Set(['app.js', 'app.json', 'app.wxss', 'config.js', 'sitemap.json',
    'project.config.json', 'project.private.config.json'])
  for (const file of packageCandidates()) {
    assert.ok(file.includes('/') ? folders.has(file.split('/')[0]) : files.has(file), `Unreviewed package input: ${file}`)
  }
})

test('registered local components exist, are packaged and are used by their templates', () => {
  const candidates = new Set(packageCandidates())
  for (const file of candidates) {
    if (!file.endsWith('.json') || !candidates.has(file.replace(/\.json$/, '.wxml'))) continue
    const config = JSON.parse(fs.readFileSync(path.join(root, file), 'utf8'))
    const template = fs.readFileSync(path.join(root, file.replace(/\.json$/, '.wxml')), 'utf8')
      .replace(/<!--[\s\S]*?-->/g, '')
    const tags = new Set([...template.matchAll(/<([A-Za-z][\w-]*)(?=[\s/>])/g)].map(match => match[1]))
    for (const [tag, reference] of Object.entries(config.usingComponents || {})) {
      assert.ok(tags.has(tag), `Unused component registration: ${file} -> ${tag}`)
      const base = reference.startsWith('/') ? reference.slice(1)
        : path.posix.normalize(path.posix.join(path.posix.dirname(file), reference))
      for (const suffix of ['.json', '.js', '.wxml', '.wxss']) {
        assert.ok(candidates.has(base + suffix), `Missing or excluded component: ${base + suffix}`)
      }
    }
  }
  for (const page of require('../app.json').pages) {
    for (const suffix of ['.json', '.js', '.wxml', '.wxss']) {
      assert.ok(candidates.has(page + suffix), `Missing or excluded page: ${page + suffix}`)
    }
  }
})

test('the three unused components are retained locally but excluded from upload', () => {
  for (const directory of ['components/business/sticky-action-bar',
    'components/layout/page-header', 'components/layout/section-title']) {
    assert.ok(fs.existsSync(path.join(root, directory)))
    assert.ok(ignored(directory))
  }
})
