const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { officialSiteFiles, copyOfficialSite } = require('../official-site-files.cjs');

function fixture() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'wdx-static-whitelist-'));
  const source = path.join(root, 'source');
  for (const name of ['assets', 'css', 'js', '.vite/deps']) fs.mkdirSync(path.join(source, name), { recursive: true });
  for (const name of ['index.html', 'legal.html', 'assets/label.png', 'css/styles.css', 'js/main.js', '.vite/deps/_metadata.json', '.env', 'package.json', 'js/.private.json']) fs.writeFileSync(path.join(source, name), 'synthetic ' + name);
  return { root, source, destination: path.join(root, 'output') };
}

function cleanup(root) {
  const resolved = path.resolve(root);
  assert.equal(path.dirname(resolved), path.resolve(os.tmpdir()));
  assert.ok(path.basename(resolved).startsWith('wdx-static-whitelist-'));
  fs.rmSync(resolved, { recursive: true, force: true });
}

test('copies only official runtime entries, styles, scripts and assets, excluding development cache and private files', () => {
  const value = fixture();
  try {
    assert.deepEqual(officialSiteFiles(value.source).map(f => path.relative(value.source, f).replaceAll('\\', '/')), ['assets/label.png', 'css/styles.css', 'index.html', 'js/main.js', 'legal.html']);
    copyOfficialSite(value.source, value.destination);
    assert.deepEqual(officialSiteFiles(value.destination).map(f => path.relative(value.destination, f)), officialSiteFiles(value.source).map(f => path.relative(value.source, f)));
    assert.equal(fs.existsSync(path.join(value.destination, '.vite')), false);
    assert.equal(fs.existsSync(path.join(value.destination, '.env')), false);
    assert.equal(fs.existsSync(path.join(value.destination, 'package.json')), false);
  } finally { cleanup(value.root); }
});

test('refuses an existing artifact and missing entry instead of silently retaining old files', () => {
  const value = fixture();
  try {
    copyOfficialSite(value.source, value.destination);
    assert.throws(() => copyOfficialSite(value.source, value.destination), /overwrite/);
    fs.renameSync(path.join(value.source, 'legal.html'), path.join(value.source, 'old.html'));
    assert.throws(() => officialSiteFiles(value.source), /entry missing/);
  } finally { cleanup(value.root); }
});
