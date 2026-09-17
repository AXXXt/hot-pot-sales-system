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

function setCartItems(cartItems) {
  state.cartItems = Array.isArray(cartItems) ? cartItems : []
  persist()
}

function addItem(item) {
  const itemBrandId = getItemBrandId(item)
  const targetIndex = state.cartItems.findIndex((current) => current.productId === item.productId && current.skuId === item.skuId)
  if (targetIndex >= 0) {
    state.cartItems[targetIndex].quantity = Number(state.cartItems[targetIndex].quantity || 0) + Number(item.quantity || 0)
    state.cartItems[targetIndex].brandId = itemBrandId || getItemBrandId(state.cartItems[targetIndex])
    state.cartItems[targetIndex].snapshot = item.snapshot || state.cartItems[targetIndex].snapshot
    state.cartItems[targetIndex].available = true
    state.cartItems[targetIndex].unavailableReason = ''
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
  const next = state.cartItems.map((item) => {
    if (item.productId === productId && item.skuId === skuId) {
      return { ...item, quantity }
    }
    return item
  })
  state.cartItems = next.filter((item) => Number(item.quantity) > 0)
  persist()
}

function getCount() {
  return availableQuantity(state.cartItems)
}

function applyValidation(result) {
  const validItems = Array.isArray(result && result.items) ? result.items : []
  const invalidIds = new Set((result && result.invalidSkuIds || []).map(Number))
  const validationBySku = new Map(validItems.map(item => [Number(item.skuId), item]))

  state.cartItems = state.cartItems.map((item) => {
    const validated = validationBySku.get(Number(item.skuId))
    if (!validated) {
      return {
        ...item,
        available: false,
        unavailableReason: invalidIds.has(Number(item.skuId))
          ? '商品已下架或不在当前可见范围'
          : '商品暂不可购买'
      }
    }

    return {
      ...item,
      productId: validated.productId,
      brandId: normalizeBrandId(validated.brandId) || getItemBrandId(item),
      available: validated.available !== false,
      unavailableReason: validated.unavailableReason || '',
      snapshot: {
        ...(item.snapshot || {}),
        brandId: normalizeBrandId(validated.brandId) || getItemBrandId(item),
        brandText: validated.brandName || item.snapshot?.brandText || '',
        name: validated.name,
        spec: validated.spec,
        price: validated.price,
        priceUnit: validated.unit,
        stockNum: validated.stockNum,
        minOrderQty: validated.minOrderQty
      }
    }
  })
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
