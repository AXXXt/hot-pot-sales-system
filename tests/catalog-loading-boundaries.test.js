const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const vm = require('node:vm')
const root = path.resolve(__dirname, '..')
const plain = value => JSON.parse(JSON.stringify(value))
function page(file, api, wx = {}) {
  let definition
  vm.runInNewContext(fs.readFileSync(path.join(root, file), 'utf8'), { Page: value => { definition = value }, wx,
    require: id => id.includes('/api/product') ? api : id.includes('/api/auth') ? {} : id.includes('/cart') ? {} : { brand: { state: {} }, auth: { state: {} } } })
  definition.setData = values => Object.assign(definition.data, values)
  return definition
}

test('category combines category, brand-text search and price or stock filters with a fresh first page', async () => {
  const calls = []
  const instance = page('pages/category/category.js', { getProductList: async params => { calls.push(plain(params)); return { code: 0, data: { items: [], total: 0 } } } })
  instance.setData({ activeCategoryId: '2', keyword: '利至雁', activeSort: 'price_asc', page: 3 })
  await instance.loadProducts()
  assert.deepEqual(calls[0], { page: 1, pageSize: 50, categoryId: '2', keyword: '利至雁', sortBy: 'price_asc' })
  instance.setData({ activeSort: 'in_stock' })
  await instance.loadProducts()
  assert.deepEqual(calls[1], { page: 1, pageSize: 50, categoryId: '2', keyword: '利至雁', inStock: 'true' })
  assert.equal(instance.data.page, 1)
})

test('category ignores an old filter result after the latest category has completed', async () => {
  const pending = []
  const instance = page('pages/category/category.js', { getProductList: params => new Promise(resolve => pending.push({ params: plain(params), resolve })) })
  instance.setData({ activeCategoryId: '2' }); const old = instance.loadProducts()
  instance.setData({ activeCategoryId: '3' }); const latest = instance.loadProducts()
  pending[1].resolve({ code: 0, data: { items: [{ id: 3 }], total: 1 } }); await latest
  pending[0].resolve({ code: 0, data: { items: [{ id: 2 }], total: 1 } }); await old
  assert.deepEqual(plain(instance.data.products), [{ id: 3 }])
  assert.equal(instance.data.loading, false)
})

test('clearing category filters restores the all chip and does not reapply a pending category', async () => {
  const calls = []
  const instance = page('pages/category/category.js', {
    getProductList: async params => {
      calls.push(plain(params))
      return { code: 0, data: { items: [], total: 0 } }
    }
  })
  instance.setData({ keyword: '旧搜索', activeCategoryId: '7', activeSort: 'price_desc',
    scrollIntoViewId: 'category-7' })
  instance.resetFilters()
  await Promise.resolve()
  assert.equal(instance.data.activeCategoryId, 'all')
  assert.equal(instance.data.scrollIntoViewId, 'category-all')
  assert.equal(instance.data.keyword, '')
  assert.equal(instance.data.activeSort, 'default')
  assert.deepEqual(calls[0], { page: 1, pageSize: 50 })
})

test('category page-two failure retains page one and retry requests page two exactly once', async () => {
  const calls = []
  let fail = true
  const instance = page('pages/category/category.js', { getProductList: async params => {
    calls.push(plain(params))
    if (params.page === 1) return { code: 0, data: { items: Array.from({ length: 50 }, (_, index) => ({ id: index + 1 })), total: 51 } }
    if (fail) { fail = false; throw new Error('synthetic unavailable') }
    return { code: 0, data: { items: [{ id: 51 }], total: 51 } }
  } })
  await instance.loadProducts()
  await instance.loadProducts(true)
  assert.equal(instance.data.products.length, 50)
  assert.equal(instance.data.page, 1)
  assert.equal(instance.data.loadMoreError, true)
  assert.equal(instance.data.error, false)
  await instance.loadProducts(true)
  assert.deepEqual(calls.map(item => item.page), [1, 2, 2])
  assert.equal(instance.data.products.length, 51)
  assert.equal(instance.data.hasMore, false)
})

test('home rapid feed switches cannot replace hot products with a late new-products response', async () => {
  const pending = []
  const instance = page('pages/home/home.js', { getProductList: params => new Promise(resolve => pending.push({ params: plain(params), resolve })) })
  instance.setData({ activeFeed: 'new' }); const old = instance.loadFeedProducts()
  instance.setData({ activeFeed: 'hot' }); const latest = instance.loadFeedProducts()
  pending[1].resolve({ code: 0, data: { items: [{ id: 20, name: '热销' }], total: 1 } }); await latest
  pending[0].resolve({ code: 0, data: { items: [{ id: 10, name: '新品' }], total: 1 } }); await old
  assert.deepEqual(pending.map(item => item.params.feed), ['new', 'hot'])
  assert.equal(instance.data.products[0].id, 20)
  assert.equal(instance.data.activeFeed, 'hot')
})

test('home failed feed shows a retryable error then clears it on the same-tab retry', async () => {
  let attempts = 0
  const instance = page('pages/home/home.js', { getProductList: async params => {
    attempts++
    assert.equal(params.feed, 'frequent')
    assert.equal(params.pageSize, 5)
    if (attempts === 1) throw new Error('synthetic unavailable')
    return { code: 0, data: { items: [{ id: 1, name: '常购' }], total: 1 } }
  } })
  await instance.loadFeedProducts()
  assert.equal(instance.data.error, true)
  assert.equal(instance.data.loading, false)
  await instance.loadFeedProducts()
  assert.equal(instance.data.error, false)
  assert.equal(instance.data.products[0].id, 1)
})

test('native product row falls back after an image error and retries a changed image URL', () => {
  let definition
  vm.runInNewContext(fs.readFileSync(path.join(root, 'components/business/product-row/product-row.js'), 'utf8'), { Component: value => { definition = value } })
  const instance = { data: { imageFailed: false }, setData(values) { Object.assign(this.data, values) } }
  definition.methods.onImageError.call(instance)
  assert.equal(instance.data.imageFailed, true)
  definition.properties.image.observer.call(instance, '/new-image.jpg')
  assert.equal(instance.data.imageFailed, false)
  const template = fs.readFileSync(path.join(root, 'components/business/product-row/product-row.wxml'), 'utf8')
  assert.match(template, /image && !imageFailed/)
  assert.match(template, /暂无图片/)
})

test('native gallery with all failed images does not launch a broken preview', () => {
  const previews = []
  const instance = page('pages/product-detail/product-detail.js', {}, { previewImage: value => previews.push(value) })
  instance.setData({ imageList: ['https://example.invalid/a.jpg', 'https://example.invalid/b.jpg'], failedImages: {} })
  for (const index of [0, 1]) instance.onImageFail({ currentTarget: { dataset: { index } } })
  instance.onPreviewImage({ currentTarget: { dataset: { index: 1 } } })
  assert.equal(previews.length, 0)
  assert.deepEqual(plain(instance.data.failedImages), { 0: true, 1: true })
})
