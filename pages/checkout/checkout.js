// 按品牌提交采购订单，可在提交时集中订阅关键提醒；拒绝订阅不阻断采购。
const cart = require('../../store/modules/cart')
const auth = require('../../store/modules/auth')
const { captureSession, isCurrentSession } = require('../../utils/auth-session')
const { createOrder, submitOrder } = require('../../services/api/order')
const { validateCart } = require('../../services/api/product')
const { requestOrderReminders } = require('../../services/order-reminders')

function isNativeCancellation(error) {
  return typeof error?.errMsg === 'string' && /(?:^|\s)cancel(?:led|ed)?(?:\s|$)/i.test(error.errMsg)
}

function showCreatedOrderHint() {
  try { wx.showToast({ title: '订单已创建，请从底部订单查看', icon: 'none', duration: 3000 }) } catch { /* Navigation can still recover when the native toast is unavailable. */ }
}

function mapCheckoutItem(item) {
  const price = Number(item.snapshot?.price || 0)
  const quantity = Number(item.quantity || 0)
  return {
    productId: item.productId,
    skuId: item.skuId,
    name: item.snapshot?.name || '商品',
    spec: item.snapshot?.spec || '',
    price,
    unit: item.snapshot?.priceUnit || '',
    quantity,
    amount: (price * quantity).toFixed(2)
  }
}

function mapCheckoutGroup(group, index) {
  const items = group.items.map(mapCheckoutItem)
  const subtotal = items.reduce((sum, item) => sum + Number(item.amount), 0)
  return {
    brandId: group.brandId || `unknown-${index}`,
    brandText: group.brandText || '品牌待确认',
    items,
    subtotal: subtotal.toFixed(2)
  }
}

Page({
  data: {
    brandGroups: [],
    totalAmount: '0.00',
    orderCount: 0,
    remark: '',
    submitting: false,
    customerName: '',
    isEmpty: true,
    validating: true
  },

  onLoad() {
    this._active = true
    this.refreshCart(true)
  },

  onUnload() { this._active = false },

  renderCart() {
    const brandGroups = cart.getCheckoutGroups().map(mapCheckoutGroup)
    const total = brandGroups.reduce((sum, group) => sum + Number(group.subtotal), 0)
    this.setData({
      brandGroups,
      totalAmount: total.toFixed(2),
      orderCount: brandGroups.length,
      isEmpty: brandGroups.length === 0,
      validating: false,
      customerName: auth.state.customer?.customerName || '客户'
    })
  },

  async refreshCart(showInvalidDialog) {
    const allItems = cart.state.cartItems || []
    const skuIds = allItems.map(item => Number(item.skuId)).filter(Boolean)
    if (!skuIds.length) {
      this.renderCart()
      return false
    }

    this.setData({ validating: true })
    try {
      const response = await validateCart([...new Set(skuIds)])
      cart.applyValidation(response && response.data ? response.data : response)
    } catch (error) {
      this.setData({ validating: false })
      wx.showToast({ title: error?.message || '购物车校验失败', icon: 'none' })
      return false
    }

    const hasInvalid = cart.state.cartItems.some(item => item.available === false)
    this.renderCart()
    if (!hasInvalid) return true

    if (showInvalidDialog) {
      wx.showModal({
        title: '购物车需要更新',
        content: '部分商品状态或数量已变化，请返回进货单查看提示并调整后再结算。',
        showCancel: false,
        confirmText: '返回调整',
        success: () => wx.navigateBack()
      })
    } else {
      wx.showToast({ title: '请先调整进货单商品及数量', icon: 'none' })
    }
    return false
  },

  onRemarkInput(e) {
    this.setData({ remark: e.detail.value })
  },

  onGoShop() {
    wx.switchTab({ url: '/pages/category/category' })
  },

  async createBrandOrder(group, customerId, session) {
    const createRes = await createOrder({
      customerId,
      items: group.items.map(item => ({
        skuId: Number(item.skuId),
        quantity: Number(item.quantity)
      })),
      remark: this.data.remark || undefined
    })
    const order = createRes?.data || createRes
    if (!order?.id) throw new Error('订单创建失败')
    if (!this._active || !isCurrentSession(auth, session)) {
      return { order, submitted: false, brandText: group.brandText }
    }

    let submitted = true
    try {
      await submitOrder(order.id)
    } catch {
      submitted = false
    }
    if (this._active && isCurrentSession(auth, session)) {
      cart.removeItemsBySkuIds(group.items.map(item => item.skuId))
    }
    return { order, submitted, brandText: group.brandText }
  },

  onSubmit() { return this.submit() },

  async submit() {
    if (this.data.submitting || this.data.validating || this.data.isEmpty || !this._active) return
    if (!auth.state.token) {
      wx.navigateTo({ url: '/pages/login/login' })
      return
    }

    const customerId = auth.state.customer?.id
    if (!customerId) {
      wx.showToast({ title: '未能获取客户信息，请重新登录', icon: 'none' })
      return
    }

    const session = captureSession(auth)
    this.setData({ submitting: true })
    const created = []
    const failures = []
    try {
      // 不能先等待购物车请求或订单创建完成，否则会失去微信要求的点击上下文。
      await requestOrderReminders(this)
      if (!this._active || !isCurrentSession(auth, session)) return
      const cartIsValid = await this.refreshCart(false)
      if (!cartIsValid || !this._active || !isCurrentSession(auth, session)) return
      const groups = cart.getCheckoutGroups()
      if (!groups.length) return
      for (const group of groups) {
        if (!this._active || !isCurrentSession(auth, session)) break
        try {
          created.push(await this.createBrandOrder(group, customerId, session))
        } catch (error) {
          failures.push({
            brandText: group.brandText || '部分商品',
            message: error?.message || error?.data?.message || '下单失败'
          })
        }
      }
      if (!this._active || !isCurrentSession(auth, session)) return
      this.renderCart()
      this.showOrderCreated(created, failures)
    } finally {
      if (this._active) this.setData({ submitting: false })
    }
  },

  showOrderCreated(created, failures) {
    if (!created.length) {
      wx.showToast({
        title: failures[0]?.message || '下单失败，请重试',
        icon: 'none',
        duration: 2500
      })
      return
    }

    const draftCount = created.filter(result => !result.submitted).length
    if (failures.length || draftCount) {
      const notes = [`已创建 ${created.length} 个品牌订单。`]
      if (draftCount) notes.push(`其中 ${draftCount} 个暂存为草稿，可在订单页继续提交。`)
      if (failures.length) notes.push(`${failures.length} 个品牌下单失败，商品仍保留在购物车。`)
      notes.push('请勿重复提交已创建的订单。')
      const recover = error => {
        if (isNativeCancellation(error)) return
        showCreatedOrderHint()
        this.switchToOrders(created, false)
      }
      try {
        wx.showModal({
          title: '订单处理结果',
          content: notes.join(''),
          showCancel: false,
          confirmText: '查看订单',
          success: res => { if (res?.confirm) this.switchToOrders(created) },
          fail: recover
        })
      } catch { recover() }
      return
    }

    wx.showToast({
      title: created.length > 1 ? `已创建${created.length}个订单` : '下单成功',
      icon: 'success'
    })
    setTimeout(() => this.switchToOrders(created), 800)
  },

  switchToOrders(created, showFailureDialog = true) {
    const failed = error => {
      if (isNativeCancellation(error)) return
      if (!showFailureDialog) { showCreatedOrderHint(); return }
      const firstOrder = created[0]?.order
      const orderLabel = created.length > 1
        ? `${created.length} 个订单`
        : (firstOrder?.orderNo || ('#' + firstOrder?.id))
      const unavailable = error => { if (!isNativeCancellation(error)) showCreatedOrderHint() }
      try {
        wx.showModal({
          title: '订单已创建',
          content: `${orderLabel} 已创建成功，但订单页跳转失败。请勿重复提交，可点击重试或稍后从“订单”进入。`,
          confirmText: '重试跳转',
          cancelText: '留在此页',
          success: (res) => {
            if (res?.confirm) this.switchToOrders(created, false)
          },
          fail: unavailable
        })
      } catch { unavailable() }
    }
    try { wx.switchTab({ url: '/pages/orders/orders', fail: failed }) }
    catch { failed() }
  }
})
