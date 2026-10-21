// 原生 tabBar 页面不支持 URL 参数，用一次性状态传递筛选条件。
let pendingStatus = null
const statuses = ['all', 'pending', 'pending_confirm', 'pending_shipment', 'shipped', 'completed', 'cancelled']
function openOrders(status = 'all') {
  pendingStatus = statuses.includes(status) ? status : 'all'
  wx.switchTab({ url: '/pages/orders/orders', fail: () => { pendingStatus = null } })
}
function consumeStatus() {
  const status = pendingStatus
  pendingStatus = null
  return status
}
module.exports = { openOrders, consumeStatus }
