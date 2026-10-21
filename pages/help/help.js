// 采购常见问题与微信意见反馈，客服电话仅使用已配置的值。
const { auth } = require('../../store/index')
const { getProfile } = require('../../services/api/auth')
const QUESTIONS = [
  { title: '订单提交后，什么时候付款？', answer: '提交采购需求后等待报价。在待确认订单中核对报价，再上传转账凭证或申请账期，审核通过后安排发货。当前不支持微信在线扣款。' },
  { title: '再次采购为什么会调整数量？', answer: '再次采购按当前可售范围、库存、起订量与价格加入购物车。下架或库存不足的规格可能无法加入，请在结算前核对商品和数量。' },
  { title: '如何修改收货信息？', answer: '请联系工作人员确认新的收货人、电话与地址。已经提交的订单还需要单独核对配送安排，不能只修改门店资料。' },
  { title: '收到商品有问题怎么办？', answer: '请保留商品、包装、批次信息和现场照片，记录订单号后联系工作人员核实处理。请勿仅在意见反馈中提交紧急售后事项。' },
  { title: '账期可用额度为什么会变化？', answer: '账期订单占用额度，还款登记或符合条件的订单取消会调整额度。已用额度不等于逾期欠款，还款时间以双方约定为准。' }
]
Page({
  data: { questions: QUESTIONS, expanded: -1, phone: '', hours: '', loading: false, error: '' },
  onLoad() { this.loadSupport() },
  async loadSupport() {
    if (!auth.state.token) return
    this.setData({ loading: true, error: '', phone: '', hours: '' })
    try {
      const result = await getProfile()
      const support = (result?.data || result)?.support || {}
      const phone = String(support.phone || '').trim()
      this.setData({ phone: /^[+\d][\d\s-]{5,24}$/.test(phone) ? phone : '', hours: support.hours || '' })
    } catch (error) { this.setData({ error: error?.message || '联系方式加载失败' }) }
    finally { this.setData({ loading: false }) }
  },
  toggleQuestion(e) {
    const index = Number(e.currentTarget.dataset.index)
    this.setData({ expanded: this.data.expanded === index ? -1 : index })
  },
  callSupport() {
    if (!this.data.phone) return
    wx.makePhoneCall({ phoneNumber: this.data.phone, fail: () => wx.showToast({ title: '未拨出，可复制号码联系', icon: 'none' }) })
  },
  copyPhone() { if (this.data.phone) wx.setClipboardData({ data: this.data.phone }) }
})
