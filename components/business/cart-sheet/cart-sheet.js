// 商品详情浮层进货单；可购状态与数量错误统一由cart store核对，保留用户所选数量。
const cart = require('../../../store/modules/cart')
const auth = require('../../../store/modules/auth')
const { validateCart } = require('../../../services/api/product')
const { captureSession, isCurrentSession } = require('../../../utils/auth-session')
const { presentCartItem } = require('../../../utils/cart-presentation')

function cartKey() {
  return (cart.state.cartItems || []).map(item => String(item.skuId)).sort().join(',')
}

Component({
  properties: {
    visible: {
      type: Boolean,
      value: false
    }
  },

  data: {
    items: [],
    totalAmount: '0.00',
    isEmpty: true,
    animating: false,
    validationLoading: false,
    hasInvalid: false,
    validCount: 0,
    validated: false,
    validationError: '',
    needsValidation: true,
    loggedIn: false,
    hasQuantityInvalid: false,
    checkoutDisabled: true
  },

  lifetimes: {
    attached() { this._attached = true; this._pageActive = true },
    detached() { this._attached = false; this._open = false; this.invalidateValidation() }
  },

  pageLifetimes: {
    show() {
      const returning = this._pageActive === false
      this._pageActive = true
      if (returning && this._open) {
        this.setData({ animating: true })
        this.loadCart()
      }
    },
    hide() { this._pageActive = false; this.invalidateValidation() }
  },

  observers: {
    'visible': function (val) {
      this._open = Boolean(val)
      if (val) {
        this.setData({ animating: true })
        return this.loadCart()
      }
      this.invalidateValidation()
    }
  },

  methods: {
    isOpen() {
      return this._open === true && this._attached !== false && this._pageActive !== false
    },

    invalidateValidation() {
      this._loadVersion = (this._loadVersion || 0) + 1
      this._validatedSession = null
      if (this._attached !== false) this.setData({ animating: false,
        validationLoading: false, validated: false, checkoutDisabled: true })
    },

    async loadCart() {
      if (!this.isOpen()) return false
      const version = this._loadVersion = (this._loadVersion || 0) + 1
      const session = captureSession(auth), key = cartKey()
      this._loadSession = session
      this._validatedSession = null
      const skuIds = (cart.state.cartItems || []).map(item => Number(item.skuId)).filter(Boolean)
      this.setData({ validationLoading: Boolean(auth.state.token && skuIds.length),
        validated: false, validationError: '', checkoutDisabled: true })
      this.renderCart()
      if (!auth.state.token || !skuIds.length) return false
      try {
        const response = await validateCart([...new Set(skuIds)])
        if (!this.isOpen() || version !== this._loadVersion) return false
        if (!isCurrentSession(auth, session) || key !== cartKey()) throw new Error('context changed')
        cart.applyValidation(response && response.data ? response.data : response)
        this._validatedSession = session
        this._validatedKey = key
        this.setData({ validated: true })
        return true
      } catch (_) {
        if (!this.isOpen() || version !== this._loadVersion) return false
        const message = !isCurrentSession(auth, session)
          ? '登录状态已变化，请重新校验' : '商品信息校验失败，请重试'
        this.setData({ validationError: message, validated: false })
        wx.showToast({ title: message, icon: 'none' })
        return false
      } finally {
        if (this.isOpen() && version === this._loadVersion) {
          this.setData({ validationLoading: false })
          this.renderCart()
        }
      }
    },

    onRetryValidation() { if (!this.data.validationLoading) return this.loadCart() },

    renderCart() {
      const items = (cart.state.cartItems || []).map(presentCartItem)
      const availableItems = items.filter(item => item.available)
      const total = availableItems.reduce((sum, item) => (
        Number.isFinite(Number(item.amount)) ? sum + Number(item.amount) : sum
      ), 0)
      const hasInvalid = availableItems.length !== items.length
      const needsValidation = !this.data.validated || items.some(item => !item.validationKnown) ||
        !isCurrentSession(auth, this._validatedSession) || this._validatedKey !== cartKey()

      this.setData({
        items,
        totalAmount: total.toFixed(2),
        isEmpty: items.length === 0,
        loggedIn: Boolean(auth.state.token),
        needsValidation,
        hasInvalid,
        hasQuantityInvalid: items.some(item => item.quantityInvalid),
        validCount: availableItems.length,
        checkoutDisabled: items.length === 0 || hasInvalid || this.data.validationLoading ||
          Boolean(this.data.validationError) || needsValidation
      })
    },

    onClose() {
      this._open = false
      this.invalidateValidation()
      this.triggerEvent('close')
    },

    onOverlayTap() {
      this.onClose()
    },

    canChangeItems() {
      return this.isOpen() && !this.data.validationLoading &&
        isCurrentSession(auth, this._loadSession)
    },

    onIncrease(e) {
      const { index } = e.currentTarget.dataset
      const item = this.data.items[index]
      if (!item || !item.canAdjust || !this.canChangeItems()) return
      if (!Number.isSafeInteger(item.stockNum) || !Number.isSafeInteger(item.minOrderQty) ||
        item.minOrderQty < 1) {
        wx.showToast({ title: '请先重新校验库存', icon: 'none' }); return
      }
      const quantity = Math.max(item.minOrderQty, Number.isFinite(item.quantity)
        ? Math.floor(item.quantity) + 1 : item.minOrderQty)
      if (quantity > item.stockNum) {
        wx.showToast({ title: `当前可用库存${item.stockNum}${item.unit}`, icon: 'none' }); return
      }
      cart.updateQuantity({ productId: item.productId, skuId: item.skuId, quantity })
      this.renderCart()
      this.triggerEvent('change', { count: cart.getCount() })
    },

    onDecrease(e) {
      const { index } = e.currentTarget.dataset
      const item = this.data.items[index]
      if (!item || !this.canChangeItems()) return
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
        wx.showToast({ title: `${item.minOrderQty}${item.unit}起订，可移除此商品`, icon: 'none' }); return
      }
      cart.updateQuantity({ productId: item.productId, skuId: item.skuId,
        quantity: Math.ceil(item.quantity) - 1 })
      this.renderCart()
      this.triggerEvent('change', { count: cart.getCount() })
    },

    onRemove(e) {
      const { index } = e.currentTarget.dataset
      const item = this.data.items[index]
      if (!item || !this.canChangeItems()) return
      this.removeItem(item)
    },

    removeItem(item) {
      cart.updateQuantity({ productId: item.productId, skuId: item.skuId, quantity: 0 })
      this.triggerEvent('change', { count: cart.getCount() })
      return this.loadCart()
    },

    confirmRemove(item) {
      const session = captureSession(auth), version = this._loadVersion
      wx.showModal({ title: '移除商品', content: '确定要移除此商品吗？', success: result => {
        if (result.confirm && this.canChangeItems() && version === this._loadVersion &&
          isCurrentSession(auth, session)) this.removeItem(item)
      } })
    },

    onCheckout() {
      if (!this.isOpen() || this.data.validationLoading) return
      if (!auth.state.token) {
        wx.navigateTo({ url: '/pages/login/login' })
        return
      }
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
      this.onClose()
      wx.navigateTo({ url: '/pages/checkout/checkout' })
    },

    onGoShop() {
      this.onClose()
      wx.switchTab({ url: '/pages/home/home' })
    },

    preventBubble() {
      // prevents tap from closing via overlay
    }
  }
})
