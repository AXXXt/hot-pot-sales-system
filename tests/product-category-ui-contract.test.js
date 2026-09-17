const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')

const root = path.resolve(__dirname, '..')

function read(relativePath) {
  return fs.readFileSync(path.join(root, relativePath), 'utf8')
}

test('分类管理与分类请求不再包含品牌关联', () => {
  const categoryView = read('admin-web/src/views/product/CategoryView.vue')
  const productApi = read('admin-web/src/api/product.ts')
  const categoryPage = read('pages/category/category.js')

  assert.doesNotMatch(categoryView, /getBrands|form\.brandId|label="品牌"/)
  assert.doesNotMatch(categoryView, /const brands\s*=/)
  assert.match(categoryView, /:disabled="!form\.name"/)
  assert.doesNotMatch(productApi, /getCategories\(brandId/)
  assert.doesNotMatch(categoryPage, /getProductCategories\(\{\s*brandId/)
  assert.match(categoryPage, /getProductCategories\(\)/)
  assert.match(categoryView, /const name = form\.name\.trim\(\)/)
  assert.match(categoryView, /rows\.value\.some/)
  assert.match(categoryView, /分类名称已存在/)
  assert.match(categoryView, /getManagedCategories/)
  assert.match(categoryView, /restoreCategory/)
  assert.match(categoryView, /分类已永久删除/)
  assert.match(categoryView, /分类已有历史商品，已安全停用/)
  assert.doesNotMatch(categoryView, /关联商品已调整为暂无分类/)
})

test('商品状态开关使用三列加两列左对齐的响应式网格', () => {
  const productEditor = read('admin-web/src/views/product/ProductEditView.vue')

  assert.match(productEditor, /class="product-flag-grid"/)
  assert.equal((productEditor.match(/class="product-flag-item"/g) || []).length, 5)
  assert.match(productEditor, /grid-template-columns:\s*repeat\(3, minmax\(0, 1fr\)\)/)
  assert.match(productEditor, /@media \(max-width: 768px\)[\s\S]*grid-template-columns:\s*1fr/)
})
