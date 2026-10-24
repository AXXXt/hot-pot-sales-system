// 订单关键提醒：提前加载模板，业务点击可一并申请后续提醒，拒绝或失败不影响采购。
const { getSubscribeTemplate } = require('../../../services/api/auth')
const { bindCurrentWechat, bindWechatForReminders } = require('../../../services/wechat')
const auth = require('../../../store/modules/auth')
const { captureSession, isCurrentSession } = require('../../../utils/auth-session')
const FUTURE_EVENTS = {
  draft: ['order.quoted', 'order.approved', 'order.shipped'],
  pending_quote: ['order.quoted', 'order.approved', 'order.shipped'],
  pending_confirm: ['order.approved', 'order.shipped'],
  pending_finance: ['order.approved', 'order.shipped'],
  pending_shipment: ['order.shipped'], shipped: [], completed: [], cancelled: []
}

Component({
  properties: {
    eligible: { type: Boolean, value: true },
    checkout: { type: Boolean, value: false },
    automatic: { type: Boolean, value: false },
    actionText: { type: String, value: '提交订单' },
    status: { type: String, value: '', observer() { this.updateChoices() } }
  },
  data: { noticeOptions: [], busy: false, message: '', selectedCount: 0 },
  lifetimes: {
    attached() {
      this._active = true
      getSubscribeTemplate().then(response => {
        if (!this._active) return
        const data = response?.data || {}
        this._catalog = Array.isArray(data.templates) ? data.templates : data.templateId
          ? [{ event: 'order.shipped', title: '发货提醒', templateId: data.templateId }] : []
        this.updateChoices()
      }).catch(() => {})
      bindCurrentWechat().catch(() => {})
    },
    detached() { this._active = false }
  },
  methods: {
    updateChoices() {
      if (!this._active || !this._catalog) return
      const events = FUTURE_EVENTS[this.properties.status]
      const seen = new Set()
      const templates = this._catalog.filter(item => {
        if (!item.templateId || seen.has(item.templateId) || (events && !events.includes(item.event))) return false
        seen.add(item.templateId)
        return true
      }).slice(0, 3).map(item => ({
        ...item, selected: this.data.noticeOptions.find(old => old.event === item.event)?.selected !== false
      }))
      this.setData({ noticeOptions: templates })
      this.reportSelection()
    },
    onToggle(e) {
      if (this.data.busy || !this.properties.eligible || this.properties.automatic) return
      const index = Number(e.currentTarget.dataset.index)
      if (!this.data.noticeOptions[index]) return
      this.setData({ [`noticeOptions[${index}].selected`]: !this.data.noticeOptions[index].selected })
      this.reportSelection()
    },
    reportSelection() {
      const selectedCount = this.data.noticeOptions.filter(item => item.selected).length
      this.setData({ selectedCount })
      this.triggerEvent('selection', { selectedCount, available: this.data.noticeOptions.length > 0 })
    },
    onSubscribe() { return this.requestSubscription() },
    requestSubscription(options = {}) {
      if (this._pending && isCurrentSession(auth, this._pendingSession)) return this._pending
      // 业务按钮申请所有仍可能发生的提醒；个人中心保留手动选择。
      const choices = this.data.noticeOptions.filter(item => options.automatic || item.selected)
      if (!this._active || !auth.state.token || !this.properties.eligible || !choices.length) {
        return Promise.resolve(false)
      }
      this.setData({ busy: true, message: '' })
      const session = captureSession(auth)
      const context = { session }
      this._pendingSession = session
      this._pendingContext = context
      // executor同步执行，微信API仍直接处于用户点击调用栈中。
      const pending = new Promise(resolve => {
        const finish = (message, accepted = false) =>
          this.finishSubscription(context, resolve, message, accepted)
        this.openSubscription(choices, session, finish)
      })
      this._pending = pending
      pending.finally(() => {
        if (this._pending !== pending) return
        this._pending = null
        this._pendingSession = null
        this._pendingContext = null
      })
      return pending
    },
    openSubscription(choices, session, finish) {
      if (typeof wx.requestSubscribeMessage !== 'function') {
        finish('当前微信暂不支持提醒，仍可正常下单。')
        return
      }
      try {
        wx.requestSubscribeMessage({
          tmplIds: choices.map(item => item.templateId),
          success: result => this.handleResult(result, choices, finish, session)
            .catch(() => finish('未能开启微信提醒，仍可正常下单并查看站内消息。')),
          fail: () => finish('未能开启微信提醒，仍可正常下单并查看站内消息。')
        })
      } catch { finish('未能开启微信提醒，仍可正常下单并查看站内消息。') }
    },
    finishSubscription(context, resolve, message, accepted) {
      const current = isCurrentSession(auth, context.session)
      const ownRequest = this._pendingContext === context
      // 旧账号只释放自己的锁，不能改写新账号正在申请的状态和提示。
      if (this._active && ownRequest) this.setData({ busy: false, message: current ? message : '' })
      resolve(Boolean(this._active && current && ownRequest && accepted))
    },
    async handleResult(result, choices, finish, session) {
      if (!this._active) { finish('', false); return }
      if (!isCurrentSession(auth, session)) {
        finish('登录账号已变化，请重新选择提醒。')
        return
      }
      const accepted = choices.filter(item => result[item.templateId] === 'accept')
      if (!accepted.length) {
        finish('本次未同意微信提醒，仍可正常下单并查看站内消息。')
        return
      }
      const bound = await bindWechatForReminders().catch(() => false)
      if (!isCurrentSession(auth, session)) {
        finish('登录账号已变化，请重新选择提醒。')
        return
      }
      const missing = accepted.length < choices.length ? '；其余提醒未开启' : ''
      finish(bound
        ? `已同意${accepted.length}种提醒，每种可发送一条${missing}。`
        : '已同意订阅，微信身份暂未绑定成功，请稍后重试。', bound)
    }
  }
})
