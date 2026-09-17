<script setup lang="ts">
import { onMounted, reactive, ref } from 'vue'
import { ElMessage } from 'element-plus'
import PageTable from '../../components/PageTable.vue'
import { getAuditLogs, getAuditLogDetail } from '../../api/audit'

const loading = ref(false)
const error = ref('')
const rows = ref<any[]>([])
const total = ref(0)
const query = reactive({ module: '', action: '', page: 1, pageSize: 15 })

const moduleOptions = [
  { label: '全部模块', value: '' },
  { label: '订单', value: 'order' },
  { label: '客户', value: 'customer' },
  { label: '商品', value: 'product' },
  { label: '用户/角色', value: 'user' },
  { label: '品牌', value: 'brand' },
  { label: '认证', value: 'auth' },
  { label: '系统', value: 'system' },
]

const actionMap: Record<string, { text: string; type: string }> = {
  login: { text: '登录', type: 'success' },
  logout: { text: '退出', type: 'info' },
  create: { text: '创建', type: 'success' },
  update: { text: '更新', type: 'warning' },
  delete: { text: '删除', type: 'danger' },
  price_change: { text: '改价', type: 'warning' },
  inventory_adjust: { text: '库存调整', type: 'warning' },
  role_change: { text: '角色变更', type: 'danger' },
  permission_change: { text: '权限变更', type: 'danger' },
  order_status_change: { text: '订单状态变更', type: 'primary' },
}
const actionOptions = [
  { label: '全部动作', value: '' },
  ...Object.entries(actionMap).map(([value, v]) => ({ label: v.text, value })),
]

const moduleText = (m: string) => moduleOptions.find((o) => o.value === m)?.label || m || '-'
const actionMeta = (a: string) => actionMap[a] || { text: a || '-', type: 'info' }

const dataOf = (r: any) => r?.data ?? r ?? {}

async function load() {
  loading.value = true; error.value = ''
  try {
    const params: any = { page: query.page, pageSize: query.pageSize }
    if (query.module) params.module = query.module
    if (query.action) params.action = query.action
    const res: any = await getAuditLogs(params)
    const d = dataOf(res)
    rows.value = d.items || []
    total.value = d.total || 0
  } catch (e: any) { error.value = e.message || '加载失败' }
  finally { loading.value = false }
}

function search() { query.page = 1; load() }

const detailVisible = ref(false)
const detailLoading = ref(false)
const detail = ref<any>(null)

async function openDetail(row: any) {
  detailVisible.value = true
  detailLoading.value = true
  detail.value = null
  try {
    const res: any = await getAuditLogDetail(row.id)
    detail.value = dataOf(res)
  } catch (e: any) {
    ElMessage.warning(e.message || '加载详情失败')
  } finally {
    detailLoading.value = false
  }
}

function jsonText(v: any) {
  if (v == null) return '—'
  try { return JSON.stringify(v, null, 2) } catch { return String(v) }
}

onMounted(load)
</script>

<template>
  <section>
    <div class="page-heading">
      <div><h1>审计日志</h1><p>查询后台关键操作记录，用于追溯与审计</p></div>
    </div>
    <el-card shadow="never">
      <el-form inline @submit.prevent="search">
        <el-form-item>
          <el-select v-model="query.module" style="width:140px" @change="search">
            <el-option v-for="o in moduleOptions" :key="o.value" :label="o.label" :value="o.value" />
          </el-select>
        </el-form-item>
        <el-form-item>
          <el-select v-model="query.action" style="width:160px" @change="search">
            <el-option v-for="o in actionOptions" :key="o.value" :label="o.label" :value="o.value" />
          </el-select>
        </el-form-item>
        <el-button type="primary" @click="search">查询</el-button>
      </el-form>
      <PageTable :loading="loading" :error="error" :empty="!rows.length" @retry="load">
        <el-table :data="rows" stripe size="small">
          <el-table-column label="时间" width="170">
            <template #default="{ row }">{{ new Date(row.createdAt).toLocaleString('zh-CN') }}</template>
          </el-table-column>
          <el-table-column label="操作人" min-width="150">
            <template #default="{ row }">{{ row.operator?.name || '系统' }}<span v-if="row.operator?.phone" class="muted">（{{ row.operator.phone }}）</span></template>
          </el-table-column>
          <el-table-column label="动作" width="120">
            <template #default="{ row }"><el-tag :type="actionMeta(row.action).type" size="small">{{ actionMeta(row.action).text }}</el-tag></template>
          </el-table-column>
          <el-table-column label="模块" width="110">
            <template #default="{ row }">{{ moduleText(row.module) }}</template>
          </el-table-column>
          <el-table-column label="目标" min-width="160">
            <template #default="{ row }">{{ row.targetType }}<span v-if="row.targetId"> #{{ row.targetId }}</span></template>
          </el-table-column>
          <el-table-column label="IP" width="130">
            <template #default="{ row }">{{ row.ipAddress || '-' }}</template>
          </el-table-column>
          <el-table-column label="操作" width="80" fixed="right">
            <template #default="{ row }">
              <el-button link type="primary" @click="openDetail(row)">详情</el-button>
            </template>
          </el-table-column>
        </el-table>
        <el-pagination
          v-model:current-page="query.page" v-model:page-size="query.pageSize"
          :total="total" layout="total, sizes, prev, pager, next"
          :page-sizes="[10, 15, 30, 50]" small @change="load" style="margin-top:16px;justify-content:flex-end" />
      </PageTable>
    </el-card>

    <el-dialog v-model="detailVisible" title="审计日志详情" width="720">
      <div v-if="detailLoading" class="detail-loading">加载中…</div>
      <template v-else-if="detail">
        <el-descriptions :column="2" border size="small">
          <el-descriptions-item label="时间">{{ new Date(detail.createdAt).toLocaleString('zh-CN') }}</el-descriptions-item>
          <el-descriptions-item label="操作人">{{ detail.operator?.name || '系统' }}</el-descriptions-item>
          <el-descriptions-item label="动作">{{ actionMeta(detail.action).text }}</el-descriptions-item>
          <el-descriptions-item label="模块">{{ moduleText(detail.module) }}</el-descriptions-item>
          <el-descriptions-item label="目标类型">{{ detail.targetType }}</el-descriptions-item>
          <el-descriptions-item label="目标 ID">{{ detail.targetId || '-' }}</el-descriptions-item>
          <el-descriptions-item label="IP">{{ detail.ipAddress || '-' }}</el-descriptions-item>
          <el-descriptions-item label="Request ID" class="break-all">{{ detail.requestId }}</el-descriptions-item>
          <el-descriptions-item label="User-Agent" :span="2" class="break-all">{{ detail.userAgent || '-' }}</el-descriptions-item>
        </el-descriptions>
        <el-divider content-position="left">变更前</el-divider>
        <pre class="json-block">{{ jsonText(detail.beforeData) }}</pre>
        <el-divider content-position="left">变更后</el-divider>
        <pre class="json-block">{{ jsonText(detail.afterData) }}</pre>
      </template>
    </el-dialog>
  </section>
</template>

<style scoped>
.page-heading { margin-bottom: 20px; }
.muted { color: #909399; font-size: 12px; }
.detail-loading { padding: 30px; text-align: center; color: #909399; }
.json-block { background: #f5f7fa; border-radius: 6px; padding: 10px 12px; font-size: 12px; max-height: 260px; overflow: auto; margin: 0; }
:deep(.break-all .el-descriptions__content) { word-break: break-all; }
</style>