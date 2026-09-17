const test = require('node:test')
const assert = require('node:assert/strict')
const path = require('node:path')

const workspaceRoot = path.resolve(__dirname, '..')

function loadCart(initialItems = []) {
  const storage = new Map([['cartItems', initialItems]])
  global.wx = {
    getStorageSync(key) { return storage.has(key) ? storage.get(key) : '' },
    setStorageSync(key, value) { storage.set(key, value) },
    removeStorageSync(key) { storage.delete(key) }
  }

  for (const modulePath of Object.keys(require.cache)) {
    if (modulePath.startsWith(workspaceRoot) && !modulePath.includes(path.join(path.sep, 'tests', path.sep))) {
      delete require.cache[modulePath]
    }
  }

  return require('../store/modules/cart')
}

test('cart accepts products from the same brand', () => {
  const cart = loadCart()

  assert.deepEqual(cart.addItem({
    productId: 17,
    skuId: 21,
    brandId: 4,
    quantity: 1,
    snapshot: { name: '德品鸭血' }
  }), { added: true })
  assert.deepEqual(cart.addItem({
    productId: 18,
    skuId: 22,
    brandId: 4,
    quantity: 1,
    snapshot: { name: '德品毛肚' }
  }), { added: true })
  assert.equal(cart.state.cartItems.length, 2)
})

test('cart accepts different brands and groups them for checkout', () => {
  const cart = loadCart()
  cart.addItem({
    productId: 17,
    skuId: 21,
    brandId: 4,
    quantity: 1,
    snapshot: { name: '德品鸭血', brandText: '德品' }
  })

  assert.deepEqual(cart.addItem({
    productId: 30,
    skuId: 40,
    brandId: 5,
    quantity: 1,
    snapshot: { name: '其他品牌商品', brandText: '其他品牌' }
  }), { added: true })
  assert.equal(cart.state.cartItems.length, 2)
  assert.deepEqual(
    cart.getCheckoutGroups().map(group => ({
      brandId: group.brandId,
      brandText: group.brandText,
      skuIds: group.items.map(item => Number(item.skuId))
    })),
    [
      { brandId: 4, brandText: '德品', skuIds: [21] },
      { brandId: 5, brandText: '其他品牌', skuIds: [40] }
    ]
  )
})

test('cart validation backfills the authoritative product brand', () => {
  const cart = loadCart([{
    productId: 17,
    skuId: 21,
    quantity: 1,
    snapshot: { name: '德品鸭血' },
    available: true,
    unavailableReason: ''
  }])

  cart.applyValidation({
    items: [{
      skuId: 21,
      productId: 17,
      brandId: 4,
      brandName: '德品',
      name: '德品鸭血',
      spec: '300g',
      price: '18.00',
      unit: '盒',
      stockNum: 5,
      minOrderQty: 1,
      available: true
    }],
    invalidSkuIds: []
  })

  assert.equal(cart.state.cartItems[0].brandId, 4)
  assert.equal(cart.state.cartItems[0].snapshot.brandText, '德品')
})

test('cart removes only the SKUs whose brand orders were created', () => {
  const cart = loadCart([
    { productId: 17, skuId: 21, brandId: 4, quantity: 1, snapshot: {}, available: true },
    { productId: 30, skuId: 40, brandId: 5, quantity: 1, snapshot: {}, available: true }
  ])

  cart.removeItemsBySkuIds([21])

  assert.deepEqual(cart.state.cartItems.map(item => item.skuId), [40])
  assert.equal(cart.getCount(), 1)
})

test('cart detects mixed brands restored from persisted data', () => {
  const cart = loadCart([
    { productId: 17, skuId: 21, brandId: 4, quantity: 1, snapshot: {}, available: true },
    { productId: 30, skuId: 40, brandId: 5, quantity: 1, snapshot: {}, available: true }
  ])

  assert.equal(cart.hasMixedBrands(), true)
})
