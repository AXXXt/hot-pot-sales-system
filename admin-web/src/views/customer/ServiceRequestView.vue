<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref } from 'vue'
import { ElMessage } from 'element-plus'
import PageTable from '../../components/PageTable.vue'
import { getServiceRequest, getServiceRequests, processServiceRequest } from '../../api/service-request'
const types: Record<string, string> = { after_sales: '售后申请', profile_change: '资料更正', account_closure: '账号注销申请', invoice: '开票咨询', delivery: '配送咨询' }
const statuses: Record<string, string> = { pending: '待处理', processing: '处理中', completed: '已结案', rejected: '已驳回' }
const rows = ref<any[]>([]), detail = ref<any>(null), total = ref(0), page = ref(1), status = ref('')
const loading = ref(false), error = ref(''), visible = ref(false), detailLoading = ref(false), detailError = ref(''), saving = ref(false)
const target = ref('processing'), message = ref('')
const terminal = computed(() => ['completed', 'rejected'].includes(detail.value?.status))
const dataOf = (r: any) => r?.data ?? r
const dateText = (value: string) => value ? new Intl.DateTimeFormat('zh-CN', { timeZone: 'Asia/Shanghai', dateStyle: 'short', timeStyle: 'short', hour12: false }).format(new Date(value)) : ''
let listRequest = 0, detailRequest = 0
async function load() {
  const current = ++listRequest
  loading.value = true; error.value = ''
  try { const result: any = dataOf(await getServiceRequests({ page: page.value, pageSize: 20, ...(status.value ? { status: status.value } : {}) })); if (current === listRequest) { rows.value = result.items || []; total.value = result.total || 0 } }
  catch (err: any) { if (current === listRequest) error.value = err.message || '服务申请加载失败' }
  finally { if (current === listRequest) loading.value = false }
}
async function open(id: number, keepDraft = false) {
  const current = ++detailRequest
  visible.value = true; detailLoading.value = true; detailError.value = ''; detail.value = null
  if (!keepDraft) { message.value = ''; target.value = 'processing' }
  try { const record = dataOf(await getServiceRequest(id)); if (current === detailRequest) detail.value = record }
  catch (err: any) { if (current === detailRequest) detailError.value = err.message || '申请详情加载失败' }
  finally { if (current === detailRequest) detailLoading.value = false }
}
async function save() {
  if (!detail.value || terminal.value || saving.value || !message.value.trim()) return
  const id = detail.value.id
  saving.value = true
  try {
    await processServiceRequest(id, { status: target.value, message: message.value.trim(), expectedVersion: detail.value.version })
    ElMessage.success('处理进度已保存'); message.value = ''; await open(id); await load()
  } catch (err: any) {
    ElMessage.warning(err.message || '保存失败')
    if (err.response?.status === 409) await open(id, true)
  } finally { saving.value = false }
}
onMounted(load)
onBeforeUnmount(() => { listRequest++; detailRequest++ })
</script>

<template>
  <section>
    <div class="page-heading"><div><h1>客户服务申请</h1><p>售后、资料更正、注销、开票及配送咨询的人工处理进度</p></div></div>
    <el-alert title="本页记录受理与处理结果。退款、出入库、资料更改和账号停用须在对应业务中另行核实办理。" type="info" :closable="false" class="notice" />
    <el-card shadow="never">
      <div class="filter"><el-select v-model="status" placeholder="全部状态" clearable @change="page = 1; load()"><el-option v-for="(label, value) in statuses" :key="value" :label="label" :value="value" /></el-select><el-button @click="load">刷新</el-button></div>
      <PageTable :loading="loading" :error="error" :empty="!rows.length" @retry="load">
        <el-table :data="rows" row-key="id"><el-table-column prop="requestNo" label="申请编号" min-width="220" /><el-table-column label="客户" min-width="150"><template #default="{ row }">{{ row.customer?.customerName }}</template></el-table-column><el-table-column label="类型" width="130"><template #default="{ row }">{{ types[row.type] }}</template></el-table-column><el-table-column prop="subject" label="事项" min-width="180" /><el-table-column label="状态" width="100"><template #default="{ row }">{{ statuses[row.status] }}</template></el-table-column><el-table-column label="提交时间" min-width="160"><template #default="{ row }">{{ dateText(row.createdAt) }}</template></el-table-column><el-table-column label="操作" width="100"><template #default="{ row }"><el-button link type="primary" @click="open(row.id)">查看处理</el-button></template></el-table-column></el-table>
      </PageTable>
      <el-pagination v-if="total > 20" v-model:current-page="page" :total="total" :page-size="20" layout="prev, pager, next" @current-change="load" />
    </el-card>
    <el-dialog v-model="visible" title="服务申请处理" width="min(680px, 94vw)" :close-on-click-modal="!saving" :close-on-press-escape="!saving" :show-close="!saving">
      <el-skeleton v-if="detailLoading" :rows="5" animated />
      <el-alert v-else-if="detailError" :title="detailError" type="error" />
      <template v-else-if="detail">
        <h3>{{ detail.subject }}</h3><p>{{ types[detail.type] }} · {{ statuses[detail.status] }}</p>
        <p>{{ detail.customer?.customerName }} · {{ detail.customer?.contactName }} · {{ detail.customer?.contactPhone }}</p>
        <p v-if="detail.order">关联订单：{{ detail.order.orderNo }}</p><p class="description">{{ detail.description }}</p>
        <el-timeline><el-timeline-item v-for="(event, index) in detail.events" :key="index" :timestamp="dateText(event.at)"><strong>{{ statuses[event.status] }}</strong><p class="description">{{ event.message }}</p></el-timeline-item></el-timeline>
        <el-form v-if="!terminal" label-position="top" :disabled="saving">
          <el-form-item label="处理状态"><el-select v-model="target"><el-option label="受理 / 继续处理" value="processing" /><el-option v-if="detail.status === 'processing'" label="处理完成" value="completed" /><el-option label="驳回申请" value="rejected" /></el-select></el-form-item>
          <el-form-item label="客户可见的处理说明（必填）"><el-input v-model="message" type="textarea" :rows="4" maxlength="2000" show-word-limit placeholder="说明已完成的核实、后续安排或不予受理原因；请勿填写账号密码等敏感信息" /></el-form-item>
        </el-form>
      </template>
      <template #footer><el-button :disabled="saving" @click="visible = false">关闭</el-button><el-button v-if="detail && !terminal" type="primary" :loading="saving" :disabled="detailLoading || !message.trim()" @click="save">记录处理进度</el-button></template>
    </el-dialog>
  </section>
</template>
<style scoped>.notice{margin-bottom:16px}.filter{display:flex;gap:12px;margin-bottom:20px}.filter .el-select{width:180px}.description{white-space:pre-wrap;overflow-wrap:anywhere;line-height:1.8}.el-timeline{margin-top:24px}</style>
