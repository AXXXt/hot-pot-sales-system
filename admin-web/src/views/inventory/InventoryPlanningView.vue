<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { ElMessage, ElMessageBox } from 'element-plus'
import { useRouter } from 'vue-router'
import http from '../../api/request'
import { useAuthStore } from '../../stores/auth'

const router = useRouter(), auth = useAuthStore()
const loading = ref(false), error = ref(''), keyword = ref(''), onlyLow = ref(false), tab = ref('overview')
const items = ref<any[]>([]), batches = ref<any[]>([]), plans = ref<any[]>([]), selection = ref<any[]>([])
const assignVisible = ref(false), assigning = ref(false), assign = ref<any>({})
const note = ref(''), planSaving = ref(false), requestId = ref(crypto.randomUUID())
const filtered = computed(() => items.value.filter(x => !onlyLow.value || x.lowStock))
const selectedItems = computed(() => selection.value.filter(x => Number.isInteger(x.purchaseQty) && x.purchaseQty > 0))
const statusText: Record<string, string> = { draft: '待采购', ordered: '已采购', closed: '已处理', cancelled: '已取消' }
const canAdjust = computed(() => auth.can('inventory:adjust'))
async function load() {
  loading.value = true; error.value = ''
  try {
    const [overview, batchResponse, planResponse]: any[] = await Promise.all([
      http.get('/inventory/planning', { params: { keyword: keyword.value } }), http.get('/inventory/batches'), http.get('/inventory/replenishment-plans')
    ])
    items.value = overview.data.items.map((x: any) => ({ ...x, purchaseQty: x.suggestedQuantity }))
    note.value = overview.data.note + (overview.data.truncated ? ' 当前最多显示500个规格，请用关键词缩小范围。' : '')
    batches.value = batchResponse.data.items; plans.value = planResponse.data.items
    selection.value = []
  } catch (e: any) { error.value = e.message || '库存计划加载失败，请重试' }
  finally { loading.value = false }
}
async function saveBatch() {
  if (assigning.value) return
  try { await ElMessageBox.confirm('将所填数量从未知日期库存划入指定批次，总库存不变。请按实物核对批次和日期。', '补登记历史批次', { confirmButtonText: '确认登记', cancelButtonText: '返回检查' }) } catch { return }
  assigning.value = true
  try { await http.post('/inventory/batches/assign', assign.value); assignVisible.value = false; await load(); ElMessage.success('批次已登记，总库存未变') }
  catch (e: any) { ElMessage.error(e.message || '登记失败') }
  finally { assigning.value = false }
}
async function createPlan() {
  if (!selectedItems.value.length || planSaving.value) return
  try { await ElMessageBox.confirm(`将所选${selectedItems.value.length}个规格保存为补货草稿，不增加库存。确认继续？`, '检查补货清单', { confirmButtonText: '保存草稿', cancelButtonText: '返回检查' }) } catch { return }
  planSaving.value = true
  try {
    await http.post('/inventory/replenishment-plans', { requestId: requestId.value, items: selectedItems.value.map(x => ({ skuId: x.skuId, quantity: x.purchaseQty })) })
    requestId.value = crypto.randomUUID(); ElMessage.success('补货草稿已保存'); await load(); tab.value = 'plans'
  } catch (e: any) { ElMessage.error(e.message || '保存失败，可重试') }
  finally { planSaving.value = false }
}
async function changeStatus(plan: any, status: string) {
  try {
    await ElMessageBox.confirm(`将补货清单标为“${statusText[status]}”。此操作不增加库存，到货后请通过出入库或AI库存草稿登记。`, '更新补货状态', { confirmButtonText: '确认', cancelButtonText: '取消' })
    await http.patch(`/inventory/replenishment-plans/${plan.id}`, { status, updatedAt: plan.updatedAt }); await load()
  } catch (e: any) { if (e !== 'cancel' && e !== 'close') ElMessage.error(e.message || '更新失败') }
}
function exportPlan(plan: any) {
  const quote = (value: unknown) => `"${String(value ?? '').replace(/^[=+\-@\t\r]/, "'$&").replaceAll('"', '""')}"`
  const csv = [['商品', '规格编码', '规格', '数量', '单位'], ...plan.payload.items.map((x: any) => [x.productName, x.skuCode, x.specText, x.quantity, x.saleUnit])].map(row => row.map(quote).join(',')).join('\r\n')
  const url = URL.createObjectURL(new Blob(['\uFEFF' + csv], { type: 'text/csv;charset=utf-8' }))
  const a = document.createElement('a'); a.href = url; a.download = `${plan.planNo}.csv`; a.click(); URL.revokeObjectURL(url)
}
onMounted(load)
</script>

<template>
  <section v-loading="loading">
    <div class="page-heading"><div><h1>库存计划与批次</h1><p>查看可售库存、订单预占、补货建议与临期批次</p></div><el-button @click="router.push('/inventory')">返回库存管理</el-button></div>
    <el-alert v-if="error" :title="error" type="error" :closable="false"><el-button @click="load">重试</el-button></el-alert>
    <el-card shadow="never"><el-tabs v-model="tab">
      <el-tab-pane label="预警与补货" name="overview">
        <div class="plan-toolbar"><el-input v-model="keyword" aria-label="搜索库存计划" clearable placeholder="商品名称或规格编码" @keyup.enter="load" /><el-button @click="load">查询</el-button><el-checkbox v-model="onlyLow">只看预警规格</el-checkbox><el-button v-if="canAdjust" type="primary" :disabled="!selectedItems.length" :loading="planSaving" @click="createPlan">保存补货草稿</el-button></div>
        <p class="plan-note">{{ note }}</p>
        <el-table :data="filtered" row-key="skuId" max-height="640" @selection-change="selection = $event">
          <el-table-column v-if="canAdjust" type="selection" width="40" />
          <el-table-column label="商品 / 规格" min-width="190"><template #default="{ row }"><strong>{{ row.productName }}</strong><div>{{ row.specText }} · {{ row.skuCode }}</div></template></el-table-column>
          <el-table-column prop="saleUnit" label="基础单位" width="70" />
          <el-table-column prop="stockNum" label="账面库存" width="80" />
          <el-table-column prop="reservedNum" label="已预占" width="75" />
          <el-table-column label="待审需求" width="85"><template #default="{ row }">{{ row.pendingDemand ?? '需订单权限' }}</template></el-table-column>
          <el-table-column label="可售数量" width="90"><template #default="{ row }"><el-tag :type="row.lowStock ? 'warning' : 'success'">{{ row.availableNum }}</el-tag></template></el-table-column>
          <el-table-column prop="threshold" label="预警量" width="90" />
          <el-table-column label="近28天销量" width="95"><template #default="{ row }">{{ row.sold28 ?? '需分析权限' }}</template></el-table-column>
          <el-table-column label="待补数量" min-width="150"><template #default="{ row }"><el-input-number v-model="row.purchaseQty" :aria-label="`${row.skuCode}补货数量`" :min="0" :max="2147483647" :precision="0" :disabled="!canAdjust" size="small" style="width:124px" /></template></el-table-column>
          <el-table-column label="批次提示" min-width="150"><template #default="{ row }"><span v-if="row.expiredQuantity">到期 {{ row.expiredQuantity }}；</span><span v-if="row.expiringQuantity">临期 {{ row.expiringQuantity }}；</span><span v-if="row.unknownBatchQuantity">日期未知 {{ row.unknownBatchQuantity }}</span><span v-if="!row.batchTracking">未启用</span></template></el-table-column>
        </el-table><el-empty v-if="!loading && !filtered.length && !error" description="暂无匹配规格" />
      </el-tab-pane>
      <el-tab-pane label="批次与保质期" name="batches"><p class="plan-note">按到期日期查看；到期批次禁止订单出库，手动报损仍可出库。启用前的历史库存不补造日期。</p><el-table :data="batches"><el-table-column prop="productName" label="商品" min-width="160" /><el-table-column prop="specText" label="规格" min-width="130" /><el-table-column prop="batchNo" label="批次" min-width="150" /><el-table-column prop="quantity" label="数量" width="90" /><el-table-column prop="saleUnit" label="单位" width="70" /><el-table-column prop="productionDate" label="生产日期" width="125" /><el-table-column prop="expiryDate" label="到期日期" width="125" /><el-table-column prop="state" label="状态" min-width="120" /><el-table-column v-if="canAdjust" label="操作" width="130"><template #default="{ row }"><el-button v-if="!row.expiryDate" link type="primary" @click="assign = { fromBatchId: row.id, quantity: row.quantity, batchNo: '', productionDate: '', expiryDate: '' }; assignVisible = true">补登记批次</el-button></template></el-table-column></el-table><el-empty v-if="!batches.length && !loading" description="暂无已登记批次，可在规格中启用后按批次入库" /></el-tab-pane>
      <el-tab-pane label="补货草稿" name="plans"><p class="plan-note">补货草稿用于采购跟进，状态更新不改变库存。到货后按实际数量登记入库。</p><el-collapse><el-collapse-item v-for="plan in plans" :key="plan.id" :title="`${plan.planNo} · ${statusText[plan.status]}`"><el-table :data="plan.payload.items"><el-table-column prop="productName" label="商品" /><el-table-column prop="skuCode" label="编码" /><el-table-column prop="specText" label="规格" /><el-table-column prop="quantity" label="数量" /><el-table-column prop="saleUnit" label="单位" /></el-table><div class="plan-toolbar"><el-button @click="exportPlan(plan)">导出清单</el-button><template v-if="canAdjust"><el-button v-if="plan.status === 'draft'" @click="changeStatus(plan, 'ordered')">标记已采购</el-button><el-button v-if="plan.status === 'ordered'" @click="changeStatus(plan, 'closed')">标记已处理</el-button><el-button v-if="['draft', 'ordered'].includes(plan.status)" @click="changeStatus(plan, 'cancelled')">取消清单</el-button></template></div></el-collapse-item></el-collapse><el-empty v-if="!plans.length && !loading" description="暂无补货草稿" /></el-tab-pane>
    </el-tabs></el-card>
    <el-dialog v-model="assignVisible" title="补登记历史批次" width="min(500px, 94vw)"><el-form label-width="90"><el-form-item label="数量"><el-input-number v-model="assign.quantity" aria-label="补登记批次数量" :min="1" :max="2147483647" :precision="0" /></el-form-item><el-form-item label="批次号"><el-input v-model="assign.batchNo" aria-label="补登记批次号" maxlength="64" /></el-form-item><el-form-item label="生产日期"><el-input v-model="assign.productionDate" placeholder="YYYY-MM-DD" /></el-form-item><el-form-item label="到期日期"><el-input v-model="assign.expiryDate" aria-label="补登记到期日期" placeholder="YYYY-MM-DD" /></el-form-item></el-form><template #footer><el-button @click="assignVisible = false">取消</el-button><el-button type="primary" :loading="assigning" @click="saveBatch">登记批次</el-button></template></el-dialog>
  </section>
</template>

<style scoped>
.plan-toolbar { display:flex; align-items:center; gap:12px; flex-wrap:wrap; margin:12px 0; }
.plan-toolbar .el-input { max-width:300px; }
.plan-note { color:var(--brand-text-soft); line-height:1.7; font-size:13px; }
@media(max-width:640px) { .page-heading { align-items:flex-start; flex-direction:column; gap:12px; } }
</style>
