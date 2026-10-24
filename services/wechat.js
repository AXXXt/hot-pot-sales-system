// 通过统一API绑定当前登录账号的微信身份；失败不影响手机号登录。
const auth = require('../store/modules/auth')
const { captureSession, isCurrentSession } = require('../utils/auth-session')
const { bindOpenid } = require('./api/auth')

let boundSession = null
let pending = null
let pendingSession = null
let lastBinding = null
let transferPending = null
let transferSession = null

/** 绑定当前会话，令牌续期后仍复用结果；不返回openid或微信code。 */
function bindCurrentWechat(confirmTransfer = false) {
  const session = captureSession(auth)
  if (!session.token || typeof wx.login !== 'function') return Promise.resolve(false)
  if (isCurrentSession(auth, boundSession)) return Promise.resolve(true)
  if (pending && isCurrentSession(auth, pendingSession)) return pending
  pendingSession = session
  const task = new Promise(resolve => {
    wx.login({
      timeout: 10000,
      success: async result => {
        if (!result.code || !isCurrentSession(auth, session)) return resolve(false)
        try {
          const response = await bindOpenid(result.code, confirmTransfer)
          if (isCurrentSession(auth, session)) lastBinding = { session, ...(response?.data || {}) }
          const bound = response?.data?.bound === true && isCurrentSession(auth, session)
          if (bound) boundSession = session
          resolve(bound)
        } catch { resolve(false) }
      },
      fail: () => resolve(false)
    })
  }).catch(() => false)
  pending = task
  task.finally(() => { if (pending === task) pending = null })
  return task
}

/** 仅在用户主动订阅后允许显示切换确认，不在启动或回前台打扰用户。 */
function bindWechatForReminders() {
  if (transferPending && isCurrentSession(auth, transferSession)) return transferPending
  const session = captureSession(auth)
  transferSession = session
  const task = (async () => {
    if (await bindCurrentWechat()) return true
    if (!isCurrentSession(auth, session) || !isCurrentSession(auth, lastBinding?.session) ||
      lastBinding.reason !== 'bound_elsewhere' || typeof wx.showModal !== 'function') return false
    const confirmed = await new Promise(resolve => wx.showModal({
      title: '切换微信提醒账号',
      content: `当前微信已关联账号${lastBinding.account || ''}。确认改为当前登录账号接收提醒吗？原账号将不再接收微信提醒。`,
      confirmText: '确认切换', cancelText: '暂不切换',
      success: result => resolve(Boolean(result.confirm)), fail: () => resolve(false)
    }))
    if (!confirmed || !isCurrentSession(auth, session)) return false
    return bindCurrentWechat(true)
  })().catch(() => false)
  transferPending = task
  task.finally(() => { if (transferPending === task) transferPending = null })
  return task
}

module.exports = { bindCurrentWechat, bindWechatForReminders }
