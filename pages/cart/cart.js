const cart = require('../../store/modules/cart')
const auth = require('../../store/modules/auth')
const { validateCart } = require('../../services/api/product')

Page({
  data: {
    items: [],
    totalAmount: '0.00',
    isEmpty: true,
    loading: false,
    hasInvalid: false,
    hasMultipleBrands: false,
    validCount: 0,
    checkoutDisabled: true
  },

  onShow() {
    this.loadCart()
  },

  async onPullDownRefresh() {
    await this.loadCart()
    wx.stopPullDownRefresh()
  },

  async loadCart() {
    const skuIds = (cart.state.cartItems || []).map(item => Number(item.skuId)).filter(Boolean)
    if (auth.state.token && skuIds.length) {
      this.setData({ loading: true, checkoutDisabled: true })
      try {
        const response = await validateCart([...new Set(skuIds)])
        cart.applyValidation(response && response.data ? response.data : response)
      } catch (error) {
        wx.showToast({ title: (error && error.message) || '购物车校验失败', icon: 'none' })
      }
    }
    this.renderCart()
  },

  renderCart() {
    const items = (cart.state.cartItems || []).map(item => ({
      productId: item.productId,
      skuId: item.skuId,
      name: item.snapshot?.name || '商品',
      spec: item.snapshot?.spec || '',
      price: Number(item.snapshot?.price || 0),
      unit: item.snapshot?.priceUnit || '',
      quantity: Number(item.quantity || 0),
      amount: (Number(item.snapshot?.price || 0) * Number(item.quantity || 0)).toFixed(2),
      priceText: Number(item.snapshot?.price || 0).toFixed(2),
      brandText: item.snapshot?.brandText || '品牌待确认',
      brandId: item.brandId || item.snapshot?.brandId || null,
      available: item.available !== false,
      unavailableReason: item.unavailableReason || ''
    }))

    const total = items.reduce((sum, item) => item.available ? sum + Number(item.amount) : sum, 0)
    const brandIds = new Set(items.filter(item => item.available).map(item => item.brandId).filter(Boolean))

    this.setData({
      items,
      totalAmount: total.toFixed(2),
      isEmpty: items.length === 0,
      loading: false,
      hasInvalid: items.some(item => !item.available),
      hasMultipleBrands: brandIds.size > 1,
      validCount: items.filter(item => item.available).length,
      checkoutDisabled: items.length === 0 || items.some(item => !item.available)
    })
  },

  onIncrease(e) {
    const { index } = e.currentTarget.dataset
    const items = this.data.items
    const item = items[index]
    if (!item || !item.available) return
    const nextQty = item.quantity + 1
    cart.updateQuantity({ productId: item.productId, skuId: item.skuId, quantity: nextQty })
    this.renderCart()
  },

  onDecrease(e) {
    const { index } = e.currentTarget.dataset
    const items = this.data.items
    const item = items[index]
    if (!item) return
    if (item.quantity <= 1) {
      wx.showModal({
        title: '移除商品',
        content: '确定要移除此商品吗？',
        success: (res) => {
          if (res.confirm) {
            cart.updateQuantity({ productId: item.productId, skuId: item.skuId, quantity: 0 })
            this.renderCart()
          }
        }
      })
      return
    }
    cart.updateQuantity({ productId: item.productId, skuId: item.skuId, quantity: item.quantity - 1 })
    this.renderCart()
  },

  onRemove(e) {
    const { index } = e.currentTarget.dataset
    const item = this.data.items[index]
    if (!item) return
    wx.showModal({
      title: '移除商品',
      content: '确定要移除此商品吗？',
      success: (res) => {
        if (res.confirm) {
          cart.updateQuantity({ productId: item.productId, skuId: item.skuId, quantity: 0 })
          this.renderCart()
        }
      }
    })
  },

  onCheckout() {
    if (!auth.state.token) {
      wx.navigateTo({ url: '/pages/login/login?redirect=' + encodeURIComponent('/pages/cart/cart') })
      return
    }
    if (this.data.loading) return
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
