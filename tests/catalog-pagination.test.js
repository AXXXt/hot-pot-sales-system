const test = require('node:test')
const assert = require('node:assert/strict')
const vm = require('node:vm')
const fs = require('node:fs')
const path = require('node:path')

function pageWith(getProductList, categories = [{ id: 1, name: '鸭血' }]) {
  let definition
  vm.runInNewContext(fs.readFileSync(path.join(__dirname, '../pages/category/category.js'), 'utf8'), {
    Page: value => { definition = value },
    require: name => name.includes('services/api/product')
      ? { getProductList, getProductCategories: async () => ({ code: 0, data: categories }) }
      : {}, wx: {}
  })
  const page = { ...definition, data: structuredClone(definition.data),
    setData(value) { Object.assign(this.data, value) } }
  return page
}
const response = (ids, total) => ({ code: 0, data: { items: ids.map(id => ({ id })), total } })

test('category can load products after the first 50 and retains rows when a later page fails', async () => {
  const requests = []
  let fail = true
  const page = pageWith(async params => {
    requests.push(params)
    if (params.page === 1) return response(Array.from({ length: 50 }, (_, i) => i + 1), 51)
    if (fail) throw Error('offline')
    return response([51], 51)
  })
  await page.loadProducts()
  await page.onReachBottom()
  assert.equal(page.data.products.length, 50)
  assert.equal(page.data.loadMoreError, true)
  assert.equal(page.data.page, 1)
  fail = false
  await page.loadMore()
  assert.equal(page.data.products.length, 51)
  assert.equal(page.data.hasMore, false)
  assert.deepEqual(requests.map(value => value.page), [1, 2, 2])
})

test('a changed filter wins over a late pagination response', async () => {
  let resolveMore
  const page = pageWith(params => params.page === 2
    ? new Promise(resolve => { resolveMore = resolve })
    : Promise.resolve(params.keyword ? response([99], 1) : response([1], 2)))
  await page.loadProducts()
  const pending = page.onReachBottom()
  page.setData({ keyword: '新商品' })
  await page.loadProducts()
  resolveMore(response([2], 2))
  await pending
  assert.deepEqual(page.data.products.map(item => item.id), [99])
  assert.equal(page.data.loadingMore, false)
})

test('a removed category resets to all rather than hiding the remaining catalog', async () => {
  const page = pageWith(async () => response([7], 1), [])
  page.setData({ activeCategoryId: '123' })
  await page.loadCategories()
  await Promise.resolve()
  assert.equal(page.data.activeCategoryId, 'all')
  assert.equal(page.data.products[0].id, 7)
})
