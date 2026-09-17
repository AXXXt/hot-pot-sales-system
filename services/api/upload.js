const env = require('../../config')
const auth = require('../../store/modules/auth')

// 上传转账凭证图片，返回后端保存的对象地址。
function uploadPaymentProof(filePath) {
  const token = auth.state.token || wx.getStorageSync('token') || ''
  if (!env.baseUrl) {
    return Promise.reject({ message: '后端地址未配置' })
  }

  return new Promise((resolve, reject) => {
    wx.uploadFile({
      url: `${env.baseUrl}/api/v1/uploads/payment-proof`,
      filePath,
      name: 'file',
      header: token ? { Authorization: `Bearer ${token}` } : {},
      success(res) {
        let payload = {}
        try {
          payload = JSON.parse(res.data || '{}')
        } catch {
          reject({ message: '上传响应格式错误' })
          return
        }
        if (res.statusCode < 200 || res.statusCode >= 300 || payload.code !== 0) {
          reject(payload.message ? payload : { message: '转账凭证上传失败' })
          return
        }
        resolve(payload)
      },
      fail(error) {
        reject({ message: error?.errMsg || '转账凭证上传失败' })
      }
    })
  })
}

module.exports = { uploadPaymentProof }
