// 小程序启动与微信身份绑定，网络请求统一经过Services层。
const { bindCurrentWechat } = require('./services/wechat')

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

    // 静默绑定微信 openid（用于订阅消息通知）
    if (token) {
      bindCurrentWechat().catch(() => {})
    }
  },

  onShow() {
    bindCurrentWechat().catch(() => {})
  }
})
