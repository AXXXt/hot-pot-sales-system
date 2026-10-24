const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const vm = require('node:vm')
const root = path.resolve(__dirname, '..')

function loadPage(file, dependencies, wx = {}) {
  let page
  vm.runInNewContext(fs.readFileSync(path.join(root, file), 'utf8'), {
    Page: value => { page = value }, require: id => dependencies[id], wx
  })
  page.setData = data => Object.assign(page.data, data)
  return page
}

function detailFixture() {
  const added = []
  const page = loadPage('pages/product-detail/product-detail.js', {
    '../../services/api/product': {},
    '../../store/modules/auth': { state: { token: 'test' } },
    '../../store/modules/cart': { addItem: item => added.push(item), getCount: () => added.length }
  }, { showToast() {} })
  page.setData({ loading: false, skuLoading: false, product: { name: '测试商品', brand_id: 8 }, productId: '1' })
  return { page, added }
}

test('native order actions use catchtap and do not require DOM event methods', () => {
  let component
  const events = []
  vm.runInNewContext(fs.readFileSync(path.join(root, 'components/business/order-card/order-card.js'), 'utf8'), {
    Component: value => { component = value }
  })
  component.methods.onActionTap.call({ triggerEvent: (name, data) => events.push([name, data.id]) }, { currentTarget: { dataset: { id: 'reorder' } } })
  assert.deepEqual(events, [['action', 'reorder']])
  assert.match(fs.readFileSync(path.join(root, 'components/business/order-card/order-card.wxml'), 'utf8'), /catchtap="onActionTap"/)
})

test('category ignores stale responses and resets all visible filters', async () => {
  const pending = []
  const store = { brand: { state: { pendingCategoryId: '2' } } }
  const page = loadPage('pages/category/category.js', {
    '../../services/api/product': { getProductList: () => new Promise(resolve => pending.push(resolve)) },
    '../../store/index': store, '../../store/modules/cart': {}
  })
  page.loadProducts()
  page.setData({ keyword: '肉', activeCategoryId: '2', activeSort: 'price_asc' })
  page.resetFilters()
  assert.equal(page.data.keyword, '')
  assert.equal(page.data.activeCategoryId, 'all')
  assert.equal(page.data.activeSort, 'default')
  assert.equal(page.data.scrollIntoViewId, 'category-all')
  assert.equal(store.brand.state.pendingCategoryId, '')
  pending[1]({ code: 0, data: { items: [{ id: 2 }] } })
  await Promise.resolve()
  pending[0]({ code: 0, data: { items: [{ id: 1 }] } })
  await Promise.resolve()
  assert.equal(page.data.products[0].id, 2)
})

test('detail selection respects minimum quantity, stock and the selected SKU price', () => {
  const { page, added } = detailFixture()
  const sku = { id: 2, sale_price: '10', customer_price: '8', min_order_qty: 2, available_qty: 4, sale_unit: '箱' }
  page.applySkuViewModel(page.data.product, [sku])
  assert.equal(page.data.selectedSkuId, '2')
  assert.equal(page.data.quantity, 2)
  assert.equal(page.data.estimatedTotal, '¥16.00')
  page.onQuantityChange({ detail: 3 })
  assert.equal(page.data.estimatedTotal, '¥24.00')
  page.onQuantityChange({ detail: 5 })
  page.onQuantityChange({ detail: 1 })
  page.onQuantityChange({ detail: NaN })
  assert.equal(page.data.quantity, 3)
  page.onAddToCart()
  assert.equal(added.length, 1)
  assert.equal(added[0].skuId, '2')
  assert.equal(added[0].quantity, 3)
})

test('out-of-stock and below-minimum SKUs cannot be added', () => {
  const { page, added } = detailFixture()
  for (const stock of [0, 1]) {
    page.applySkuViewModel(page.data.product, [{ id: 1, sale_price: '10', min_order_qty: 2, available_qty: stock }])
    assert.equal(page.data.canBuy, false)
    page.onAddToCart()
  }
  assert.equal(added.length, 0)
})

test('zero agreement prices remain valid and initial SKU prefers one with sufficient stock', () => {
  const { page } = detailFixture()
  page.applySkuViewModel(page.data.product, [
    { id: 1, available_qty: 0, sold_out: true },
    { id: 2, sale_price: '10', customer_price: '0', min_order_qty: 1, available_qty: 3 }
  ])
  assert.equal(page.data.selectedSkuId, '2')
  assert.equal(page.data.estimatedTotal, '¥0.00')
})

test('quantity stepper never emits disabled or out-of-range values', () => {
  let definition
  vm.runInNewContext(fs.readFileSync(path.join(root, 'components/business/quantity-stepper/quantity-stepper.js'), 'utf8'), {
    Component: value => { definition = value }
  })
  const events = []
  const instance = { data: { value: 2, min: 2, max: 3, disabled: false }, triggerEvent: (_, value) => events.push(value), ...definition.methods }
  instance.decrement()
  instance.increment()
  assert.deepEqual(events, [3])
  instance.data.disabled = true
  instance.increment()
  assert.deepEqual(events, [3])
})

test('home search passes its keyword and category to the native category tab', () => {
  const brand = { state: {} }
  const urls = []
  const page = loadPage('pages/home/home.js', {
    '../../store/index': { brand }, '../../services/api/product': {},
    '../../services/api/auth': {}, '../../store/modules/cart': {}
  }, { switchTab: value => urls.push(value.url) })
  page.setData({ keyword: ' 牛肉 ' })
  page.goSearch()
  assert.equal(brand.state.pendingKeyword, '牛肉')
  assert.equal(brand.state.pendingCategoryId, 'all')
  assert.deepEqual(urls, ['/pages/category/category'])
  page.goCategory({ currentTarget: { dataset: { id: 2 } } })
  assert.equal(brand.state.pendingKeyword, '')
  assert.equal(brand.state.pendingCategoryId, '2')
})

test('new mini brand assets stay below 150 KB and core pages are gradient-free', () => {
  const bytes = fs.readdirSync(path.join(root, 'assets/brand')).reduce((sum, file) => sum + fs.statSync(path.join(root, 'assets/brand', file)).size, 0)
  assert.ok(bytes < 150 * 1024, `Brand assets are ${bytes} bytes`)
  for (const file of ['pages/home/home.wxss', 'pages/product-detail/product-detail.wxss']) {
    assert.doesNotMatch(fs.readFileSync(path.join(root, file), 'utf8'), /gradient\(|backdrop-filter|letter-spacing:\s*-/)
  }
  const row = fs.readFileSync(path.join(root, 'components/business/product-row/product-row.wxml'), 'utf8')
  assert.match(row, /catchtap="onActionTap"/)
})

test('WXML bindings remain on one line for the native compiler', () => {
  for (const file of ['pages/home/home.wxml', 'pages/product-detail/product-detail.wxml',
    'components/business/product-row/product-row.wxml']) {
    const source = fs.readFileSync(path.join(root, file), 'utf8')
    for (const match of source.matchAll(/\{\{[\s\S]*?\}\}/g)) assert.doesNotMatch(match[0], /\n/)
  }
})


test('native gallery keeps other images visible after a failure and previews valid images in order', () => {
  const previews = []
  const page = loadPage('pages/product-detail/product-detail.js', {
    '../../services/api/product': {}, '../../store/modules/auth': {}, '../../store/modules/cart': {}
  }, { previewImage: options => previews.push(options) })
  const urls = ['https://example.com/1.jpg', 'https://example.com/2.jpg', 'https://example.com/3.jpg']
  assert.deepEqual(Array.from(page.normalizeDetail({ main_image_url: urls[0] })), [urls[0]])
  assert.deepEqual(Array.from(page.normalizeDetail({ images: [urls[0], null, urls[0], urls[1]] })), urls.slice(0, 2))
  page.setData({ imageList: urls })
  page.onImageFail({ currentTarget: { dataset: { index: 1 } } })
  page.onSwiperChange({ detail: { current: 2 } })
  page.onPreviewImage({ currentTarget: { dataset: { index: 2 } } })
  assert.equal(page.data.imageError, false)
  assert.equal(page.data.imageIndex, 2)
  assert.equal(previews[0].current, urls[2])
  assert.deepEqual(Array.from(previews[0].urls), [urls[0], urls[2]])
})
