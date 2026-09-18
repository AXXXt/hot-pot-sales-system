<script setup lang="ts">
import { onMounted, ref } from 'vue'
import { ArrowRight, Refresh } from '@element-plus/icons-vue'
import { getProducts } from '../../api/catalog'
import type { Product, ProductSku } from '../../api/catalog'
import { useAuthStore } from '../../stores/auth'
import { useCartStore } from '../../stores/cart'
import ProductCard from '../../components/ProductCard.vue'
import { ElMessage } from 'element-plus'

const auth = useAuthStore()
const cart = useCartStore()
const recommended = ref<Product[]>([])
const frequent = ref<Product[]>([])
const loading = ref(true)

async function loadHome() {
  loading.value = true
  try {
    const requests = [
      getProducts({ page: 1, pageSize: 8 }),
      auth.customer ? getProducts({ feed: 'frequent', page: 1 }) : Promise.resolve(null)
    ]
    const [hotResponse, frequentResponse] = await Promise.all(requests)
    if (!hotResponse) return
    recommended.value = hotResponse.data.items
    frequent.value = frequentResponse?.data?.items || []
  } finally {
    loading.value = false
  }
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
    <section class="hero">
      <div>
        <small>PC 端批量采购 · 一键复购</small>
        <h1>火锅店食材补货，<br />像点外卖一样简单</h1>
        <p>订单自动按品牌拆分，报价确认后进入审核发货流程，采购记录随时回溯。</p>
        <router-link to="/category"><el-button type="primary" size="large">立即采购<el-icon><ArrowRight /></el-icon></el-button></router-link>
      </div>
      <div class="hero-stats">
        <div><strong>{{ recommended.length }}</strong><span>在售商品</span></div>
        <div><strong>{{ cart.totalCount }}</strong><span>进货单件数</span></div>
        <div><strong>同城</strong><span>冷链直达</span></div>
      </div>
    </section>

    <template v-if="frequent.length">
      <section class="section-heading">
        <h2>常购清单</h2>
        <el-button text :icon="Refresh" @click="loadHome">刷新</el-button>
      </section>
      <div v-loading="loading" class="product-grid">
        <ProductCard v-for="item in frequent" :key="`f-${item.id}`" :product="item" @add="addToCart" />
      </div>
    </template>

    <section class="section-heading"><h2>推荐商品</h2><router-link to="/category"><el-button text>查看全部</el-button></router-link></section>
    <div v-loading="loading" class="product-grid">
      <ProductCard v-for="item in recommended" :key="item.id" :product="item" @add="addToCart" />
    </div>
    <el-empty v-if="!loading && !recommended.length" description="暂无可采购商品" />
  </div>
</template>

<style scoped>
.hero { min-height: 290px; border-radius: 26px; padding: 46px; color: white; background: var(--brand-gradient); display: grid; grid-template-columns: 1.25fr .75fr; align-items: center; gap: 30px; }
.hero small { letter-spacing: 3px; opacity: .68; }
.hero h1 { margin: 12px 0 16px; font-size: 38px; line-height: 1.2; }
.hero p { max-width: 520px; margin: 0 0 26px; color: rgba(255,255,255,.76); line-height: 1.8; }
.hero-stats { display: grid; gap: 12px; }
.hero-stats div { padding: 18px 20px; border: 1px solid rgba(255,255,255,.16); border-radius: 16px; background: rgba(255,255,255,.1); display: flex; align-items: baseline; gap: 10px; }
.hero-stats strong { font-size: 26px; }
.product-grid { display: grid; grid-template-columns: repeat(4, 1fr); gap: 16px; }
@media (max-width: 960px) { .hero { grid-template-columns: 1fr; padding: 30px; } .hero h1 { font-size: 28px; } .product-grid { grid-template-columns: repeat(2,1fr); } }
</style>