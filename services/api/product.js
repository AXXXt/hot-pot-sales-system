// 商品接口适配：展示真实名称、最低规格价和整件商品的可购状态。
const { request } = require('../request')

function adaptProductListItem(p) {
  const skus = (p.skus || []).filter(s => !s.status || s.status === 'active')
  const amount = s => Number(s.customerPrice ?? s.basePrice ?? Infinity)
  const firstSku = skus.reduce((best, item) => !best || amount(item) < amount(best) ? item : best, null) || {}
  const displayPrice = firstSku.customerPrice ?? firstSku.basePrice ?? ''
  const available = skus.filter(s => Number(s.availableNum ?? s.stockNum ?? 0) >= Math.max(Number(s.minOrderQty || 1), 1))
  const stockNum = skus.reduce((max, s) => Math.max(max, Number(s.availableNum ?? s.stockNum ?? 0)), 0)
  const canBuy = available.length > 0
  const stockText = !canBuy && stockNum > 0 ? '库存不足' : stockNum > 10 ? '库存充足' : stockNum > 0 ? '库存紧张' : '售罄'
  return {
    id: p.id,
    skuId: firstSku.id || null,
    code: p.code,
    name: p.displayName || (p.subtitle && p.subtitle.trim()) || p.name,
    management_label: p.managementLabel || p.name,
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
    priceFrom: skus.length > 1,
    spec: (firstSku.specText || p.baseSpec || '') + (skus.length > 1 ? ` 等${skus.length}种规格` : ''),
    stockText,
    statusVariant: canBuy ? 'success' : 'danger',
    subText: firstSku.customerPrice != null ? '协议价' : '',
    sale_price: firstSku.basePrice,
    customer_price: firstSku.customerPrice ?? null,
    sale_unit: firstSku.saleUnit || '',
    min_order_qty: firstSku.minOrderQty || 1,
    minOrderQty: firstSku.minOrderQty || 1,
    stock_qty: stockNum,
    stock_text: stockText,
    sold_out: !canBuy,
    skus: (p.skus || []).map((s) => ({
      id: s.id, image_url: s.imageUrl || '', packaging_units: s.packagingUnits || [],
      sku_code: s.skuCode,
      name: s.name,
      spec_text: s.specText,
      sale_unit: s.saleUnit,
      sale_price: s.basePrice,
      customer_price: s.customerPrice ?? null,
      min_order_qty: s.minOrderQty,
      stock_qty: s.availableNum ?? s.stockNum ?? 0,
      stock_text: (s.availableNum ?? s.stockNum ?? 0) > 10 ? '库存充足' : (s.availableNum ?? s.stockNum ?? 0) > 0 ? '库存紧张' : '售罄',
      sold_out: (s.availableNum ?? s.stockNum ?? 0) <= 0
    }))
  }
}

function adaptProductDetail(p) {
  return {
    id: p.id,
    code: p.code,
    name: p.displayName || (p.subtitle && p.subtitle.trim()) || p.name,
    management_label: p.managementLabel || p.name,
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
      id: s.id, image_url: s.imageUrl || '', packaging_units: s.packagingUnits || [],
      sku_code: s.skuCode,
      name: s.name,
      spec_text: s.specText,
      sale_unit: s.saleUnit,
      sale_price: s.basePrice,
      customer_price: s.customerPrice ?? null,
      base_price: s.basePrice,
      min_order_qty: s.minOrderQty,
      stock_qty: s.availableNum ?? s.stockNum ?? 0,
      available_qty: s.availableNum ?? s.stockNum ?? 0,
      stock_text: (s.availableNum ?? s.stockNum ?? 0) > 10 ? '库存充足' : (s.availableNum ?? s.stockNum ?? 0) > 0 ? '库存紧张' : '售罄',
      sold_out: (s.availableNum ?? s.stockNum ?? 0) <= 0
    }))
  }
}

function adaptSku(s) {
  return {
    id: s.id, image_url: s.imageUrl || '', packaging_units: s.packagingUnits || [],
    sku_code: s.skuCode,
    name: s.name,
    spec_text: s.specText,
    sale_unit: s.saleUnit,
    sale_price: s.basePrice,
    customer_price: s.customerPrice ?? null,
    base_price: s.basePrice,
    min_order_qty: s.minOrderQty,
    stock_qty: s.availableNum ?? s.stockNum ?? 0,
    available_qty: s.availableNum ?? s.stockNum ?? 0,
    stock_text: (s.availableNum ?? s.stockNum ?? 0) > 10 ? '库存充足' : (s.availableNum ?? s.stockNum ?? 0) > 0 ? '库存紧张' : '售罄',
    sold_out: (s.availableNum ?? s.stockNum ?? 0) <= 0
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
