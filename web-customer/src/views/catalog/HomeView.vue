<script setup lang="ts">
import { onMounted, ref } from 'vue'
import { ArrowRight, Refresh } from '@element-plus/icons-vue'
import { getProducts, type Product, type ProductSku } from '../../api/catalog'
import { useAuthStore } from '../../stores/auth'
import { useCartStore } from '../../stores/cart'
import { formatAmount } from '../../utils/format'
import ProductCard from '../../components/ProductCard.vue'
import { ElMessage } from 'element-plus'
const auth = useAuthStore()
const cart = useCartStore()
const recommended = ref<Product[]>([])
const frequent = ref<Product[]>([])
const loading = ref(true)
const error = ref('')
async function loadHome() {
  loading.value = true
  error.value = ''
  try {
    const [hotResponse, frequentResponse] = await Promise.all([
      getProducts({ page: 1, pageSize: 8 }),
      auth.customer ? getProducts({ feed: 'frequent', page: 1 }) : Promise.resolve(null)
    ])
    recommended.value = hotResponse.data.items
    frequent.value = frequentResponse?.data?.items || []
  } catch {
    error.value = '商品加载失败，请重试'
  } finally { loading.value = false }
}
function addToCart(product: Product, sku?: ProductSku) {
  const selectedSku = sku || product.skus[0]
  if (!selectedSku) return
  cart.addItem(product, selectedSku, selectedSku.minOrderQty || 1)
  ElMessage.success('已加入进货单')
}
onMounted(loadHome)
</script>
<template>
  <div class="page">
    <header class="home-heading">
      <div><h1>{{ auth.customerName || '唯哆鲜采购台' }}</h1><p>今天需要补充哪些食材？</p></div>
      <router-link to="/category"><el-button type="primary" size="large">前往选品<el-icon><ArrowRight /></el-icon></el-button></router-link>
    </header>
    <nav class="account-strip" aria-label="采购概况">
      <router-link to="/profile"><span>可用账期额度</span><strong>¥{{ formatAmount(auth.customer?.creditRemaining || 0) }}</strong></router-link>
      <router-link to="/cart"><span>进货单</span><strong>{{ cart.totalCount }} 件</strong></router-link>
      <router-link to="/orders"><span>采购记录</span><strong>我的订单 →</strong></router-link>
    </nav>
    <el-alert v-if="error" :title="error" type="error" :closable="false" show-icon><el-button @click="loadHome">重试</el-button></el-alert>
    <template v-if="frequent.length">
      <section class="section-heading"><h2>常购清单</h2><el-button text :icon="Refresh" :loading="loading" @click="loadHome">刷新</el-button></section>
      <div v-loading="loading" class="product-grid"><ProductCard v-for="item in frequent" :key="item.id" :product="item" @add="addToCart" /></div>
    </template>
    <section class="section-heading"><h2>推荐商品</h2><router-link to="/category"><el-button text>查看全部</el-button></router-link></section>
    <div v-loading="loading" class="product-grid"><ProductCard v-for="item in recommended" :key="item.id" :product="item" @add="addToCart" /></div>
    <el-empty v-if="!loading && !error && !recommended.length" description="暂无可采购商品" />
  </div>
</template>
<style scoped>
.home-heading { display: flex; align-items: center; justify-content: space-between; gap: 24px; padding: 12px 0 28px; border-bottom: 1px solid var(--line); }
.home-heading h1 { margin: 0 0 8px; font-size: 28px; font-weight: 600; }
.home-heading p { margin: 0; color: var(--muted); }
.account-strip { display: grid; grid-template-columns: repeat(3,minmax(0,1fr)); border-bottom: 1px solid var(--line); margin-bottom: 32px; }
.account-strip a { padding: 24px 20px 24px 0; min-width: 0; }
.account-strip span, .account-strip strong { display: block; }
.account-strip span { color: var(--muted); margin-bottom: 8px; }
.account-strip strong { font-size: 20px; font-weight: 600; overflow-wrap: anywhere; }
.account-strip a:hover strong { color: var(--green); }
.product-grid { display: grid; grid-template-columns: repeat(4,minmax(0,1fr)); gap: 28px; min-height: 160px; }
@media (max-width: 760px) { .home-heading { align-items: start; flex-direction: column; gap: 16px; } .home-heading h1 { font-size: 24px; } .account-strip strong { font-size: 16px; } .product-grid { grid-template-columns: repeat(2,minmax(0,1fr)); gap: 20px 14px; } }
</style>
