const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')

const root = path.resolve(__dirname, '..')
const read = (relativePath) => fs.readFileSync(path.join(root, relativePath), 'utf8')

test('logged-in customers without agreement prices see only the base price', () => {
  const detail = read('pages/product-detail/product-detail.js')

  assert.match(detail, /auth\.state\.token \? '' : '登录查看协议价'/)
})

test('home and category keep a live cart entry after returning from product detail', () => {
  for (const page of ['home', 'category']) {
    const logic = read(`pages/${page}/${page}.js`)
    const template = read(`pages/${page}/${page}.wxml`)
    assert.match(logic, /onShow\(\)[\s\S]*cart\.getCount\(\)/)
    assert.match(logic, /goCart\(\)[\s\S]*\/pages\/cart\/cart/)
    assert.match(template, /floating-cart-entry/)
  }
})

test('checkout chooses no payment method and creates brand groups', () => {
  const logic = read('pages/checkout/checkout.js')
  const template = read('pages/checkout/checkout.wxml')

  assert.match(logic, /getCheckoutGroups\(\)/)
  assert.match(logic, /removeItemsBySkuIds/)
  assert.doesNotMatch(logic, /paymentMode|uploadPaymentProof|paymentProofPath/)
  assert.doesNotMatch(template, /支付方式|转账凭证|账期支付/)
  assert.match(template, /自动生成 \{\{orderCount\}\} 个独立订单/)
})

test('admin submits quotes while customers confirm them', () => {
  const adminDetail = read('admin-web/src/views/orders/OrderDetailView.vue')
  const customerDetail = read('pages/order-detail/order-detail.wxml')
  const dashboard = read('admin-web/src/views/dashboard/DashboardView.vue')

  assert.doesNotMatch(adminDetail, /doSubmitFinance|确认报价并提交财务审核/)
  assert.match(adminDetail, /等待客户确认报价并选择支付方式/)
  assert.match(customerDetail, /确认报价并支付/)
  assert.match(dashboard, /openOrders\('pending_quote'\)[\s\S]*待报价订单/)
})
