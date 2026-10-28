// 进货单页面与浮层共用的商品展示字段；保留异常数量供用户主动调整。
function presentCartItem(item) {
  const snapshot = item.snapshot || {}
  const quantity = Number(item.quantity)
  const price = Number(snapshot.price || 0)
  const amount = price * quantity
  const stock = Number(snapshot.stockNum)

  return {
    productId: item.productId,
    skuId: item.skuId,
    name: snapshot.name || '商品',
    spec: snapshot.spec || '',
    unit: snapshot.priceUnit || '',
    quantity,
    quantityText: Number.isSafeInteger(quantity) && quantity > 0 ? String(quantity) : '待调整',
    amount: Number.isFinite(amount) ? amount.toFixed(2) : '--',
    priceText: Number.isFinite(price) ? price.toFixed(2) : '--',
    available: item.available !== false,
    quantityInvalid: Boolean(item.quantityError),
    validationKnown: typeof item.skuAvailable === 'boolean',
    canAdjust: item.skuAvailable === true ||
      (item.skuAvailable === undefined && item.available !== false),
    minOrderQty: Number(snapshot.minOrderQty || 1),
    stockNum: stock,
    boundsKnown: Number.isSafeInteger(stock) && stock >= 0,
    unavailableReason: item.unavailableReason || ''
  }
}

module.exports = { presentCartItem }
