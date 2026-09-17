const { request } = require('../request')

function adaptProductListItem(p) {
  const firstSku = (p.skus && p.skus[0]) || {}
  const displayPrice = firstSku.customerPrice || firstSku.basePrice || ''
  const stockNum = Number(firstSku.stockNum || 0)
  return {
    id: p.id,
    skuId: firstSku.id || null,
    code: p.code,
    name: p.name,
    subtitle: p.subtitle,
    main_image_url: p.mainImageUrl,
    images: p.images,
    base_spec: p.baseSpec,
    delivery_text: p.deliveryText,
    isRecommended: p.isRecommended,
    category_id: p.category?.id,
    category_name: p.category?.name,
    unit_name: p.unit?.name,
    brand_id: p.brand?.id || null,
    brandId: p.brand?.id || null,
    brand_name: p.brand?.name || '',
    brandText: p.brand?.name || '',
    image: p.mainImageUrl || '',
    price: String(displayPrice),
    priceUnit: firstSku.saleUnit || '',
    spec: firstSku.specText || p.baseSpec || '',
    stockText: stockNum > 10 ? '库存充足' : stockNum > 0 ? '库存紧张' : '售罄',
    statusVariant: stockNum > 0 ? 'success' : 'danger',
    subText: firstSku.customerPrice ? '协议价' : '',
    sale_price: firstSku.basePrice,
    customer_price: firstSku.customerPrice || null,
    sale_unit: firstSku.saleUnit || '',
    min_order_qty: firstSku.minOrderQty || 1,
    minOrderQty: firstSku.minOrderQty || 1,
    stock_qty: stockNum,
    stock_text: stockNum > 10 ? '库存充足' : stockNum > 0 ? '库存紧张' : '售罄',
    sold_out: stockNum <= 0,
    skus: (p.skus || []).map((s) => ({
      id: s.id,
      sku_code: s.skuCode,
      name: s.name,
      spec_text: s.specText,
      sale_unit: s.saleUnit,
      sale_price: s.basePrice,
      customer_price: s.customerPrice || null,
      min_order_qty: s.minOrderQty,
      stock_qty: s.stockNum || 0,
      stock_text: (s.stockNum || 0) > 10 ? '库存充足' : (s.stockNum || 0) > 0 ? '库存紧张' : '售罄',
      sold_out: (s.stockNum || 0) <= 0
    }))
  }
}

function adaptProductDetail(p) {
  return {
    id: p.id,
    code: p.code,
    name: p.name,
    subtitle: p.subtitle,
    main_image_url: p.mainImageUrl,
    images: p.images,
    base_spec: p.baseSpec,
    description: p.description,
    delivery_text: p.deliveryText,
    isRecommended: p.isRecommended,
    category_id: p.category?.id,
    category_name: p.category?.name,
    unit_name: p.unit?.name,
    brand_id: p.brand?.id || null,
    brand_name: p.brand?.name || '',
    brand: p.brand,
    skus: (p.skus || []).map((s) => ({
      id: s.id,
      sku_code: s.skuCode,
      name: s.name,
      spec_text: s.specText,
      sale_unit: s.saleUnit,
      sale_price: s.basePrice,
      customer_price: s.customerPrice || null,
      base_price: s.basePrice,
      min_order_qty: s.minOrderQty,
      stock_qty: s.stockNum || 0,
      available_qty: s.stockNum || 0,
      stock_text: (s.stockNum || 0) > 10 ? '库存充足' : (s.stockNum || 0) > 0 ? '库存紧张' : '售罄',
      sold_out: (s.stockNum || 0) <= 0
    }))
  }
}

function adaptSku(s) {
  return {
    id: s.id,
    sku_code: s.skuCode,
    name: s.name,
    spec_text: s.specText,
    sale_unit: s.saleUnit,
    sale_price: s.basePrice,
    customer_price: s.customerPrice || null,
    base_price: s.basePrice,
    min_order_qty: s.minOrderQty,
    stock_qty: s.stockNum || 0,
    available_qty: s.stockNum || 0,
    stock_text: (s.stockNum || 0) > 10 ? '库存充足' : (s.stockNum || 0) > 0 ? '库存紧张' : '售罄',
    sold_out: (s.stockNum || 0) <= 0
  }
}

function getProductList(params) {
  return request({
    url: '/api/v1/products',
    method: 'GET',
    data: params,
    showLoading: false
  }).then((res) => {
    if (res && res.code === 0 && res.data) {
      return {
        ...res,
        data: {
          items: (res.data.items || []).map(adaptProductListItem),
          page: res.data.page,
          pageSize: res.data.pageSize,
          total: res.data.total
        }
      }
    }
    return res
  })
}

function getProductDetail(id) {
  return request({
    url: `/api/v1/products/${id}`,
    method: 'GET',
    showLoading: false
  }).then((res) => {
    if (res && res.code === 0 && res.data) {
      return { ...res, data: adaptProductDetail(res.data) }
    }
    return res
  })
}

function getProductSkus(id) {
  return request({
    url: `/api/v1/products/${id}/skus`,
    method: 'GET',
    showLoading: false
  }).then((res) => {
    if (res && res.code === 0 && res.data) {
      return { ...res, data: res.data.map(adaptSku) }
    }
    return res
  })
}

function getProductCategories(params) {
  return request({
    url: '/api/v1/product-categories',
    method: 'GET',
    data: params,
    showLoading: false
  })
}

function validateCart(skuIds) {
  return request({
    url: '/api/v1/products/cart-validation',
    method: 'POST',
    data: { skuIds },
    showLoading: false
  })
}

function getBrands() {
  return request({
    url: '/api/v1/brands',
    method: 'GET',
    showLoading: false
  })
}

module.exports = {
  getProductList,
  getProductDetail,
  getProductSkus,
  getProductCategories,
  validateCart,
  getBrands
}
