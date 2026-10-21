// 展示无需登录即可阅读的协议与隐私政策。
const legal = require('../../constants/legal')

Page({
  data: { title: '', intro: '', sections: [], notice: legal.notice, version: legal.version },
  onLoad(options) {
    const document = legal.documents[options.type] || legal.documents.terms
    this.setData(document)
    wx.setNavigationBarTitle({ title: document.title })
  },
  contact() { wx.makePhoneCall({ phoneNumber: legal.phone }) }
})
