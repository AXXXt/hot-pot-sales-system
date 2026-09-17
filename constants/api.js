const BASE_URL = 'http://127.0.0.1:3000'

const API_PREFIX = '/api/v1'

const ENDPOINTS = {
  authSendCode: `${API_PREFIX}/auth/send-code`,
  authLogin: `${API_PREFIX}/auth/login`,
  authRefreshToken: `${API_PREFIX}/auth/refresh-token`,
  authLogout: `${API_PREFIX}/auth/logout`,
  authProfile: `${API_PREFIX}/auth/profile`,
  brands: `${API_PREFIX}/brands`,
  productCategories: `${API_PREFIX}/product-categories`,
  products: `${API_PREFIX}/products`,
  productDetail: (id) => `${API_PREFIX}/products/${id}`,
  productSkus: (id) => `${API_PREFIX}/products/${id}/skus`,
  cart: `${API_PREFIX}/cart`,
  orders: `${API_PREFIX}/orders`,
  orderDetail: (id) => `${API_PREFIX}/orders/${id}`,
  addresses: `${API_PREFIX}/addresses`,
  configs: `${API_PREFIX}/configs`,
  upload: `${API_PREFIX}/upload`
}

module.exports = {
  BASE_URL,
  API_PREFIX,
  ENDPOINTS
}
