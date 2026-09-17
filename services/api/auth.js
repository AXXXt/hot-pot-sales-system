const { request } = require('../request')

function sendLoginCode(data) {
  return request({
    url: '/api/v1/auth/send-code',
    method: 'POST',
    data,
    showLoading: false
  })
}

function registerOrLogin(data) {
  return request({
    url: '/api/v1/auth/register-or-login',
    method: 'POST',
    data,
    showLoading: false
  })
}

function loginByPhone(data) {
  return request({
    url: '/api/v1/auth/login',
    method: 'POST',
    data,
    showLoading: false
  })
}

function refreshToken(data) {
  return request({
    url: '/api/v1/auth/refresh-token',
    method: 'POST',
    data,
    showLoading: false
  })
}

function logout() {
  return request({
    url: '/api/v1/auth/logout',
    method: 'POST',
    showLoading: false
  })
}

function getProfile() {
  return request({
    url: '/api/v1/auth/profile',
    method: 'GET',
    showLoading: false
  })
}

function checkStatus(phone) {
  return request({
    url: '/api/v1/auth/check-status',
    method: 'POST',
    data: { phone },
    showLoading: false
  })
}

module.exports = {
  sendLoginCode,
  loginByPhone,
  registerOrLogin,
  refreshToken,
  logout,
  getProfile,
  checkStatus
}
