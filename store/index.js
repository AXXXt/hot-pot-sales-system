const auth = require('./modules/auth')
const brand = require('./modules/brand')
const cart = require('./modules/cart')
const config = require('./modules/config')

function getState() {
  return {
    auth: auth.state,
    brand: brand.state,
    cart: cart.state,
    config: config.state
  }
}

module.exports = {
  auth,
  brand,
  cart,
  config,
  getState
}
