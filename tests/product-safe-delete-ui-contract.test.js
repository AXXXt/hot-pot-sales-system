const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')

const root = path.resolve(__dirname, '..')
const read = (relativePath) => fs.readFileSync(path.join(root, relativePath), 'utf8')

test('商品 API 暴露单个和批量安全删除方法', () => {
  const api = read('admin-web/src/api/product.ts')

  assert.match(api, /export function deleteProduct/)
  assert.match(api, /http\.delete\(`\/products\/\$\{id\}`\)/)
  assert.match(api, /export function batchArchiveProducts/)
  assert.match(api, /patch\('\/products\/batch-archive'/)
})

test('商品列表支持单个和批量安全删除', () => {
  const view = read('admin-web/src/views/product/ProductListView.vue')

  assert.match(view, /async function handleDelete/)
  assert.match(view, /async function handleBatchDelete/)
  assert.match(view, /批量删除/)
  assert.match(view, /@click="handleDelete\(row\)"/)
  assert.match(view, /batchArchiveProducts/)
})

test('批量下架只提交选中的已上架商品', () => {
  const view = read('admin-web/src/views/product/ProductListView.vue')

  assert.match(view, /selectedRows\.value\.filter\(row => row\.status === 'active'\)/)
  assert.doesNotMatch(view, /:selectable="isRowSelectable"/)
})
