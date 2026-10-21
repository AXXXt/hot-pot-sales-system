// 账户设置与协议入口；退出登录不删除购物车。
const { auth } = require('../../store/index')
const { logout } = require('../../services/api/auth')
Page({
  data: { version: '', environment: '', loggedIn: false, loggingOut: false },
  onShow() {
    const info = wx.getAccountInfoSync().miniProgram
    this.setData({
      loggedIn: Boolean(auth.state.token), version: info.version || '开发版本',
      environment: { develop: '开发版', trial: '体验版', release: '正式版' }[info.envVersion] || ''
    })
  },
  openLegal(e) { wx.navigateTo({ url: `/pages/legal/legal?type=${e.currentTarget.dataset.type}` }) },
  goHelp() { wx.navigateTo({ url: '/pages/help/help' }) },
  onLogout() {
    if (this.data.loggingOut) return
    wx.showModal({
      title: '退出登录', content: '确定退出当前门店账号吗？',
      success: async result => {
        if (!result.confirm || this.data.loggingOut) return
        this.setData({ loggingOut: true })
        try { await logout() } catch (_) { /* 网络异常时仍清除本机登录凭据。 */ }
        finally {
          auth.clearAuth()
          this.setData({ loggingOut: false, loggedIn: false })
          wx.switchTab({ url: '/pages/profile/profile' })
        }
      }
    })
  }
})
