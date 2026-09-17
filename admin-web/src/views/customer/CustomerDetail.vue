<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { ElMessage, ElMessageBox } from 'element-plus'
import { ArrowLeft, Edit } from '@element-plus/icons-vue'
import { getCustomerDetail, updateCustomer, getCustomerLevels, getPriceRules, createPriceRule, deletePriceRule } from '../../api/customer'
import { getProducts } from '../../api/product'
import ProductVisibilityCard from './components/ProductVisibilityCard.vue'

const route = useRoute()
const router = useRouter()
const id = Number(route.params.id)
const loading = ref(true)
const customer = ref<any>({})
const levels = ref<any[]>([])
const priceRules = ref<any[]>([])
const products = ref<any[]>([])
const editVisible = ref(false)
const saving = ref(false)
const editForm = ref<any>({})
type PriceRuleForm = {
  id: number | null
  skuId: number | null
  price: number | null
}

const ruleVisible = ref(false)
const ruleForm = ref<PriceRuleForm>({ id: null, skuId: null, price: null })
const ruleSaving = ref(false)
const deletingRuleId = ref<number | null>(null)
const skuOptions = computed(() => products.value.flatMap((product: any) =>
  (product.skus || []).map((sku: any) => {
    const currentRule = priceRules.value.find((rule: any) => Number(rule.skuId) === Number(sku.id))
    const basePriceText = sku.basePrice != null ? ` / 原价 ¥${Number(sku.basePrice).toFixed(2)}` : ''
    const currentPriceText = currentRule ? ` / 当前协议价 ¥${Number(currentRule.price).toFixed(2)}` : ''
    return {
      ...sku,
      optionLabel: `${product.name} / ${sku.name || sku.skuCode}${basePriceText}${currentPriceText}`
    }
  })
))
const ruleDialogTitle = computed(() => ruleForm.value.id ? '编辑协议价' : '添加协议价')

const dataOf = (r: any) => r?.data ?? r ?? {}

async function load() {
  loading.value = true
  try {
    const [cRes, lRes, pRes]: any = await Promise.all([
      getCustomerDetail(id),
      getCustomerLevels(),
      getPriceRules(id)
    ])
    customer.value = dataOf(cRes)
    levels.value = dataOf(lRes) || []
    priceRules.value = dataOf(pRes) || []
  } catch (e: any) {
    const status = e?.response?.status
    if (status === 404 || (e?.message && e.message.includes('404'))) { router.back() }
    else { ElMessage.error(e.message || '加载失败'); router.back() }
  }
  finally { loading.value = false }
}

function openEdit() {
  editForm.value = {
    customerName: customer.value.customerName,
    contactName: customer.value.contactName || '',
    contactPhone: customer.value.contactPhone || '',
    address: customer.value.address || '',
    customerLevelId: customer.value.customerLevelId || null,
    creditLimit: customer.value.creditLimit != null ? String(customer.value.creditLimit) : '',
    creditDays: customer.value.creditDays != null ? Number(customer.value.creditDays) : null,
    status: customer.value.status || 'active'
  }
  editVisible.value = true
}

async function saveEdit() {
  saving.value = true
  try {
    await updateCustomer(id, editForm.value)
    ElMessage.success('已更新')
    editVisible.value = false
    if (editForm.value.status === 'disabled') { router.back() } else { await load() }
  } catch (e: any) { ElMessage.warning(e.message || '保存失败') }
  finally { saving.value = false }
}

async function toggleStatus() {
  try {
    const newStatus = customer.value.status === 'active' ? 'disabled' : 'active'
    const message = newStatus === 'disabled'
      ? '禁用后客户及关联账号将无法登录，历史数据会保留。确认禁用？'
      : '启用后客户及关联账号可重新登录。确认启用？'
    await ElMessageBox.confirm(message, '状态变更', { type: 'warning' })
    await updateCustomer(id, { status: newStatus })
    ElMessage.success(newStatus === 'disabled' ? '客户已禁用，历史数据已保留' : '客户已启用')
    if (newStatus === 'disabled') { router.back() } else { await load() }
  } catch (e: any) { if (e !== 'cancel' && e !== 'close') ElMessage.warning(e.message || '操作失败') }
}

async function loadPriceRules() {
  const response: any = await getPriceRules(id)
  priceRules.value = dataOf(response) || []
}

async function loadProducts() {
  try {
    const res: any = await getProducts({ pageSize: 200 })
    products.value = dataOf(res).items || dataOf(res) || []
  } catch { products.value = [] }
}

async function openRule(rule?: any) {
  await loadProducts()
  ruleForm.value = rule
    ? { id: Number(rule.id), skuId: Number(rule.skuId), price: Number(rule.price) }
    : { id: null, skuId: null, price: null }
  ruleVisible.value = true
}

async function saveRule() {
  if (!ruleForm.value.skuId) { ElMessage.warning('请选择商品规格'); return }
  const price = Number(ruleForm.value.price)
  if (!Number.isFinite(price) || price <= 0) { ElMessage.warning('请输入大于 0 的协议价'); return }

  const existingRule = priceRules.value.find((rule: any) => (
    Number(rule.skuId) === Number(ruleForm.value.skuId) && Number(rule.id) !== Number(ruleForm.value.id)
  ))
  if (!ruleForm.value.id && existingRule) {
    try {
      await ElMessageBox.confirm(
        `该商品规格已有协议价 ¥${Number(existingRule.price).toFixed(2)}，是否更新为 ¥${price.toFixed(2)}？`,
        '更新协议价',
        { type: 'warning' }
      )
    } catch (error) {
      if (error === 'cancel' || error === 'close') return
      throw error
    }
  }

  ruleSaving.value = true
  try {
    await createPriceRule({
      customerId: id,
      skuId: ruleForm.value.skuId,
      price: price.toFixed(2)
    })
    ElMessage.success(ruleForm.value.id || existingRule ? '协议价已更新' : '协议价已添加')
    ruleVisible.value = false
    await loadPriceRules()
  } catch (e: any) { ElMessage.warning(e.message || '保存失败') }
  finally { ruleSaving.value = false }
}

async function removeRule(row: any) {
  const basePrice = row.sku?.basePrice
  const fallbackText = basePrice != null
    ? `删除后该客户购买此规格将恢复原价 ¥${Number(basePrice).toFixed(2)}。`
    : '删除后该客户购买此规格将恢复原价。'
  try {
    await ElMessageBox.confirm(fallbackText, '删除协议价', { type: 'warning' })
    deletingRuleId.value = Number(row.id)
    await deletePriceRule(Number(row.id))
    ElMessage.success('协议价已删除，已恢复原价')
    await loadPriceRules()
  } catch (e: any) {
    if (e !== 'cancel' && e !== 'close') ElMessage.warning(e.message || '删除失败')
  } finally {
    deletingRuleId.value = null
  }
}

const levelName = (lid: number) => levels.value.find((l: any) => l.id === lid)?.name || '未设置'

onMounted(load)
</script>

<template>
  <section>
    <div class="page-heading">
      <div style="display:flex;align-items:center;gap:12px">
        <el-button text :icon="ArrowLeft" @click="router.back()" />
        <div><h1>{{ customer.customerName || '加载中…' }}</h1><p>客户详情</p></div>
      </div>
      <div style="display:flex;gap:8px">
        <el-button :type="customer.status === 'active' ? 'danger' : 'success'" plain @click="toggleStatus">
          {{ customer.status === 'active' ? '禁用客户' : '启用客户' }}
        </el-button>
        <el-button type="primary" :icon="Edit" @click="openEdit">编辑信息</el-button>
      </div>
    </div>

    <div v-if="loading" class="inline-loading">加载中…</div>

    <template v-if="!loading && customer.id">
      <!-- Info Cards -->
      <div class="info-grid">
        <el-card shadow="never">
          <template #header><strong>基本信息</strong></template>
          <el-descriptions :column="2" border size="small">
            <el-descriptions-item label="客户名称">{{ customer.customerName }}</el-descriptions-item>
            <el-descriptions-item label="客户类型">{{ customer.customerType || '-' }}</el-descriptions-item>
            <el-descriptions-item label="联系人">{{ customer.contactName || '-' }}</el-descriptions-item>
            <el-descriptions-item label="联系电话">{{ customer.contactPhone || '-' }}</el-descriptions-item>
            <el-descriptions-item label="所在地址" :span="2">{{ customer.address || '-' }}</el-descriptions-item>
            <el-descriptions-item label="状态">
              <el-tag :type="customer.status === 'active' ? 'success' : 'danger'" size="small">{{ customer.status === 'active' ? '正常' : '已禁用' }}</el-tag>
            </el-descriptions-item>
          </el-descriptions>
        </el-card>

        <el-card shadow="never">
          <template #header><strong>等级与账期</strong></template>
          <el-descriptions :column="1" border size="small">
            <el-descriptions-item label="当前等级">
              <el-tag type="warning">{{ levelName(customer.customerLevelId) }}</el-tag>
            </el-descriptions-item>
            <el-descriptions-item label="折扣率">{{ customer.level?.discountRate ? (Number(customer.level.discountRate) * 100).toFixed(0) + '%' : '无折扣' }}</el-descriptions-item>
            <el-descriptions-item label="信用额度">¥ {{ (customer.creditLimit || 0).toLocaleString() }}</el-descriptions-item>
            <el-descriptions-item label="账期天数">{{ customer.creditDays || 0 }} 天</el-descriptions-item>
            <el-descriptions-item label="注册时间">{{ new Date(customer.createdAt).toLocaleString('zh-CN') }}</el-descriptions-item>
          </el-descriptions>
        </el-card>
      </div>

      <ProductVisibilityCard :customer-id="id" />

      <!-- Price Rules -->
      <el-card shadow="never" style="margin-top:16px">
        <template #header>
          <div style="display:flex;justify-content:space-between;align-items:center">
            <strong>协议价格（客户 + 商品规格唯一）</strong>
            <el-button size="small" type="primary" @click="openRule()">添加协议价</el-button>
          </div>
        </template>
        <el-table v-if="priceRules.length" :data="priceRules" size="small" stripe>
          <el-table-column label="商品" min-width="140">
            <template #default="{row}">{{ row.product?.name || '-' }}</template>
          </el-table-column>
          <el-table-column label="商品规格" min-width="180">
            <template #default="{row}">{{ row.sku?.specText || row.sku?.name || row.sku?.skuCode || '-' }}</template>
          </el-table-column>
          <el-table-column label="原价" width="110">
            <template #default="{row}">¥{{ Number(row.sku?.basePrice || 0).toFixed(2) }}</template>
          </el-table-column>
          <el-table-column label="协议价" width="110">
            <template #default="{row}">¥{{ Number(row.price).toFixed(2) }}</template>
          </el-table-column>
          <el-table-column label="操作" width="150" fixed="right">
            <template #default="{row}">
              <el-button link type="primary" @click="openRule(row)">编辑</el-button>
              <el-button link type="danger" :loading="deletingRuleId === row.id" @click="removeRule(row)">删除</el-button>
            </template>
          </el-table-column>
        </el-table>
        <div v-else class="inline-empty">暂无协议价格</div>
      </el-card>
    </template>

    <!-- Edit Dialog -->
    <el-dialog v-model="editVisible" title="编辑客户信息" width="500">
      <el-form label-width="90">
        <el-form-item label="客户名称"><el-input v-model="editForm.customerName" maxlength="120" /></el-form-item>
        <el-form-item label="联系人"><el-input v-model="editForm.contactName" maxlength="100" /></el-form-item>
        <el-form-item label="联系电话"><el-input v-model="editForm.contactPhone" maxlength="20" /></el-form-item>
        <el-form-item label="地址"><el-input v-model="editForm.address" maxlength="255" /></el-form-item>
        <el-form-item label="客户等级">
          <el-select v-model="editForm.customerLevelId" clearable style="width:100%">
            <el-option v-for="lv in levels" :key="lv.id" :label="lv.name" :value="lv.id" />
          </el-select>
        </el-form-item>
        <el-form-item label="信用额度">
          <el-input v-model="editForm.creditLimit" placeholder="例如：50000" />
        </el-form-item>
        <el-form-item label="账期天数">
          <el-input-number
            v-model="editForm.creditDays"
            :min="0"
            :precision="0"
            controls-position="right"
            placeholder="例如：30"
            style="width:100%"
          />
        </el-form-item>
      </el-form>
      <template #footer>
        <el-button @click="editVisible = false">取消</el-button>
        <el-button type="primary" :loading="saving" @click="saveEdit">保存</el-button>
      </template>
    </el-dialog>

    <!-- Price Rule Dialog -->
    <el-dialog v-model="ruleVisible" :title="ruleDialogTitle" width="520">
      <el-form label-width="90">
        <el-form-item label="商品规格" required>
          <el-select
            v-model="ruleForm.skuId"
            filterable
            :disabled="!!ruleForm.id"
            placeholder="搜索商品规格"
            style="width:100%"
          >
            <el-option v-for="s in skuOptions" :key="s.id" :label="s.optionLabel" :value="s.id" />
          </el-select>
        </el-form-item>
        <el-form-item label="协议价" required>
          <el-input-number
            v-model="ruleForm.price"
            :min="0.01"
            :precision="2"
            :step="0.1"
            controls-position="right"
            style="width:100%"
          />
        </el-form-item>
      </el-form>
      <template #footer>
        <el-button @click="ruleVisible = false">取消</el-button>
        <el-button type="primary" :loading="ruleSaving" @click="saveRule">保存</el-button>
      </template>
    </el-dialog>
  </section>
</template>

<style scoped>
.page-heading { margin-bottom: 20px; }
.info-grid { display: grid; grid-template-columns: 2fr 1fr; gap: 18px; }
@media (max-width: 768px) { .info-grid { grid-template-columns: 1fr; } }
@media (max-width: 640px) {
  .page-heading { flex-direction: column; gap: 12px; }
  .page-heading > div:last-child { display: flex; flex-wrap: wrap; justify-content: flex-end; width: 100%; }
}
</style>
