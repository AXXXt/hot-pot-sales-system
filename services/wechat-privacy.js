// 仅在用户主动选图前调用；业务协议勾选不代替微信平台的隐私授权。
function ensureWechatPrivacy() {
  if (typeof wx.requirePrivacyAuthorize !== 'function') return Promise.resolve()
  return new Promise((resolve, reject) => {
    const failed = () => reject({ code: 'WECHAT_PRIVACY_REJECTED', message: '请先同意微信隐私保护指引后再选择图片' })
    try { wx.requirePrivacyAuthorize({ success: () => resolve(), fail: failed }) } catch { failed() }
  })
}

module.exports = { ensureWechatPrivacy }
