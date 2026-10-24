// 在订单业务按钮的点击栈内申请后续提醒；拒绝、缺少模板或异常不阻断业务。

/** 同步调用已加载的提醒组件，不等待网络后再触发微信授权。 */
function requestOrderReminders(page) {
  try {
    const reminder = page.selectComponent?.('#shipment-reminder')
    if (!reminder?.requestSubscription) return Promise.resolve(false)
    return Promise.resolve(reminder.requestSubscription({ automatic: true })).catch(() => false)
  } catch { return Promise.resolve(false) }
}

module.exports = { requestOrderReminders }
