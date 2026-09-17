const { getProductDetail, getProductSkus } = require('../../services/api/product')
const auth = require('../../store/modules/auth')
const cart = require('../../store/modules/cart')

Page({
  data: {
    loading: true,
    error: '',
    productId: '',
    product: null,
    imageList: [],
    skus: [],
    selectedSkuId: '',
    quantity: 1,
    selectedSku: null,
    skuLoading: true,
    skuError: '',
    imageError: false,
    imageIndex: 0,
    inCartCount: 0,
    canBuy: false,
    loginRequired: false,
    priceMode: '',
    displayPrice: '',
    saleUnitText: '',
    customerPriceText: '',
    basePriceText: '',
    stockText: '',
    minOrderText: '',
    deliveryText: '',
    paramList: [],
    quantityDisabled: false,
    minQuantity: 1,
    maxQuantity: 999999,
    skuErrorMessage: '',
    cartSheetVisible: false
  },

  onLoad(options) {
    const productId = String(options.id || '').trim()
    if (!productId || !/^\d+$/.test(productId)) {
      this.setData({ loading: false, error: '商品不存在或参数无效' })
      return
    }
    this.setData({ productId })
    this.loadDetail(productId)
  },

  onShow() {
    this.setData({ inCartCount: cart.getCount() })
  },

  normalizeDetail(product) {
    const images = Array.isArray(product.images) ? product.images.filter(Boolean) : []
    if (!images.length && product.main_image_url) images.push(product.main_image_url)
    return images
  },

  applySkuViewModel(product, skuList) {
    const selectedSku = skuList[0] || null
    const customerPrice = selectedSku && selectedSku.customer_price
    const salePrice = selectedSku && selectedSku.sale_price
    const saleUnit = (selectedSku && selectedSku.sale_unit) || '单位待确认'
    const priceValue = auth.state.token && customerPrice ? customerPrice : salePrice
    this.setData({
      selectedSkuId: selectedSku ? String(selectedSku.id) : '',
      selectedSku,
      quantity: Number((selectedSku && selectedSku.min_order_qty) || 1),
      canBuy: Boolean(selectedSku && !selectedSku.sold_out),
      quantityDisabled: !selectedSku || selectedSku.sold_out,
      minQuantity: Number((selectedSku && selectedSku.min_order_qty) || 1),
      maxQuantity: Number((selectedSku && selectedSku.available_qty) || 999999),
      displayPrice: priceValue ? '¥' + priceValue : '价格待确认',
      saleUnitText: '/ ' + saleUnit,
      customerPriceText: customerPrice
        ? '协议价 ¥' + customerPrice
        : (auth.state.token ? '' : '登录查看协议价'),
      basePriceText: salePrice ? '基础价 ¥' + salePrice : '',
      stockText: selectedSku && selectedSku.sold_out ? '售罄' : (selectedSku && selectedSku.stock_text) || '库存待确认',
      minOrderText: selectedSku && selectedSku.min_order_qty ? selectedSku.min_order_qty + (selectedSku.sale_unit || '') : '起订量待确认',
      deliveryText: product.delivery_text || '配送信息待确认',
      paramList: [
        { label: '品牌', value: product.brand_name || '--' },
        { label: '规格', value: (selectedSku && selectedSku.spec_text) || product.base_spec || '--' },
        { label: '单位', value: (selectedSku && selectedSku.sale_unit) || '单位待确认' }
      ].filter(function (item) { return item.value && item.value !== '--' })
    })
  },

  loadDetail(productId) {
    this.setData({ loading: true, error: '', skuError: '', skuLoading: true })
    var that = this
    Promise.all([getProductDetail(productId), getProductSkus(productId)])
      .then(function (results) {
        var detailPayload = results[0]
        var skuPayload = results[1]
        var product = detailPayload && detailPayload.data ? detailPayload.data : null
        var skuList = (skuPayload && skuPayload.data && skuPayload.data.items) || (skuPayload && skuPayload.data) || []
        if (!product) {
          that.setData({ loading: false, error: '商品已下架或不存在' })
          return
        }
        if (!skuList.length) {
          that.setData({ loading: false, skuLoading: false, product: product, skus: [], error: '', skuError: '规格信息暂不可用', imageList: that.normalizeDetail(product) })
          return
        }
        that.setData({
          loading: false,
          skuLoading: false,
          product: product,
          skus: skuList,
          imageList: that.normalizeDetail(product),
          inCartCount: cart.getCount()
        })
        that.applySkuViewModel(product, skuList)
      })
      .catch(function (err) {
        var message = (err && err.message) || '加载失败，请重试'
        that.setData({ loading: false, skuLoading: false, error: message })
      })
  },

  onRetry() {
    if (this.data.productId) {
      this.loadDetail(this.data.productId)
    }
  },

  onImageFail() {
    this.setData({ imageError: true })
  },

  onSwiperChange(e) {
    this.setData({ imageIndex: e.detail.current })
  },

  onSelectSku(e) {
    var skuId = String(e.currentTarget.dataset.id || '')
    var selectedSku = this.data.skus.find(function (item) { return String(item.id) === skuId }) || null
    if (!selectedSku) return
    this.setData({ selectedSkuId: skuId, selectedSku: selectedSku })
    this.applySkuViewModel(this.data.product, [selectedSku])
    this.setData({ skuError: '', canBuy: !selectedSku.sold_out, quantityDisabled: Boolean(selectedSku.sold_out) })
  },

  onQuantityChange(e) {
    const nextQuantity = Number(e.detail)
    const min = Number(this.data.minQuantity || 1)
    const max = Number(this.data.maxQuantity || 999999)
    if (nextQuantity < min || nextQuantity > max) return
    this.setData({ quantity: nextQuantity })
  },

  ensureLogin() {
    if (auth.state.token) return true
    wx.navigateTo({ url: '/pages/login/login?redirect=' + encodeURIComponent('/pages/product-detail/product-detail?id=' + this.data.productId) })
    return false
  },

  onOpenCart() {
    this.setData({ cartSheetVisible: true })
  },

  onCloseCart() {
    this.setData({ cartSheetVisible: false })
  },

  onCartChange(e) {
    this.setData({ inCartCount: e.detail && e.detail.count != null ? e.detail.count : cart.getCount() })
  },

  onAddToCart() {
    if (!this.ensureLogin()) return
    if (!this.data.selectedSku) {
      this.setData({ skuError: '请选择规格后再加入购物车' })
      return
    }
    if (this.data.selectedSku.sold_out) {
      this.setData({ skuError: '该规格已售罄' })
      return
    }
    cart.addItem({
      productId: this.data.productId,
      skuId: String(this.data.selectedSku.id),
      brandId: this.data.product && this.data.product.brand_id,
      quantity: this.data.quantity,
      snapshot: {
        name: this.data.product && this.data.product.name,
        brandId: this.data.product && this.data.product.brand_id,
        brandText: this.data.product && this.data.product.brand_name || '',
        spec: this.data.selectedSku && this.data.selectedSku.spec_text || '',
        price: this.data.selectedSku && this.data.selectedSku.customer_price || this.data.selectedSku && this.data.selectedSku.sale_price || '',
        priceUnit: this.data.selectedSku && this.data.selectedSku.sale_unit || ''
      }
    })
    this.setData({ inCartCount: cart.getCount() })
    wx.showToast({ title: '已加入购物车', icon: 'success' })
  },

  onBuyNow() {
    if (!this.ensureLogin()) return
    if (!this.data.selectedSku) {
      this.setData({ skuError: '请选择规格后再下单' })
      return
    }
    if (this.data.selectedSku.sold_out) {
      this.setData({ skuError: '该规格已售罄' })
      return
    }
    cart.addItem({
      productId: this.data.productId,
      skuId: String(this.data.selectedSku.id),
      brandId: this.data.product && this.data.product.brand_id,
      quantity: this.data.quantity,
      snapshot: {
        name: this.data.product && this.data.product.name,
        brandId: this.data.product && this.data.product.brand_id,
        brandText: this.data.product && this.data.product.brand_name || '',
        spec: this.data.selectedSku && this.data.selectedSku.spec_text || '',
        price: this.data.selectedSku && this.data.selectedSku.customer_price || this.data.selectedSku && this.data.selectedSku.sale_price || '',
        priceUnit: this.data.selectedSku && this.data.selectedSku.sale_unit || ''
      }
    })
    this.setData({ inCartCount: cart.getCount() })
    wx.navigateTo({ url: '/pages/checkout/checkout' })
  }
})
