<script setup lang="ts">
import { onBeforeUnmount, onMounted, ref } from 'vue'
import { useRoute } from 'vue-router'
import { ElMessage } from 'element-plus'
import { createMyServiceRequest, getMyServiceRequest, getMyServiceRequests, getServiceOrderOptions, serviceRequestKey } from '../../api/service-request'
const route = useRoute()
const types: Record<string, string> = { after_sales: '售后申请', profile_change: '资料更正', account_closure: '账号注销申请', invoice: '开票咨询', delivery: '配送咨询' }
const statuses: Record<string, string> = { pending: '待处理', processing: '处理中', completed: '已结案', rejected: '已驳回' }
const rows = ref<any[]>([]), orders = ref<any[]>([]), detail = ref<any>(null), page = ref(1), total = ref(0)
const loading = ref(false), error = ref(''), formVisible = ref(false), detailVisible = ref(false), detailLoading = ref(false), saving = ref(false)
const form = ref({ clientKey: '', type: 'after_sales', subject: '', description: '', orderId: null as number | null })
const dataOf = (response: any) => response?.data ?? response
const dateText = (value: string) => value ? new Intl.DateTimeFormat('zh-CN', { timeZone: 'Asia/Shanghai', dateStyle: 'short', timeStyle: 'short', hour12: false }).format(new Date(value)) : ''
let orderSearch = 0, listRequest = 0, detailRequest = 0
async function load() {
  const current = ++listRequest
  loading.value = true; error.value = ''
  try { const result: any = dataOf(await getMyServiceRequests({ page: page.value, pageSize: 20 })); if (current === listRequest) { rows.value = result.items || []; total.value = result.total || 0 } }
  catch (err: any) { if (current === listRequest) error.value = err.message || '申请记录加载失败' }
  finally { if (current === listRequest) loading.value = false }
}
async function loadOrders(keyword = '', orderId?: number) {
  const current = ++orderSearch
  try { const result = dataOf(await getServiceOrderOptions({ ...(keyword ? { keyword } : {}), ...(orderId ? { orderId } : {}) })); if (current === orderSearch) orders.value = result || [] }
  catch { if (current === orderSearch) orders.value = [] }
}
function create(type = 'after_sales', orderId?: number) {
  form.value = { clientKey: serviceRequestKey(), type: types[type] ? type : 'after_sales', subject: '', description: '', orderId: orderId || null }
  formVisible.value = true; loadOrders('', orderId)
}
async function open(id: number) {
  const current = ++detailRequest
  detailVisible.value = true; detailLoading.value = true; detail.value = null
  try { const record = dataOf(await getMyServiceRequest(id)); if (current === detailRequest) detail.value = record }
  catch (err: any) { if (current === detailRequest) { ElMessage.warning(err.message || '申请暂不可访问'); detailVisible.value = false } }
  finally { if (current === detailRequest) detailLoading.value = false }
}
async function submit() {
  if (saving.value || !form.value.subject.trim() || !form.value.description.trim()) return
  saving.value = true
  try {
    const result: any = dataOf(await createMyServiceRequest({ ...form.value, subject: form.value.subject.trim(), description: form.value.description.trim(), orderId: form.value.orderId || undefined }))
    formVisible.value = false; page.value = 1; ElMessage.success('申请已提交'); await load(); await open(result.id)
  } catch (err: any) { ElMessage.warning(err.message || '提交失败，请保留表单并重试'); await load() }
  finally { saving.value = false }
}
onMounted(() => { load(); if (route.query.type) create(String(route.query.type), Number(route.query.orderId) || undefined) })
onBeforeUnmount(() => { orderSearch++; listRequest++; detailRequest++ })
</script>

<template>
  <main class="requests-page">
    <div class="heading"><div><h1>服务申请与进度</h1><p>售后、资料更正、注销、开票及配送咨询</p></div><el-button type="primary" @click="create()">提交申请</el-button></div>
    <p class="notice">提交后由工作人员人工核实处理。注销申请不会立即删除账号，售后申请不会自动退款；请在本页查看进度。</p>
    <el-alert v-if="error" :title="error" type="error"><el-button @click="load">重新加载</el-button></el-alert>
    <el-skeleton v-else-if="loading" :rows="5" animated />
    <el-empty v-else-if="!rows.length" description="暂无服务申请" />
    <button v-for="row in rows" :key="row.id" class="request-row" @click="open(row.id)"><span><strong>{{ row.subject }}</strong><small>{{ types[row.type] }} · {{ dateText(row.createdAt) }}</small></span><span>{{ statuses[row.status] }} ›</span></button>
    <el-pagination v-if="total > 20" v-model:current-page="page" :total="total" :page-size="20" layout="prev, pager, next" @current-change="load" />
    <el-dialog v-model="formVisible" title="提交服务申请" width="min(560px, 94vw)" :close-on-click-modal="!saving" :close-on-press-escape="!saving" :show-close="!saving">
      <el-form label-position="top" :disabled="saving">
        <el-form-item label="申请类型"><el-select v-model="form.type"><el-option v-for="(label, value) in types" :key="value" :label="label" :value="value" /></el-select></el-form-item>
        <el-form-item label="事项（必填）"><el-input v-model="form.subject" maxlength="120" /></el-form-item>
        <el-form-item label="关联订单（可选）"><el-select v-model="form.orderId" clearable filterable remote :remote-method="loadOrders" placeholder="输入订单号搜索"><el-option v-for="order in orders" :key="order.id" :label="order.orderNo" :value="order.id" /></el-select></el-form-item>
        <p class="hint">搜索最多显示最近30笔匹配订单。资料更正和账号注销可不关联订单。</p>
        <el-form-item label="详细说明（必填）"><el-input v-model="form.description" type="textarea" :rows="5" maxlength="2000" show-word-limit placeholder="请描述问题或需要更正的内容，请勿填写密码、验证码或银行卡完整号码" /></el-form-item>
      </el-form>
      <template #footer><el-button :disabled="saving" @click="formVisible = false">取消</el-button><el-button type="primary" :loading="saving" :disabled="!form.subject.trim() || !form.description.trim()" @click="submit">提交申请</el-button></template>
    </el-dialog>
    <el-dialog v-model="detailVisible" title="申请处理进度" width="min(560px, 94vw)">
      <el-skeleton v-if="detailLoading" :rows="5" animated />
      <template v-else-if="detail"><h3>{{ detail.subject }}</h3><p>{{ types[detail.type] }} · {{ statuses[detail.status] }}</p><p v-if="detail.order">关联订单：{{ detail.order.orderNo }}</p><p class="description">{{ detail.description }}</p>
        <el-timeline><el-timeline-item v-for="(event, index) in detail.events" :key="index" :timestamp="dateText(event.at)"><strong>{{ statuses[event.status] }}</strong><p class="description">{{ event.message }}</p></el-timeline-item></el-timeline>
        <el-button @click="open(detail.id)">刷新进度</el-button>
      </template>
    </el-dialog>
  </main>
</template>
<style scoped>.requests-page{max-width:920px;margin:0 auto;padding:24px 16px}.heading{display:flex;justify-content:space-between;gap:16px;align-items:center}.heading h1{font-size:24px}.notice,.hint,.heading p{color:#69716b;font-size:14px;line-height:1.8}.notice{padding:16px;background:#f4f6f4}.request-row{display:flex;width:100%;justify-content:space-between;text-align:left;gap:16px;align-items:center;background:white;border:0;border-bottom:1px solid #e4e8e4;padding:20px 0;cursor:pointer;color:inherit;font:inherit}.request-row small{display:block;margin-top:8px;color:#69716b}.description{white-space:pre-wrap;overflow-wrap:anywhere;line-height:1.8}.el-timeline{margin-top:24px}</style>
