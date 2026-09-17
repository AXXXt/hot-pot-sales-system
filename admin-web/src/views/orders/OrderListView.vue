<script setup lang="ts">
import { onMounted, reactive, ref, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { ElMessage } from 'element-plus'
import PageTable from '../../components/PageTable.vue'
import { getOrders, cancelOrder } from '../../api/order'

const route = useRoute()
const router = useRouter()
const loading = ref(false)
const error = ref('')
const rows = ref<any[]>([])
const total = ref(0)

const supportedStatuses = new Set([
  'pending_quote', 'pending_confirm', 'pending_finance', 'pending_shipment',
  'shipped', 'completed', 'cancelled'
])
const routeStatus = typeof route.query.status === 'string' && supportedStatuses.has(route.query.status)
  ? route.query.status
  : ''
const query = reactive({ status: routeStatus, keyword: '', page: 1, pageSize: 15 })

const statusOptions = [
  { label: '全部', value: '' },
  { label: '待报价', value: 'pending_quote' },
  { label: '待客户确认', value: 'pending_confirm' },
  { label: '待财务审核', value: 'pending_finance' },
  { label: '待发货', value: 'pending_shipment' },
  { label: '已发货', value: 'shipped' },
  { label: '已完成', value: 'completed' },
  { label: '已取消', value: 'cancelled' },
]

const statusTag = (s: string) => {
  const map: Record<string, string> = { draft: 'info', pending_quote: '', pending_confirm: 'warning', pending_finance: 'danger', pending_shipment: 'primary', shipped: 'success', completed: 'success', cancelled: 'danger' }
  return map[s] || 'info'
}
const statusText = (s: string) => {
  const map: Record<string, string> = { draft: '草稿', pending_quote: '待报价', pending_confirm: '待客户确认', pending_finance: '待财务审核', pending_shipment: '待发货', shipped: '已发货', completed: '已完成', cancelled: '已取消' }
  return map[s] || s
}

const dataOf = (r: any) => r?.data ?? r ?? {}

async function load() {
  loading.value = true; error.value = ''
  try {
    const params: any = { page: query.page, pageSize: query.pageSize }
    if (query.status) params.status = query.status
    if (query.keyword) params.keyword = query.keyword
    const res: any = await getOrders(params)
    const d = dataOf(res)
    rows.value = d.items || []
    total.value = d.total || 0
  } catch (e: any) { error.value = e.message || '加载失败' }
  finally { loading.value = false }
}

function search() { query.page = 1; load() }

async function handleCancel(row: any) {
  try {
    await cancelOrder(row.id)
    ElMessage.success('订单已取消')
    load()
  } catch (e: any) { ElMessage.warning(e.message || '操作失败') }
}

watch(
  () => route.query.status,
  (status) => {
    const nextStatus = typeof status === 'string' && supportedStatuses.has(status) ? status : ''
    if (nextStatus === query.status) return
    query.status = nextStatus
    query.page = 1
    load()
  }
)

onMounted(load)
</script>

<template>
  <section>
    <div class="page-heading">
      <div><h1>订单管理</h1><p>查询所有订单并处理业务状态</p></div>
    </div>
    <el-card shadow="never">
      <el-form inline @submit.prevent="search">
        <el-form-item>
          <el-select v-model="query.status" placeholder="订单状态" clearable style="width:140px" @change="search">
            <el-option v-for="o in statusOptions" :key="o.value" :label="o.label" :value="o.value" />
          </el-select>
        </el-form-item>
        <el-form-item>
          <el-input v-model="query.keyword" placeholder="订单号" clearable style="width:200px" @keyup.enter="search" />
        </el-form-item>
        <el-button type="primary" @click="search">查询</el-button>
      </el-form>
      <PageTable :loading="loading" :error="error" :empty="!rows.length" @retry="load">
        <el-table :data="rows" stripe size="small">
          <el-table-column prop="orderNo" label="订单号" width="180" />
          <el-table-column label="客户" min-width="160">
            <template #default="{ row }">{{ row.customer?.customerName || row.customerName || '-' }}</template>
          </el-table-column>
          <el-table-column label="金额" width="130">
            <template #default="{ row }">¥{{ Number(row.payableAmount || 0).toFixed(2) }}</template>
          </el-table-column>
          <el-table-column label="状态" width="100">
            <template #default="{ row }"><el-tag :type="statusTag(row.status)" size="small">{{ statusText(row.status) }}</el-tag></template>
          </el-table-column>
          <el-table-column label="创建时间" width="170">
            <template #default="{ row }">{{ new Date(row.createdAt).toLocaleString('zh-CN') }}</template>
          </el-table-column>
          <el-table-column label="操作" width="180" fixed="right">
            <template #default="{ row }">
              <el-button link type="primary" @click="router.push('/orders/' + row.id)">详情</el-button>
              <el-button v-if="row.status === 'pending_confirm'" link type="danger" @click="handleCancel(row)">取消</el-button>
            </template>
          </el-table-column>
        </el-table>
        <el-pagination
          v-model:current-page="query.page" v-model:page-size="query.pageSize"
          :total="total" layout="total, sizes, prev, pager, next"
          :page-sizes="[10, 15, 30, 50]" small @change="load" style="margin-top:16px;justify-content:flex-end" />
      </PageTable>
    </el-card>
  </section>
</template>

<style scoped>
.page-heading { margin-bottom: 20px; }
</style>
