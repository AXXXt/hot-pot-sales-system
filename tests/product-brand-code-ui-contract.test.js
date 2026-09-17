const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')

const root = path.resolve(__dirname, '..')

function read(relativePath) {
  return fs.readFileSync(path.join(root, relativePath), 'utf8')
}

test('管理端提供品牌管理入口、接口与生命周期操作', () => {
  const router = read('admin-web/src/router/index.ts')
  const layout = read('admin-web/src/layouts/MainLayout.vue')
  const api = read('admin-web/src/api/product.ts')
  const brandView = read('admin-web/src/views/product/BrandView.vue')

  assert.match(router, /products\/brands/)
  assert.match(layout, /品牌管理/)
  assert.match(api, /getManagedBrands/)
  assert.match(api, /suggestBrandCode/)
  assert.match(api, /restoreBrand/)
  assert.match(brandView, /品牌编码前缀/)
  assert.match(brandView, /当前商品数/)
  assert.match(brandView, /已归档/)
  assert.match(brandView, /historicalProductCount/)
  assert.match(brandView, /恢复/)
})

test('商品编辑器只提交品牌和分类并展示自动生成身份', () => {
  const editor = read('admin-web/src/views/product/ProductEditView.vue')

  assert.match(editor, /getBrands/)
  assert.match(editor, /form\.brandId/)
  assert.match(editor, /generatedName/)
  assert.match(editor, /generatedCodePreview/)
  assert.match(editor, /readonly/)
  assert.match(editor, /更换品牌或分类将生成新商品编码/)
  assert.doesNotMatch(editor, /code:\s*form\.productCode/)
})

test('商品列表展示正式编码且分类管理使用生命周期接口', () => {
  const productList = read('admin-web/src/views/product/ProductListView.vue')
  const productApi = read('admin-web/src/api/product.ts')
  const categoryView = read('admin-web/src/views/product/CategoryView.vue')

  assert.match(productList, /prop="code" label="商品编码"/)
  assert.doesNotMatch(productList, /prop="productCode"/)
  assert.match(productApi, /getManagedCategories/)
  assert.match(productApi, /restoreCategory/)
  assert.match(categoryView, /当前商品数/)
  assert.match(categoryView, /已归档/)
  assert.match(categoryView, /historicalProductCount/)
  assert.match(categoryView, /已停用/)
  assert.match(categoryView, /恢复/)
})
