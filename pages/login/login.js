const { sendLoginCode, registerOrLogin, loginByPhone, checkStatus } = require('../../services/api/auth')
const auth = require('../../store/modules/auth')
const { getStorage, setStorage, removeStorage } = require('../../utils/storage')

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
    approved: false
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
      this.checkStatusSilent(savedPhone)
      return
    }

    this.setData({ mode, step: mode === 'register' ? 'register' : 'login' })
    this.setData({ redirect: options.redirect || '' })
  },

  onUnload() { if (this._timer) { clearInterval(this._timer); this._timer = null } },

  goLogin()    { this.setData({ step: 'login', code: '', agree: false }) },
  goRegister() { this.setData({ step: 'register', code: '', agree: false }) },

  onPhoneInput(e)   { this.setData({ phone: e.detail.value.replace(/\D/g, '') }) },
  onCodeInput(e)    { this.setData({ code: e.detail.value.replace(/\D/g, '').slice(0, 6) }) },
  onNameInput(e)    { this.setData({ contactName: e.detail.value }) },
  onCompanyInput(e) { this.setData({ customerName: e.detail.value }) },
  onAddressInput(e) { this.setData({ address: e.detail.value }) },
  onAgreeChange(e)  { this.setData({ agree: e.detail.value.length > 0 }) },

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
    sendLoginCode({ phone: this.data.phone })
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

    loginByPhone({ phone, code })
      .then(res => {
        const data = res?.data || {}
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
          this.setData({ step: 'pending', approved: false, pendingCustomer: data.customer || { customerName } })
          return
        }
        removeStorage('pendingPhone')
        removeStorage('pendingStep')
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
    this.setData({ step: 'login', phone, code: '', approved: false, agree: false })
    wx.showToast({ title: '请获取验证码登录', icon: 'none' })
  },

  onBackToPending() { this.setData({ approved: false, code: '' }) },

  async checkStatusSilent(phone) {
    try {
      const res = await checkStatus(phone)
      const data = res?.data || {}
      if (data.customerStatus === 'active') {
        wx.showToast({ title: '审核已通过', icon: 'success', duration: 1500 })
        this.setData({ approved: true })
      } else if (!data.exists || data.customerStatus === 'disabled' || data.customerStatus === null) {
        removeStorage('pendingPhone'); removeStorage('pendingStep')
        this.setData({ step: 'register', phone: '' })
        wx.showToast({ title: '审核未通过，请重新注册', icon: 'none', duration: 2500 })
      } else {
        this.setData({ step: 'pending', approved: false })
      }
    } catch { this.setData({ step: 'pending', approved: false }) }
  },

  onPullDownRefresh() {
    if (this.data.checking) { wx.stopPullDownRefresh(); return }

    const phone = this.data.phone || getStorage('pendingPhone', '')
    if (!phone) {
      wx.stopPullDownRefresh()
      wx.showToast({ title: '未找到手机号，请重新填写', icon: 'none' })
      this.setData({ step: 'register' })
      return
    }

    this.setData({ checking: true, phone })

    checkStatus(phone)
      .then(res => {
        wx.stopPullDownRefresh()
        const data = res?.data || {}
        if (data.customerStatus === 'active') {
          wx.showToast({ title: '审核已通过', icon: 'success', duration: 1500 })
          this.setData({ approved: true })
        } else if (!data.exists || data.customerStatus === 'disabled' || data.customerStatus === null) {
          removeStorage('pendingPhone'); removeStorage('pendingStep')
          wx.showToast({ title: '审核未通过，请重新注册', icon: 'none', duration: 2500 })
          this.setData({ step: 'register', phone: '' })
        } else {
          wx.showToast({ title: '仍在审核中，请耐心等待', icon: 'none' })
        }
      })
      .catch(() => { wx.stopPullDownRefresh(); wx.showToast({ title: '网络请求失败，请重试', icon: 'none' }) })
      .finally(() => { this.setData({ checking: false }) })
  }
})
