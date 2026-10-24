// 商品分类：筛选、分页与进货单入口。
const { getProductList, getProductCategories } = require('../../services/api/product')
const store = require('../../store/index')
const cart = require('../../store/modules/cart')

Page({
  data: {
    loading: true,
    loadingMore: false,
    loadMoreError: false,
    page: 0,
    hasMore: false,
    keyword: '',
    activeCategoryId: 'all',
    activeSort: 'default',
    scrollIntoViewId: '',
    categories: [{ id: 'all', label: '全部' }],
    sorts: [
      { id: 'default', label: '综合' },
      { id: 'price_asc', label: '价格升序' },
      { id: 'price_desc', label: '价格降序' },
      { id: 'in_stock', label: '仅看有货' }
    ],
    products: [],
    cartCount: 0,
    error: false
  },

  onLoad() {
    this._skipNextShowRefresh = true
    this.loadCategories()
    this.loadProducts()
  },

  onShow() {
    this.setData({ cartCount: cart.getCount() })
    const skipRefresh = this._skipNextShowRefresh
    this._skipNextShowRefresh = false
    const pending = store.brand.state.pendingCategoryId
    if (typeof store.brand.state.pendingKeyword === 'string') {
      this.setData({ keyword: store.brand.state.pendingKeyword, activeCategoryId: pending || 'all' })
      delete store.brand.state.pendingKeyword
      store.brand.state.pendingCategoryId = ''
      this.loadProducts()
      return
    }
    if (pending && pending !== this.data.activeCategoryId) {
      this.setData({
        activeCategoryId: pending,
        scrollIntoViewId: `category-${pending}`
      })
      store.brand.setCurrentBrand({ ...store.brand.state.currentBrand, lastCategoryId: pending })
      store.brand.state.pendingCategoryId = ''
      this.loadProducts()
      return
    }
    if (!skipRefresh) {
      this.loadCategories()
      this.loadProducts()
    }
  },

  async loadCategories() {
    try {
      const res = await getProductCategories()
      const cats = (res && res.code === 0 && res.data) ? res.data : []
      this.setData({
        categories: [
          { id: 'all', label: '全部' },
          ...cats.map((c) => ({ id: String(c.id), label: c.name }))
        ]
      })
      if (!this.data.categories.some(item => item.id === this.data.activeCategoryId)) {
        this.setData({ activeCategoryId: 'all' })
        this.loadProducts()
      }
    } catch {
      // keep defaults
    }
  },

  loadProducts(loadMore = false) {
    const append = loadMore === true
    if (append && (this.data.loading || this.data.loadingMore || !this.data.hasMore)) return
    const requestId = this._requestId = (this._requestId || 0) + 1
    const page = append ? this.data.page + 1 : 1
    this.setData({ loading: !append, loadingMore: append, error: false, loadMoreError: false })
    const categoryId = this.data.activeCategoryId
    const params = {
      page,
      pageSize: 50
    }
    if (categoryId && categoryId !== 'all') {
      params.categoryId = categoryId
    }
    if (this.data.keyword) {
      params.keyword = this.data.keyword
    }
    if (this.data.activeSort === 'price_asc') {
      params.sortBy = 'price_asc'
    } else if (this.data.activeSort === 'price_desc') {
      params.sortBy = 'price_desc'
    } else if (this.data.activeSort === 'in_stock') {
      params.inStock = 'true'
    }

    return getProductList(params)
      .then((res) => {
        if (requestId !== this._requestId) return
        const result = (res && res.code === 0 && res.data) ? res.data : { items: [], total: 0 }
        const products = append ? this.data.products.concat(result.items || []) : result.items || []
        this.setData({
          products, page, loading: false, loadingMore: false,
          hasMore: products.length < Number(result.total || 0)
        })
      })
      .catch(() => {
        if (requestId !== this._requestId) return
        this.setData({ loading: false, loadingMore: false, error: !append, loadMoreError: append })
      })
  },

  onReachBottom() { return this.loadProducts(true) },

  loadMore() { return this.loadProducts(true) },

  onUnload() { this._requestId = (this._requestId || 0) + 1 },

  onSearch(event) {
    this.setData({ keyword: typeof event.detail === 'string' ? event.detail : '' })
    this.loadProducts()
  },

  resetFilters() {
    this.setData({
      keyword: '', activeCategoryId: 'all', activeSort: 'default',
      scrollIntoViewId: 'category-all'
    })
    store.brand.state.pendingCategoryId = ''
    this.loadProducts()
  },

  onCategoryChange(event) {
    const activeCategoryId = String(event.detail || 'all')
    this.setData({
      activeCategoryId,
      scrollIntoViewId: `category-${activeCategoryId}`
    })
    store.brand.state.pendingCategoryId = activeCategoryId
    store.brand.setCurrentBrand({ ...store.brand.state.currentBrand, lastCategoryId: activeCategoryId })
    this.loadProducts()
  },

  onSortChange(event) {
    const activeSort = event.currentTarget.dataset.id
    this.setData({ activeSort })
    this.loadProducts()
  },

  onProductTap(e) {
    const productId = e?.currentTarget?.dataset?.productId || e?.detail?.productId
    if (!productId) return
    wx.navigateTo({ url: `/pages/product-detail/product-detail?id=${encodeURIComponent(productId)}` })
  },

  onProductAdd(e) {
    const productId = e?.currentTarget?.dataset?.productId || e?.detail?.productId
    const product = this.data.products.find(item => Number(item.id) === Number(productId))
    if (!product) return
    if (product.skus && product.skus.length > 1) {
      this.onProductTap(e)
      return
    }
    if (!store.auth.state.token) {
      wx.navigateTo({
        url: '/pages/login/login?redirect=' + encodeURIComponent('/pages/category/category')
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
    this.setData({ cartCount: cart.getCount() })
    wx.showToast({ title: '已加入购物车', icon: 'success' })
  },

  goCart() {
    wx.navigateTo({ url: '/pages/cart/cart' })
  }
})
