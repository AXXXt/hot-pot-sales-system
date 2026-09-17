const { request } = require('../request')

function getOrderList(params) {
  return request({
    url: '/api/v1/orders',
    method: 'GET',
    data: params
  })
}

function getOrderDetail(id) {
  return request({
    url: `/api/v1/orders/${id}`,
    method: 'GET'
  })
}

function createOrder(data) {
  return request({
    url: '/api/v1/orders',
    method: 'POST',
    data
  })
}

function submitOrder(id) {
  return request({
    url: `/api/v1/orders/${id}/submit`,
    method: 'POST'
  })
}

function submitFinance(id, data) {
  return request({
    url: `/api/v1/orders/${id}/submit-finance`,
    method: 'POST',
    data
  })
}

function cancelOrder(id) {
  return request({
    url: `/api/v1/orders/${id}/cancel`,
    method: 'POST'
  })
}

function completeOrder(id) {
  return request({
    url: `/api/v1/orders/${id}/complete`,
    method: 'POST'
  })
}

module.exports = {
  getOrderList,
  getOrderDetail,
  createOrder,
  submitOrder,
  submitFinance,
  cancelOrder,
  completeOrder
}
