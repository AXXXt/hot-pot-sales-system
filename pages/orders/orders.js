const { getOrderList, getOrderDetail } = require('../../services/api/order')
const { validateCart } = require('../../services/api/product')
const auth = require('../../store/modules/auth')
const cart = require('../../store/modules/cart')

const STATUS_MAP = {
  draft: { text: '草稿', variant: 'info' },
  pending_quote: { text: '待报价', variant: 'warning' },
  pending_confirm: { text: '待确认', variant: 'warning' },
  pending_finance: { text: '待审核', variant: 'warning' },
  pending_shipment: { text: '待发货', variant: 'primary' },
  shipped: { text: '已发货', variant: 'primary' },
  completed: { text: '已完成', variant: 'success' },
  cancelled: { text: '已取消', variant: 'info' }
}

Page({
  data: {
    loading: true,
    activeStatus: 'all',
    statuses: [
      { id: 'all', label: '全部' },
      { id: 'pending', label: '进行中' },
      { id: 'completed', label: '已完成' },
      { id: 'cancelled', label: '已取消' }
    ],
    orders: [],
    error: '',
    repeatBuying: false
  },

  onShow() {
    if (!auth.state.token) {
      this.setData({ loading: false, error: '请先登录' })
      return
    }
    this.loadOrders()
  },

  onPullDownRefresh() {
    this.loadOrders().finally(() => wx.stopPullDownRefresh())
  },

  async loadOrders() {
    this.setData({ loading: true, error: '' })

    try {
      const params = { page: 1, pageSize: 50 }

      if (this.data.activeStatus === 'pending') {
        // Show all non-terminal statuses
      } else if (this.data.activeStatus !== 'all') {
        params.status = this.data.activeStatus
      }

      const res = await getOrderList(params)
      const data = res?.data || {}
      const items = (data.items || []).map(order => ({
        id: order.id,
        orderNo: order.orderNo,
        timeText: this.formatTime(order.createdAt),
        statusText: STATUS_MAP[order.status]?.text || order.status,
        statusVariant: STATUS_MAP[order.status]?.variant || 'info',
        status: order.status,
        summaryText: this.formatSummary(order),
        amountText: '¥' + Number(order.payableAmount || order.totalAmount || 0).toFixed(2),
        actions: this.getActions(order)
      }))

      // Filter pending statuses on client side
      let filtered = items
      if (this.data.activeStatus === 'pending') {
        filtered = items.filter(o =>
          !['completed', 'cancelled'].includes(o.status)
        )
      }

      this.setData({ orders: filtered, loading: false })

    } catch (err) {
      this.setData({
        loading: false,
        error: err?.message || '加载失败'
      })
    }
  },

  formatTime(dateStr) {
    if (!dateStr) return ''
    const d = new Date(dateStr)
    const pad = n => String(n).padStart(2, '0')
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`
  },

  formatSummary(order) {
    const items = order.items || []
    const fallbackCount = items.reduce((sum, item) => sum + Number(item.quantity || 0), 0)
    const count = Number.isFinite(Number(order.itemCount))
      ? Number(order.itemCount)
      : fallbackCount
    const names = Array.isArray(order.productNames)
      ? order.productNames.filter(Boolean).slice(0, 2)
      : items.slice(0, 2).map(item => item.productName || item.skuName).filter(Boolean)
    let text = `共 ${count} 件`
    if (names.length) text = names.join('、') + ' ' + text
    return text
  },

  getActions(order) {
    const s = order.status
    if (s === 'completed') return [{ id: 'repeat', label: '再次购买' }]
    if (s === 'cancelled') return []
    return []
  },

  onStatusChange(e) {
    const activeStatus = e.detail?.activeId || e.detail
    this.setData({ activeStatus })
    this.loadOrders()
  },

  onOrderTap(e) {
    const id = e.currentTarget.dataset.id
    if (id) {
      wx.navigateTo({ url: `/pages/order-detail/order-detail?id=${id}` })
    }
  },

  async onOrderAction(e) {
    if (e.detail?.id !== 'repeat' || this.data.repeatBuying) return
    const orderId = Number(e.currentTarget.dataset.id)
    if (!orderId) return

    this.setData({ repeatBuying: true })
    wx.showLoading({ title: '正在加入', mask: true })
    try {
      const detailRes = await getOrderDetail(orderId)
      const order = detailRes?.data || detailRes
      const orderItems = Array.isArray(order?.items) ? order.items : []
      if (!orderItems.length) throw new Error('订单中没有可再次购买的商品')

      const skuIds = [...new Set(orderItems.map(item => Number(item.skuId)).filter(Boolean))]
      const validationRes = await validateCart(skuIds)
      const validation = validationRes?.data || validationRes || {}
      const brandId = Number(order.brandId || validation.items?.[0]?.brandId || 0)

      if (this.hasDifferentCartBrand(brandId)) {
        wx.hideLoading()
        const confirmed = await this.confirmReplaceCart()
        if (!confirmed) return
        cart.setCartItems([])
        wx.showLoading({ title: '正在加入', mask: true })
      }

      const result = this.buildRepeatItems(orderItems, validation)
      if (!result.items.length) {
        throw new Error('商品已下架、售罄或库存不足')
      }
      for (const item of result.items) {
        const addResult = cart.addItem(item)
        if (!addResult.added) throw new Error('购物车中存在其他品牌商品')
      }

      wx.hideLoading()
      if (result.skipped || result.adjusted) {
        wx.showModal({
          title: '已加入购物车',
          content: `已加入 ${result.items.length} 个商品规格；${result.skipped} 个不可购买，${result.adjusted} 个按当前库存调整数量。`,
          showCancel: false
        })
      } else {
        wx.showToast({ title: '已加入购物车', icon: 'success' })
      }
    } catch (err) {
      wx.hideLoading()
      wx.showToast({ title: err?.message || '再次购买失败', icon: 'none', duration: 2500 })
    } finally {
      this.setData({ repeatBuying: false })
    }
  },

  hasDifferentCartBrand(brandId) {
    if (!brandId) return false
    return cart.state.cartItems.some(item => {
      const currentBrandId = Number(item.brandId || item.snapshot?.brandId || 0)
      return currentBrandId && currentBrandId !== brandId
    })
  },

  confirmReplaceCart() {
    return new Promise((resolve) => {
      wx.showModal({
        title: '购物车已有其他品牌',
        content: '一个订单只能包含同一品牌商品。是否清空购物车并加入本订单商品？',
        confirmText: '清空并加入',
        success: (res) => resolve(Boolean(res.confirm)),
        fail: () => resolve(false)
      })
    })
  },

  buildRepeatItems(orderItems, validation) {
    const validationMap = new Map((validation.items || []).map(item => [Number(item.skuId), item]))
    let skipped = (validation.invalidSkuIds || []).length
    let adjusted = 0
    const items = []

    for (const orderItem of orderItems) {
      const sku = validationMap.get(Number(orderItem.skuId))
      if (!sku || sku.available === false) {
        if (sku) skipped += 1
        continue
      }
      const existing = cart.state.cartItems.find(item => Number(item.skuId) === Number(orderItem.skuId))
      const existingQuantity = Number(existing?.quantity || 0)
      const minOrderQty = Number(sku.minOrderQty || 1)
      const stockNum = Number(sku.stockNum || 0)
      const requestedQuantity = Math.max(Number(orderItem.quantity || 0), minOrderQty)
      const quantity = Math.min(requestedQuantity, Math.max(stockNum - existingQuantity, 0))
      if (quantity <= 0 || (existingQuantity === 0 && quantity < minOrderQty)) {
        skipped += 1
        continue
      }
      if (quantity < requestedQuantity) adjusted += 1
      items.push({
        productId: Number(sku.productId || orderItem.productId),
        skuId: Number(sku.skuId),
        brandId: Number(sku.brandId || 0),
        quantity,
        snapshot: {
          brandId: Number(sku.brandId || 0),
          name: sku.name || orderItem.productName || '商品',
          spec: sku.spec || orderItem.skuSpecText || '',
          price: sku.price || orderItem.unitPrice || 0,
          priceUnit: sku.unit || orderItem.saleUnit || '',
          stockNum,
          minOrderQty
        }
      })
    }

    return { items, skipped, adjusted }
  },

  onGoShop() {
    wx.switchTab({ url: '/pages/home/home' })
  }
})
