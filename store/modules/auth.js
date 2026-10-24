const { setStorage, getStorage, removeStorage } = require('../../utils/storage')

const state = {
  sessionVersion: 0,
  token: getStorage('token', ''),
  refreshToken: getStorage('refreshToken', ''),
  userInfo: getStorage('userInfo', null),
  profile: getStorage('profile', null),
  customer: getStorage('customer', null)
}

function setToken(token, options = {}) {
  if (state.token !== token && !options.refresh) state.sessionVersion++
  state.token = token
  setStorage('token', token)
}

function setRefreshToken(refreshToken) {
  state.refreshToken = refreshToken
  setStorage('refreshToken', refreshToken)
}

function setUserInfo(userInfo) {
  state.userInfo = userInfo
  setStorage('userInfo', userInfo)
}

function setProfile(profile) {
  state.profile = profile
  setStorage('profile', profile)
}

function setCustomer(customer) {
  state.customer = customer
  setStorage('customer', customer)
}

function clearAuth() {
  state.sessionVersion++
  state.token = ''
  state.refreshToken = ''
  state.userInfo = null
  state.profile = null
  state.customer = null
  removeStorage('token')
  removeStorage('refreshToken')
  removeStorage('userInfo')
  removeStorage('profile')
  removeStorage('customer')
  removeStorage('pendingPhone')
  removeStorage('pendingStep')
  removeStorage('pendingStatusTicket')
}

module.exports = {
  state,
  setToken,
  setRefreshToken,
  setUserInfo,
  setProfile,
  setCustomer,
  clearAuth
}
