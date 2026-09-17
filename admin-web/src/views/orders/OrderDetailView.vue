<script setup lang="ts">
import { computed, onMounted, reactive, ref } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { ElMessage, ElMessageBox } from 'element-plus'
import { getOrderDetail, quoteOrder, getPriceHistory, approveFinance, shipOrder, cancelOrder, completeOrder, submitOrder, refundOrder } from '../../api/order'
import { getPaymentProofUrl } from '../../api/upload'

const route = useRoute()
const router = useRouter()
const id = Number(route.params.id)
const loading = ref(true)
const error = ref('')
const order = ref<any>({})
const actionLoading = ref('')
const quoteVisible = ref(false)
const shipVisible = ref(false)
const historyPrices = ref<any[]>([])
const quoteItems = ref<any[]>([])
const quoteNote = ref('')
const shipForm = reactive({ logisticsType: 'tricycle', driverName: '', driverPhone: '', plateNumber: '' })
const refundVisible = ref(false)
const refundSaving = ref(false)
const refundForm = reactive({ amount: 0, method: 'transfer', reason: '' })

const methodText = (m: string) => ({ transfer: '转账', cash: '现金', other: '其他' } as Record<string, string>)[m] || m || '-'

function openRefund() {
  refundForm.amount = Number(order.value.payableAmount || 0)
  refundForm.method = 'transfer'
  refundForm.reason = ''
  refundVisible.value = true
}

async function submitRefund() {
  const amount = Number(refundForm.amount)
  if (!Number.isFinite(amount) || amount <= 0) { ElMessage.warning('请输入大于 0 的退款金额'); return }
  refundSaving.value = true
  try {
    await refundOrder(id, { amount: String(amount), method: refundForm.method, reason: refundForm.reason || undefined })
    ElMessage.success('退款登记成功')
    refundVisible.value = false
    await fetch()
  } catch (e: any) { ElMessage.warning(e.message || '退款登记失败') }
  finally { refundSaving.value = false }
}

const dataOf = (r: any) => r?.data ?? r ?? {}
const viewingProof = ref(false)

async function viewPaymentProof() {
  if (!order.value.paymentProof || viewingProof.value) return
  viewingProof.value = true
  try {
    const res: any = await getPaymentProofUrl(order.value.paymentProof)
    const url = dataOf(res).url
    if (url) {
      window.open(url, '_blank', 'noopener')
    } else {
      ElMessage.warning('凭证地址无效')
    }
  } catch (e: any) {
    ElMessage.warning(e.message || '获取凭证失败')
  } finally {
    viewingProof.value = false
  }
}

async function fetch() {
  loading.value = true; error.value = ''
  try { const res: any = await getOrderDetail(id); order.value = dataOf(res) }
  catch (e: any) { error.value = e.message || '加载失败' }
  finally { loading.value = false }
}

const st = (s: string) => {
  const m: Record<string, string> = { draft: '草稿', pending_quote: '待报价', pending_confirm: '待客户确认', pending_finance: '待财务审核', pending_shipment: '待发货', shipped: '已发货', completed: '已完成', cancelled: '已取消' }
  return m[s] || s
}
const stTag = (s: string) => {
  const m: Record<string, string> = { draft: 'info', pending_quote: '', pending_confirm: 'warning', pending_finance: 'danger', pending_shipment: 'primary', shipped: 'success', completed: 'success', cancelled: 'danger' }
  return m[s] || 'info'
}

const canCancel = computed(() => ['draft', 'pending_quote', 'pending_confirm', 'pending_finance', 'pending_shipment'].includes(order.value.status))

// draft -> pending_quote
async function doSubmit() {
  actionLoading.value = 'submit'
  try {
    await submitOrder(id)
    ElMessage.success('订单已提交，等待报价')
    await fetch()
  } catch (e: any) { ElMessage.warning(e.message || '操作失败') }
  finally { actionLoading.value = '' }
}

// pending_quote -> pending_confirm
async function openQuote() {
  const items = order.value.items || []
  const skuIds = items.map((i: any) => i.skuId)
  try {
    const res: any = await getPriceHistory(order.value.customerId, skuIds)
    historyPrices.value = dataOf(res) || []
  } catch { historyPrices.value = [] }
  quoteItems.value = items.map((item: any) => {
    const hist = historyPrices.value.find((h: any) => h.skuId === item.skuId)
    return { skuId: item.skuId, productName: item.productName, skuName: item.skuName, quantity: item.quantity, quotedPrice: hist ? Number(hist.price) : Number(item.unitPrice || 0) }
  })
  quoteNote.value = ''
  quoteVisible.value = true
}

async function submitQuote() {
  actionLoading.value = 'quote'
  try {
    await quoteOrder(id, { items: quoteItems.value.map(i => ({ skuId: i.skuId, quotedPrice: i.quotedPrice })), note: quoteNote.value })
    ElMessage.success('报价已提交，等待客户确认')
    quoteVisible.value = false
    await fetch()
  } catch (e: any) { ElMessage.warning(e.message || '报价失败') }
  finally { actionLoading.value = '' }
}

// pending_finance -> pending_shipment (stock deduction)
async function doApproveFinance() {
  try {
    await ElMessageBox.confirm('确认财务审核通过？通过后将自动扣减库存。', '审核确认', { type: 'warning' })
    actionLoading.value = 'approve'
    await approveFinance(id)
    ElMessage.success('审核通过，库存已扣减')
    await fetch()
  } catch (e: any) { if (e !== 'cancel' && e !== 'close') ElMessage.warning(e.message || '操作失败') }
  finally { actionLoading.value = '' }
}

// pending_shipment -> shipped
function openShip() {
  const info = order.value.logisticsInfo || {}
  shipForm.logisticsType = order.value.logisticsType || 'tricycle'
  shipForm.driverName = info.driverName || ''
  shipForm.driverPhone = info.driverPhone || ''
  shipForm.plateNumber = info.plateNumber || ''
  shipVisible.value = true
}

const needLogisticsDetail = computed(() => shipForm.logisticsType !== 'tricycle')

async function submitShip() {
  if (needLogisticsDetail.value) {
    if (!shipForm.plateNumber || !shipForm.driverName || !shipForm.driverPhone) {
      ElMessage.warning('冷链/普货必须填写车牌号、司机姓名和联系方式'); return
    }
  }
  actionLoading.value = 'ship'
  try {
    await shipOrder(id, { ...shipForm })
    ElMessage.success('已发货')
    shipVisible.value = false
    await fetch()
  } catch (e: any) { ElMessage.warning(e.message || '发货失败') }
  finally { actionLoading.value = '' }
}

async function doCancel() {
  try {
    await ElMessageBox.confirm('确认取消该订单？已扣库存和已占用账期额度会自动退还。', '取消确认', { type: 'warning' })
    actionLoading.value = 'cancel'
    await cancelOrder(id)
    ElMessage.success('已取消')
    await fetch()
  } catch (e: any) { if (e !== 'cancel' && e !== 'close') ElMessage.warning(e.message || '操作失败') }
  finally { actionLoading.value = '' }
}

// shipped -> completed
async function doComplete() {
  try {
    await ElMessageBox.confirm('确认收货完成？', '完成确认', { type: 'warning' })
    actionLoading.value = 'complete'
    await completeOrder(id)
    ElMessage.success('订单已完成')
    await fetch()
  } catch (e: any) { if (e !== 'cancel' && e !== 'close') ElMessage.warning(e.message || '操作失败') }
  finally { actionLoading.value = '' }
}

onMounted(fetch)
</script>

<template>
  <section>
    <div class="page-heading">
      <div><h1>订单详情</h1><p>{{ order.orderNo || '加载中…' }}</p></div>
      <el-button @click="router.back()">返回列表</el-button>
    </div>

    <el-alert v-if="error" type="error" :title="error" show-icon style="margin-bottom:16px" />

    <div v-if="loading" style="text-align:center;padding:60px 0">
      <el-icon class="is-loading" :size="28"><svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="10" stroke="#ead9d7" stroke-width="3" fill="none"/><path d="M12 2a10 10 0 0 1 10 10" stroke="#8d1c1c" stroke-width="3" fill="none" stroke-linecap="round"/></svg></el-icon>
    </div>

    <template v-if="!loading && !error && order.id">
      <el-card shadow="never" style="margin-bottom:16px">
        <template #header>
          <div class="card-title"><strong>基本信息</strong><el-tag :type="stTag(order.status)">{{ st(order.status) }}</el-tag></div>
        </template>
        <el-descriptions :column="3" border size="small">
          <el-descriptions-item label="订单号">{{ order.orderNo }}</el-descriptions-item>
          <el-descriptions-item label="客户">{{ order.customer?.customerName || '-' }}</el-descriptions-item>
          <el-descriptions-item label="类型"><el-tag v-if="order.sampleFlag" type="warning" size="small">样品单</el-tag><span v-else>普通订单</span></el-descriptions-item>
          <el-descriptions-item label="订单金额">¥{{ Number(order.totalAmount || 0).toFixed(2) }}</el-descriptions-item>
          <el-descriptions-item label="报价金额" v-if="order.quotedAmount">¥{{ Number(order.quotedAmount || 0).toFixed(2) }}</el-descriptions-item>
          <el-descriptions-item label="应付金额"><b>¥{{ Number(order.payableAmount || 0).toFixed(2) }}</b></el-descriptions-item>
          <el-descriptions-item label="支付方式" v-if="order.paymentMethod">{{ order.paymentMethod === 'credit' ? '账期支付' : '转账凭证' }}</el-descriptions-item>
          <el-descriptions-item label="创建时间">{{ new Date(order.createdAt).toLocaleString('zh-CN') }}</el-descriptions-item>
          <el-descriptions-item label="备注" :span="2">{{ order.remark || '-' }}</el-descriptions-item>
        </el-descriptions>
        <div v-if="order.paymentProof" style="margin-top:12px">
          <el-tag type="success" size="small">已上传付款凭证</el-tag>
          <el-button link type="primary" size="small" :loading="viewingProof" @click="viewPaymentProof">查看凭证</el-button>
        </div>
        <div v-if="order.logisticsInfo" style="margin-top:12px">
          <el-tag type="primary" size="small">物流信息</el-tag>
          <span style="margin-left:8px;font-size:12px;color:#606266">
            {{ order.logisticsType === 'tricycle' ? '三轮车' : order.logisticsType }}
            <template v-if="order.logisticsInfo.driverName"> / {{ order.logisticsInfo.driverName }}</template>
            <template v-if="order.logisticsInfo.driverPhone"> / {{ order.logisticsInfo.driverPhone }}</template>
            <template v-if="order.logisticsInfo.plateNumber"> / {{ order.logisticsInfo.plateNumber }}</template>
          </span>
        </div>
      </el-card>

      <el-card v-if="order.items?.length" shadow="never" style="margin-bottom:16px">
        <template #header><strong>商品明细</strong></template>
        <el-table :data="order.items" size="small" stripe>
          <el-table-column type="index" label="#" width="50" />
          <el-table-column prop="productName" label="商品" min-width="140" />
          <el-table-column prop="skuSpecText" label="规格" min-width="100" />
          <el-table-column prop="quantity" label="数量" width="70" />
          <el-table-column label="原价" width="90"><template #default="{row}">¥{{ Number(row.unitPrice||0).toFixed(2) }}</template></el-table-column>
          <el-table-column label="报价" width="100">
            <template #default="{row}">
              <span v-if="row.quotedPrice" style="color:#e6a23c;font-weight:600">¥{{ Number(row.quotedPrice).toFixed(2) }}</span>
              <span v-else class="inline-hint">-</span>
            </template>
          </el-table-column>
          <el-table-column label="小计" width="100"><template #default="{row}">¥{{ Number(row.amount||0).toFixed(2) }}</template></el-table-column>
        </el-table>
      </el-card>

      <el-card v-if="order.statusLogs?.length" shadow="never" style="margin-bottom:16px">
        <template #header><strong>状态流转</strong></template>
        <el-timeline>
          <el-timeline-item v-for="log in order.statusLogs" :key="log.id"
            :timestamp="new Date(log.createdAt).toLocaleString('zh-CN')"
            :color="log.toStatus === 'completed' ? '#34A853' : log.toStatus === 'cancelled' ? '#C43737' : '#8D1C1C'">
            {{ st(log.fromStatus) }} → {{ st(log.toStatus) }}
          </el-timeline-item>
        </el-timeline>
      </el-card>

      <el-card v-if="order.refunds?.length" shadow="never" style="margin-bottom:16px">
        <template #header><strong>退款记录</strong></template>
        <el-table :data="order.refunds" size="small" stripe>
          <el-table-column label="时间" width="170">
            <template #default="{row}">{{ new Date(row.createdAt).toLocaleString('zh-CN') }}</template>
          </el-table-column>
          <el-table-column label="金额" width="120">
            <template #default="{row}">¥{{ Number(row.amount).toFixed(2) }}</template>
          </el-table-column>
          <el-table-column label="方式" width="100">
            <template #default="{row}">{{ methodText(row.method) }}</template>
          </el-table-column>
          <el-table-column prop="reason" label="原因" min-width="140"><template #default="{row}">{{ row.reason || '-' }}</template></el-table-column>
        </el-table>
      </el-card>

      <div class="actions-bar">
        <el-button v-if="order.status === 'draft'" type="primary" :loading="actionLoading==='submit'" @click="doSubmit">提交订单</el-button>
        <el-button v-if="order.status === 'pending_quote'" type="primary" :loading="actionLoading==='quote'" @click="openQuote">填写报价</el-button>
        <el-tag v-if="order.status === 'pending_confirm'" type="warning" size="large">等待客户确认报价并选择支付方式</el-tag>
        <el-button v-if="order.status === 'pending_finance'" type="success" :loading="actionLoading==='approve'" @click="doApproveFinance">财务审核通过（扣库存）</el-button>
        <el-button v-if="order.status === 'pending_shipment'" type="primary" :loading="actionLoading==='ship'" @click="openShip">录入物流并发货</el-button>
        <el-button v-if="order.status === 'shipped'" type="success" :loading="actionLoading==='complete'" @click="doComplete">确认收货</el-button>
        <el-tag v-if="order.status === 'completed'" type="success" size="large">订单已完成</el-tag>
        <el-tag v-if="order.status === 'cancelled'" type="danger" size="large">订单已取消</el-tag>
        <el-button v-if="order.status === 'cancelled'" type="warning" plain @click="openRefund">退款登记</el-button>
        <el-button v-if="canCancel" type="danger" plain :loading="actionLoading==='cancel'" @click="doCancel">取消订单</el-button>
      </div>
    </template>

    <el-dialog v-model="quoteVisible" title="填写报价" width="650" @close="quoteVisible=false">
      <div v-if="!quoteItems.length" class="inline-empty">无商品明细</div>
      <el-table v-else :data="quoteItems" size="small">
        <el-table-column prop="productName" label="商品" width="140" />
        <el-table-column prop="skuName" label="规格" width="120" />
        <el-table-column prop="quantity" label="数量" width="70" />
        <el-table-column label="历史价" width="100">
          <template #default="{row}">
            <span v-if="historyPrices.find((h:any)=>h.skuId===row.skuId)" class="inline-hint">
              ¥{{ Number(historyPrices.find((h:any)=>h.skuId===row.skuId).price).toFixed(2) }}
            </span>
            <span v-else class="inline-hint">无记录</span>
          </template>
        </el-table-column>
        <el-table-column label="报价单价" width="180">
          <template #default="{row}">
            <el-input-number v-model="row.quotedPrice" :min="0" :precision="2" size="small" controls-position="right" style="width:150px" />
          </template>
        </el-table-column>
      </el-table>
      <el-form style="margin-top:16px">
        <el-form-item label="报价备注"><el-input v-model="quoteNote" type="textarea" :rows="2" placeholder="可选，报价说明" /></el-form-item>
      </el-form>
      <template #footer>
        <el-button @click="quoteVisible=false">取消</el-button>
        <el-button type="primary" :loading="actionLoading==='quote'" @click="submitQuote">提交报价</el-button>
      </template>
    </el-dialog>

    <el-dialog v-model="shipVisible" title="录入物流信息" width="480">
      <el-form label-width="100">
        <el-form-item label="配送方式">
          <el-select v-model="shipForm.logisticsType" style="width:100%">
            <el-option label="三轮车（同城）" value="tricycle" />
            <el-option label="冷链配送" value="cold-chain" />
            <el-option label="普货物流" value="regular" />
          </el-select>
        </el-form-item>
        <template v-if="needLogisticsDetail">
          <el-form-item label="车牌号"><el-input v-model="shipForm.plateNumber" placeholder="例如：豫A12345" /></el-form-item>
          <el-form-item label="司机姓名"><el-input v-model="shipForm.driverName" /></el-form-item>
          <el-form-item label="司机电话"><el-input v-model="shipForm.driverPhone" placeholder="手机号" /></el-form-item>
        </template>
      </el-form>
      <template #footer>
        <el-button @click="shipVisible=false">取消</el-button>
        <el-button type="primary" :loading="actionLoading==='ship'" @click="submitShip">确认发货</el-button>
      </template>
    </el-dialog>
  <!-- Refund Dialog -->
  <el-dialog v-model="refundVisible" title="退款登记" width="440">
    <el-form label-width="90">
      <el-form-item label="退款金额" required>
        <el-input-number v-model="refundForm.amount" :min="0.01" :precision="2" :controls="false" style="width:100%" />
      </el-form-item>
      <el-form-item label="退款方式">
        <el-select v-model="refundForm.method" style="width:100%">
          <el-option label="转账" value="transfer" />
          <el-option label="现金" value="cash" />
          <el-option label="其他" value="other" />
        </el-select>
      </el-form-item>
      <el-form-item label="退款原因">
        <el-input v-model="refundForm.reason" type="textarea" :rows="2" placeholder="可选" />
      </el-form-item>
    </el-form>
    <template #footer>
      <el-button @click="refundVisible=false">取消</el-button>
      <el-button type="primary" :loading="refundSaving" @click="submitRefund">确认退款</el-button>
    </template>
  </el-dialog>
  </section>
</template>

<style scoped>
.page-heading { margin-bottom: 20px; }
.card-title { display: flex; justify-content: space-between; align-items: center; color: var(--brand-text); }
.actions-bar { display: flex; gap: 10px; padding: 10px 0; flex-wrap: wrap; align-items: center; }
</style>
