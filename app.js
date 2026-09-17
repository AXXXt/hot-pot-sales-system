App({
  globalData: {
    token: '',
    userInfo: null,
    currentBrand: null,
    currentCustomer: null,
    systemConfig: null,
    cartCount: 0
  },

  onLaunch() {

    const token = wx.getStorageSync('token') || ''
    const userInfo = wx.getStorageSync('userInfo') || null
    const currentBrand = wx.getStorageSync('currentBrand') || null
    const currentCustomer = wx.getStorageSync('currentCustomer') || null
    const systemConfig = wx.getStorageSync('systemConfig') || null
    const cartCount = wx.getStorageSync('cartCount') || 0

    this.globalData.token = token
    this.globalData.userInfo = userInfo
    this.globalData.currentBrand = currentBrand
    this.globalData.currentCustomer = currentCustomer
    this.globalData.systemConfig = systemConfig
    this.globalData.cartCount = cartCount
  }
})
