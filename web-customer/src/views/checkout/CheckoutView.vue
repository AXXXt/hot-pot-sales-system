<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { useRouter } from 'vue-router'
import { ElMessage, ElMessageBox } from 'element-plus'
import { validateCart } from '../../api/catalog'
import { createOrder, submitOrder } from '../../api/order'
import { formatAmount } from '../../utils/format'
import { useAuthStore } from '../../stores/auth'
import { useCartStore } from '../../stores/cart'
import { submitBrandOrders } from '../../utils/submit-brand-orders'

const router = useRouter()
const auth = useAuthStore()
const cart = useCartStore()
const remark = ref('')
const submitting = ref(false)
const validating = ref(false)

const groups = computed(() => {
  const result = new Map<string, typeof cart.validItems>()
  cart.validItems.forEach(item => {
    const key = String(item.brandId || item.brandName || '待确认品牌')
    result.set(key, [...(result.get(key) || []), item])
  })
  return [...result.entries()].map(([brandId, items]) => ({
    brandId,
    brand: items[0].brandName || `品牌 ${brandId}`,
    amount: items.reduce((sum, item) => sum + Number(item.price) * item.quantity, 0),
    items
  }))
})

async function refreshCart() {
  if (!auth.customer || !cart.items.length) return false
  validating.value = true
  try {
    const response = await validateCart([...new Set(cart.items.map(item => item.skuId))])
    cart.applyValidation(response.data)
    return !cart.hasUnavailable
  } catch {
    return false
  } finally {
    validating.value = false
  }
}

async function submitAll() {
  if (submitting.value || validating.value || !auth.customer) return
  if (!cart.validItems.length) return
  if (cart.hasUnavailable) {
    ElMessage.warning('购物车存在不可购买商品')
    return
  }
  submitting.value = true
  try {
    if (!await refreshCart()) {
      ElMessage.warning('请刷新购物车并处理不可购买商品后重试')
      return
    }
    const result = await submitBrandOrders(groups.value, {
      create: async group => {
        const response = await createOrder({
          customerId: auth.customer!.id,
          items: group.items.map(item => ({ skuId: item.skuId, quantity: item.quantity })),
          remark: remark.value || undefined
        })
        return response.data
      },
      submit: submitOrder,
      remove: cart.removeItemsBySkuIds
    })
    const { created, failures } = result

    if (!created.length) {
      ElMessage.error('下单失败，商品已保留，请稍后重试')
      return
    }
    const drafts = created.filter(order => !order.submitted)
    if (failures.length || drafts.length) {
      await ElMessageBox.alert([
        `已创建 ${created.length} 个品牌订单。`,
        drafts.length ? `${drafts.map(order => order.brand).join('、')} 已保存为草稿，可在订单详情继续提交。` : '',
        failures.length ? `${failures.join('、')} 下单失败，商品仍保留在进货单。` : ''
      ].filter(Boolean).join('\n'), '订单处理结果', { type: 'warning', confirmButtonText: '查看订单' }).catch(() => {})
    } else {
      ElMessage.success(`已提交 ${created.length} 个品牌订单`)
    }
    await router.replace('/orders')
  } finally {
    submitting.value = false
  }
}

onMounted(refreshCart)
</script>

<template>
  <div class="page">
    <h1 class="page-title">确认下单</h1>
    <div v-loading="validating" class="checkout-layout">
      <div>
        <el-card v-for="group in groups" :key="group.brandId" shadow="never" class="group-card">
          <template #header><strong>{{ group.brand }}</strong><span>预估 ¥{{ formatAmount(group.amount) }}</span></template>
          <div v-for="item in group.items" :key="item.skuId" class="order-item">
            <div><strong>{{ item.name }}</strong><p class="muted">{{ item.spec || '默认规格' }}</p></div>
            <span>× {{ item.quantity }}</span>
            <strong class="price">¥{{ formatAmount(Number(item.price) * item.quantity) }}</strong>
          </div>
        </el-card>
        <el-card shadow="never" class="group-card"><h3>订单备注</h3><el-input v-model="remark" type="textarea" :rows="4" maxlength="500" show-word-limit placeholder="可填写到货时间、收货地址补充等" /></el-card>
      </div>
      <el-card class="submit-card" shadow="never">
        <h3>提交前确认</h3>
        <div class="row"><span>品牌订单</span><strong>{{ groups.length }}</strong></div>
        <div class="row"><span>商品件数</span><strong>{{ cart.totalCount }}</strong></div>
        <div class="row total"><span>预估总额</span><strong class="price">¥{{ formatAmount(cart.totalAmount) }}</strong></div>
        <el-alert title="不同品牌会分别生成订单，请勿重复提交" type="info" :closable="false" />
        <el-button type="primary" size="large" :loading="submitting" :disabled="!groups.length || validating || cart.hasUnavailable" @click="submitAll">提交采购订单</el-button>
        <router-link to="/cart"><el-button size="large">返回进货单</el-button></router-link>
      </el-card>
    </div>
  </div>
</template>

<style scoped>
.checkout-layout { display: grid; grid-template-columns: 1fr 330px; gap: 18px; align-items: start; }
.group-card { margin-bottom: 14px; border-radius: 4px; }
.group-card :deep(.el-card__header) { display: flex; justify-content: space-between; }
.order-item { display: grid; grid-template-columns: 1fr 80px 110px; gap: 14px; padding: 14px 0; border-bottom: 1px solid var(--line); }
.order-item:last-child { border-bottom: 0; }
.order-item p { margin: 4px 0 0; }
h3 { margin-top: 0; }
.submit-card { position: sticky; top: 96px; border-radius: 4px; }
.row { display: flex; justify-content: space-between; margin-bottom: 12px; }
.row.total { padding-top: 12px; border-top: 1px solid var(--line); }
.submit-card .el-button { width: 100%; margin: 12px 0 0; }
@media (max-width: 900px) { .checkout-layout { grid-template-columns: 1fr; } .submit-card { position: static; } }
</style>
