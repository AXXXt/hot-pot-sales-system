import { computed, ref, watch } from 'vue'
import { defineStore } from 'pinia'
import type { CartValidationResult, Product, ProductSku } from '../api/catalog'

export interface CartItem {
  productId: number
  skuId: number
  name: string
  spec: string
  price: string
  unit: string
  quantity: number
  brandId?: number
  brandName?: string
  image?: string
  minOrderQty: number
  stockNum: number
  available?: boolean
  unavailableReason?: string | null
}

const STORAGE_KEY = 'webCustomerCart'

function restoreItems(): CartItem[] {
  try {
    const parsed = JSON.parse(localStorage.getItem(STORAGE_KEY) || '[]')
    return Array.isArray(parsed) ? parsed : []
  } catch {
    return []
  }
}

export const useCartStore = defineStore('client-cart', () => {
  const items = ref<CartItem[]>(restoreItems())

  watch(items, (value) => localStorage.setItem(STORAGE_KEY, JSON.stringify(value)), { deep: true })

  const totalCount = computed(() => items.value.reduce((sum, item) => sum + item.quantity, 0))
  const validItems = computed(() => items.value.filter(item => item.available !== false))
  const totalAmount = computed(() => validItems.value.reduce((sum, item) => sum + Number(item.price) * item.quantity, 0))
  const brandCount = computed(() => new Set(validItems.value.map(item => item.brandId).filter(Boolean)).size)
  const hasUnavailable = computed(() => items.value.some(item => item.available === false))

  function addItem(product: Product, sku: ProductSku, quantity: number) {
    const existing = items.value.find(item => item.skuId === sku.id)
    const nextQuantity = Math.min((existing?.quantity || 0) + quantity, sku.stockNum)
    if (nextQuantity <= 0) return
    if (existing) {
      existing.quantity = nextQuantity
      existing.price = sku.customerPrice || sku.basePrice
      existing.stockNum = sku.stockNum
      return
    }
    items.value.push({
      productId: product.id,
      skuId: sku.id,
      name: product.name,
      spec: sku.specText,
      price: sku.customerPrice || sku.basePrice,
      unit: sku.saleUnit,
      quantity: nextQuantity,
      brandId: product.brand?.id,
      brandName: product.brand?.name,
      image: product.mainImageUrl,
      minOrderQty: sku.minOrderQty,
      stockNum: sku.stockNum,
      available: sku.stockNum > 0
    })
  }

  function addRepeatedSku(item: {
    productId?: number
    skuId: number
    productName?: string
    skuSpecText?: string
    unitPrice: string
    saleUnit?: string
    quantity: number
  }) {
    const existing = items.value.find(cartItem => cartItem.skuId === item.skuId)
    if (existing) {
      existing.quantity += item.quantity
      return
    }
    items.value.push({
      productId: item.productId || 0,
      skuId: item.skuId,
      name: item.productName || '商品',
      spec: item.skuSpecText || '',
      price: item.unitPrice,
      unit: item.saleUnit || '件',
      quantity: item.quantity,
      minOrderQty: 1,
      stockNum: 999999,
      available: true
    })
  }

  function setQuantity(skuId: number, quantity: number) {
    const item = items.value.find(entry => entry.skuId === skuId)
    if (!item) return
    if (quantity <= 0) items.value = items.value.filter(entry => entry.skuId !== skuId)
    else item.quantity = Math.min(quantity, Math.max(item.stockNum, quantity))
  }

  function applyValidation(result: CartValidationResult) {
    const priceMap = new Map(result.items.map(item => [item.skuId, item]))
    const invalidIds = new Set(result.invalidSkuIds)
    items.value = items.value.flatMap(item => {
      const validated = priceMap.get(item.skuId)
      if (!validated) return invalidIds.has(item.skuId) ? [item] : [item]
      return [{
        ...item,
        productId: validated.productId,
        name: validated.name,
        spec: validated.spec,
        price: validated.price,
        unit: validated.unit,
        brandId: validated.brandId,
        brandName: validated.brandName,
        stockNum: validated.stockNum,
        minOrderQty: validated.minOrderQty,
        available: validated.available,
        unavailableReason: validated.unavailableReason
      }]
    })
  }

  function clearInvalid() {
    items.value = items.value.filter(item => item.available !== false)
  }

  function clear() {
    items.value = []
  }

  return {
    items, totalCount, validItems, totalAmount, brandCount, hasUnavailable,
    addItem, addRepeatedSku, setQuantity, applyValidation, clearInvalid, clear
  }
})