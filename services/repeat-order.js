// 再次采购时重新校验可售范围、价格和库存，不沿用历史价格。
const { getOrderDetail } = require('./api/order')
const { validateCart } = require('./api/product')
const cart = require('../store/modules/cart')

function buildRepeatItem(sku, requestedQuantity, existingQuantity) {
  if (!sku || sku.available === false || sku.price == null ||
    !Number.isFinite(Number(sku.price)) || Number(sku.price) < 0) return null

  const minOrderQty = Math.max(1, Number(sku.minOrderQty || 1))
  const stockNum = Number(sku.stockNum || 0)
  const desiredQuantity = Math.max(requestedQuantity, Math.max(0, minOrderQty - existingQuantity))
  const quantity = Math.min(desiredQuantity, Math.max(stockNum - existingQuantity, 0))
  if (!Number.isSafeInteger(quantity) || quantity <= 0 ||
    existingQuantity + quantity < minOrderQty) return null

  return {
    productId: sku.productId,
    skuId: sku.skuId,
    brandId: sku.brandId,
    quantity,
    snapshot: {
      name: sku.name,
      spec: sku.spec,
      price: sku.price,
      priceUnit: sku.unit,
      brandId: sku.brandId,
      brandText: sku.brandName || '',
      stockNum,
      minOrderQty
    }
  }
}

function buildRepeatItems(orderItems, validation, existingItems) {
  const validatedBySku = new Map((validation.items || []).map(item => [Number(item.skuId), item]))
  const requestedBySku = new Map()
  for (const item of orderItems) {
    const skuId = Number(item.skuId)
    requestedBySku.set(skuId, (requestedBySku.get(skuId) || 0) + Number(item.quantity || 0))
  }

  const items = []
  let skipped = 0
  let adjusted = 0
  for (const [skuId, requestedQuantity] of requestedBySku) {
    const existing = existingItems.find(item => Number(item.skuId) === skuId)
    const item = buildRepeatItem(
      validatedBySku.get(skuId), requestedQuantity, Number(existing?.quantity || 0)
    )
    if (!item) {
      skipped++
      continue
    }
    if (item.quantity !== requestedQuantity) adjusted++
    items.push(item)
  }
  return { items, skipped, adjusted }
}

// 参数为原订单 ID；返回实际加入数量及不可购买、数量调整的规格数。
async function repeatOrder(orderId) {
  const response = await getOrderDetail(orderId)
  const order = response?.data || response
  if (order?.status !== 'completed') throw new Error('仅已完成订单支持再次采购')
  const orderItems = order.items || []
  if (!orderItems.length) throw new Error('订单中没有可再次购买的商品')
  const result = await validateCart([...new Set(orderItems.map(item => Number(item.skuId)))])
  const next = buildRepeatItems(orderItems, result?.data || result || {}, cart.state.cartItems)
  if (!next.items.length) throw new Error('商品不可购买或购物车数量已达库存上限')
  next.items.forEach(item => cart.addItem(item))
  return { added: next.items.length, skipped: next.skipped, adjusted: next.adjusted }
}

function isNativeCancellation(error) {
  return typeof error?.errMsg === 'string' &&
    /(?:^|\s)cancel(?:led|ed)?(?:\s|$)/i.test(error.errMsg)
}

function showCartHint() {
  try {
    wx.showToast({ title: '商品已加入购物车，请稍后进入查看', icon: 'none', duration: 3000 })
  } catch {
    // 原生提示失败时仍保留已经加入的商品。
  }
}

function openCart() {
  try {
    wx.navigateTo({
      url: '/pages/cart/cart',
      fail: error => { if (!isNativeCancellation(error)) showCartHint() }
    })
  } catch {
    showCartHint()
  }
}

function showRepeatResult(result) {
  if (!result.skipped && !result.adjusted) {
    openCart()
    return
  }

  const recover = error => {
    if (isNativeCancellation(error)) return
    showCartHint()
    openCart()
  }
  try {
    wx.showModal({
      title: '已更新购物车',
      showCancel: false,
      content: `已加入 ${result.added} 个规格，${result.skipped} 个无法加入，${result.adjusted} 个已调整数量。`,
      success: res => { if (res?.confirm) openCart() },
      fail: recover
    })
  } catch {
    recover()
  }
}

module.exports = { repeatOrder, buildRepeatItems, showRepeatResult }
