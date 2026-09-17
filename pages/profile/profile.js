const store = require('../../store/index')
const { getProfile, logout } = require('../../services/api/auth')

const LEVEL_MAP = {
  chain: '大型连锁',
  factory: '工厂直配',
  individual: '个体商户',
  strategic: '战略合作',
  new: '新用户',
  senior: '资深客户'
}

// 个人中心页面，展示当前客户资料并提供业务入口。
Page({
  data: {
    isLoggedIn: false,
    storeName: '',
    levelName: '--',
    city: '--'
  },

  onShow() {
    this.refreshProfile()
  },

  async refreshProfile() {
    const auth = store.auth.state
    if (!auth.token) {
      this.setData({ isLoggedIn: false, storeName: '', levelName: '--', city: '--' })
      return
    }

    let profile = auth.profile || {}
    try {
      const response = await getProfile()
      profile = response?.data || response || profile
      store.auth.setProfile(profile)
      store.auth.setCustomer(profile.customer || null)
    } catch {
      // 保留本地缓存资料，避免个人中心因短暂网络错误变成空白。
    }

    const customer = profile.customer || {}
    const addressParts = (customer.address || '').split(' ')
    this.setData({
      isLoggedIn: true,
      storeName: customer.customerName || profile.tenant?.name || '--',
      levelName: LEVEL_MAP[customer.customerType] || customer.customerType || '--',
      city: addressParts[1] || addressParts[0] || '--'
    })
  },

  goLogin() {
    wx.navigateTo({ url: '/pages/login/login?mode=login' })
  },

  goRegister() {
    wx.navigateTo({ url: '/pages/login/login?mode=register' })
  },

  onProtectedTap(e) {
    if (!this.data.isLoggedIn) {
      wx.navigateTo({ url: '/pages/login/login?mode=login' })
      return
    }
    const type = e.currentTarget.dataset.type
    wx.navigateTo({ url: `/pages/profile-detail/profile-detail?type=${type}` })
  },

  onLogout() {
    wx.showModal({
      title: '退出登录',
      content: '确定要退出登录吗？',
      success: (res) => {
        if (!res.confirm) return
        logout().catch(() => {})
        store.auth.clearAuth()
        this.setData({ isLoggedIn: false, storeName: '', levelName: '--', city: '--' })
        wx.showToast({ title: '已退出', icon: 'success' })
      }
    })
  }
})
