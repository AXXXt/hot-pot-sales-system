<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { ElMessage, ElMessageBox } from 'element-plus'
import { RefreshRight, Van } from '@element-plus/icons-vue'
import { cancelOrder, completeOrder, getOrderDetail, getOrderLogistics } from '../../api/order'
import type { OrderDetail } from '../../api/order'
import { formatAmount, formatDateTime, orderStatus } from '../../utils/format'
import { useCartStore } from '../../stores/cart'

const route = useRoute()
const router = useRouter()
const cart = useCartStore()
const order = ref<OrderDetail | null>(null)
const track = ref<Array<{ time: string; text: string }>>([])
const loading = ref(true)
const working = ref(false)
const orderId = computed(() => Number(route.params.id))

const timeline = computed(() => [
  { title: '提交订单', done: true },
  { title: '供应商报价', done: !['draft'].includes(order.value?.status || '') },
  { title: '客户确认', done: ['pending_finance','pending_shipment','shipped','completed'].includes(order.value?.status || '') },
  { title: '财务审核', done: ['pending_shipment','shipped','completed'].includes(order.value?.status || '') },
  { title: '配送完成', done: order.value?.status === 'completed' }
])

async function load() {
  loading.value = true
  try {
    const response = await getOrderDetail(orderId.value)
    order.value = response.data
    if (['pending_shipment','shipped','completed'].includes(response.data.status)) {
      const logistics = await getOrderLogistics(orderId.value)
      track.value = logistics.data.track || []
    }
  } finally {
    loading.value = false
  }
}

function reorder() {
  if (!order.value) return
  order.value.items.forEach(item => cart.addRepeatedSku(item))
  ElMessage.success('已复制到进货单')
  router.push('/cart')
}

async function cancel() {
  await ElMessageBox.confirm('确定取消这个订单吗？', '取消订单', { type: 'warning' })
  working.value = true
  try {
    await cancelOrder(orderId.value)
    ElMessage.success('订单已取消')
    await load()
  } finally {
    working.value = false
  }
}

async function confirmReceipt() {
  await ElMessageBox.confirm('请确认已收到全部货物。', '确认收货', { type: 'warning' })
  working.value = true
  try {
    await completeOrder(orderId.value)
    ElMessage.success('已确认收货')
    await load()
  } finally {
    working.value = false
  }
}

onMounted(load)
</script>

<template>
  <div class="page" v-loading="loading">
    <div class="title-row">
      <div><h1 class="page-title">{{ order?.orderNo || '订单详情' }}</h1><p class="muted">{{ formatDateTime(order?.createdAt || '') }}</p></div>
      <div class="top-actions">
        <el-button size="large" type="primary" :icon="RefreshRight" @click="reorder">一键复购</el-button>
        <el-button v-if="order?.status === 'shipped'" size="large" type="success" :icon="Van" :loading="working" @click="confirmReceipt">确认收货</el-button>
      </div>
    </div>

    <el-card v-if="order" shadow="never" class="block">
      <div class="status-panel">
        <div><small>当前状态</small><el-tag :type="orderStatus(order.status).type" size="large">{{ orderStatus(order.status).label }}</el-tag></div>
        <div><small>应付金额</small><strong class="price">¥{{ formatAmount(order.payableAmount || order.totalAmount) }}</strong></div>
        <div><small>客户</small><span>{{ order.customer?.customerName || '--' }}</span></div>
      </div>
      <div class="steps">
        <div v-for="(item, index) in timeline" :key="item.title" class="step" :class="{ active: item.done, next: timeline[index + 1]?.done }">
          <i>{{ index + 1 }}</i><span>{{ item.title }}</span>
        </div>
      </div>
    </el-card>

    <div v-if="order" class="detail-grid">
      <div>
        <el-card shadow="never" class="block">
          <template #header><strong>商品清单</strong></template>
          <div v-for="item in order.items" :key="item.id" class="item-row">
            <div><strong>{{ item.productName }}</strong><p class="muted">{{ item.skuSpecText || item.skuName || '默认规格' }}</p></div>
            <div class="qty">¥{{ formatAmount(item.unitPrice) }} × {{ item.quantity }}</div>
            <strong class="price">¥{{ formatAmount(item.amount) }}</strong>
          </div>
        </el-card>
        <el-card v-if="track.length" shadow="never" class="block">
          <template #header><strong>物流信息</strong></template>
          <el-timeline>
            <el-timeline-item v-for="(item, index) in track" :key="index" :timestamp="item.time" placement="top">{{ item.text }}</el-timeline-item>
          </el-timeline>
        </el-card>
      </div>
      <el-card shadow="never" class="summary">
        <h3>费用摘要</h3>
        <div class="row"><span>商品总额</span><span>¥{{ formatAmount(order.totalAmount) }}</span></div>
        <div class="row"><span>优惠调整</span><span>¥{{ formatAmount(order.discountAmount) }}</span></div>
        <div class="row total"><span>应付金额</span><strong class="price">¥{{ formatAmount(order.payableAmount || order.totalAmount) }}</strong></div>
        <h3>订单备注</h3><p class="muted">{{ order.remark || '无' }}</p>
        <div class="bottom-actions">
          <el-button v-if="['draft','pending_quote','pending_confirm','pending_finance'].includes(order.status)" type="danger" plain :loading="working" @click="cancel">取消订单</el-button>
          <el-button @click="router.push('/orders')">返回列表</el-button>
        </div>
      </el-card>
    </div>
  </div>
</template>

<style scoped>
.title-row { display: flex; justify-content: space-between; align-items: flex-start; gap: 16px; }
.top-actions { display: flex; gap: 10px; }
.block { margin-bottom: 16px; border-radius: 16px; }
.status-panel { display: grid; grid-template-columns: repeat(3,1fr); gap: 18px; padding-bottom: 22px; border-bottom: 1px solid var(--line); }
.status-panel div { display: flex; flex-direction: column; gap: 6px; }
.status-panel small { color: var(--muted); }
.steps { display: grid; grid-template-columns: repeat(5,1fr); gap: 10px; margin-top: 20px; }
.step { text-align: center; color: var(--muted); }
.step i { width: 32px; height: 32px; margin-bottom: 8px; display: grid; place-items: center; border-radius: 50%; background: #f0eae6; font-style: normal; }
.step.active { color: var(--brand); font-weight: 600; }
.step.active i { color: white; background: var(--brand); }
.detail-grid { display: grid; grid-template-columns: 1fr 330px; gap: 16px; align-items: start; }
.item-row { display: grid; grid-template-columns: 1fr 160px 110px; gap: 14px; padding: 15px 0; border-bottom: 1px solid var(--line); }
.item-row:last-child { border-bottom: 0; }
.item-row p { margin: 4px 0 0; }
.summary { position: sticky; top: 96px; border-radius: 16px; }
.summary h3 { margin: 20px 0 12px; }
.summary h3:first-child { margin-top: 0; }
.row { display: flex; justify-content: space-between; margin-bottom: 12px; }
.row.total { padding-top: 12px; border-top: 1px solid var(--line); }
.bottom-actions { display: grid; gap: 10px; margin-top: 24px; }
.bottom-actions .el-button { width: 100%; }
@media (max-width: 900px) { .detail-grid { grid-template-columns: 1fr; } .status-panel { grid-template-columns: 1fr; } .steps { grid-template-columns: repeat(2,1fr); } .item-row { grid-template-columns: 1fr; } .summary { position: static; } }
</style>