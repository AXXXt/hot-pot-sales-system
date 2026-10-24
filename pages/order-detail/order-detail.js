// 订单详情、草稿恢复与付款确认；返回时刷新，并保留原生选图期间的业务上下文。
const { getOrderDetail, cancelOrder, completeOrder, submitFinance, submitOrder } = require('../../services/api/order')
const { uploadPaymentProof } = require('../../services/api/upload')
const { requestOrderReminders } = require('../../services/order-reminders')
const { ensureWechatPrivacy } = require('../../services/wechat-privacy')
const auth = require('../../store/modules/auth')
const { captureSession, isCurrentSession } = require('../../utils/auth-session')
const { logisticsText } = require('../../utils/logistics')

const STATUS_MAP = {
  draft: { text: '草稿', variant: 'info' },
  pending_quote: { text: '待报价', variant: 'warning' },
  pending_confirm: { text: '待确认报价', variant: 'warning' },
  pending_finance: { text: '待审核', variant: 'warning' },
  pending_shipment: { text: '待发货', variant: 'primary' },
  shipped: { text: '已发货', variant: 'primary' },
  completed: { text: '已完成', variant: 'success' },
  cancelled: { text: '已取消', variant: 'info' }
}

Page({
  data: {
    loading: true,
    error: '',
    orderId: '',
    orderNo: '',
    orderTime: '',
    statusText: '',
    statusVariant: '',
    items: [],
    totalAmount: '',
    discountAmount: '',
    adjustAmount: '0.00',
    priceAdjustments: [],
    payableAmount: '',
    remark: '',
    customerName: '',
    customerContact: '',
    logisticsText: '',
    canCancel: false,
    canConfirm: false,
    canSubmitFinance: false,
    canSubmitDraft: false,
    submittingDraft: false,
    paymentProof: '',
    financeRejectionReason: '',
    financeRevision: '',
    paymentMethodText: '',
    creditRemaining: '0.00',
    submittingFinance: false,
    canSubscribeShipment: false
  },

  onLoad(options) {
    this._active = true
    this._hasShown = false
    const orderId = String(options.id || '').trim()
    if (!orderId || !/^\d+$/.test(orderId)) {
      this.setData({ loading: false, error: '订单不存在或参数无效' })
      return
    }
    this.setData({ orderId })
    return this.loadDetail(orderId)
  },

  onShow() {
    const wasActive = this._active
    this._active = true
    const nativeHidden = this._nativeHidden
    this._nativeHidden = null
    if (!this._hasShown) { this._hasShown = true; return }
    if ((nativeHidden && this.isCurrentAction(nativeHidden.context)) ||
      (wasActive && (this._nativeInteraction || this._financeContext || this._draftContext || this._orderAction))) {
      this._refreshAfterNative = true
      if (this._nativeInteraction || this._financeContext || this._draftContext || this._orderAction) return
    } else if (nativeHidden) {
      this.invalidateDetail()
      this._active = true
      this.clearPrivateDetail()
    }
    if (this.data.orderId) return this.loadDetail(this.data.orderId)
  },

  onHide() {
    // chooseMedia等系统界面可能先触发onHide，也可能先回调再onShow，不能当作离开订单。
    if (this._nativeInteraction && this.isCurrentAction(this._nativeInteraction.context)) {
      this._nativeHidden = this._nativeInteraction
      return
    }
    this.invalidateDetail()
    this.clearPrivateDetail()
  },

  onUnload() { this.invalidateDetail(); this.clearPrivateDetail() },

  invalidateDetail() {
    this._active = false
    this._pageEpoch = (this._pageEpoch || 0) + 1
    this._detailRequest = (this._detailRequest || 0) + 1
    this._financeContext = null
    this._draftContext = null
    this._orderAction = null
    this._nativeInteraction = null
    this._nativeHidden = null
    this._refreshAfterNative = false
    if (this._uploadingProof) wx.hideLoading()
    this._uploadingProof = null
  },

  clearPrivateDetail(error = '') {
    this._loadedSession = null
    this.setData({
      loading: false, error, orderNo: '', orderTime: '', statusText: '', statusVariant: '',
      items: [], totalAmount: '', discountAmount: '', adjustAmount: '0.00',
      priceAdjustments: [], payableAmount: '', remark: '',
      customerName: '', customerContact: '', logisticsText: '', paymentProof: '', financeRejectionReason: '', financeRevision: '',
      paymentMethodText: '', creditRemaining: '0.00', canCancel: false, canConfirm: false,
      canSubmitFinance: false, canSubmitDraft: false, canSubscribeShipment: false,
      noticeStatus: '', submittingFinance: false, submittingDraft: false
    })
  },

  actionContext(orderId = this.data.orderId) {
    return { session: captureSession(auth), orderId, pageEpoch: this._pageEpoch || 0 }
  },

  isCurrentAction(context) {
    return this._active && isCurrentSession(auth, context.session) &&
      this.data.orderId === context.orderId && (this._pageEpoch || 0) === context.pageEpoch
  },

  async withNativeInteraction(context, callback) {
    const interaction = { context }
    this._nativeInteraction = interaction
    try { return await callback() }
    finally { if (this._nativeInteraction === interaction) this._nativeInteraction = null }
  },

  showNativeChoiceError(error, context, message) {
    const reason = typeof error?.errMsg === 'string' ? error.errMsg : ''
    if (!/cancel/i.test(reason) && this.isCurrentAction(context)) {
      wx.showToast({ title: message, icon: 'none' })
    }
  },

  async refreshAfterAction() {
    if (!this._active || !this._refreshAfterNative) return
    this._refreshAfterNative = false
    if (this.data.orderId) await this.loadDetail(this.data.orderId)
  },

  async loadDetail(orderId) {
    if (!this._active) return
    if (!auth.state.token) { this.clearPrivateDetail('请先登录'); return }
    const context = this.actionContext(orderId)
    const request = this._detailRequest = (this._detailRequest || 0) + 1
    this.setData({ loading: true, error: '' })
    try {
      const res = await getOrderDetail(orderId)
      if (!this.isCurrentAction(context) || request !== this._detailRequest) return
      const order = res?.data || {}
      const customer = order.customer || {}
      this._loadedSession = context.session
      this._refreshAfterNative = false

      const items = (order.items || []).map(item => ({
        id: item.id,
        name: item.productName || '商品',
        spec: item.skuSpecText || '',
        quantity: item.quantity,
        amountText: Number(item.amount || 0).toFixed(2)
      }))

      this.setData({
        loading: false,
        canSubscribeShipment: ['draft', 'pending_quote', 'pending_confirm', 'pending_finance', 'pending_shipment'].includes(order.status),
        noticeStatus: order.status,
        orderNo: order.orderNo || '',
        orderTime: this.formatTime(order.createdAt),
        statusText: STATUS_MAP[order.status]?.text || order.status || '',
        statusVariant: STATUS_MAP[order.status]?.variant || 'info',
        items,
        totalAmount: order.totalAmount ? Number(order.totalAmount).toFixed(2) : '0.00',
        discountAmount: order.discountAmount ? Number(order.discountAmount).toFixed(2) : '0.00',
        adjustAmount: Number(order.adjustAmount || 0).toFixed(2),
        priceAdjustments: (Array.isArray(order.priceAdjustments) ? order.priceAdjustments : [])
          .map(record => ({
            id: record.id,
            beforeAmount: Number(record.beforeAmount || 0).toFixed(2),
            afterAmount: Number(record.afterAmount || 0).toFixed(2),
            reason: record.reason || '',
            time: this.formatTime(record.createdAt)
          })),
        payableAmount: (order.payableAmount || order.totalAmount) ? Number(order.payableAmount || order.totalAmount).toFixed(2) : '0.00',
        remark: order.remark || '',
        customerName: customer.customerName || '--',
        customerContact: [customer.contactName, customer.contactPhone].filter(Boolean).join(' ') || '--',
        logisticsText: logisticsText(order.logisticsType),
        canCancel: ['draft', 'pending_quote', 'pending_confirm', 'pending_finance'].includes(order.status),
        canConfirm: order.status === 'shipped',
        canSubmitFinance: order.status === 'pending_confirm',
        canSubmitDraft: order.status === 'draft',
        paymentProof: order.paymentProof || '',
        financeRejectionReason: order.financeRejection?.reason || '',
        financeRevision: order.updatedAt || '',
        paymentMethodText: order.paymentMethod === 'credit'
          ? '账期支付'
          : (order.paymentMethod === 'transfer' ? '转账凭证' : ''),
        creditRemaining: Number(customer.creditRemaining || 0).toFixed(2)
      })
    } catch (err) {
      if (!this.isCurrentAction(context) || request !== this._detailRequest) return
      this._refreshAfterNative = false
      this.setData({ loading: false, error: err?.message || '加载失败' })
    } finally {
      if (this._active && request === this._detailRequest && this.data.loading) {
        this.clearPrivateDetail('登录状态已变化，请返回后重新进入订单')
      }
    }
  },

  onRetry() {
    if (this.data.orderId) this.loadDetail(this.data.orderId)
  },

  async onCancel() {
    if (this.data.submittingFinance || this.data.submittingDraft || this._orderAction || !this._active || !auth.state.token) return
    const context = this.actionContext()
    this._orderAction = context
    try {
      const confirmed = await this.withNativeInteraction(context, () => new Promise(resolve => wx.showModal({
        title: '取消订单', content: '确定要取消此订单吗？',
        success: res => resolve(Boolean(res.confirm)), fail: () => resolve(false)
      })))
      if (!confirmed || !this.isCurrentAction(context)) return
      await cancelOrder(context.orderId)
      if (!this.isCurrentAction(context)) return
      wx.showToast({ title: '已取消', icon: 'success' })
      await this.loadDetail(context.orderId)
    } catch (err) {
      if (this.isCurrentAction(context)) wx.showToast({ title: err?.message || '取消失败', icon: 'none' })
    } finally {
      if (this._orderAction === context) {
        this._orderAction = null
        await this.refreshAfterAction()
      }
    }
  },

  async onConfirmReceipt() {
    if (this.data.submittingFinance || this.data.submittingDraft || this._orderAction || !this._active || !auth.state.token) return
    const context = this.actionContext()
    this._orderAction = context
    try {
      const confirmed = await this.withNativeInteraction(context, () => new Promise(resolve => wx.showModal({
        title: '确认收货', content: '确定已收到货物吗？',
        success: res => resolve(Boolean(res.confirm)), fail: () => resolve(false)
      })))
      if (!confirmed || !this.isCurrentAction(context)) return
      await completeOrder(context.orderId)
      if (!this.isCurrentAction(context)) return
      wx.showToast({ title: '已确认收货', icon: 'success' })
      await this.loadDetail(context.orderId)
    } catch (err) {
      if (this.isCurrentAction(context)) wx.showToast({ title: err?.message || '操作失败', icon: 'none' })
    } finally {
      if (this._orderAction === context) {
        this._orderAction = null
        await this.refreshAfterAction()
      }
    }
  },

  async onSubmitFinance() {
    if (this.data.submittingFinance || this.data.submittingDraft || this._orderAction || !this.data.canSubmitFinance ||
      !this._active || !auth.state.token) return
    const context = this.actionContext()
    if (this._loadedSession && !isCurrentSession(auth, this._loadedSession)) {
      this.clearPrivateDetail('登录状态已变化，请返回后重新进入订单'); return
    }
    const hasProof = Boolean(this.data.paymentProof)
    const creditLabel = `账期支付（可用 ¥${this.data.creditRemaining}）`
    const itemList = hasProof
      ? [creditLabel, '使用已上传凭证', '重新上传转账凭证']
      : [creditLabel, '上传转账凭证']

    this._financeContext = context
    this.setData({ submittingFinance: true })
    try {
      // 直接在业务点击栈申请审核/发货提醒，不能等凭证上传后再调用。
      await this.withNativeInteraction(context, () => requestOrderReminders(this))
      if (!this.isCurrentAction(context)) return
      const choice = await this.withNativeInteraction(context, () => new Promise(resolve => wx.showActionSheet({
        itemList, success: res => resolve(res.tapIndex), fail: error => {
          this.showNativeChoiceError(error, context, '付款方式选择暂不可用，请重试')
          resolve(null)
        }
      }))).catch(error => {
        this.showNativeChoiceError(error, context, '付款方式选择暂不可用，请重试')
        return null
      })
      if (choice === null || !this.isCurrentAction(context)) return
      await this.handleFinanceChoice(choice, hasProof, context)
    } catch (error) {
      if (this.isCurrentAction(context)) {
        wx.showToast({ title: error?.message || '操作失败，请重试', icon: 'none' })
      }
    } finally {
      if (this._financeContext === context) {
        this._financeContext = null
        if (this._active) this.setData({ submittingFinance: false })
        await this.refreshAfterAction()
      }
    }
  },

  async handleFinanceChoice(tapIndex, hasProof, context) {
    if (tapIndex === 0) {
      const confirmed = await this.confirmCreditPayment(context)
      if (confirmed && this.isCurrentAction(context)) {
        await this.submitFinanceData({ creditRequested: true }, context)
      }
      return
    }
    if (hasProof && tapIndex === 1) {
      await this.submitFinanceData({ paymentProof: this.data.paymentProof }, context)
      return
    }

    await this.uploadFinanceProof(context)
  },

  async uploadFinanceProof(context) {
    const consent = await this.withNativeInteraction(context, () => new Promise(resolve => wx.showModal({
      title: '付款凭证授权',
      content: '为核验本次付款，我们将处理您上传的转账凭证。请遮盖余额、完整银行卡号和无关交易，仅保留本次核验所需信息。是否同意并继续？',
      confirmText: '同意继续',
      success: res => resolve(Boolean(res.confirm)),
      fail: error => {
        this.showNativeChoiceError(error, context, '授权提示暂不可用，请重试')
        resolve(false)
      }
    }))).catch(error => {
      this.showNativeChoiceError(error, context, '授权提示暂不可用，请重试')
      return false
    })
    if (!consent || !this.isCurrentAction(context)) return
    await this.withNativeInteraction(context, () => ensureWechatPrivacy())
    if (!this.isCurrentAction(context)) return
    const file = await this.choosePaymentProofFile()
    if (!file || !this.isCurrentAction(context)) return
    if (Number(file.size || 0) > 5 * 1024 * 1024) {
      wx.showToast({ title: '图片不能超过 5MB', icon: 'none' })
      return
    }

    this._uploadingProof = context
    wx.showLoading({ title: '上传中', mask: true })
    try {
      const uploadRes = await uploadPaymentProof(file.tempFilePath, { isActive: () => this.isCurrentAction(context) })
      if (!this.isCurrentAction(context)) return
      const paymentProof = uploadRes?.data?.url || uploadRes?.url
      if (!paymentProof) throw new Error('转账凭证上传失败')
      await this.submitFinanceData({ paymentProof }, context)
    } catch (err) {
      if (this.isCurrentAction(context)) {
        wx.showToast({ title: err?.message || '提交失败', icon: 'none' })
      }
    } finally {
      if (this._uploadingProof === context) {
        wx.hideLoading()
        this._uploadingProof = null
      }
    }
  },

  confirmCreditPayment(context = this.actionContext()) {
    return this.withNativeInteraction(context, () => new Promise((resolve) => {
      wx.showModal({
        title: '确认报价并使用账期',
        content: `本单应付 ¥${this.data.payableAmount}，当前可用账期额度 ¥${this.data.creditRemaining}。确认后将占用对应额度。`,
        confirmText: '确认使用',
        success: (res) => resolve(Boolean(res.confirm)),
        fail: error => {
          this.showNativeChoiceError(error, context, '账期确认暂不可用，请重试')
          resolve(false)
        }
      })
    })).catch(error => {
      this.showNativeChoiceError(error, context, '账期确认暂不可用，请重试')
      return false
    })
  },

  async onSubmitDraft() {
    if (this.data.submittingDraft || this.data.submittingFinance || this._orderAction || !this.data.canSubmitDraft ||
      !this._active || !auth.state.token) return
    const context = this.actionContext()
    if (this._loadedSession && !isCurrentSession(auth, this._loadedSession)) {
      this.clearPrivateDetail('登录状态已变化，请返回后重新进入订单'); return
    }
    this._draftContext = context
    this.setData({ submittingDraft: true })
    try {
      await this.withNativeInteraction(context, () => requestOrderReminders(this))
      if (!this.isCurrentAction(context)) return
      await submitOrder(context.orderId)
      if (!this.isCurrentAction(context)) return
      wx.showToast({ title: '已提交，等待报价', icon: 'success' })
      await this.loadDetail(context.orderId)
    } catch (error) {
      if (this.isCurrentAction(context)) {
        wx.showToast({ title: error?.message || '提交失败，请重试', icon: 'none' })
      }
    } finally {
      if (this._draftContext === context) {
        this._draftContext = null
        if (this._active) this.setData({ submittingDraft: false })
        await this.refreshAfterAction()
      }
    }
  },

  choosePaymentProofFile() {
    const context = this.actionContext()
    return this.withNativeInteraction(context, () => new Promise((resolve) => {
      const showError = message => {
        if (this.isCurrentAction(context)) wx.showToast({ title: message, icon: 'none', duration: 3000 })
        resolve(null)
      }
      const failed = error => {
        const reason = typeof error?.errMsg === 'string' ? error.errMsg : ''
        if (/cancel/i.test(reason)) { resolve(null); return }
        showError(/privacy|permission|auth deny|authorize|权限|隐私/i.test(reason)
          ? '无法读取图片，请检查微信授权后重试' : '未能选择图片，请重新选择或稍后重试')
      }
      try {
        wx.chooseMedia({
          count: 1,
          mediaType: ['image'],
          sourceType: ['album', 'camera'],
          success: (res) => {
            const file = res?.tempFiles?.[0]
            if (!file || typeof file.tempFilePath !== 'string' || !file.tempFilePath.trim()) {
              showError('未获取到图片，请重新选择'); return
            }
            resolve(file)
          },
          fail: failed
        })
      } catch { failed({}) }
    }))
  },

  async submitFinanceData(data, context) {
    if (!this.isCurrentAction(context)) return
    try {
      const revision = this.data.financeRevision ? { expectedUpdatedAt: this.data.financeRevision, expectedPayableAmount: this.data.payableAmount } : {}
      await submitFinance(context.orderId, { ...data, ...revision })
      if (!this.isCurrentAction(context)) return
      wx.showToast({ title: '已提交', icon: 'success' })
      await this.loadDetail(context.orderId)
    } catch (err) {
      if (this.isCurrentAction(context)) {
        wx.showToast({ title: err?.message || '提交失败', icon: 'none' })
        if (err?.errorCode === 'ORD_QUOTE_CHANGED') await this.loadDetail(context.orderId)
      }
    }
  },

  formatTime(dateStr) {
    if (!dateStr) return ''
    const d = new Date(dateStr)
    const pad = function (n) { return String(n).padStart(2, '0') }
    return pad(d.getFullYear()) + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate()) + ' ' + pad(d.getHours()) + ':' + pad(d.getMinutes())
  }
})
