const store = require('../../store/index')
const { getProfile } = require('../../services/api/auth')
const { getMyPriceRules } = require('../../services/api/customer')
const { money, profileView } = require('../../utils/profile')

const TYPE_CONFIG = {
  company: { title: '企业资料' },
  address: { title: '收货信息' },
  prices: { title: '协议价格' },
  credit: { title: '账期账户' }
}

const CUSTOMER_TYPE_MAP = {
  chain: '大型连锁',
  factory: '工厂直配',
  individual: '个体商户',
  strategic: '战略合作',
  new: '新用户',
  senior: '资深客户'
}

// 个人中心业务详情页，按入口类型展示企业资料、地址或协议价。
Page({
  data: {
    type: 'company',
    title: '企业资料',
    loading: true,
    error: '',
    companyRows: [],
    addressRows: [],
    priceItems: [],
    addressText: '', keyword: '', filteredPrices: [], creditRows: [], creditEnabled: false
  },

  onLoad(options) {
    const type = TYPE_CONFIG[options.type] ? options.type : 'company'
    this.setData({ type, title: TYPE_CONFIG[type].title })
    wx.setNavigationBarTitle({ title: TYPE_CONFIG[type].title })
    this.loadData()
  },

  async loadData() {
    const requestId = this.requestId = (this.requestId || 0) + 1
    if (!store.auth.state.token) {
      this.setData({ loading: false, error: '请先登录' })
      return
    }

    this.setData({ loading: true, error: '' })
    try {
      const profileResponse = await getProfile()
      if (requestId !== this.requestId || !store.auth.state.token) return
      const profile = profileResponse?.data || profileResponse || {}
      store.auth.setProfile(profile)
      store.auth.setCustomer(profile.customer || null)
      const customer = profile.customer || {}
      const type = this.data.type
      const nextData = {
        loading: false,
        companyRows: this.buildCompanyRows(customer, profile),
        addressRows: this.buildAddressRows(customer),
        addressText: customer.address ? [customer.customerName, customer.contactName,
          customer.contactPhone, customer.address].filter(Boolean).join('\n') : '',
        creditEnabled: profileView(profile).creditEnabled,
        creditRows: [
          { label: '可用额度', value: money(customer.creditRemaining) },
          { label: '总额度', value: money(customer.creditLimit) },
          { label: '已用额度', value: money(customer.creditUsed) },
          { label: '账期天数', value: profileView(profile).creditDays }
        ]
      }

      if (type === 'prices') {
        const priceResponse = await getMyPriceRules()
        const rules = priceResponse?.data || priceResponse || []
        nextData.priceItems = (Array.isArray(rules) ? rules : []).map(rule => ({
          id: rule.id, productId: rule.product?.id, skuId: rule.sku?.id,
          productName: rule.product?.name || '商品',
          skuName: rule.sku?.name === rule.sku?.specText ? '' : (rule.sku?.name || ''),
          specText: rule.sku?.specText || '',
          price: money(rule.price),
          basePrice: Number(rule.sku?.basePrice || 0).toFixed(2),
          saleUnit: rule.sku?.saleUnit || '',
          validity: rule.endAt ? `有效至 ${String(rule.endAt).slice(0, 10)}` : '当前生效'
        }))
      }
      if (requestId !== this.requestId || !store.auth.state.token) return
      this.setData(nextData)
      this.filterPrices()
    } catch (error) {
      if (requestId === this.requestId) this.setData({ loading: false, error: error?.message || '加载失败' })
    }
  },

  buildCompanyRows(customer, profile) {
    return [
      { label: '企业名称', value: customer.customerName || '--' },
      { label: '客户类型', value: CUSTOMER_TYPE_MAP[customer.customerType] || customer.customerType || '--' },
      { label: '客户等级', value: customer.customerLevelName || '暂未设置等级' },
      { label: '联系人', value: customer.contactName || '--' },
      { label: '联系电话', value: customer.contactPhone || profile.user?.phone || '--' },
      { label: '审核状态', value: profileView(profile).statusText }
    ]
  },

  buildAddressRows(customer) {
    return [
      { label: '收货单位', value: customer.customerName || '--' },
      { label: '收货人', value: customer.contactName || '--' },
      { label: '联系电话', value: customer.contactPhone || '--' },
      { label: '详细地址', value: customer.address || '暂未填写' }
    ]
  },

  onUnload() { this.requestId = (this.requestId || 0) + 1 },
  onSearch(e) { this.setData({ keyword: e.detail.value }); this.filterPrices() },
  clearSearch() { this.setData({ keyword: '' }); this.filterPrices() },
  filterPrices() {
    const keyword = this.data.keyword.trim().toLowerCase()
    this.setData({ filteredPrices: this.data.priceItems.filter(item =>
      `${item.productName} ${item.skuName} ${item.specText}`.toLowerCase().includes(keyword)) })
  },
  openProduct(e) {
    const { id, sku } = e.currentTarget.dataset
    if (id) wx.navigateTo({ url: `/pages/product-detail/product-detail?id=${id}&skuId=${sku}` })
  },
  goHelp() { wx.navigateTo({ url: '/pages/help/help' }) },
  goLogin() { wx.navigateTo({ url: '/pages/login/login?mode=login' }) },
  retry() { return store.auth.state.token ? this.loadData() : this.goLogin() },
  copyAddress() {
    if (!this.data.addressText) {
      wx.showToast({ title: '暂无可复制的地址', icon: 'none' })
      return
    }
    wx.setClipboardData({
      data: this.data.addressText,
      success: () => wx.showToast({ title: '收货信息已复制', icon: 'success' })
    })
  }
})
