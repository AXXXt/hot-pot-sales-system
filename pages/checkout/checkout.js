const cart = require('../../store/modules/cart')
const auth = require('../../store/modules/auth')
const { createOrder, submitOrder } = require('../../services/api/order')
const { getSubscribeTemplate } = require('../../services/api/auth')
const { validateCart } = require('../../services/api/product')

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
    this.refreshCart(true)
  },

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
      wx.showToast({ title: '购物车为空', icon: 'none' })
      setTimeout(() => wx.navigateBack(), 1500)
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
        content: '部分商品已下架、售罄或不在当前可见范围，请返回购物车移除后再结算。',
        showCancel: false,
        success: () => wx.navigateBack()
      })
    } else {
      wx.showToast({ title: '请先移除不可购买商品', icon: 'none' })
    }
    return false
  },

  onRemarkInput(e) {
    this.setData({ remark: e.detail.value })
  },

  async createBrandOrder(group, customerId) {
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

    let submitted = true
    try {
      await submitOrder(order.id)
    } catch {
      submitted = false
    }
    cart.removeItemsBySkuIds(group.items.map(item => item.skuId))
    return { order, submitted, brandText: group.brandText }
  },

  async onSubmit() {
    if (this.data.submitting || this.data.validating) return
    if (!auth.state.token) {
      wx.navigateTo({ url: '/pages/login/login' })
      return
    }

    const customerId = auth.state.customer?.id
    if (!customerId) {
      wx.showToast({ title: '未能获取客户信息，请重新登录', icon: 'none' })
      return
    }

    const cartIsValid = await this.refreshCart(false)
    if (!cartIsValid) return

    const groups = cart.getCheckoutGroups()
    if (!groups.length) {
      wx.showToast({ title: '购物车为空', icon: 'none' })
      return
    }

    this.setData({ submitting: true })
    const created = []
    const failures = []
    try {
      for (const group of groups) {
        try {
          created.push(await this.createBrandOrder(group, customerId))
        } catch (error) {
          failures.push({
            brandText: group.brandText || '部分商品',
            message: error?.message || error?.data?.message || '下单失败'
          })
        }
      }
      this.renderCart()
      this.showOrderCreated(created, failures)
    } finally {
      this.setData({ submitting: false })
    }
  },

  async requestSubscribe() {
    try {
      const res = await getSubscribeTemplate()
      const templateId = res && res.data && res.data.templateId
      if (!templateId) return
      wx.requestSubscribeMessage({
        tmplIds: [templateId],
        success: () => {},
        fail: () => {}
      })
    } catch (e) { /* 订阅失败不影响下单 */ }
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
      wx.showModal({
        title: '订单处理结果',
        content: notes.join(''),
        showCancel: false,
        confirmText: '查看订单',
        success: () => this.switchToOrders(created)
      })
      return
    }

    this.requestSubscribe()
    wx.showToast({
      title: created.length > 1 ? `已创建${created.length}个订单` : '下单成功',
      icon: 'success'
    })
    setTimeout(() => this.switchToOrders(created), 800)
  },

  switchToOrders(created, showFailureDialog = true) {
    wx.switchTab({
      url: '/pages/orders/orders',
      fail: () => {
        if (!showFailureDialog) {
          wx.showToast({ title: '订单已创建，请从订单页查看', icon: 'none', duration: 2500 })
          return
        }
        const firstOrder = created[0]?.order
        const orderLabel = created.length > 1
          ? `${created.length} 个订单`
          : (firstOrder?.orderNo || ('#' + firstOrder?.id))
        wx.showModal({
          title: '订单已创建',
          content: `${orderLabel} 已创建成功，但订单页跳转失败。请勿重复提交，可点击重试或稍后从“订单”进入。`,
          confirmText: '重试跳转',
          cancelText: '留在此页',
          success: (res) => {
            if (res.confirm) this.switchToOrders(created, false)
          }
        })
      }
    })
  }
})
