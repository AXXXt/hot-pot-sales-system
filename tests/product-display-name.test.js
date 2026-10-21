const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const vm = require('node:vm')

function productApi(product) {
  const context = {
    module: { exports: {} },
    require: () => ({ request: ({ url }) => Promise.resolve({ code: 0, data: url.endsWith('/products') ? { items: [product], total: 1 } : product }) })
  }
  vm.runInNewContext(fs.readFileSync(path.join(__dirname, '../services/api/product.js'), 'utf8'), context)
  return context.module.exports
}

test('native catalog and detail use the real name and preserve identifiers and zero inventory', async () => {
  const api = productApi({ id: 1, name: '利至雁丸滑', subtitle: '爆汁牛筋丸', code: 'LIZHIYAN-WanHua-001', skus: [{ id: 11, stockNum: 0, basePrice: '10', saleUnit: '袋' }] })
  const list = (await api.getProductList({})).data.items[0]
  const detail = (await api.getProductDetail(1)).data
  for (const item of [list, detail]) {
    assert.equal(item.name, '爆汁牛筋丸')
    assert.equal(item.management_label, '利至雁丸滑')
    assert.equal(item.code, 'LIZHIYAN-WanHua-001')
    assert.equal(item.skus[0].sold_out, true)
  }
})

test('native clients use the management label as a fallback for incomplete legacy products', async () => {
  const api = productApi({ id: 1, name: '旧管理标签', subtitle: '   ', skus: [] })
  assert.equal((await api.getProductDetail(1)).data.name, '旧管理标签')
})
