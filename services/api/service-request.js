const { request } = require('../request')

// 读取本人服务申请列表；params包含page/pageSize及可选状态，返回分页API响应。
function getServiceRequests(params) {
  return request({ url: '/api/v1/service-requests/mine', data: params, showLoading: false })
}

// 读取本人申请的详情及处理记录；id为申请编号对应ID，返回API响应。
function getServiceRequest(id) {
  return request({ url: `/api/v1/service-requests/mine/${id}`, showLoading: false })
}

// 提交人工服务申请；data包含幂等标识及表单，返回已创建或已有的申请。
function createServiceRequest(data) {
  return request({ url: '/api/v1/service-requests/mine', method: 'POST', data, showLoading: false })
}

// 搜索当前客户可关联的订单；query可传keyword或orderId，返回最多30条安全摘要。
function getServiceOrderOptions(query) {
  return request({ url: '/api/v1/service-requests/order-options', data: query, showLoading: false })
}

// 为一次申请表生成重试标识；不作为权限凭据，失败重试时保持不变。
function serviceRequestKey() {
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, character => {
    const value = Math.floor(Math.random() * 16)
    return (character === 'x' ? value : (value & 3) | 8).toString(16)
  })
}

module.exports = {
  getServiceRequests, getServiceRequest, createServiceRequest,
  getServiceOrderOptions, serviceRequestKey
}
