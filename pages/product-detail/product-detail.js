// 商品详情：规格选择、库存约束与采购金额预估。
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
    failedImages: {},
    imageIndex: 0,
    inCartCount: 0,
    canBuy: false,
    loginRequired: false,
    priceMode: '',
    displayPrice: '',
    estimatedTotal: '待报价',
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
    this.requestedSkuId = String(options.skuId || '')
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
    const images = Array.isArray(product.images) ? product.images.filter(function (url, index, list) { return typeof url === 'string' && !!url && list.indexOf(url) === index }) : []
    if (!images.length && product.main_image_url) images.push(product.main_image_url)
    return images
  },

  applySkuViewModel(product, skuList) {
    const selectedSku = skuList.find(item => !item.sold_out && Number(item.available_qty) >= Number(item.min_order_qty || 1)) || skuList[0] || null
    const customerPrice = selectedSku && selectedSku.customer_price
    const salePrice = selectedSku && selectedSku.sale_price
    const saleUnit = (selectedSku && selectedSku.sale_unit) || '单位待确认'
    const priceValue = auth.state.token && customerPrice != null ? customerPrice : salePrice
    const minQuantity = Math.max(1, Number(selectedSku && selectedSku.min_order_qty || 1))
    const maxQuantity = Math.max(0, Number(selectedSku && selectedSku.available_qty || 0))
    const canBuy = Boolean(selectedSku && !selectedSku.sold_out && maxQuantity >= minQuantity)
    this.setData({
      selectedSkuId: selectedSku ? String(selectedSku.id) : '',
      selectedSku,
      quantity: minQuantity,
      canBuy,
      quantityDisabled: !canBuy,
      minQuantity,
      maxQuantity,
      displayPrice: priceValue != null && priceValue !== '' ? '¥' + priceValue : '价格待确认',
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
    this.updateEstimatedTotal()
  },

  loadDetail(productId) {
    this.setData({ loading: true, error: '', skuError: '', skuLoading: true, imageError: false, failedImages: {}, imageIndex: 0, canBuy: false, quantityDisabled: true })
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
        const requested = skuList.find(item => String(item.id) === that.requestedSkuId)
        that.applySkuViewModel(product, requested ? [requested] : skuList)
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

  onImageFail(e) {
    const index = Number(e.currentTarget.dataset.index || 0)
    const failed = Object.assign({}, this.data.failedImages)
    failed[index] = true
    this.setData({ failedImages: failed })
  },

  onPreviewImage(e) {
    const index = Number(e.currentTarget.dataset.index || 0)
    const failed = this.data.failedImages
    const urls = this.data.imageList.filter(function (url, position) { return !failed[position] })
    if (!urls.length || failed[index]) return
    wx.previewImage({ current: this.data.imageList[index], urls: urls, fail: function () { wx.showToast({ title: '图片预览失败，请重试', icon: 'none' }) } })
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
    this.setData({ skuError: this.data.canBuy ? '' : '该规格库存不足起订量' })
  },

  onQuantityChange(e) {
    const nextQuantity = Number(e.detail)
    const min = Number(this.data.minQuantity || 1)
    const max = Number(this.data.maxQuantity || 999999)
    if (!Number.isInteger(nextQuantity) || this.data.quantityDisabled || nextQuantity < min || nextQuantity > max) return
    this.setData({ quantity: nextQuantity })
    this.updateEstimatedTotal()
  },

  updateEstimatedTotal() {
    const sku = this.data.selectedSku
    const price = sku && (auth.state.token && sku.customer_price != null ? sku.customer_price : sku.sale_price)
    const knownPrice = price != null && price !== '' && Number.isFinite(Number(price))
    this.setData({ estimatedTotal: knownPrice ? '¥' + (Number(price) * this.data.quantity).toFixed(2) : '待报价' })
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
    if (this.data.loading || this.data.skuLoading || !this.data.canBuy) return
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
    if (this.data.loading || this.data.skuLoading || !this.data.canBuy) return
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
