<script setup lang="ts">
import { onMounted, reactive, ref } from 'vue'
import { RefreshRight } from '@element-plus/icons-vue'
import { useRouter } from 'vue-router'
import { getOrderDetail, getOrders } from '../../api/order'
import type { OrderListItem } from '../../api/order'
import { formatAmount, formatDateTime, orderStatus } from '../../utils/format'
import { useAuthStore } from '../../stores/auth'
import { useCartStore } from '../../stores/cart'
import { ElMessage } from 'element-plus'

const router = useRouter()
const auth = useAuthStore()
const cart = useCartStore()
const orders = ref<OrderListItem[]>([])
const loading = ref(false)
const total = ref(0)
const query = reactive({ page: 1, pageSize: 10, status: 'all' })
const repeatingOrderId = ref<number>()

async function load() {
  loading.value = true
  try {
    const params: Record<string, unknown> = {
      customerId: auth.customer?.id,
      page: query.page,
      pageSize: query.pageSize
    }
    if (query.status !== 'all') params.status = query.status
    const response = await getOrders(params)
    orders.value = response.data.items
    total.value = response.data.total
  } finally {
    loading.value = false
  }
}

async function reorder(order: OrderListItem) {
  repeatingOrderId.value = order.id
  try {
    const response = await getOrderDetail(order.id)
    response.data.items.forEach(item => cart.addRepeatedSku(item))
    ElMessage.success('已复制商品到进货单')
    await router.push('/cart')
  } finally {
    repeatingOrderId.value = undefined
  }
}

onMounted(load)
</script>

<template>
  <div class="page">
    <div class="title-row">
      <h1 class="page-title">我的订单</h1>
      <router-link to="/category"><el-button type="primary">继续采购</el-button></router-link>
    </div>
    <el-card shadow="never" class="toolbar">
      <el-radio-group v-model="query.status" @change="() => { query.page = 1; load() }">
        <el-radio-button value="all">全部</el-radio-button>
        <el-radio-button value="pending_quote">待报价</el-radio-button>
        <el-radio-button value="pending_confirm">待确认</el-radio-button>
        <el-radio-button value="pending_finance">待审核</el-radio-button>
        <el-radio-button value="pending_shipment">待发货</el-radio-button>
        <el-radio-button value="shipped">配送中</el-radio-button>
        <el-radio-button value="completed">已完成</el-radio-button>
      </el-radio-group>
    </el-card>
    <div v-loading="loading" class="orders">
      <el-card v-for="order in orders" :key="order.id" shadow="hover" class="order-card">
        <div class="head">
          <div><strong>{{ order.orderNo }}</strong><span class="muted"> · {{ formatDateTime(order.createdAt) }}</span></div>
          <el-tag :type="orderStatus(order.status).type">{{ orderStatus(order.status).label }}</el-tag>
        </div>
        <div class="body">
          <p>{{ (order.productNames || []).join('、') || '采购商品' }}<span v-if="(order.productNames?.length || 0) > 1"> 等</span></p>
          <span class="muted">共 {{ order.itemCount || 0 }} 件</span>
        </div>
        <div class="foot">
          <div>应付 <strong class="price">¥{{ formatAmount(order.payableAmount || order.totalAmount) }}</strong></div>
          <div class="actions">
            <el-button :icon="RefreshRight" :loading="repeatingOrderId === order.id" @click="reorder(order)">一键复购</el-button>
            <el-button type="primary" @click="router.push(`/orders/${order.id}`)">查看详情</el-button>
          </div>
        </div>
      </el-card>
    </div>
    <el-empty v-if="!loading && !orders.length" description="还没有订单，去开启第一次采购吧" />
    <div class="pagination"><el-pagination v-model:current-page="query.page" :total="total" :page-size="query.pageSize" layout="total, prev, pager, next" @current-change="load" /></div>
  </div>
</template>

<style scoped>
.title-row { display: flex; justify-content: space-between; align-items: center; }
.toolbar { margin: 16px 0; border-radius: 14px; overflow-x: auto; }
.orders { min-height: 220px; display: grid; gap: 14px; }
.order-card { border-radius: 16px; }
.head { display: flex; justify-content: space-between; align-items: center; }
.body { display: flex; justify-content: space-between; gap: 20px; padding: 16px 0; }
.body p { margin: 0; font-weight: 600; }
.foot { display: flex; justify-content: space-between; align-items: center; padding-top: 14px; border-top: 1px solid var(--line); }
.actions { display: flex; gap: 10px; }
.pagination { display: flex; justify-content: flex-end; margin-top: 20px; }
@media (max-width: 720px) { .head, .foot { flex-direction: column; align-items: flex-start; gap: 10px; } .body { flex-direction: column; gap: 6px; } }
</style>