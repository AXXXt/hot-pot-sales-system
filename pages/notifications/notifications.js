// 采购站内消息：展示订单进度、跨设备已读状态和对应订单入口。
const auth = require('../../store/modules/auth')
const { captureSession, isCurrentSession } = require('../../utils/auth-session')
const { getNotifications, readNotification, readAllNotifications } = require('../../services/api/notification')
const { formatShanghaiMinute } = require('../../utils/format')

Page({
  data: { items: [], loading: false, error: '', page: 0, total: 0, unreadCount: 0, marking: false },
  onShow() {
    this._active = true
    this._action = (this._action || 0) + 1
    this.setData({ marking: false })
    if (!auth.state.token) { wx.navigateTo({ url: '/pages/login/login' }); return }
    this.load(true)
  },
  onHide() {
    this._active = false
    this._request = (this._request || 0) + 1
    this._action = (this._action || 0) + 1
    this.setData({ items: [], page: 0, total: 0, unreadCount: 0,
      loading: false, marking: false, error: '' })
  },
  onUnload() { this.onHide() },
  onPullDownRefresh() { this.load(true).finally(() => wx.stopPullDownRefresh()) },
  onReachBottom() {
    if (!this.data.loading && this.data.items.length < this.data.total) this.load(false)
  },
  onRetry() { this.load(this.data.page === 0) },
  async load(reset) {
    const session = captureSession(auth)
    const requestId = this._request = (this._request || 0) + 1
    const page = reset ? 1 : this.data.page + 1
    this.setData({ loading: true, error: '', ...(reset ? { items: [], page: 0, total: 0, unreadCount: 0 } : {}) })
    try {
      const response = await getNotifications(page)
      if (!this._active || requestId !== this._request || !isCurrentSession(auth, session)) return
      const data = response.data || response
      const items = data.items.map(item => ({ ...item,
        dateText: formatShanghaiMinute(item.createdAt),
        orderNo: item.order?.orderNo || ''
      }))
      this.setData({ items: reset ? items : this.data.items.concat(items),
        page, total: data.total, unreadCount: data.unreadCount })
    } catch (error) {
      if (this._active && requestId === this._request && isCurrentSession(auth, session)) {
        this.setData({ error: error?.message || '消息加载失败' })
      }
    } finally {
      if (this._active && requestId === this._request) this.setData({ loading: false })
    }
  },
  async onOpen(e) {
    if (this.data.marking) return
    const session = captureSession(auth)
    const item = this.data.items.find(message => message.id === Number(e.currentTarget.dataset.id))
    if (!item) return
    const action = this._action = (this._action || 0) + 1
    this.setData({ marking: true })
    try {
      await readNotification(item.id)
      if (this._active && action === this._action && isCurrentSession(auth, session)) {
        this.setData({ marking: false })
        wx.navigateTo({ url: `/pages/order-detail/order-detail?id=${item.orderId}` })
      }
    } catch (error) {
      if (this._active && action === this._action && isCurrentSession(auth, session)) {
        wx.showToast({ title: error?.message || '消息暂不可访问，请刷新', icon: 'none' })
      }
    } finally { if (this._active && action === this._action) this.setData({ marking: false }) }
  },
  async onReadAll() {
    if (this.data.marking || !this.data.unreadCount || this.data.loading) return
    const session = captureSession(auth)
    const action = this._action = (this._action || 0) + 1
    this.setData({ marking: true })
    try {
      await readAllNotifications()
      if (this._active && action === this._action && isCurrentSession(auth, session)) await this.load(true)
    } catch (error) {
      if (this._active && action === this._action && isCurrentSession(auth, session)) {
        wx.showToast({ title: error?.message || '操作失败', icon: 'none' })
      }
    } finally { if (this._active && action === this._action) this.setData({ marking: false }) }
  }
})
