const cart = require('../../../store/modules/cart')
const auth = require('../../../store/modules/auth')
const { validateCart } = require('../../../services/api/product')

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
    checkoutDisabled: true
  },

  observers: {
    'visible': function (val) {
      if (val) {
        this.loadCart()
        this.setData({ animating: true })
      } else {
        this.setData({ animating: false })
      }
    }
  },

  methods: {
    async loadCart() {
      const skuIds = (cart.state.cartItems || []).map(item => Number(item.skuId)).filter(Boolean)
      if (auth.state.token && skuIds.length) {
        this.setData({ validationLoading: true, checkoutDisabled: true })
        try {
          const response = await validateCart([...new Set(skuIds)])
          cart.applyValidation(response && response.data ? response.data : response)
        } catch (error) {
          wx.showToast({ title: (error && error.message) || '购物车校验失败', icon: 'none' })
        } finally {
          this.setData({ validationLoading: false })
        }
      }
      this.renderCart()
    },

    renderCart() {
      const items = (cart.state.cartItems || []).map(item => ({
        productId: item.productId,
        skuId: item.skuId,
        name: item.snapshot && item.snapshot.name || '商品',
        spec: item.snapshot && item.snapshot.spec || '',
        price: Number(item.snapshot && item.snapshot.price || 0),
        unit: item.snapshot && item.snapshot.priceUnit || '',
        quantity: Number(item.quantity || 0),
        amount: (Number(item.snapshot && item.snapshot.price || 0) * Number(item.quantity || 0)).toFixed(2),
        priceText: Number(item.snapshot && item.snapshot.price || 0).toFixed(2),
        available: item.available !== false,
        unavailableReason: item.unavailableReason || ''
      }))

      const total = items.reduce(function (sum, item) {
        return item.available ? sum + Number(item.amount) : sum
      }, 0)

      this.setData({
        items: items,
        totalAmount: total.toFixed(2),
        isEmpty: items.length === 0,
        hasInvalid: items.some(item => !item.available),
        validCount: items.filter(item => item.available).length,
        checkoutDisabled: items.length === 0 || items.some(item => !item.available)
      })
    },

    onClose() {
      this.triggerEvent('close')
    },

    onOverlayTap() {
      this.triggerEvent('close')
    },

    onIncrease(e) {
      var index = e.currentTarget.dataset.index
      var item = this.data.items[index]
      if (!item || !item.available) return
      cart.updateQuantity({ productId: item.productId, skuId: item.skuId, quantity: item.quantity + 1 })
      this.renderCart()
      this.triggerEvent('change', { count: cart.getCount() })
    },

    onDecrease(e) {
      var index = e.currentTarget.dataset.index
      var item = this.data.items[index]
      if (!item) return
      if (item.quantity <= 1) {
        var that = this
        wx.showModal({
          title: '移除商品',
          content: '确定要移除此商品吗？',
          success: function (res) {
            if (res.confirm) {
              cart.updateQuantity({ productId: item.productId, skuId: item.skuId, quantity: 0 })
              that.renderCart()
              that.triggerEvent('change', { count: cart.getCount() })
            }
          }
        })
        return
      }
      cart.updateQuantity({ productId: item.productId, skuId: item.skuId, quantity: item.quantity - 1 })
      this.renderCart()
      this.triggerEvent('change', { count: cart.getCount() })
    },

    onRemove(e) {
      var index = e.currentTarget.dataset.index
      var item = this.data.items[index]
      if (!item) return
      cart.updateQuantity({ productId: item.productId, skuId: item.skuId, quantity: 0 })
      this.renderCart()
      this.triggerEvent('change', { count: cart.getCount() })
    },

    onCheckout() {
      if (!auth.state.token) {
        wx.navigateTo({ url: '/pages/login/login' })
        return
      }
      if (this.data.validationLoading) return
      if (this.data.hasInvalid) {
        wx.showToast({ title: '请先移除不可购买商品', icon: 'none' })
        return
      }
      if (this.data.validCount === 0) {
        wx.showToast({ title: '购物车为空', icon: 'none' })
        return
      }
      this.triggerEvent('close')
      wx.navigateTo({ url: '/pages/checkout/checkout' })
    },

    onGoShop() {
      this.triggerEvent('close')
      wx.switchTab({ url: '/pages/home/home' })
    },

    preventBubble() {
      // prevents tap from closing via overlay
    }
  }
})
