<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { useRoute } from 'vue-router'
import { ElMessage } from 'element-plus'
import { getProduct, type Product } from '../../api/catalog'
import { useCartStore } from '../../stores/cart'
import { formatAmount } from '../../utils/format'

const route = useRoute()
const cart = useCartStore()
const product = ref<Product | null>(null)
const loading = ref(true)
const quantity = ref(1)
const activeSkuId = ref<number>()

const sku = computed(() => product.value?.skus.find(item => item.id === activeSkuId.value) || product.value?.skus?.[0])
const image = computed(() => product.value?.mainImageUrl || 'data:image/svg+xml;utf8,<svg xmlns="http://www.w3.org/2000/svg" width="640" height="480"><rect width="100%" height="100%" fill="%23f1e6e1"/><text x="50%" y="52%" font-size="64" text-anchor="middle" fill="%238d1c1c">%E9%A3%9F%E6%9D%90</text></svg>')

async function load() {
  loading.value = true
  try {
    const response = await getProduct(Number(route.params.id))
    product.value = response.data
    activeSkuId.value = response.data.skus.find(item => item.stockNum > 0)?.id
    quantity.value = sku.value?.minOrderQty || 1
  } finally {
    loading.value = false
  }
}

function selectSku(id: number) {
  activeSkuId.value = id
  quantity.value = product.value?.skus.find(item => item.id === id)?.minOrderQty || 1
}

function addToCart() {
  if (!product.value || !sku.value) return
  cart.addItem(product.value, sku.value, quantity.value)
  ElMessage.success('已加入进货单')
}

onMounted(load)
</script>

<template>
  <div class="page" v-loading="loading">
    <el-breadcrumb class="breadcrumb"><el-breadcrumb-item to="/category">全部商品</el-breadcrumb-item><el-breadcrumb-item>{{ product?.name || '商品详情' }}</el-breadcrumb-item></el-breadcrumb>
    <div v-if="product" class="detail">
      <img class="cover" :src="image" :alt="product.name" />
      <section>
        <div class="badges"><el-tag v-if="product.isNew" type="warning">新品</el-tag><el-tag v-if="product.isHot" type="danger">热销</el-tag><el-tag>{{ product.brand?.name || '品牌商品' }}</el-tag></div>
        <h1>{{ product.name }}</h1>
        <p class="muted">{{ product.subtitle || product.baseSpec || '餐饮食材整箱供货' }}</p>
        <div class="price-panel">
          <div><small>采购价</small><strong class="price">¥{{ formatAmount(sku?.customerPrice || sku?.basePrice) }}</strong><span class="muted">/{{ sku?.saleUnit || '件' }}</span></div>
          <div><small>库存</small><span>{{ sku?.stockNum || 0 }}</span></div>
          <div><small>起订量</small><span>{{ sku?.minOrderQty || 1 }}</span></div>
        </div>
        <div class="sku-list">
          <button v-for="item in product.skus" :key="item.id" :class="{ active: item.id === sku?.id, disabled: item.stockNum <= 0 }" :disabled="item.stockNum <= 0" @click="selectSku(item.id)">
            <strong>{{ item.specText || item.name }}</strong><span>¥{{ formatAmount(item.customerPrice || item.basePrice) }}</span>
          </button>
        </div>
        <div class="buy-row">
          <el-input-number v-model="quantity" :min="sku?.minOrderQty || 1" :max="sku?.stockNum || 1" />
          <el-button type="primary" size="large" :disabled="!sku || sku.stockNum <= 0" @click="addToCart">加入进货单</el-button>
        </div>
        <div class="service"><span v-if="product.deliveryText">{{ product.deliveryText }}</span><span>整箱批发</span><span>订单进度可查</span></div>
      </section>
    </div>
    <el-card v-if="product" class="desc-card"><h3>商品介绍</h3><p class="muted">{{ product.description || '如需规格和配送详情，请联系客户经理。' }}</p></el-card>
  </div>
</template>

<style scoped>
.breadcrumb { margin-bottom: 18px; }
.detail { display: grid; grid-template-columns: .8fr 1.2fr; gap: 34px; align-items: start; }
.cover { width: 100%; min-height: 360px; border-radius: 22px; object-fit: cover; background: #efe8e4; }
h1 { margin: 12px 0 8px; font-size: 30px; }
.badges { display: flex; gap: 8px; }
.price-panel { margin: 22px 0; padding: 20px; display: grid; grid-template-columns: repeat(3,1fr); background: var(--brand-soft); border-radius: 16px; }
.price-panel strong { font-size: 28px; }
.price-panel div { display: flex; flex-direction: column; gap: 4px; }
.price-panel small { color: var(--muted); }
.sku-list { display: flex; flex-wrap: wrap; gap: 10px; margin-bottom: 24px; }
.sku-list button { min-width: 124px; padding: 10px 14px; border: 1px solid var(--line); border-radius: 12px; background: white; cursor: pointer; display: flex; flex-direction: column; }
.sku-list button.active { border-color: var(--brand); color: var(--brand); background: #fff8f6; }
.sku-list button.disabled { opacity: .45; cursor: not-allowed; }
.buy-row { display: flex; gap: 14px; align-items: center; }
.service { margin-top: 18px; display: flex; flex-wrap: wrap; gap: 16px; color: var(--muted); }
.desc-card { margin-top: 28px; }
.desc-card h3 { margin-top: 0; }
@media (max-width: 860px) { .detail { grid-template-columns: 1fr; } .price-panel { grid-template-columns: 1fr; } }
</style>