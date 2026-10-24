// 客户服务申请：提交售后、资料更正等人工申请，并查看工作人员处理进度。
const auth = require('../../store/modules/auth')
const { captureSession, isCurrentSession } = require('../../utils/auth-session')
const api = require('../../services/api/service-request')
const { formatShanghaiMinute } = require('../../utils/format')
const TYPES = [
  { value: 'after_sales', label: '售后申请' },
  { value: 'profile_change', label: '资料更正' },
  { value: 'account_closure', label: '账号注销申请' },
  { value: 'invoice', label: '开票咨询' },
  { value: 'delivery', label: '配送咨询' }
]
const STATUS = { pending: '待处理', processing: '处理中', completed: '已结案', rejected: '已驳回' }
const emptyForm = () => ({ clientKey: '', type: 'after_sales', subject: '', description: '', orderId: null })

Page({
  data: {
    mode: 'list', items: [], total: 0, page: 0, loading: false, error: '',
    detail: null, types: TYPES, typeIndex: 0, form: emptyForm(), submitting: false,
    orders: [], orderLabels: ['不关联订单'], orderIndex: 0, orderKeyword: '', ordersLoading: false
  },
  onLoad(options) { this._initial = options || {} },
  onShow() {
    this._active = true
    if (!auth.state.token) { wx.navigateTo({ url: '/pages/login/login' }); return }
    if (this._owner && !isCurrentSession(auth, this._owner)) {
      this.setData({ mode: 'list', items: [], detail: null, form: emptyForm(), page: 0, total: 0 })
      this._detailId = null
    }
    this._owner = captureSession(auth)
    if (!this._started && this._initial.type) {
      this._started = true
      this.openCreate(this._initial.type, Number(this._initial.orderId) || null)
    } else if (this.data.mode === 'detail' && this._detailId) this.loadDetail(this._detailId)
    else if (this.data.mode === 'list') this.loadList(true)
    this._started = true
  },
  onHide() {
    this._active = false
    this._request = (this._request || 0) + 1
    this._orders = (this._orders || 0) + 1
    this.setData({ loading: false, submitting: false, ordersLoading: false })
  },
  onUnload() { this.onHide() },
  onPullDownRefresh() {
    const task = this.data.mode === 'detail'
      ? this.loadDetail(this._detailId) : this.loadList(true)
    task.finally(() => wx.stopPullDownRefresh())
  },
  onReachBottom() {
    if (this.data.mode === 'list' && !this.data.loading && this.data.items.length < this.data.total) {
      this.loadList(false)
    }
  },
  live(session, generation) {
    return this._active && generation === this._request && isCurrentSession(auth, session)
  },
  async loadList(reset) {
    if (this.data.mode !== 'list') return
    const session = captureSession(auth)
    const generation = this._request = (this._request || 0) + 1
    const page = reset ? 1 : this.data.page + 1
    this.setData({ loading: true, error: '', ...(reset ? { items: [], page: 0, total: 0 } : {}) })
    try {
      const response = await api.getServiceRequests({ page, pageSize: 20 })
      if (!this.live(session, generation)) return
      const data = response.data || response
      const items = (data.items || []).map(item => ({ ...item,
        typeText: TYPES.find(type => type.value === item.type)?.label || '服务申请',
        statusText: STATUS[item.status] || item.status,
        dateText: formatShanghaiMinute(item.createdAt)
      }))
      this.setData({ items: reset ? items : this.data.items.concat(items), total: data.total, page })
    } catch (error) {
      if (this.live(session, generation)) this.setData({ error: error?.message || '申请加载失败' })
    } finally { if (this.live(session, generation)) this.setData({ loading: false }) }
  },
  onRetry() {
    if (this.data.mode === 'detail') this.loadDetail(this._detailId)
    else this.loadList(this.data.page === 0)
  },
  onCreate() { this.openCreate('after_sales') },
  openCreate(type, orderId = null) {
    const typeIndex = Math.max(0, TYPES.findIndex(item => item.value === type))
    this._request = (this._request || 0) + 1
    this.setData({ mode: 'compose', error: '', detail: null, typeIndex, orderIndex: 0,
      form: { ...emptyForm(), clientKey: api.serviceRequestKey(), type: TYPES[typeIndex].value, orderId }
    })
    this.loadOrders(orderId ? { orderId } : {})
  },
  onBack() {
    this._request = (this._request || 0) + 1
    this.setData({ mode: 'list', detail: null, error: '', form: emptyForm() })
    this.loadList(true)
  },
  onTypeChange(event) {
    const index = Number(event.detail.value)
    if (TYPES[index]) this.setData({ typeIndex: index, 'form.type': TYPES[index].value })
  },
  onFieldInput(event) {
    const field = event.currentTarget.dataset.field
    if (['subject', 'description'].includes(field)) this.setData({ [`form.${field}`]: event.detail.value })
  },
  onOrderKeyword(event) { this.setData({ orderKeyword: event.detail.value }) },
  onSearchOrders() { this.loadOrders({ keyword: this.data.orderKeyword.trim() }) },
  async loadOrders(query) {
    const session = captureSession(auth), generation = this._orders = (this._orders || 0) + 1
    this.setData({ ordersLoading: true })
    try {
      const response = await api.getServiceOrderOptions(query)
      if (!this._active || generation !== this._orders || !isCurrentSession(auth, session)) return
      const orders = response.data || response || []
      const selected = this.data.orders.find(item => item.id === this.data.form.orderId)
      if (selected && !query.orderId && !orders.some(item => item.id === selected.id)) orders.unshift(selected)
      const found = orders.findIndex(item => item.id === this.data.form.orderId)
      this.setData({ orders, orderLabels: ['不关联订单', ...orders.map(item => item.orderNo)],
        orderIndex: found + 1, 'form.orderId': found >= 0 ? orders[found].id : null })
    } catch (error) {
      if (this._active && generation === this._orders && isCurrentSession(auth, session)) {
        wx.showToast({ title: error?.message || '订单列表加载失败', icon: 'none' })
      }
    } finally {
      if (this._active && generation === this._orders) this.setData({ ordersLoading: false })
    }
  },
  onOrderChange(event) {
    const index = Number(event.detail.value)
    this.setData({ orderIndex: index, 'form.orderId': this.data.orders[index - 1]?.id || null })
  },
  onOpen(event) { this.loadDetail(Number(event.currentTarget.dataset.id)) },
  async loadDetail(id) {
    const session = captureSession(auth), generation = this._request = (this._request || 0) + 1
    this._detailId = id
    this.setData({ mode: 'detail', loading: true, detail: null, error: '' })
    try {
      const response = await api.getServiceRequest(id)
      if (!this.live(session, generation)) return
      const detail = response.data || response
      this.setData({ detail: { ...detail,
        typeText: TYPES.find(type => type.value === detail.type)?.label || '服务申请',
        statusText: STATUS[detail.status] || detail.status,
        events: (detail.events || []).map((item, index) => ({ ...item, eventKey: `${item.at}-${index}`,
          statusText: STATUS[item.status], dateText: formatShanghaiMinute(item.at) }))
      } })
    } catch (error) {
      if (this.live(session, generation)) this.setData({ error: error?.message || '申请暂不可访问' })
    } finally { if (this.live(session, generation)) this.setData({ loading: false }) }
  },
  onRefreshDetail() { this.loadDetail(this._detailId) },
  async onSubmit() {
    if (this.data.submitting) return
    const subject = this.data.form.subject.trim(), description = this.data.form.description.trim()
    if (!subject || !description) {
      wx.showToast({ title: '请填写事项和详细说明', icon: 'none' }); return
    }
    const session = captureSession(auth), generation = this._request = (this._request || 0) + 1
    this.setData({ submitting: true })
    try {
      const response = await api.createServiceRequest({ ...this.data.form, subject, description,
        orderId: this.data.form.orderId || undefined })
      if (!this.live(session, generation)) return
      const created = response.data || response
      this.setData({ submitting: false, form: emptyForm() })
      await this.loadDetail(created.id)
    } catch (error) {
      if (this.live(session, generation)) wx.showToast({ title: error?.message || '提交失败，请重试', icon: 'none' })
    } finally { if (this.live(session, generation)) this.setData({ submitting: false }) }
  }
})
