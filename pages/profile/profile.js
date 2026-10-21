// 门店采购中心：身份、订单待办、账期概览与最近采购。
const store = require('../../store/index')
const { getProfile } = require('../../services/api/auth')
const { getOrderOverview } = require('../../services/api/order')
const { profileView } = require('../../utils/profile')
const { openOrders } = require('../../utils/order-navigation')
const { repeatOrder, showRepeatResult } = require('../../services/repeat-order')

Page({
  data: {
    isLoggedIn: false, loading: false, error: '', hasProfile: false,
    overviewLoading: false, overviewError: '', recentOrders: [],
    orderEntries: [], hideAmounts: true, repeatBuying: false, ...profileView({})
  },
  onShow() { this.refreshProfile() },
  onUnload() { this.requestId = (this.requestId || 0) + 1 },
  onPullDownRefresh() { this.refreshProfile().finally(() => wx.stopPullDownRefresh()) },

  async refreshProfile() {
    const requestId = this.requestId = (this.requestId || 0) + 1
    const token = store.auth.state.token
    this.setData({
      isLoggedIn: Boolean(token), loading: Boolean(token), error: '', hasProfile: false,
      overviewError: '', overviewLoading: false, recentOrders: [], orderEntries: [],
      hideAmounts: true, ...profileView({})
    })
    if (!token) return
    try {
      const response = await getProfile()
      if (requestId !== this.requestId || !store.auth.state.token) return
      const profile = response?.data || response
      store.auth.setProfile(profile)
      store.auth.setCustomer(profile.customer || null)
      this.setData({ ...profileView(profile), hasProfile: true })
      if (profile.customer?.id) await this.loadOverview(requestId)
    } catch (error) {
      if (requestId === this.requestId) this.setData({ error: error?.message || '资料加载失败' })
    } finally {
      if (requestId === this.requestId) this.setData({ loading: false, isLoggedIn: Boolean(store.auth.state.token) })
    }
  },

  async loadOverview(requestId = this.requestId) {
    this.setData({ overviewLoading: true, overviewError: '' })
    try {
      const response = await getOrderOverview()
      if (requestId !== this.requestId || !store.auth.state.token) return
      const result = response?.data || response
      const entries = [['pending_confirm', '待确认'], ['pending_shipment', '待发货'], ['shipped', '待收货']]
      this.setData({
        orderEntries: entries.map(entry => ({
          status: entry[0], label: entry[1], count: result.counts[entry[0]] || 0
        })),
        recentOrders: (result.recentOrders || []).map(order => ({
          ...order, date: String(order.createdAt).slice(0, 10), imageFailed: false
        }))
      })
    } catch (error) {
      if (requestId === this.requestId) this.setData({ overviewError: error?.message || '订单加载失败' })
    } finally {
      if (requestId === this.requestId) this.setData({ overviewLoading: false })
    }
  },
  retryOverview() { return this.loadOverview() },
  goLogin() { wx.navigateTo({ url: '/pages/login/login?mode=login' }) },
  goRegister() { wx.navigateTo({ url: '/pages/login/login?mode=register' }) },
  goSettings() { wx.navigateTo({ url: '/pages/account-settings/account-settings' }) },
  goHelp() { wx.navigateTo({ url: '/pages/help/help' }) },
  goOrders(e) { openOrders(e.currentTarget.dataset.status || 'all') },
  goShop() { wx.switchTab({ url: '/pages/category/category' }) },
  toggleAmounts() { this.setData({ hideAmounts: !this.data.hideAmounts }) },
  onProtectedTap(e) {
    if (!store.auth.state.token) return this.goLogin()
    wx.navigateTo({ url: `/pages/profile-detail/profile-detail?type=${e.currentTarget.dataset.type}` })
  },
  openOrder(e) { wx.navigateTo({ url: `/pages/order-detail/order-detail?id=${e.currentTarget.dataset.id}` }) },
  onImageError(e) {
    this.setData({ [`recentOrders[${e.currentTarget.dataset.index}].imageFailed`]: true })
  },
  async onRepeat(e) {
    if (this.data.repeatBuying) return
    this.setData({ repeatBuying: true })
    try { showRepeatResult(await repeatOrder(e.currentTarget.dataset.id)) }
    catch (error) { wx.showToast({ title: error?.message || '再次采购失败', icon: 'none' }) }
    finally { this.setData({ repeatBuying: false }) }
  }
})
