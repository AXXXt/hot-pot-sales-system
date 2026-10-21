const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const vm = require('node:vm')

test('native detail switches the SKU picture and adds configured boxes into one base-unit inventory', () => {
  let definition, added
  const modules = {
    '../../services/api/product': {},
    '../../store/modules/auth': { state: { token: 'fixture-only' } },
    '../../store/modules/cart': { getCount: () => 0, addItem: item => { added = item } }
  }
  const context = { Page: value => { definition = value }, require: value => {
    if (modules[value]) return modules[value]
    throw new Error('Unexpected module: ' + value)
  }, wx: { showToast() {} } }
  vm.runInNewContext(fs.readFileSync(path.join(__dirname, '../pages/product-detail/product-detail.js'), 'utf8'), context)
  const page = { ...definition, data: { ...definition.data, productId: '1', product: { name: '牛筋丸', brand_id: 1 }, imageList: ['/a.jpg', '/b.jpg'] }, setData(patch) { Object.assign(this.data, patch) } }
  const sku = { id: 11, spec_text: '500克/袋', sale_unit: '袋', sale_price: '20', customer_price: '18.50', available_qty: 45, min_order_qty: 1, sold_out: false, image_url: '/b.jpg', packaging_units: [{ unit: '箱', factor: 20 }] }
  page.data.loading = false; page.data.skuLoading = false
  page.applySkuViewModel(page.data.product, [sku])
  assert.equal(page.data.imageIndex, 1)
  page.onPackageChange({ detail: { value: '1' } })
  assert.equal(page.data.displayPrice, '¥370.00')
  assert.equal(page.data.maxQuantity, 2)
  assert.equal(page.data.packageFactor, 20)
  assert.equal(page.data.minOrderText, '1箱')
  page.onQuantityChange({ detail: 2 })
  assert.equal(page.data.estimatedTotal, '¥740.00')
  page.onAddToCart()
  assert.equal(added.quantity, 40)
  assert.equal(added.skuId, '11')
  assert.equal(added.snapshot.priceUnit, '袋')
  assert.equal(added.snapshot.price, '18.50')
})
