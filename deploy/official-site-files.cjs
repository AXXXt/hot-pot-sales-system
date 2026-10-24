'use strict';
const fs = require('node:fs');
const path = require('node:path');

// The official site is static source, not Vite's project directory or development cache.
function officialSiteFiles(directory) {
  const root = path.resolve(directory);
  if (!fs.lstatSync(root).isDirectory() || fs.lstatSync(root).isSymbolicLink()) throw new Error('Invalid official runtime root');
  const result = [];
  function collect(file) {
    const stat = fs.lstatSync(file);
    if (stat.isSymbolicLink()) throw new Error('Symlink in official runtime inputs');
    if (stat.isDirectory()) {
      for (const name of fs.readdirSync(file).sort()) if (!name.startsWith('.')) collect(path.join(file, name));
    } else if (stat.isFile()) result.push(file);
    else throw new Error('Unexpected official runtime member');
  }
  for (const name of ['index.html', 'legal.html']) {
    const file = path.join(root, name);
    if (!fs.existsSync(file) || !fs.lstatSync(file).isFile()) throw new Error('Official entry missing: ' + name);
    collect(file);
  }
  for (const name of ['assets', 'css', 'js']) collect(path.join(root, name));
  return result.sort();
}

function copyOfficialSite(directory, destination) {
  if (fs.existsSync(destination)) throw new Error('Never overwrite an official runtime artifact');
  for (const file of officialSiteFiles(directory)) {
    const target = path.join(destination, path.relative(path.resolve(directory), file));
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.copyFileSync(file, target);
  }
}

module.exports = { officialSiteFiles, copyOfficialSite };
