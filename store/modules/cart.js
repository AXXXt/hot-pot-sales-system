// 进货单按最新规格范围核对数量；不自动改量或删除用户选中的商品。
const { setStorage, getStorage } = require('../../utils/storage')

const storedItems = getStorage('cartItems', [])
const rawItems = Array.isArray(storedItems) ? storedItems : []
function normalizeBrandId(value) {
  const brandId = Number(value)
  return Number.isInteger(brandId) && brandId > 0 ? brandId : null
}

function getItemBrandId(item) {
  return normalizeBrandId(item && (item.brandId ?? item.snapshot?.brandId))
}

function getBrandIds() {
  return [...new Set(state.cartItems.map(getItemBrandId).filter(Boolean))]
}

function availableQuantity(items) {
  return items.reduce((total, item) => (
    item.available === false ? total : total + Number(item.quantity || 0)
  ), 0)
}

const state = {
  cartItems: rawItems,
  cartCount: availableQuantity(rawItems)
}

function persist() {
  state.cartCount = availableQuantity(state.cartItems)
  setStorage('cartItems', state.cartItems)
}

function withQuantityStatus(item) {
  if (typeof item.skuAvailable !== 'boolean') return item
  if (!item.skuAvailable) return {
    ...item, available: false, quantityError: '', unavailableReason: item.skuUnavailableReason
  }
  const quantity = Number(item.quantity)
  const snapshot = item.snapshot || {}
  const minOrderQty = Number(snapshot.minOrderQty)
  const stockNum = Number(snapshot.stockNum)
  let quantityError = ''
  if (!Number.isSafeInteger(quantity) || quantity < 1) quantityError = '请调整为有效的整数数量'
  else if (quantity < minOrderQty) {
    quantityError = `${minOrderQty}${snapshot.priceUnit || '件'}起订，请增加数量`
  } else if (quantity > stockNum) {
    quantityError = `当前可用库存${stockNum}${snapshot.priceUnit || '件'}，请减少数量`
  }
  return {
    ...item,
    quantityError,
    available: !quantityError,
    unavailableReason: quantityError
  }
}

function setCartItems(cartItems) {
  state.cartItems = Array.isArray(cartItems) ? cartItems.map(withQuantityStatus) : []
  persist()
}

function addItem(item) {
  const itemBrandId = getItemBrandId(item)
  const existingItem = state.cartItems.find(current => (
    Number(current.productId) === Number(item.productId) &&
    Number(current.skuId) === Number(item.skuId)
  ))
  if (existingItem) {
    existingItem.quantity = Number(existingItem.quantity || 0) + Number(item.quantity || 0)
    existingItem.brandId = itemBrandId || getItemBrandId(existingItem)
    existingItem.snapshot = item.snapshot || existingItem.snapshot
    existingItem.available = true
    existingItem.unavailableReason = ''
    delete existingItem.skuAvailable
    delete existingItem.skuUnavailableReason
    delete existingItem.quantityError
  } else {
    state.cartItems = [
      ...state.cartItems,
      {
        productId: item.productId,
        skuId: item.skuId,
        brandId: itemBrandId,
        quantity: Number(item.quantity || 0),
        snapshot: item.snapshot || {},
        available: true,
        unavailableReason: ''
      }
    ]
  }
  persist()
  return { added: true }
}

function updateQuantity({ productId, skuId, quantity }) {
  quantity = Number(quantity)
  if (!Number.isSafeInteger(quantity) || quantity < 0) return
  const next = state.cartItems.map((item) => {
    if (Number(item.productId) === Number(productId) && Number(item.skuId) === Number(skuId)) {
      return withQuantityStatus({ ...item, quantity })
    }
    return item
  })
  state.cartItems = next.filter((item) => Number(item.quantity) > 0)
  persist()
}

function getCount() {
  return availableQuantity(state.cartItems)
}

function assertValidStockBounds(items) {
  for (const item of items) {
    const stockNum = Number(item.stockNum)
    const minOrderQty = Number(item.minOrderQty)
    if (item.stockNum == null || item.stockNum === '' ||
      !Number.isSafeInteger(stockNum) || stockNum < 0 ||
      item.minOrderQty == null || item.minOrderQty === '' ||
      !Number.isSafeInteger(minOrderQty) || minOrderQty < 1) {
      throw new Error('商品库存信息校验失败，请重试')
    }
  }
}

function applyItemValidation(item, validated, invalidIds) {
  if (!validated) {
    const unavailableReason = invalidIds.has(Number(item.skuId))
      ? '商品已下架或不在当前可见范围'
      : '商品暂不可购买'
    return {
      ...item,
      available: false,
      skuAvailable: false,
      quantityError: '',
      skuUnavailableReason: unavailableReason,
      unavailableReason
    }
  }

  const brandId = normalizeBrandId(validated.brandId) || getItemBrandId(item)
  return withQuantityStatus({
    ...item,
    productId: validated.productId,
    brandId,
    skuAvailable: validated.available !== false &&
      Number(validated.stockNum) >= Number(validated.minOrderQty),
    skuUnavailableReason: validated.unavailableReason || '当前库存不足起订量',
    snapshot: {
      ...(item.snapshot || {}),
      brandId,
      brandText: validated.brandName || item.snapshot?.brandText || '',
      name: validated.name,
      spec: validated.spec,
      price: validated.price,
      priceUnit: validated.unit,
      stockNum: validated.stockNum,
      minOrderQty: validated.minOrderQty
    }
  })
}

function applyValidation(result) {
  if (!Array.isArray(result && result.items)) throw new Error('商品校验结果无效，请重试')
  assertValidStockBounds(result.items)
  const invalidIds = new Set((Array.isArray(result.invalidSkuIds) ? result.invalidSkuIds : []).map(Number))
  const validationBySku = new Map(result.items.map(item => [Number(item.skuId), item]))
  state.cartItems = state.cartItems.map(item => (
    applyItemValidation(item, validationBySku.get(Number(item.skuId)), invalidIds)
  ))
  persist()
}

function getCheckoutItems() {
  return state.cartItems.filter(item => item.available !== false)
}

function getCheckoutGroups() {
  const groups = new Map()
  getCheckoutItems().forEach((item) => {
    const brandId = getItemBrandId(item)
    const groupKey = brandId ? String(brandId) : `sku-${item.skuId}`
    const current = groups.get(groupKey) || {
      brandId,
      brandText: item.snapshot?.brandText || '品牌待确认',
      items: []
    }
    current.items.push(item)
    groups.set(groupKey, current)
  })
  return [...groups.values()]
}

function removeItemsBySkuIds(skuIds) {
  const removedIds = new Set((skuIds || []).map(Number))
  state.cartItems = state.cartItems.filter(item => !removedIds.has(Number(item.skuId)))
  persist()
}

function hasMixedBrands() {
  return getBrandIds().length > 1
}

module.exports = {
  state,
  setCartItems,
  addItem,
  updateQuantity,
  applyValidation,
  getCheckoutItems,
  getCheckoutGroups,
  removeItemsBySkuIds,
  hasMixedBrands,
  getCount
}
