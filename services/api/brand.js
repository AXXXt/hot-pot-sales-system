const { request } = require('../request')

function getBrandList() {
  return request({
    url: '/api/v1/brands',
    method: 'GET'
  })
}

module.exports = {
  getBrandList
}
