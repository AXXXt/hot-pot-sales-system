// 采购首页：真实客户账期、商品推荐与进货单入口。
const store = require('../../store/index')
const { getProductList } = require('../../services/api/product')
const { getProfile } = require('../../services/api/auth')
const cart = require('../../store/modules/cart')

function normProduct(p) {
  if (!p) return p
  return {
    ...p,
    brandText: p.brandText || '',
    image: p.image || '',
    price: p.price != null ? String(p.price) : '',
    priceUnit: p.priceUnit || '',
    spec: p.spec || '',
    statusText: p.stockText || '',
    statusVariant: p.statusVariant || 'default',
    subText: p.subText || '',
  }
}

Page({
  data: {
    loading: true,
    userInfo: {
      isLogin: false, levelName: '访客', companyName: '未登录',
      region: '', creditTotal: '0', creditDays: '0', creditRemaining: '0'
    },
    activeFeed: 'frequent',
    feedTabs: [
      { id: 'frequent', label: '常购' },
      { id: 'new', label: '新品' },
      { id: 'hot', label: '热销' }
    ],
    products: [],
    cartCount: 0,
    cartTotal: '0.00',
    keyword: '',
    error: false
  },

  onLoad() {
    this._skipNextShowRefresh = true
    this.refreshProfile()
    this.loadHomeData()
  },

  onShow() {
    this.refreshCart()
    this.refreshProfile()
    if (this._skipNextShowRefresh) {
      this._skipNextShowRefresh = false
      return
    }
    this.loadHomeData()
  },

  async refreshProfile() {
    const a = store.auth.state
    if (!a.token) {
      this.setData({ userInfo: { isLogin: false, levelName: '访客', companyName: '未登录', region: '', creditTotal: '0', creditDays: '0', creditRemaining: '0' } })
      return
    }

    try {
      const res = await getProfile()
      const data = res?.data || {}
      const cust = data.customer || {}

      const addr = (cust.address || '').split(' ')
      const region = addr.length >= 3
        ? [addr[0], addr[1], addr[2]].filter(Boolean).join(' ')
        : (cust.address || '--')

      const creditTotal = Number(cust.creditLimit || 0)
      const creditDays = Number(cust.creditDays || 0)

      this.setData({
        userInfo: {
          isLogin: true,
          levelName: cust.customerLevelName || '暂未设置等级',
          companyName: cust.customerName || data.tenant?.name || '--',
          region,
          creditTotal: creditTotal.toLocaleString(),
          creditDays: String(creditDays),
          creditRemaining: Number(cust.creditRemaining || 0).toLocaleString()
        }
      })
      store.auth.setProfile(data)
    } catch {
      // Silent fallback — keep previous state
    }
  },

  async loadHomeData() {
    await this.loadFeedProducts()
  },

  async loadFeedProducts() {
    const requestId = (this._feedRequestId || 0) + 1
    this._feedRequestId = requestId
    this.setData({ loading: true, error: false })
    try {
      const activeFeed = this.data.activeFeed
      const response = await getProductList({
        feed: activeFeed,
        page: 1,
        pageSize: activeFeed === 'frequent' ? 5 : 6
      })
      const data = (response && response.code === 0)
        ? response.data
        : { items: [], total: 0 }
      if (requestId !== this._feedRequestId) return
      this.setData({
        loading: false,
        products: (data.items || []).map(normProduct)
      })
    } catch {
      if (requestId !== this._feedRequestId) return
      this.setData({ loading: false, error: true, products: [] })
    }
  },

  onFeedChange(event) {
    const activeFeed = event.detail
    if (!activeFeed || activeFeed === this.data.activeFeed) return
    this.setData({ activeFeed })
    this.loadFeedProducts()
  },

  refreshCart() {
    const total = cart.getCheckoutItems().reduce((sum, item) => {
      const price = Number(String(item.snapshot?.price || '').replace(/[¥￥,]/g, ''))
      return sum + (Number.isFinite(price) ? price * item.quantity : 0)
    }, 0)
    this.setData({ cartCount: cart.getCount(), cartTotal: total.toFixed(2) })
  },

  onSearchInput(e) { this.setData({ keyword: e.detail.value }) },

  goSearch() {
    store.brand.state.pendingKeyword = this.data.keyword.trim()
    store.brand.state.pendingCategoryId = 'all'
    wx.switchTab({ url: '/pages/category/category' })
  },

  goProfile() { wx.switchTab({ url: '/pages/profile/profile' }) },

  goCategory(e) {
    store.brand.state.pendingKeyword = ''
    store.brand.state.pendingCategoryId = String(e?.currentTarget?.dataset?.id || 'all')
    wx.switchTab({ url: '/pages/category/category' })
  },

  goOrders()  { wx.switchTab({ url: '/pages/orders/orders' }) },

  goProductDetail(e) {
    const id = e?.currentTarget?.dataset?.productId || e?.detail?.productId
    if (!id) return
    wx.navigateTo({ url: '/pages/product-detail/product-detail?id=' + encodeURIComponent(id) })
  },

  onProductAdd(e) {
    const productId = e?.currentTarget?.dataset?.productId || e?.detail?.productId
    const product = this.data.products.find(item => Number(item.id) === Number(productId))
    if (!product) return
    if (product.skus && product.skus.length > 1) {
      this.goProductDetail(e)
      return
    }
    if (!store.auth.state.token) {
      wx.navigateTo({
        url: '/pages/login/login?redirect=' + encodeURIComponent('/pages/home/home')
      })
      return
    }
    if (!product.skuId || product.sold_out) {
      wx.showToast({ title: '该商品暂不可购买', icon: 'none' })
      return
    }
    cart.addItem({
      productId: product.id,
      skuId: product.skuId,
      brandId: product.brandId,
      quantity: Number(product.minOrderQty || 1),
      snapshot: {
        name: product.name,
        brandId: product.brandId,
        brandText: product.brandText || '',
        spec: product.spec || '',
        price: product.price || '',
        priceUnit: product.priceUnit || ''
      }
    })
    this.refreshCart()
    wx.showToast({ title: '已加入购物车', icon: 'success' })
  },

  goCart() {
    wx.navigateTo({ url: '/pages/cart/cart' })
  }
})
