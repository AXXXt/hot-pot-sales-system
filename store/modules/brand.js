const { setStorage, getStorage } = require('../../utils/storage')

const state = {
  currentBrand: getStorage('currentBrand', null)
}

function setCurrentBrand(brand) {
  state.currentBrand = brand
  setStorage('currentBrand', brand)
}

module.exports = {
  state,
  setCurrentBrand
}
