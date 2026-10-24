// 展示无需登录即可阅读的协议与隐私政策。
const legal = require('../../constants/legal')

Page({
  data: { title: '', intro: '', sections: [], notice: legal.notice, version: legal.version },
  onLoad(options) {
    const document = legal.documents[options.type] || legal.documents.terms
    this.setData(document)
    wx.setNavigationBarTitle({ title: document.title })
  },
  openWechatPrivacy() {
    if (typeof wx.openPrivacyContract !== 'function') { wx.showToast({ title: '请在微信小程序详情中查看隐私指引', icon: 'none' }); return }
    wx.openPrivacyContract({ fail: () => wx.showToast({ title: '微信隐私指引暂不可用，请稍后重试', icon: 'none' }) })
  },
  contact() { wx.makePhoneCall({ phoneNumber: legal.phone }) }
})
