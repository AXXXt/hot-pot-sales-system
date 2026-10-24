// 会话版本只在登录/退出时变化；同一账号的令牌续期不应中断当前业务。
function captureSession(auth) {
  return { token: auth.state.token, version: auth.state.sessionVersion }
}

function isCurrentSession(auth, session) {
  if (!session) return false
  if (typeof session.version === 'number') {
    return session.version === auth.state.sessionVersion &&
      Boolean(session.token) === Boolean(auth.state.token)
  }
  return session.token === auth.state.token
}

module.exports = { captureSession, isCurrentSession }
