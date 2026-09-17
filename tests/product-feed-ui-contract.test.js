const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')

const root = path.resolve(__dirname, '..')

function read(relativePath) {
  return fs.readFileSync(path.join(root, relativePath), 'utf8')
}

test('首页只保留常购新品热销切换并在点击后刷新商品', () => {
  const template = read('pages/home/home.wxml')
  const logic = read('pages/home/home.js')

  assert.doesNotMatch(template, /home__cat-scroll|home__cat-chip/)
  assert.match(template, /segmented-control/)
  assert.match(logic, /onFeedChange[\s\S]*event\.detail[\s\S]*loadFeedProducts/)
})

test('分类栏位于综合排序栏下方并注册分类组件', () => {
  const config = JSON.parse(read('pages/category/category.json'))
  const template = read('pages/category/category.wxml')
  const logic = read('pages/category/category.js')
  const toolbarIndex = template.indexOf('category-toolbar')
  const categoryIndex = template.indexOf('<category-scroll')

  assert.equal(config.usingComponents['category-scroll'], '/components/business/category-scroll/category-scroll')
  assert.ok(toolbarIndex >= 0 && categoryIndex > toolbarIndex)
  assert.match(logic, /onCategoryChange[\s\S]*event\.detail/)
  assert.match(logic, /onSortChange[\s\S]*dataset\.id/)
})

test('商品编辑页可保存新品和热销标签', () => {
  const editor = read('admin-web/src/views/product/ProductEditView.vue')

  assert.match(editor, /v-model="form\.isNew"/)
  assert.match(editor, /v-model="form\.isHot"/)
  assert.match(editor, /isNew:\s*form\.isNew/)
  assert.match(editor, /isHot:\s*form\.isHot/)
})

test('mini program components use compatible property defaults and local assets', () => {
  const categoryLogic = read('pages/category/category.js')
  const productRow = read('components/business/product-row/product-row.js')
  const productRowTemplate = read('components/business/product-row/product-row.wxml')
  const searchBar = read('components/business/search-bar/search-bar.wxml')

  assert.match(categoryLogic, /scrollIntoViewId:\s*''/)
  assert.match(productRow, /productId:\s*\{\s*type:\s*Number,\s*value:\s*0\s*\}/)
  assert.doesNotMatch(productRow, /type:\s*\[String,\s*Number\]/)
  assert.match(productRowTemplate, />\/\{\{priceUnit\}\}<\/text>/)
  assert.doesNotMatch(searchBar, /\/assets\/icons\/search\.png/)
  assert.match(searchBar, /<view class="search-bar__icon"/)
})

test('小程序未显式选择品牌时展示全部可见品牌商品', () => {
  const controller = read('backend/src/product/product.controller.ts')
  const homeLogic = read('pages/home/home.js')
  const categoryLogic = read('pages/category/category.js')

  assert.doesNotMatch(controller, /brandIdNum\s*\?\?[^\n]*:\s*1/)
  assert.doesNotMatch(homeLogic, /brandId:\s*store\.brand\.state\.currentBrand/)
  assert.doesNotMatch(homeLogic, /getBrands/)
  assert.doesNotMatch(categoryLogic, /const brandId\s*=\s*store\.brand/)
  const loadProductsStart = categoryLogic.indexOf('  loadProducts() {')
  const loadProductsEnd = categoryLogic.indexOf('  onSearch(', loadProductsStart)
  const loadProductsLogic = categoryLogic.slice(loadProductsStart, loadProductsEnd)
  assert.doesNotMatch(loadProductsLogic, /brandId/)
})
