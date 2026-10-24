// 手机号登录、注册审核与登录后的微信身份绑定。
const { sendLoginCode, registerOrLogin, loginByPhone, checkStatus, verifyRegistrationStatus } = require('../../services/api/auth')
const { bindCurrentWechat } = require('../../services/wechat')
const auth = require('../../store/modules/auth')
const { getStorage, setStorage, removeStorage } = require('../../utils/storage')
const legal = require('../../constants/legal')

Page({
  data: {
    step: 'login',
    mode: 'login',
    phone: '',
    code: '',
    contactName: '',
    customerName: '',
    region: ['北京市', '北京市', '东城区'],
    regionStr: '',
    address: '',
    agree: false,
    sendingCode: false,
    submitting: false,
    countdown: 0,
    timerRunning: false,
    redirect: '',
    pendingCustomer: null,
    checking: false,
    approved: false,
    reviewRejected: false,
    reviewDisabled: false,
    statusVerification: false
  },

  onLoad(options) {
    const mode = options.mode || 'login'
    const savedPhone = getStorage('pendingPhone', '')

    if (auth.state.token) {
      this.setData({ step: 'done' })
      return
    }

    if (savedPhone && getStorage('pendingStep', '') === 'pending') {
      this.setData({ phone: savedPhone, mode, step: 'pending' })
      if (!getStorage('pendingStatusTicket', '')) { this.requireStatusVerification(); return }
      this.checkStatusSilent(savedPhone)
      return
    }

    this.setData({ mode, step: mode === 'register' ? 'register' : 'login' })
    this.setData({ redirect: options.redirect || '' })
  },

  onUnload() { if (this._timer) { clearInterval(this._timer); this._timer = null } },

  goLogin() { this.setData({ step: 'login', code: '', agree: false, statusVerification: false }) },
  goRegister() {
    this.setData({ step: 'register', code: '', agree: false, statusVerification: false, reviewRejected: false, reviewDisabled: false })
  },
  onEditApplication() { this.goRegister() },

  onPhoneInput(e)   { this.setData({ phone: e.detail.value.replace(/\D/g, '') }) },
  onCodeInput(e)    { this.setData({ code: e.detail.value.replace(/\D/g, '').slice(0, 6) }) },
  onNameInput(e)    { this.setData({ contactName: e.detail.value }) },
  onCompanyInput(e) { this.setData({ customerName: e.detail.value }) },
  onAddressInput(e) { this.setData({ address: e.detail.value }) },
  onAgreeChange(e)  { this.setData({ agree: e.detail.value.length > 0 }) },
  openTerms() { wx.navigateTo({ url: '/pages/legal/legal?type=terms' }) },
  openPrivacy() { wx.navigateTo({ url: '/pages/legal/legal?type=privacy' }) },

  onRegionChange(e) {
    const val = e.detail.value
    this.setData({ region: val, regionStr: val.join(' ') })
  },

  startCountdown(seconds) {
    if (this._timer) clearInterval(this._timer)
    this.setData({ countdown: Number(seconds || 60), timerRunning: true })
    this._timer = setInterval(() => {
      const next = this.data.countdown - 1
      if (next <= 0) { if (this._timer) clearInterval(this._timer); this.setData({ countdown: 0, timerRunning: false }); return }
      this.setData({ countdown: next })
    }, 1000)
  },

  onSendCode() {
    if (this.data.sendingCode || this.data.timerRunning) return
    if (!/^1\d{10}$/.test(this.data.phone)) {
      wx.showToast({ title: '请输入有效手机号', icon: 'none' }); return
    }
    this.setData({ sendingCode: true })
    sendLoginCode({
      phone: this.data.phone,
      purpose: this.data.step === 'register' ? 'register' : 'login'
    })
      .then(() => { this.startCountdown(60); wx.showToast({ title: '验证码已发送', icon: 'success' }) })
      .catch(err => wx.showToast({ title: err?.message || '发送失败', icon: 'none' }))
      .finally(() => this.setData({ sendingCode: false }))
  },

  // Simple login
  onLoginSubmit() {
    if (this.data.submitting) return
    if (!this.data.agree) { wx.showToast({ title: '请同意用户协议', icon: 'none' }); return }
    const { phone, code } = this.data

    if (!phone || !/^1\d{10}$/.test(phone)) { wx.showToast({ title: '请输入有效手机号', icon: 'none' }); return }
    if (!code || code.length !== 6) { wx.showToast({ title: '请输入6位验证码', icon: 'none' }); return }

    this.setData({ submitting: true })

    const verifying = this.data.statusVerification
    const submit = verifying ? verifyRegistrationStatus : loginByPhone
    submit({ phone, code, consentAccepted: this.data.agree, consentVersion: legal.version, consentChannel: 'mini' })
      .then(res => {
        const data = res?.data || {}
        if (verifying) {
          if (data.statusTicket) setStorage('pendingStatusTicket', data.statusTicket)
          this.setData({ statusVerification: false, code: '', agree: false })
          this.applyReviewStatus(data, false)
          return
        }
        removeStorage('pendingPhone'); removeStorage('pendingStep'); removeStorage('pendingStatusTicket')
        auth.setToken(data.accessToken)
        auth.setRefreshToken(data.refreshToken)
        auth.setUserInfo(data.user)
        if (data.customer) auth.setCustomer(data.customer)
        this.navigateAfterLogin()
      })
      .catch(err => {
        wx.showToast({ title: err?.message || '登录失败', icon: 'none', duration: 2500 })
      })
      .finally(() => this.setData({ submitting: false }))
  },

  // Registration submit
  onSubmit() {
    if (this.data.submitting) return
    if (!this.data.agree) { wx.showToast({ title: '请同意用户协议', icon: 'none' }); return }
    const { phone, code, contactName, customerName, region, address } = this.data

    if (!phone || !/^1\d{10}$/.test(phone)) { wx.showToast({ title: '请输入有效手机号', icon: 'none' }); return }
    if (!code || code.length !== 6) { wx.showToast({ title: '请输入6位验证码', icon: 'none' }); return }
    if (!customerName.trim()) { wx.showToast({ title: '请输入火锅店名或公司名称', icon: 'none' }); return }
    if (!contactName.trim()) { wx.showToast({ title: '请输入联系人姓名', icon: 'none' }); return }

    this.setData({ submitting: true })

    registerOrLogin({
      phone, code,
      consentAccepted: this.data.agree, consentVersion: legal.version, consentChannel: 'mini',
      contactName: contactName.trim(),
      customerName: customerName.trim(),
      province: region[0], city: region[1], district: region[2],
      address: address.trim()
    })
      .then(res => {
        const data = res?.data || {}
        if (data.pending) {
          setStorage('pendingPhone', phone)
          setStorage('pendingStep', 'pending')
          if (data.statusTicket) setStorage('pendingStatusTicket', data.statusTicket)
          this.setData({
            step: 'pending', approved: false, reviewRejected: false, reviewDisabled: false,
            code: '', pendingCustomer: data.customer || { customerName }
          })
          return
        }
        removeStorage('pendingPhone')
        removeStorage('pendingStep')
        removeStorage('pendingStatusTicket')
        auth.setToken(data.accessToken)
        auth.setRefreshToken(data.refreshToken)
        auth.setUserInfo(data.user)
        if (data.customer) auth.setCustomer(data.customer)
        this.navigateAfterLogin()
      })
      .catch(err => {
        wx.showToast({ title: err?.message || '提交失败', icon: 'none', duration: 2500 })
      })
      .finally(() => this.setData({ submitting: false }))
  },

  navigateAfterLogin() {
    bindCurrentWechat().catch(() => {})
    this.setData({ step: 'done' })
    setTimeout(() => {
      if (this.data.redirect) {
        wx.redirectTo({ url: decodeURIComponent(this.data.redirect) })
      } else {
        wx.switchTab({ url: '/pages/home/home' })
      }
    }, 600)
  },

  onApprovedLogin() {
    const phone = this.data.phone || getStorage('pendingPhone', '')
    if (!phone) { wx.showToast({ title: '手机号异常', icon: 'none' }); return }

    removeStorage('pendingPhone')
    removeStorage('pendingStep')
    removeStorage('pendingStatusTicket')
    this.setData({ step: 'login', phone, code: '', approved: false, agree: false, statusVerification: false })
    wx.showToast({ title: '请获取验证码登录', icon: 'none' })
  },

  onBackToPending() { this.setData({ approved: false, code: '' }) },

  applyReviewStatus(data, silent) {
    if (data.verificationRequired) { this.requireStatusVerification(); return }
    if (!data.exists || data.customerStatus === null) {
      removeStorage('pendingPhone'); removeStorage('pendingStep'); removeStorage('pendingStatusTicket')
      this.setData({ step: 'register', code: '', approved: false })
      wx.showToast({ title: '未找到注册申请，请重新提交', icon: 'none' })
      return
    }
    const approved = data.reviewStatus === 'approved' || (
      !data.reviewStatus && data.customerStatus === 'active' && data.userStatus === 'active'
    )
    const reviewRejected = data.reviewStatus === 'rejected'
    const reviewDisabled = data.reviewStatus === 'disabled'
    this.setData({
      step: 'pending', approved, reviewRejected, reviewDisabled,
      pendingCustomer: { customerName: data.customerName || this.data.pendingCustomer?.customerName || '' }
    })
    if (approved) wx.showToast({ title: '审核已通过', icon: 'success', duration: 1500 })
    else if (!silent && !reviewRejected && !reviewDisabled) {
      wx.showToast({ title: '仍在审核中，请耐心等待', icon: 'none' })
    }
  },

  async checkStatusSilent(phone) {
    const ticket = getStorage('pendingStatusTicket', '')
    if (!ticket) { this.requireStatusVerification(); return }
    try {
      const res = await checkStatus(phone, ticket)
      if (auth.state.token || phone !== this.data.phone) return
      this.applyReviewStatus(res?.data || {}, true)
    } catch (error) {
      if (auth.state.token || phone !== this.data.phone || error?.code === 'AUTH_SESSION_CHANGED') return
      if (error?.errorCode === 'AUTH_STATUS_TICKET_EXPIRED') this.requireStatusVerification()
      else this.setData({ step: 'pending', approved: false })
    }
  },

  requireStatusVerification() {
    removeStorage('pendingStatusTicket')
    this.setData({ step: 'login', statusVerification: true, code: '', agree: false, approved: false, pendingCustomer: null })
    wx.showToast({ title: '请重新验证手机号查询申请', icon: 'none' })
  },

  onPullDownRefresh() {
    if (this.data.checking) { wx.stopPullDownRefresh(); return }

    const phone = this.data.phone || getStorage('pendingPhone', '')
    const ticket = getStorage('pendingStatusTicket', '')
    if (!ticket) { wx.stopPullDownRefresh(); this.requireStatusVerification(); return }
    if (!phone) {
      wx.stopPullDownRefresh()
      wx.showToast({ title: '未找到手机号，请重新填写', icon: 'none' })
      this.setData({ step: 'register' })
      return
    }

    this.setData({ checking: true, phone })

    checkStatus(phone, ticket)
      .then(res => {
        wx.stopPullDownRefresh()
        if (auth.state.token || phone !== this.data.phone) return
        this.applyReviewStatus(res?.data || {}, false)
      })
      .catch(error => { wx.stopPullDownRefresh(); if (auth.state.token || phone !== this.data.phone || error?.code === 'AUTH_SESSION_CHANGED') return; if (error?.errorCode === 'AUTH_STATUS_TICKET_EXPIRED') this.requireStatusVerification(); else wx.showToast({ title: '网络请求失败，请重试', icon: 'none' }) })
      .finally(() => { this.setData({ checking: false }) })
  }
})
