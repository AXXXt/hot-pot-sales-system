const { getOrderDetail, cancelOrder, completeOrder, submitFinance } = require('../../services/api/order')
const { uploadPaymentProof } = require('../../services/api/upload')

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
    payableAmount: '',
    remark: '',
    customerName: '',
    customerContact: '',
    logisticsText: '',
    canCancel: false,
    canConfirm: false,
    canSubmitFinance: false,
    paymentProof: '',
    paymentMethodText: '',
    creditRemaining: '0.00',
    submittingFinance: false
  },

  onLoad(options) {
    const orderId = String(options.id || '').trim()
    if (!orderId || !/^\d+$/.test(orderId)) {
      this.setData({ loading: false, error: '订单不存在或参数无效' })
      return
    }
    this.setData({ orderId })
    this.loadDetail(orderId)
  },

  async loadDetail(orderId) {
    this.setData({ loading: true, error: '' })
    try {
      const res = await getOrderDetail(orderId)
      const order = res?.data || {}
      const customer = order.customer || {}

      const items = (order.items || []).map(item => ({
        id: item.id,
        name: item.productName || '商品',
        spec: item.skuSpecText || '',
        quantity: item.quantity,
        amountText: Number(item.amount || 0).toFixed(2)
      }))

      this.setData({
        loading: false,
        orderNo: order.orderNo || '',
        orderTime: this.formatTime(order.createdAt),
        statusText: STATUS_MAP[order.status]?.text || order.status || '',
        statusVariant: STATUS_MAP[order.status]?.variant || 'info',
        items,
        totalAmount: order.totalAmount ? Number(order.totalAmount).toFixed(2) : '0.00',
        discountAmount: order.discountAmount ? Number(order.discountAmount).toFixed(2) : '0.00',
        payableAmount: (order.payableAmount || order.totalAmount) ? Number(order.payableAmount || order.totalAmount).toFixed(2) : '0.00',
        remark: order.remark || '',
        customerName: customer.customerName || '--',
        customerContact: [customer.contactName, customer.contactPhone].filter(Boolean).join(' ') || '--',
        logisticsText: order.logisticsType || '',
        canCancel: ['draft', 'pending_quote', 'pending_confirm', 'pending_finance'].includes(order.status),
        canConfirm: order.status === 'shipped',
        canSubmitFinance: order.status === 'pending_confirm',
        paymentProof: order.paymentProof || '',
        paymentMethodText: order.paymentMethod === 'credit'
          ? '账期支付'
          : (order.paymentMethod === 'transfer' ? '转账凭证' : ''),
        creditRemaining: Number(customer.creditRemaining || 0).toFixed(2)
      })
    } catch (err) {
      this.setData({ loading: false, error: err?.message || '加载失败' })
    }
  },

  async onCancel() {
    wx.showModal({
      title: '取消订单',
      content: '确定要取消此订单吗？',
      success: async (res) => {
        if (!res.confirm) return
        try {
          await cancelOrder(this.data.orderId)
          wx.showToast({ title: '已取消', icon: 'success' })
          setTimeout(() => this.loadDetail(this.data.orderId), 500)
        } catch (err) {
          wx.showToast({ title: err?.message || '取消失败', icon: 'none' })
        }
      }
    })
  },

  async onConfirmReceipt() {
    wx.showModal({
      title: '确认收货',
      content: '确定已收到货物吗？',
      success: async (res) => {
        if (!res.confirm) return
        try {
          await completeOrder(this.data.orderId)
          wx.showToast({ title: '已确认收货', icon: 'success' })
          setTimeout(() => this.loadDetail(this.data.orderId), 500)
        } catch (err) {
          wx.showToast({ title: err?.message || '操作失败', icon: 'none' })
        }
      }
    })
  },

  async onSubmitFinance() {
    if (this.data.submittingFinance) return
    const hasProof = Boolean(this.data.paymentProof)
    const creditLabel = `账期支付（可用 ¥${this.data.creditRemaining}）`
    const itemList = hasProof
      ? [creditLabel, '使用已上传凭证', '重新上传转账凭证']
      : [creditLabel, '上传转账凭证']

    wx.showActionSheet({
      itemList,
      success: (res) => this.handleFinanceChoice(res.tapIndex, hasProof)
    })
  },

  async handleFinanceChoice(tapIndex, hasProof) {
    if (tapIndex === 0) {
      const confirmed = await this.confirmCreditPayment()
      if (confirmed) await this.submitFinanceData({ creditRequested: true })
      return
    }
    if (hasProof && tapIndex === 1) {
      await this.submitFinanceData({ paymentProof: this.data.paymentProof })
      return
    }

    const file = await this.choosePaymentProofFile()
    if (!file) return
    if (Number(file.size || 0) > 5 * 1024 * 1024) {
      wx.showToast({ title: '图片不能超过 5MB', icon: 'none' })
      return
    }

    this.setData({ submittingFinance: true })
    wx.showLoading({ title: '上传中', mask: true })
    try {
      const uploadRes = await uploadPaymentProof(file.tempFilePath)
      const paymentProof = uploadRes?.data?.url || uploadRes?.url
      if (!paymentProof) throw new Error('转账凭证上传失败')
      await submitFinance(this.data.orderId, { paymentProof })
      wx.showToast({ title: '报价已确认', icon: 'success' })
      setTimeout(() => this.loadDetail(this.data.orderId), 500)
    } catch (err) {
      wx.showToast({ title: err?.message || '提交失败', icon: 'none' })
    } finally {
      wx.hideLoading()
      this.setData({ submittingFinance: false })
    }
  },

  confirmCreditPayment() {
    return new Promise((resolve) => {
      wx.showModal({
        title: '确认报价并使用账期',
        content: `本单应付 ¥${this.data.payableAmount}，当前可用账期额度 ¥${this.data.creditRemaining}。确认后将占用对应额度。`,
        confirmText: '确认使用',
        success: (res) => resolve(Boolean(res.confirm)),
        fail: () => resolve(false)
      })
    })
  },

  choosePaymentProofFile() {
    return new Promise((resolve) => {
      wx.chooseMedia({
        count: 1,
        mediaType: ['image'],
        sourceType: ['album', 'camera'],
        success: (res) => resolve(res.tempFiles?.[0] || null),
        fail: () => resolve(null)
      })
    })
  },

  async submitFinanceData(data) {
    this.setData({ submittingFinance: true })
    try {
      await submitFinance(this.data.orderId, data)
      wx.showToast({ title: '已提交', icon: 'success' })
      setTimeout(() => this.loadDetail(this.data.orderId), 500)
    } catch (err) {
      wx.showToast({ title: err?.message || '提交失败', icon: 'none' })
    } finally {
      this.setData({ submittingFinance: false })
    }
  },

  formatTime(dateStr) {
    if (!dateStr) return ''
    const d = new Date(dateStr)
    const pad = function (n) { return String(n).padStart(2, '0') }
    return pad(d.getFullYear()) + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate()) + ' ' + pad(d.getHours()) + ':' + pad(d.getMinutes())
  }
})
