// 个人中心展示数据：缺失信息与真实零值分开处理。
function money(value) {
  return value !== null && value !== undefined && value !== '' && Number.isFinite(Number(value))
    ? Number(value).toFixed(2) : '暂未提供'
}
function profileView(profile) {
  const c = profile.customer || {}
  const phone = c.contactPhone || profile.user?.phone || ''
  return {
    storeName: c.customerName || '未关联门店',
    contactName: c.contactName || '联系人待完善',
    phone: phone.replace(/^(\d{3})\d{4}(\d{4})$/, '$1****$2'),
    levelName: c.customerLevelName || '暂未设置等级',
    statusText: c.status === 'active' ? '已审核' : c.status === 'disabled' ? '暂未开通' : '状态待确认',
    hasCustomer: Boolean(c.id),
    creditEnabled: Number(c.creditLimit) > 0 || Number(c.creditUsed) > 0,
    creditRemaining: money(c.creditRemaining), creditLimit: money(c.creditLimit),
    creditUsed: money(c.creditUsed), creditDays: c.creditDays == null ? '未设置' : `${c.creditDays} 天`
  }
}
module.exports = { money, profileView }
