// 再次采购时重新校验可售范围、价格和库存，不沿用历史价格。
const { getOrderDetail } = require('./api/order')
const { validateCart } = require('./api/product')
const cart = require('../store/modules/cart')

function buildRepeatItems(orderItems, validation, existingItems) {
  const current = new Map((validation.items || []).map(item => [Number(item.skuId), item]))
  const requested = new Map()
  orderItems.forEach(item => {
    const id = Number(item.skuId)
    requested.set(id, (requested.get(id) || 0) + Number(item.quantity || 0))
  })
  const items = []
  let skipped = 0
  let adjusted = 0
  requested.forEach((amount, id) => {
    const sku = current.get(id)
    if (!sku || sku.available === false || sku.price == null ||
        !Number.isFinite(Number(sku.price)) || Number(sku.price) < 0) { skipped++; return }
    const existing = existingItems.find(item => Number(item.skuId) === id)
    const held = Number(existing?.quantity || 0)
    const min = Math.max(1, Number(sku.minOrderQty || 1))
    const stock = Number(sku.stockNum || 0)
    const desired = Math.max(amount, Math.max(0, min - held))
    const quantity = Math.min(desired, Math.max(stock - held, 0))
    if (!Number.isSafeInteger(quantity) || quantity <= 0 || held + quantity < min) {
      skipped++; return
    }
    if (quantity !== amount) adjusted++
    items.push({
      productId: sku.productId, skuId: sku.skuId, brandId: sku.brandId, quantity,
      snapshot: {
        name: sku.name, spec: sku.spec, price: sku.price, priceUnit: sku.unit,
        brandId: sku.brandId, brandText: sku.brandName || '', stockNum: stock, minOrderQty: min
      }
    })
  })
  return { items, skipped, adjusted }
}

// 参数为原订单 ID；返回实际加入数量及不可购买、数量调整的规格数。
async function repeatOrder(id) {
  const response = await getOrderDetail(id)
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

function showRepeatResult(result) {
  const openCart = () => wx.navigateTo({ url: '/pages/cart/cart' })
  if (result.skipped || result.adjusted) {
    wx.showModal({
      title: '已更新购物车', showCancel: false,
      content: `已加入 ${result.added} 个规格，${result.skipped} 个无法加入，${result.adjusted} 个已调整数量。`,
      success: openCart
    })
  } else openCart()
}

module.exports = { repeatOrder, buildRepeatItems, showRepeatResult }
