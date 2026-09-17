const store = require('../../store/index')
const { getProfile } = require('../../services/api/auth')
const { getMyPriceRules } = require('../../services/api/customer')

const TYPE_CONFIG = {
  company: { title: '企业资料' },
  address: { title: '收货地址' },
  prices: { title: '协议价格' }
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
    addressText: ''
  },

  onLoad(options) {
    const type = TYPE_CONFIG[options.type] ? options.type : 'company'
    this.setData({ type, title: TYPE_CONFIG[type].title })
    wx.setNavigationBarTitle({ title: TYPE_CONFIG[type].title })
    this.loadData()
  },

  async loadData() {
    if (!store.auth.state.token) {
      this.setData({ loading: false, error: '请先登录' })
      return
    }

    this.setData({ loading: true, error: '' })
    try {
      const profileResponse = await getProfile()
      const profile = profileResponse?.data || profileResponse || {}
      store.auth.setProfile(profile)
      store.auth.setCustomer(profile.customer || null)
      const customer = profile.customer || {}
      const type = this.data.type
      const nextData = {
        loading: false,
        companyRows: this.buildCompanyRows(customer, profile),
        addressRows: this.buildAddressRows(customer),
        addressText: customer.address || ''
      }

      if (type === 'prices') {
        const priceResponse = await getMyPriceRules()
        const rules = priceResponse?.data || priceResponse || []
        nextData.priceItems = (Array.isArray(rules) ? rules : []).map(rule => ({
          productName: rule.product?.name || '商品',
          skuName: rule.sku?.name || '',
          specText: rule.sku?.specText || '',
          price: Number(rule.price || 0).toFixed(2),
          basePrice: Number(rule.sku?.basePrice || 0).toFixed(2),
          saleUnit: rule.sku?.saleUnit || ''
        }))
      }
      this.setData(nextData)
    } catch (error) {
      this.setData({ loading: false, error: error?.message || '加载失败' })
    }
  },

  buildCompanyRows(customer, profile) {
    return [
      { label: '企业名称', value: customer.customerName || '--' },
      { label: '客户类型', value: CUSTOMER_TYPE_MAP[customer.customerType] || customer.customerType || '--' },
      { label: '联系人', value: customer.contactName || '--' },
      { label: '联系电话', value: customer.contactPhone || profile.user?.phone || '--' },
      { label: '审核状态', value: customer.status === 'active' ? '已审核' : (customer.status || '--') }
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

  copyAddress() {
    if (!this.data.addressText) {
      wx.showToast({ title: '暂无可复制的地址', icon: 'none' })
      return
    }
    wx.setClipboardData({
      data: this.data.addressText,
      success: () => wx.showToast({ title: '地址已复制', icon: 'success' })
    })
  }
})
