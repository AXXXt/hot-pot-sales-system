const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')

const root = path.resolve(__dirname, '..')

function read(relativePath) {
  return fs.readFileSync(path.join(root, relativePath), 'utf8')
}

test('商品列表支持选择已上架商品并批量下架', () => {
  const view = read('admin-web/src/views/product/ProductListView.vue')

  assert.match(view, /type="selection"/)
  assert.match(view, /@selection-change="handleSelectionChange"/)
  assert.match(view, /批量下架/)
  assert.match(view, /batchUpdateProductStatus/)
  assert.match(view, /确认批量下架选中的/)
})

test('商品 API 暴露批量状态更新方法', () => {
  const api = read('admin-web/src/api/product.ts')

  assert.match(api, /export function batchUpdateProductStatus/)
  assert.match(api, /patch\('\/products\/batch-status'/)
})
