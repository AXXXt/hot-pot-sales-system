<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { useRoute } from 'vue-router'
import { ElMessage } from 'element-plus'
import ProductGallery from '../../components/ProductGallery.vue'
import { getProduct, type Product } from '../../api/catalog'
import { useCartStore } from '../../stores/cart'
import { formatAmount } from '../../utils/format'

const route = useRoute()
const cart = useCartStore()
const product = ref<Product | null>(null)
const loading = ref(true)
const error = ref('')
const quantity = ref(1)
const activeSkuId = ref<number>()

const sku = computed(() => product.value?.skus.find(item => item.id === activeSkuId.value) || product.value?.skus?.[0])
const canBuy = computed(() => !!sku.value && sku.value.stockNum >= (sku.value.minOrderQty || 1))

async function load() {
  loading.value = true
  error.value = ''
  try {
    const response = await getProduct(Number(route.params.id))
    product.value = response.data
    activeSkuId.value = response.data.skus.find(item => item.stockNum >= (item.minOrderQty || 1))?.id
    quantity.value = sku.value?.minOrderQty || 1
  } catch {
    error.value = '商品加载失败，请重试'
  } finally {
    loading.value = false
  }
}

function selectSku(id: number) {
  activeSkuId.value = id
  quantity.value = product.value?.skus.find(item => item.id === id)?.minOrderQty || 1
}

function addToCart() {
  if (!product.value || !sku.value || !canBuy.value || !Number.isInteger(quantity.value) || quantity.value < (sku.value.minOrderQty || 1) || quantity.value > sku.value.stockNum) return
  cart.addItem(product.value, sku.value, quantity.value)
  ElMessage.success('已加入进货单')
}

onMounted(load)
</script>

<template>
  <div class="page" v-loading="loading">
    <el-breadcrumb class="breadcrumb"><el-breadcrumb-item to="/category">全部商品</el-breadcrumb-item><el-breadcrumb-item>{{ product?.name || '商品详情' }}</el-breadcrumb-item></el-breadcrumb>
    <el-alert v-if="error" :title="error" type="error" :closable="false"><el-button @click="load">重试</el-button></el-alert>
    <div v-if="product" class="detail">
      <ProductGallery :key="product.id" :images="product.images" :cover="product.mainImageUrl" :name="product.name" />
      <section>
        <div class="badges"><el-tag v-if="product.isNew" type="warning">新品</el-tag><el-tag v-if="product.isHot" type="danger">热销</el-tag><el-tag>{{ product.brand?.name || '品牌商品' }}</el-tag></div>
        <h1>{{ product.name }}</h1>
        <p class="muted">{{ product.baseSpec || '餐饮食材整箱供货' }}</p>
        <div class="price-panel">
          <div><small>采购价</small><strong class="price">¥{{ formatAmount(sku?.customerPrice ?? sku?.basePrice) }}</strong><span class="muted">/{{ sku?.saleUnit || '件' }}</span></div>
          <div><small>库存</small><span>{{ sku?.stockNum || 0 }}</span></div>
          <div><small>起订量</small><span>{{ sku?.minOrderQty || 1 }}</span></div>
        </div>
        <div class="sku-list">
          <button v-for="item in product.skus" :key="item.id" :class="{ active: item.id === sku?.id, disabled: item.stockNum < (item.minOrderQty || 1) }" :aria-pressed="item.id === sku?.id" :disabled="item.stockNum < (item.minOrderQty || 1)" @click="selectSku(item.id)">
            <strong>{{ item.specText || item.name }}</strong><span>¥{{ formatAmount(item.customerPrice ?? item.basePrice) }}</span>
          </button>
        </div>
        <div class="buy-row">
          <el-input-number v-model="quantity" aria-label="采购数量" :disabled="!canBuy" :min="sku?.minOrderQty || 1" :max="Math.max(sku?.stockNum || 0, sku?.minOrderQty || 1)" />
          <el-button type="primary" size="large" :disabled="!canBuy" @click="addToCart">{{ canBuy ? '加入进货单' : '库存不足' }}</el-button>
        </div>
        <div class="service"><span v-if="product.deliveryText">{{ product.deliveryText }}</span><span>整箱批发</span><span>订单进度可查</span></div>
      </section>
    </div>
    <el-card v-if="product" class="desc-card"><h3>商品介绍</h3><p class="muted">{{ product.description || '如需规格和配送详情，请联系客户经理。' }}</p></el-card>
  </div>
</template>

<style scoped>
.breadcrumb { margin-bottom: 28px; line-height: 1.6; }
.detail { display: grid; grid-template-columns: minmax(0,1fr) minmax(0,1fr); gap: 48px; align-items: start; }
h1 { margin: 18px 0 12px; font-size: 28px; line-height: 1.4; font-weight: 600; }
.badges { display: flex; gap: 8px; flex-wrap: wrap; }
.price-panel { margin: 24px 0; padding: 24px 0; display: grid; grid-template-columns: 1.6fr 1fr 1fr; gap: 12px; border-top: 1px solid var(--line); border-bottom: 1px solid var(--line); }
.price-panel strong { font-size: 28px; }
.price-panel div { display: flex; flex-direction: column; gap: 8px; }
.price-panel small { color: var(--muted); }
.sku-list { display: grid; grid-template-columns: repeat(2,minmax(0,1fr)); gap: 12px; margin-bottom: 28px; }
.sku-list button { min-height: 74px; padding: 14px; border: 1px solid var(--line); border-radius: 4px; background: white; cursor: pointer; display: flex; flex-direction: column; align-items: start; gap: 6px; text-align: left; }
.sku-list button.active { border-color: var(--green); color: var(--green); background: #f1f5f2; }
.sku-list button.disabled { opacity: .5; cursor: not-allowed; }
.buy-row { display: flex; gap: 16px; align-items: center; flex-wrap: wrap; }
.service { margin-top: 24px; display: flex; flex-wrap: wrap; gap: 16px; color: var(--muted); }
.desc-card { margin-top: 40px; }
.desc-card h3 { margin-top: 0; font-size: 18px; }
.desc-card p { line-height: 1.8; white-space: pre-line; }
@media (max-width: 860px) { .detail { grid-template-columns: 1fr; gap: 24px; } h1 { font-size: 24px; } .product-image { max-height: 480px; } }
</style>
