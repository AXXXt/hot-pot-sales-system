function setStorage(key, value) {
  wx.setStorageSync(key, value)
}

function getStorage(key, defaultValue = null) {
  const value = wx.getStorageSync(key)
  return value === '' || value === undefined ? defaultValue : value
}

function removeStorage(key) {
  wx.removeStorageSync(key)
}

module.exports = {
  setStorage,
  getStorage,
  removeStorage
}
