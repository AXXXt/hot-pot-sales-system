<script setup lang="ts">
import { onMounted, ref } from 'vue'
import { useRouter } from 'vue-router'
import { ElMessage, ElMessageBox } from 'element-plus'
import { Plus, Search, Phone, Location, Star, Check, Close } from '@element-plus/icons-vue'
import { getCustomers, createCustomer, getCustomerLevels, approveCustomer, rejectCustomer } from '../../api/customer'
import { downloadExport } from '../../api/export'

const router = useRouter()
const loading = ref(true)
const rows = ref<any[]>([])
const levels = ref<any[]>([])
const keyword = ref('')
const statusFilter = ref('all')
const exporting = ref(false)

async function handleExport() {
  exporting.value = true
  try {
    await downloadExport('/exports/customers', { keyword: keyword.value, status: statusFilter.value })
  } catch (e: any) { ElMessage.warning(e.message || '导出失败') }
  finally { exporting.value = false }
}
const drawer = ref(false)
const saving = ref(false)
const form = ref({ customerName: '', contactName: '', contactPhone: '', address: '', customerLevelId: null as number | null })

const dataOf = (r: any) => r?.data ?? r ?? {}

async function load() {
  loading.value = true
  try {
    const params: any = { pageSize: 100 }
    if (keyword.value) params.keyword = keyword.value
    if (statusFilter.value !== 'all') params.status = statusFilter.value
    const [cRes, lRes]: any = await Promise.all([getCustomers(params), getCustomerLevels()])
    rows.value = dataOf(cRes).items || dataOf(cRes) || []
    levels.value = dataOf(lRes) || []
  } catch { rows.value = [] }
  finally { loading.value = false }
}

function extractCity(addr: string) {
  if (!addr) return '-'
  const m = addr.match(/(.+?(?:市|州|盟))/)
  return m ? m[1] : addr.slice(0, 8)
}

const levelName = (id: number) => levels.value.find((l: any) => l.id === id)?.name || '未设置'

async function doCreate() {
  saving.value = true
  try {
    await createCustomer(form.value)
    ElMessage.success('客户已创建')
    drawer.value = false
    form.value = { customerName: '', contactName: '', contactPhone: '', address: '', customerLevelId: null }
    await load()
  } catch (e: any) { ElMessage.warning(e.message || '创建失败') }
  finally { saving.value = false }
}

async function doApprove(row: any) {
  try {
    await ElMessageBox.confirm(`确认通过「${row.customerName}」的注册申请？`, '审核通过', { type: 'info' })
    await approveCustomer(row.id)
    ElMessage.success('已通过')
    await load()
  } catch (e: any) { if (e !== 'cancel' && e !== 'close') ElMessage.warning(e.message || '操作失败') }
}

async function doReject(row: any) {
  let reason = ''
  try {
    const result = await ElMessageBox.prompt(
      '驳回后将禁用客户及关联账号，历史数据会保留。请输入驳回原因',
      '驳回申请',
      { type: 'warning', inputPlaceholder: '可选' }
    )
    reason = String(result.value || '').trim()
  } catch { return }

  try {
    await rejectCustomer(row.id, reason || undefined)
    ElMessage.success('已驳回并禁用，历史数据已保留')
    await load()
  } catch (e: any) { if (e !== 'cancel' && e !== 'close') ElMessage.warning(e.message || '操作失败') }
}

function goDetail(id: number) { router.push(`/customers/${id}`) }

const statusTag = (s: string) => s === 'active' ? 'success' : 'danger'

onMounted(load)
</script>

<template>
  <section>
    <div class="page-heading">
      <div><h1>客户管理</h1><p>共 {{ rows.length }} 个客户</p></div>
      <el-button type="primary" :icon="Plus" @click="drawer = true">添加客户</el-button>
    </div>

    <div class="search-bar">
      <el-input v-model="keyword" placeholder="搜索客户名称 / 电话" clearable @clear="load" @keyup.enter="load" style="max-width:280px">
        <template #prefix><el-icon><Search /></el-icon></template>
      </el-input>
      <el-select v-model="statusFilter" @change="load" style="width:130px;margin-left:10px">
        <el-option label="全部状态" value="all" />
        <el-option label="待审核" value="disabled" />
        <el-option label="已通过" value="active" />
      </el-select>
      <el-button :loading="exporting" style="margin-left:10px" @click="handleExport">导出 Excel</el-button>
    </div>

    <div v-if="loading" class="inline-loading">加载中…</div>

    <div v-else-if="!rows.length" class="empty">暂无客户数据</div>

    <div v-else class="card-grid">
      <div v-for="c in rows" :key="c.id" class="customer-card" @click="goDetail(c.id)">
        <div class="card-avatar">{{ (c.customerName || '?')[0] }}</div>
        <div class="card-body">
          <div class="card-name">{{ c.customerName }}</div>
          <div class="card-row"><el-icon :size="14"><Phone /></el-icon> {{ c.contactPhone || '-' }}</div>
          <div class="card-row"><el-icon :size="14"><Location /></el-icon> {{ extractCity(c.address) }}</div>
        </div>
        <div class="card-footer">
          <el-tag :type="statusTag(c.status)" size="small">{{ c.status === 'active' ? '已通过' : '待审核' }}</el-tag>
          <span class="card-level"><el-icon :size="13"><Star /></el-icon> {{ levelName(c.customerLevelId) }}</span>
        </div>
        <div v-if="c.status === 'disabled'" class="card-actions" @click.stop>
          <el-button size="small" type="success" :icon="Check" @click="doApprove(c)">通过</el-button>
          <el-button size="small" type="danger" :icon="Close" @click="doReject(c)">驳回</el-button>
        </div>
      </div>
    </div>

    <el-drawer v-model="drawer" title="添加客户" direction="rtl" size="420">
      <el-form label-width="90">
        <el-form-item label="客户名称" required>
          <el-input v-model="form.customerName" placeholder="公司或门店名称" maxlength="120" />
        </el-form-item>
        <el-form-item label="联系人">
          <el-input v-model="form.contactName" placeholder="联系人姓名" maxlength="100" />
        </el-form-item>
        <el-form-item label="联系电话" required>
          <el-input v-model="form.contactPhone" placeholder="手机号" maxlength="20" />
        </el-form-item>
        <el-form-item label="所在地区">
          <el-input v-model="form.address" placeholder="省/市/区 + 详细地址" maxlength="255" />
        </el-form-item>
        <el-form-item label="客户等级">
          <el-select v-model="form.customerLevelId" placeholder="选择等级" clearable style="width:100%">
            <el-option v-for="lv in levels" :key="lv.id" :label="lv.name" :value="lv.id" />
          </el-select>
        </el-form-item>
        <el-form-item>
          <el-button type="primary" :loading="saving" @click="doCreate" style="width:100%">确认添加</el-button>
        </el-form-item>
      </el-form>
    </el-drawer>
  </section>
</template>

<style scoped>
.page-heading { margin-bottom: 20px; }
.search-bar { display: flex; align-items: center; margin-bottom: 20px; }
.card-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(286px, 1fr)); gap: 16px; }
.customer-card { position: relative; padding: 22px; display: flex; flex-direction: column; gap: 13px; cursor: pointer; transition: transform .18s ease, box-shadow .18s ease; }
.customer-card:hover { transform: translateY(-3px); }
.card-avatar { width: 48px; height: 48px; display: grid; place-items: center; font-size: 18px; font-weight: 800; }
.card-body { flex: 1; }
.card-name { margin-bottom: 9px; color: var(--brand-text); font-size: 16px; font-weight: 750; }
.card-row { display: flex; align-items: center; gap: 6px; margin-top: 5px; color: var(--brand-text-soft); font-size: 13px; }
.card-footer { display: flex; justify-content: space-between; align-items: center; padding-top: 10px; border-top: 1px solid #f3e8e6; }
.card-level { display: flex; align-items: center; gap: 4px; color: var(--brand-text-soft); font-size: 12px; }
.card-actions { display: flex; gap: 8px; padding-top: 4px; }
.empty { padding: 70px; color: var(--brand-muted); text-align: center; }
</style>
