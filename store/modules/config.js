const { setStorage, getStorage } = require('../../utils/storage')

const state = {
  systemConfig: getStorage('systemConfig', null)
}

function setSystemConfig(systemConfig) {
  state.systemConfig = systemConfig
  setStorage('systemConfig', systemConfig)
}

module.exports = {
  state,
  setSystemConfig
}
