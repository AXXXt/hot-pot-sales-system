<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { ElMessage, ElMessageBox } from 'element-plus'
import { RefreshRight, Van, Check, UploadFilled } from '@element-plus/icons-vue'
import { cancelOrder, completeOrder, getOrderDetail, getOrderLogistics, submitOrder, submitFinance, uploadPaymentProof } from '../../api/order'
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
const error = ref('')
const financeVisible = ref(false)
const paymentMethod = ref<'transfer' | 'credit'>('transfer')
const proofFile = ref<File | null>(null)
const uploadedProof = ref('')
const proofConsent = ref(false)
const creditInsufficient = computed(() => Number(order.value?.customer?.creditRemaining || 0) < Number(order.value?.payableAmount || 0))
const orderId = computed(() => Number(route.params.id))

const timeline = computed(() => [
  { title: '提交订单', done: true },
  { title: '供应商报价', done: ['pending_confirm','pending_finance','pending_shipment','shipped','completed'].includes(order.value?.status || '') },
  { title: '客户确认', done: ['pending_finance','pending_shipment','shipped','completed'].includes(order.value?.status || '') },
  { title: '财务审核', done: ['pending_shipment','shipped','completed'].includes(order.value?.status || '') },
  { title: '配送完成', done: order.value?.status === 'completed' }
])

async function load() {
  loading.value = true
  error.value = ''
  track.value = []
  try {
    const response = await getOrderDetail(orderId.value)
    order.value = response.data
    if (['pending_shipment','shipped','completed'].includes(response.data.status)) {
      try {
        const logistics = await getOrderLogistics(orderId.value)
        track.value = logistics.data.track || []
      } catch { /* Order actions remain available when logistics is temporarily unavailable. */ }
    }
  } catch {
    error.value = '订单加载失败，请重试'
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
  if (working.value) return
  const confirmed = await ElMessageBox.confirm('确定取消这个订单吗？', '取消订单', { type: 'warning' }).then(() => true).catch(() => false)
  if (!confirmed) return
  working.value = true
  try {
    await cancelOrder(orderId.value)
    ElMessage.success('订单已取消')
    await load()
  } catch { /* The request layer displays the error. */ } finally {
    working.value = false
  }
}

async function confirmReceipt() {
  if (working.value) return
  const confirmed = await ElMessageBox.confirm('请确认已收到全部货物。', '确认收货', { type: 'warning' }).then(() => true).catch(() => false)
  if (!confirmed) return
  working.value = true
  try {
    await completeOrder(orderId.value)
    ElMessage.success('已确认收货')
    await load()
  } catch { /* The request layer displays the error. */ } finally {
    working.value = false
  }
}

async function submitDraft() {
  if (working.value) return
  working.value = true
  try {
    await submitOrder(orderId.value)
    ElMessage.success('订单已提交，等待报价')
    await load()
  } catch { /* The draft remains available for retry. */ } finally { working.value = false }
}

function openFinance() {
  paymentMethod.value = 'transfer'
  proofFile.value = null
  uploadedProof.value = order.value?.paymentProof || ''
  proofConsent.value = false
  financeVisible.value = true
}

function chooseProof(event: Event) {
  const input = event.target as HTMLInputElement
  const file = input.files?.[0]
  if (!file) return
  if (!['image/jpeg', 'image/png', 'image/webp'].includes(file.type) || file.size > 5 * 1024 * 1024) {
    ElMessage.warning('请选择不超过 5MB 的 JPG、PNG 或 WebP 图片')
    input.value = ''
    return
  }
  proofFile.value = file
  uploadedProof.value = ''
}

async function confirmFinance() {
  if (working.value || !order.value) return
  if (paymentMethod.value === 'credit' && creditInsufficient.value) {
    ElMessage.warning('可用账期额度不足')
    return
  }
  if (paymentMethod.value === 'transfer' && (!proofConsent.value || (!proofFile.value && !uploadedProof.value))) {
    ElMessage.warning('请选择付款凭证并确认授权处理该凭证')
    return
  }
  working.value = true
  try {
    if (paymentMethod.value === 'credit') {
      await submitFinance(orderId.value, { creditRequested: true })
    } else {
      if (!uploadedProof.value) {
        const response = await uploadPaymentProof(proofFile.value!)
        uploadedProof.value = response.data.url
      }
      await submitFinance(orderId.value, { paymentProof: uploadedProof.value })
    }
    financeVisible.value = false
    ElMessage.success('报价已确认，等待财务审核')
    await load()
  } catch { /* Retain the uploaded proof so a retry does not upload twice. */ } finally { working.value = false }
}

onMounted(load)
</script>

<template>
  <div class="page" v-loading="loading">
    <el-alert v-if="error" :title="error" type="error" :closable="false"><el-button @click="load">重试</el-button></el-alert>
    <div class="title-row">
      <div><h1 class="page-title">{{ order?.orderNo || '订单详情' }}</h1><p class="muted">{{ formatDateTime(order?.createdAt || '') }}</p></div>
      <div class="top-actions">
        <el-button size="large" type="primary" :icon="RefreshRight" :disabled="!order || working" @click="reorder">一键复购</el-button>
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
        <template v-if="order.quoteNote"><h3>报价说明</h3><p class="muted">{{ order.quoteNote }}</p></template>
        <div class="bottom-actions">
          <el-button v-if="order.status === 'draft'" type="primary" :icon="Check" :loading="working" @click="submitDraft">继续提交订单</el-button>
          <el-button v-if="order.status === 'pending_confirm'" type="primary" :icon="Check" :disabled="working" @click="openFinance">确认报价并支付</el-button>
          <el-button v-if="['draft','pending_quote','pending_confirm','pending_finance'].includes(order.status)" type="danger" plain :loading="working" @click="cancel">取消订单</el-button>
          <el-button @click="router.push('/orders')">返回列表</el-button>
        </div>
      </el-card>
    </div>
    <el-dialog v-model="financeVisible" title="确认报价" width="min(520px, 94vw)" :close-on-click-modal="!working" :close-on-press-escape="!working" :show-close="!working">
      <p class="finance-total">应付金额 <strong class="price">¥{{ formatAmount(order?.payableAmount || '0') }}</strong></p>
      <el-radio-group v-model="paymentMethod" :disabled="working" aria-label="支付方式">
        <el-radio-button value="transfer">转账凭证</el-radio-button>
        <el-radio-button value="credit">账期支付</el-radio-button>
      </el-radio-group>
      <div v-if="paymentMethod === 'transfer'" class="finance-fields">
        <label for="payment-proof"><el-icon><UploadFilled /></el-icon> 转账凭证（JPG / PNG / WebP，最大 5MB）</label>
        <input id="payment-proof" type="file" accept="image/jpeg,image/png,image/webp" :disabled="working" @change="chooseProof">
        <p v-if="uploadedProof">凭证已上传，提交失败后可直接重试。</p>
        <p class="muted">请遮盖余额、完整银行卡号及无关交易，仅保留本次付款核验所需信息。</p>
        <el-checkbox v-model="proofConsent" :disabled="working">我同意为核验本次付款处理所上传的凭证信息</el-checkbox>
      </div>
      <div v-else class="finance-fields">
        <p>可用账期额度：¥{{ formatAmount(order?.customer?.creditRemaining || '0') }}</p>
        <p class="muted">确认后将占用本单金额对应的账期额度。</p>
        <el-alert v-if="creditInsufficient" title="可用额度不足，请选择转账凭证或联系客户经理" type="warning" :closable="false" />
      </div>
      <template #footer>
        <el-button :disabled="working" @click="financeVisible = false">取消</el-button>
        <el-button type="primary" :icon="Check" :loading="working" :disabled="paymentMethod === 'credit' ? creditInsufficient : !proofConsent || (!proofFile && !uploadedProof)" @click="confirmFinance">确认并提交</el-button>
      </template>
    </el-dialog>
  </div>
</template>

<style scoped>
.title-row { display: flex; justify-content: space-between; align-items: flex-start; gap: 16px; }
.top-actions { display: flex; gap: 10px; }
.finance-total { display: flex; justify-content: space-between; gap: 16px; }
.finance-fields { display: grid; gap: 12px; margin-top: 20px; }
.finance-fields p { margin: 0; line-height: 1.6; }
.finance-fields input { max-width: 100%; }
.finance-fields :deep(.el-checkbox) { height: auto; align-items: flex-start; white-space: normal; }
.finance-fields :deep(.el-checkbox__label) { white-space: normal; line-height: 1.5; }
.bottom-actions .el-button + .el-button { margin-left: 0; }
@media (max-width: 600px) { .title-row, .top-actions { flex-wrap: wrap; } .page-title { overflow-wrap: anywhere; } }
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
