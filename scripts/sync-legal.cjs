// 微信运行时不能 require JSON；从共享文案生成可打包的 CommonJS 模块。
const fs = require('node:fs')
const path = require('node:path')
function syncLegal() {
  const directory = path.resolve(__dirname, '../constants')
  const legal = JSON.parse(fs.readFileSync(path.join(directory, 'legal.json'), 'utf8'))
  const source = '// 由 scripts/sync-legal.cjs 从 legal.json 生成，请修改共享 JSON 文案。\n' +
    'module.exports = ' + JSON.stringify(legal, null, 2) + '\n'
  fs.writeFileSync(path.join(directory, 'legal.js'), source, 'utf8')
}
if (require.main === module) syncLegal()
module.exports = { syncLegal }
