// 微信运行时不能 require JSON；从共享文案生成可打包的 CommonJS 模块。
const fs = require('node:fs')
const path = require('node:path')
function syncLegal() {
  const directory = path.resolve(__dirname, '../constants')
  const legal = JSON.parse(fs.readFileSync(path.join(directory, 'legal.json'), 'utf8'))
  const source = '// 由 scripts/sync-legal.cjs 从 legal.json 生成，请修改共享 JSON 文案。\n' +
    'module.exports = ' + JSON.stringify(legal, null, 2) + '\n'
  const writeChanged = (file, content) => { if (!fs.existsSync(file) || fs.readFileSync(file, 'utf8') !== content) fs.writeFileSync(file, content, 'utf8') }
  writeChanged(path.join(directory, 'legal.js'), source)
  const backendDirectory = path.resolve(__dirname, '../backend/src/legal')
  fs.mkdirSync(backendDirectory, { recursive: true })
  writeChanged(path.join(backendDirectory, 'legal-policy.ts'), '// 由 scripts/sync-legal.cjs 生成；请修改 constants/legal.json。\nexport const currentLegalPolicy = ' + JSON.stringify(legal, null, 2) + ' as const\n')
  writeChanged(path.resolve(__dirname, '../official-site/js/legal.js'), '// 由 scripts/sync-legal.cjs 生成。\nwindow.WDQ_LEGAL = ' + JSON.stringify(legal) + '\n')
}
if (require.main === module) syncLegal()
module.exports = { syncLegal }
