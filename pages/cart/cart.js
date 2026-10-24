// 进货单保留所选数量，校验库存与起订量后才允许结算。
const cart = require('../../store/modules/cart')
const auth = require('../../store/modules/auth')
const { validateCart } = require('../../services/api/product')
const { captureSession, isCurrentSession } = require('../../utils/auth-session')

function cartKey() {
  return (cart.state.cartItems || []).map(item => String(item.skuId)).sort().join(',')
}

function presentItem(item) {
  const quantity = Number(item.quantity), price = Number(item.snapshot?.price || 0)
  const amount = price * quantity, stock = Number(item.snapshot?.stockNum)
  return {
    productId: item.productId, skuId: item.skuId,
    name: item.snapshot?.name || '商品', spec: item.snapshot?.spec || '',
    price, unit: item.snapshot?.priceUnit || '', quantity,
    quantityText: Number.isSafeInteger(quantity) && quantity > 0 ? String(quantity) : '待调整',
    amount: Number.isFinite(amount) ? amount.toFixed(2) : '--',
    priceText: Number.isFinite(price) ? price.toFixed(2) : '--',
    brandText: item.snapshot?.brandText || '品牌待确认',
    brandId: item.brandId || item.snapshot?.brandId || null,
    available: item.available !== false,
    validationKnown: typeof item.skuAvailable === 'boolean',
    canAdjust: item.skuAvailable === true ||
      (item.skuAvailable === undefined && item.available !== false),
    quantityInvalid: Boolean(item.quantityError),
    minOrderQty: Number(item.snapshot?.minOrderQty || 1), stockNum: stock,
    boundsKnown: Number.isSafeInteger(stock) && stock >= 0,
    unavailableReason: item.unavailableReason || ''
  }
}

Page({
  data: {
    items: [],
    totalAmount: '0.00',
    isEmpty: true,
    loading: false,
    hasInvalid: false,
    hasMultipleBrands: false,
    validCount: 0,
    loggedIn: false,
    validated: false,
    validationError: '',
    hasQuantityInvalid: false,
    needsValidation: true,
    checkoutDisabled: true
  },

  onShow() {
    this._active = true
    return this.loadCart()
  },

  onHide() { this._active = false; this._loadVersion = (this._loadVersion || 0) + 1 },
  onUnload() { this.onHide() },

  async onPullDownRefresh() {
    await this.loadCart()
    wx.stopPullDownRefresh()
  },

  async loadCart() {
    if (this._active === false) return false
    const version = this._loadVersion = (this._loadVersion || 0) + 1
    const session = captureSession(auth), key = cartKey()
    const skuIds = (cart.state.cartItems || []).map(item => Number(item.skuId)).filter(Boolean)
    this._validatedSession = null
    this.setData({ loading: Boolean(auth.state.token && skuIds.length), validated: false,
      validationError: '', checkoutDisabled: true })
    this.renderCart()
    if (!auth.state.token || !skuIds.length) return false
    try {
      const response = await validateCart([...new Set(skuIds)])
      if (this._active === false || version !== this._loadVersion) return false
      if (!isCurrentSession(auth, session)) throw new Error('session changed')
      if (key !== cartKey()) throw new Error('cart changed')
      cart.applyValidation(response && response.data ? response.data : response)
      this._validatedSession = session
      this._validatedKey = key
      this.setData({ validated: true })
      return true
    } catch (_) {
      if (this._active === false || version !== this._loadVersion) return false
      const message = !isCurrentSession(auth, session)
        ? '登录状态已变化，请重新校验' : '商品信息校验失败，请重试'
      this.setData({ validationError: message, validated: false })
      wx.showToast({ title: message, icon: 'none' })
      return false
    } finally {
      if (this._active !== false && version === this._loadVersion) {
        this.setData({ loading: false })
        this.renderCart()
      }
    }
  },

  onRetryValidation() { if (!this.data.loading) return this.loadCart() },

  renderCart() {
    const items = (cart.state.cartItems || []).map(presentItem)
    const total = items.reduce((sum, item) => item.available && Number.isFinite(Number(item.amount))
      ? sum + Number(item.amount) : sum, 0)
    const brandIds = new Set(items.filter(item => item.available).map(item => item.brandId).filter(Boolean))
    const needsValidation = !this.data.validated || items.some(item => !item.validationKnown)

    this.setData({
      items,
      totalAmount: total.toFixed(2),
      isEmpty: items.length === 0,
      loggedIn: Boolean(auth.state.token),
      hasInvalid: items.some(item => !item.available),
      hasQuantityInvalid: items.some(item => item.quantityInvalid),
      needsValidation,
      hasMultipleBrands: brandIds.size > 1,
      validCount: items.filter(item => item.available).length,
      checkoutDisabled: items.length === 0 || items.some(item => !item.available) ||
        this.data.loading || Boolean(this.data.validationError) || needsValidation ||
        !isCurrentSession(auth, this._validatedSession) || this._validatedKey !== cartKey()
    })
  },

  onIncrease(e) {
    const { index } = e.currentTarget.dataset
    const items = this.data.items
    const item = items[index]
    if (!item || !item.canAdjust || this.data.loading) return
    if (!Number.isSafeInteger(item.stockNum) || !Number.isSafeInteger(item.minOrderQty) ||
      item.minOrderQty < 1) {
      wx.showToast({ title: '请先重新校验库存', icon: 'none' }); return
    }
    const nextQty = Math.max(item.minOrderQty, Number.isFinite(item.quantity)
      ? Math.floor(item.quantity) + 1 : item.minOrderQty)
    if (nextQty > item.stockNum) {
      wx.showToast({ title: `当前可用库存${item.stockNum}${item.unit}`, icon: 'none' }); return
    }
    cart.updateQuantity({ productId: item.productId, skuId: item.skuId, quantity: nextQty })
    this.renderCart()
  },

  onDecrease(e) {
    const { index } = e.currentTarget.dataset
    const items = this.data.items
    const item = items[index]
    if (!item || this.data.loading) return
    if (!Number.isSafeInteger(item.minOrderQty) || item.minOrderQty < 1) {
      wx.showToast({ title: '请先重新校验起订量', icon: 'none' }); return
    }
    if (!Number.isFinite(item.quantity)) {
      wx.showToast({ title: '数量异常，请用加号重新设置', icon: 'none' }); return
    }
    if (item.quantity <= 1) {
      this.confirmRemove(item)
      return
    }
    if (item.quantity - 1 < item.minOrderQty) {
      wx.showToast({ title: `${item.minOrderQty}${item.unit}起订，可删除此商品`, icon: 'none' }); return
    }
    cart.updateQuantity({ productId: item.productId, skuId: item.skuId,
      quantity: Math.ceil(item.quantity) - 1 })
    this.renderCart()
  },

  onRemove(e) {
    const { index } = e.currentTarget.dataset
    const item = this.data.items[index]
    if (!item) return
    this.confirmRemove(item)
  },

  confirmRemove(item) {
    const session = captureSession(auth), version = this._loadVersion
    wx.showModal({
      title: '移除商品',
      content: '确定要移除此商品吗？',
      success: (res) => {
        if (res.confirm && this._active !== false && version === this._loadVersion &&
          isCurrentSession(auth, session)) {
          cart.updateQuantity({ productId: item.productId, skuId: item.skuId, quantity: 0 })
          this.loadCart()
        }
      }
    })
  },

  onCheckout() {
    if (!auth.state.token) {
      wx.navigateTo({ url: '/pages/login/login?redirect=' + encodeURIComponent('/pages/cart/cart') })
      return
    }
    if (this._active === false || this.data.loading) return
    this.renderCart()
    if (this.data.validationError || this.data.needsValidation ||
      !isCurrentSession(auth, this._validatedSession) || this._validatedKey !== cartKey()) {
      wx.showToast({ title: '请先重新校验商品信息', icon: 'none' }); return
    }
    if (this.data.hasQuantityInvalid) {
      wx.showToast({ title: '请调整商品数量后再结算', icon: 'none' }); return
    }
    if (this.data.hasInvalid) {
      wx.showToast({ title: '请先移除不可购买商品', icon: 'none' })
      return
    }
    if (this.data.validCount === 0) {
      wx.showToast({ title: '购物车为空', icon: 'none' })
      return
    }
    wx.navigateTo({ url: '/pages/checkout/checkout' })
  },

  onGoShop() {
    wx.switchTab({ url: '/pages/home/home' })
  }
})
