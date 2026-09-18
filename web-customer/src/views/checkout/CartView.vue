<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { useRouter } from 'vue-router'
import { ElMessage, ElMessageBox } from 'element-plus'
import { validateCart } from '../../api/catalog'
import { formatAmount } from '../../utils/format'
import { useAuthStore } from '../../stores/auth'
import { useCartStore } from '../../stores/cart'

const router = useRouter()
const auth = useAuthStore()
const cart = useCartStore()
const validating = ref(false)

const groupedItems = computed(() => {
  const groups = new Map<string, typeof cart.items>()
  cart.items.forEach(item => {
    const key = String(item.brandId || item.brandName || '待确认品牌')
    groups.set(key, [...(groups.get(key) || []), item])
  })
  return [...groups.entries()].map(([brand, items]) => ({ brand, items }))
})

async function refreshCart(showMessage = true) {
  if (!auth.customer || !cart.items.length) return
  validating.value = true
  try {
    const response = await validateCart([...new Set(cart.items.map(item => item.skuId))])
    cart.applyValidation(response.data)
    if (showMessage) ElMessage.success('购物车已更新')
  } finally {
    validating.value = false
  }
}

function checkout() {
  if (!cart.items.length) return
  if (!auth.isAuthenticated) return router.push('/login?redirect=/cart')
  if (cart.hasUnavailable) {
    ElMessage.warning('请先移除不可购买商品')
    return
  }
  router.push('/checkout')
}

async function removeItem(skuId: number) {
  await ElMessageBox.confirm('确定移除该商品吗？', '移除商品', { type: 'warning' })
  cart.setQuantity(skuId, 0)
}

onMounted(() => refreshCart(false))
</script>

<template>
  <div class="page">
    <h1 class="page-title">进货单</h1>
    <el-alert v-if="cart.hasUnavailable" title="部分商品已下架、售罄或不可见，请移除后再结算" type="warning" show-icon :closable="false" class="notice" />
    <div v-if="cart.items.length" class="cart-layout">
      <div class="cart-main" v-loading="validating">
        <el-card v-for="group in groupedItems" :key="group.brand" shadow="never" class="brand-group">
          <template #header><strong>{{ group.brand }}</strong><span class="muted">按品牌创建订单</span></template>
          <div v-for="item in group.items" :key="item.skuId" class="cart-item">
            <div class="item-info">
              <strong>{{ item.name }}</strong>
              <p class="muted">{{ item.spec || '默认规格' }} · ¥{{ formatAmount(item.price) }}/{{ item.unit }}</p>
              <el-tag v-if="item.available === false" type="danger" size="small">{{ item.unavailableReason || '不可购买' }}</el-tag>
            </div>
            <el-input-number v-model="item.quantity" :min="0" :max="Math.max(item.stockNum, item.quantity)" size="small" @change="(value?: number) => cart.setQuantity(item.skuId, value || 0)" />
            <div class="item-amount">¥{{ formatAmount(Number(item.price) * item.quantity) }}</div>
            <el-button text type="danger" @click="removeItem(item.skuId)">移除</el-button>
          </div>
        </el-card>
      </div>
      <el-card class="cart-summary" shadow="never">
        <h3>结算摘要</h3>
        <div class="summary-row"><span>商品件数</span><strong>{{ cart.totalCount }}</strong></div>
        <div class="summary-row"><span>品牌数</span><strong>{{ cart.brandCount }}</strong></div>
        <div class="summary-row total"><span>预估金额</span><strong class="price">¥{{ formatAmount(cart.totalAmount) }}</strong></div>
        <el-button v-if="cart.hasUnavailable" type="warning" size="large" @click="cart.clearInvalid">移除不可购商品</el-button>
        <el-button type="primary" size="large" :disabled="cart.hasUnavailable || !cart.items.length" @click="checkout">去结算</el-button>
        <router-link to="/category"><el-button size="large" class="continue">继续采购</el-button></router-link>
      </el-card>
    </div>
    <div v-else class="empty-state">进货单还是空的，去挑选食材吧。<div class="empty-action"><router-link to="/category"><el-button type="primary">去采购</el-button></router-link></div></div>
  </div>
</template>

<style scoped>
.notice { margin-bottom: 18px; }
.cart-layout { display: grid; grid-template-columns: 1fr 330px; gap: 18px; align-items: start; }
.brand-group { margin-bottom: 14px; border-radius: 16px; }
.brand-group :deep(.el-card__header) { display: flex; justify-content: space-between; align-items: center; }
.cart-item { display: grid; grid-template-columns: 1fr 150px 100px auto; gap: 18px; align-items: center; padding: 16px 0; border-bottom: 1px solid var(--line); }
.cart-item:last-child { border-bottom: 0; }
.item-info p { margin: 4px 0; }
.item-amount { font-weight: 700; color: var(--brand); }
.cart-summary { position: sticky; top: 96px; border-radius: 16px; }
.cart-summary h3 { margin-top: 0; }
.summary-row { display: flex; justify-content: space-between; margin-bottom: 14px; }
.summary-row.total { padding-top: 14px; border-top: 1px solid var(--line); }
.cart-summary .el-button { width: 100%; margin: 0 0 10px; }
.continue { margin-top: 4px; }
.empty-action { margin-top: 18px; }
@media (max-width: 900px) { .cart-layout { grid-template-columns: 1fr; } .cart-item { grid-template-columns: 1fr; gap: 12px; } .cart-summary { position: static; } }
</style>