const { request } = require('../request')

// 获取当前登录客户的协议价格。
function getMyPriceRules() {
  return request({
    url: '/api/v1/customers/me/price-rules',
    method: 'GET',
    showLoading: false
  })
}

module.exports = { getMyPriceRules }
