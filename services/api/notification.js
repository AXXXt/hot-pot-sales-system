// 当前登录账号的站内消息与已读状态，服务端负责租户和订单归属校验。
const { request } = require('../request')
function getNotifications(page = 1, pageSize = 20) {
  return request({ url: '/api/v1/notifications', method: 'GET', data: { page, pageSize }, showLoading: false })
}
function readNotification(id) {
  return request({ url: `/api/v1/notifications/${Number(id)}/read`, method: 'PATCH', showLoading: false })
}
function readAllNotifications() {
  return request({ url: '/api/v1/notifications/read-all', method: 'PATCH', showLoading: false })
}
module.exports = { getNotifications, readNotification, readAllNotifications }
