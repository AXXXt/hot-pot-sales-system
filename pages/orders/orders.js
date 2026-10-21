// 订单列表支持采购中心筛选跳转、分页以及按当前价格再次采购。
const { getOrderList } = require('../../services/api/order')
const auth = require('../../store/modules/auth')
const { consumeStatus } = require('../../utils/order-navigation')
const { repeatOrder, showRepeatResult } = require('../../services/repeat-order')

const STATUS_MAP = {
  draft: { text: '草稿', variant: 'info' },
  pending_quote: { text: '待报价', variant: 'warning' },
  pending_confirm: { text: '待确认', variant: 'warning' },
  pending_finance: { text: '待审核', variant: 'warning' },
  pending_shipment: { text: '待发货', variant: 'primary' },
  shipped: { text: '待收货', variant: 'primary' },
  completed: { text: '已完成', variant: 'success' },
  cancelled: { text: '已取消', variant: 'info' }
}
const PAGE_SIZE = 20

Page({
  data: {
    loading: true, loadingMore: false, activeStatus: 'all',
    statuses: [
      { id: 'all', label: '全部' }, { id: 'pending', label: '进行中' },
      { id: 'pending_confirm', label: '待确认' }, { id: 'pending_shipment', label: '待发货' },
      { id: 'shipped', label: '待收货' }, { id: 'completed', label: '已完成' },
      { id: 'cancelled', label: '已取消' }
    ],
    orders: [], error: '', moreError: '', page: 0, hasMore: false, repeatBuying: false
  },
  onShow() {
    const status = consumeStatus()
    if (status) this.setData({ activeStatus: status })
    this.loadOrders()
  },
  onUnload() { this.requestId = (this.requestId || 0) + 1 },
  onPullDownRefresh() { this.loadOrders().finally(() => wx.stopPullDownRefresh()) },
  onReachBottom() { this.loadMore() },
  loadOrders() { return this.fetchOrders(false) },
  loadMore() {
    if (this.data.loading || this.data.loadingMore || !this.data.hasMore) return
    return this.fetchOrders(true)
  },
  async fetchOrders(append) {
    const requestId = this.requestId = (this.requestId || 0) + 1
    if (!auth.state.token) {
      this.setData({ loading: false, loadingMore: false, orders: [], error: '请先登录' })
      return
    }
    const page = append ? this.data.page + 1 : 1
    this.setData(append ? { loadingMore: true, moreError: '' } : {
      loading: true, loadingMore: false, error: '', moreError: '', orders: []
    })
    try {
      const response = await getOrderList({ page, pageSize: PAGE_SIZE, status: this.data.activeStatus })
      if (requestId !== this.requestId || !auth.state.token) return
      const data = response?.data || {}
      const next = (data.items || []).map(order => this.mapOrder(order))
      const orders = append ? this.data.orders.concat(next) : next
      this.setData({ orders, page, hasMore: orders.length < Number(data.total || 0) })
    } catch (error) {
      if (requestId === this.requestId) this.setData({
        [append ? 'moreError' : 'error']: error?.message || '加载失败'
      })
    } finally {
      if (requestId === this.requestId) this.setData({ loading: false, loadingMore: false })
    }
  },
  mapOrder(order) {
    return {
      id: order.id, orderNo: order.orderNo, timeText: String(order.createdAt).slice(0, 10),
      statusText: STATUS_MAP[order.status]?.text || order.status,
      statusVariant: STATUS_MAP[order.status]?.variant || 'info', status: order.status,
      summaryText: `${(order.productNames || []).join('、')} 共 ${order.itemCount || 0} 件`,
      amountText: '¥' + Number(order.payableAmount ?? order.totalAmount ?? 0).toFixed(2),
      actions: order.status === 'completed' ? [{ id: 'repeat', label: '再次采购' }] : []
    }
  },
  onStatusChange(e) {
    this.setData({ activeStatus: e.detail?.activeId || e.detail })
    this.loadOrders()
  },
  onOrderTap(e) {
    wx.navigateTo({ url: `/pages/order-detail/order-detail?id=${e.currentTarget.dataset.id}` })
  },
  async onOrderAction(e) {
    if (e.detail?.id !== 'repeat' || this.data.repeatBuying) return
    this.setData({ repeatBuying: true })
    try { showRepeatResult(await repeatOrder(e.currentTarget.dataset.id)) }
    catch (error) { wx.showToast({ title: error?.message || '再次采购失败', icon: 'none' }) }
    finally { this.setData({ repeatBuying: false }) }
  },
  onGoShop() { wx.switchTab({ url: '/pages/home/home' }) }
})
