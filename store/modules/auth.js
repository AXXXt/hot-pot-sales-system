const { setStorage, getStorage, removeStorage } = require('../../utils/storage')

const state = {
  token: getStorage('token', ''),
  refreshToken: getStorage('refreshToken', ''),
  userInfo: getStorage('userInfo', null),
  profile: getStorage('profile', null),
  customer: getStorage('customer', null)
}

function setToken(token) {
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
