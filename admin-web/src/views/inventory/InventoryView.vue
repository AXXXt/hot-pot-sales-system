<script setup lang="ts">
import { computed, onMounted, reactive, ref } from 'vue'
import { ElMessage, ElMessageBox } from 'element-plus'
import PageTable from '../../components/PageTable.vue'
import { getBrands, getCategories } from '../../api/product'
import {
  cancelStocktake,
  completeStocktake,
  createAdjustment,
  createStocktake,
  getAdjustmentDetail,
  getAdjustments,
  getInventoryStock,
  getStockMovements,
  getStocktakeDetail,
  getStocktakes,
  updateStocktakeItems
} from '../../api/inventory'
import { useAuthStore } from '../../stores/auth'

const auth = useAuthStore()
const canAdjust = computed(() => auth.can('inventory:adjust'))
const dataOf = (response: any) => response.data?.data ?? response.data

const activeTab = ref('stock')

// ---- 库存总览 ----
const stockQuery = reactive({ keyword: '', brandId: undefined as number | undefined, categoryId: undefined as number | undefined, lowStock: false, lowStockThreshold: 10, page: 1, pageSize: 20 })
const stockItems = ref<any[]>([])
const stockTotal = ref(0)
const stockLoading = ref(false)
const stockError = ref('')
const brands = ref<any[]>([])
const categories = ref<any[]>([])
const skuOptions = ref<any[]>([])

async function loadStock() {
  stockLoading.value = true
  stockError.value = ''
  try {
    const response: any = await getInventoryStock({
      ...stockQuery,
      lowStock: stockQuery.lowStock ? 'true' : undefined,
      lowStockThreshold: stockQuery.lowStockThreshold
    })
    const data = dataOf(response)
    stockItems.value = data.items || []
    stockTotal.value = data.total || 0
  } catch (e: any) {
    stockError.value = e.message || '库存加载失败'
  } finally {
    stockLoading.value = false
  }
}

async function loadBrandCategories() {
  try {
    const [brandResponse, categoryResponse]: any = await Promise.all([getBrands(), getCategories()])
    const b = dataOf(brandResponse)
    const c = dataOf(categoryResponse)
    brands.value = Array.isArray(b) ? b : b?.items || []
    categories.value = Array.isArray(c) ? c : c?.items || []
  } catch {}
}

async function loadSkuOptions() {
  try {
    const response: any = await getInventoryStock({ page: 1, pageSize: 1000 })
    skuOptions.value = dataOf(response)?.items || []
  } catch {}
}

function searchStock() { stockQuery.page = 1; loadStock() }

// ---- 库存流水 ----
const movementQuery = reactive({ skuId: undefined as number | undefined, type: '', sourceType: '', dateFrom: '', dateTo: '', page: 1, pageSize: 20 })
const movementItems = ref<any[]>([])
const movementTotal = ref(0)
const movementLoading = ref(false)
const movementError = ref('')

const movementTypeMap: Record<string, { label: string; type: string }> = {
  manual_in: { label: '手动入库', type: 'success' },
  manual_out: { label: '手动出库', type: 'warning' },
  order_out: { label: '订单出库', type: 'danger' },
  order_return: { label: '订单退回', type: 'success' },
  stocktake_in: { label: '盘盈', type: 'success' },
  stocktake_out: { label: '盘亏', type: 'danger' }
}
function movementTypeMeta(type: string) {
  return movementTypeMap[type] || { label: type, type: 'info' }
}

async function loadMovements() {
  movementLoading.value = true
  movementError.value = ''
  try {
    const response: any = await getStockMovements({
      ...movementQuery,
      skuId: movementQuery.skuId || undefined,
      type: movementQuery.type || undefined,
      sourceType: movementQuery.sourceType || undefined,
      dateFrom: movementQuery.dateFrom || undefined,
      dateTo: movementQuery.dateTo || undefined
    })
    const data = dataOf(response)
    movementItems.value = data.items || []
    movementTotal.value = data.total || 0
  } catch (e: any) {
    movementError.value = e.message || '流水加载失败'
  } finally {
    movementLoading.value = false
  }
}

function searchMovements() { movementQuery.page = 1; loadMovements() }

// ---- 手动出入库 ----
const adjustmentQuery = reactive({ page: 1, pageSize: 10 })
const adjustments = ref<any[]>([])
const adjustmentTotal = ref(0)
const adjustmentLoading = ref(false)
const adjustmentError = ref('')
const adjustmentDialog = ref(false)
const adjusting = ref(false)
const adjustmentForm = reactive({ type: 'manual_in', reason: '', rows: [] as Array<{ skuId?: number; quantity: number }> })
const adjustmentDetailVisible = ref(false)
const adjustmentDetail = ref<any>(null)

function adjustmentTypeLabel(type: string) {
  return type === 'manual_in' ? '入库' : '出库'
}

async function loadAdjustments() {
  adjustmentLoading.value = true
  adjustmentError.value = ''
  try {
    const response: any = await getAdjustments({ ...adjustmentQuery })
    const data = dataOf(response)
    adjustments.value = data.items || []
    adjustmentTotal.value = data.total || 0
  } catch (e: any) {
    adjustmentError.value = e.message || '出入库单加载失败'
  } finally {
    adjustmentLoading.value = false
  }
}

function openAdjustmentDialog() {
  adjustmentForm.type = 'manual_in'
  adjustmentForm.reason = ''
  adjustmentForm.rows = [{ skuId: undefined, quantity: 1 }]
  adjustmentDialog.value = true
}

function addAdjustmentRow() { adjustmentForm.rows.push({ skuId: undefined, quantity: 1 }) }
function removeAdjustmentRow(index: number) { adjustmentForm.rows.splice(index, 1) }

async function submitAdjustment() {
  if (!adjustmentForm.rows.length || adjustmentForm.rows.some((r) => !r.skuId || !r.quantity)) {
    ElMessage.warning('请完整填写出入库明细')
    return
  }
  adjusting.value = true
  try {
    await createAdjustment({
      type: adjustmentForm.type,
      reason: adjustmentForm.reason || undefined,
      items: adjustmentForm.rows.map((r) => ({ skuId: r.skuId, quantity: r.quantity }))
    })
    ElMessage.success('出入库单已生效')
    adjustmentDialog.value = false
    await loadAdjustments()
    await loadStock()
    await loadMovements()
  } catch (e: any) {
    ElMessage.error(e.message || '创建失败')
  } finally {
    adjusting.value = false
  }
}

async function openAdjustmentDetail(id: number) {
  const response: any = await getAdjustmentDetail(id)
  adjustmentDetail.value = dataOf(response)
  adjustmentDetailVisible.value = true
}

// ---- 盘点 ----
const stocktakeQuery = reactive({ page: 1, pageSize: 10 })
const stocktakes = ref<any[]>([])
const stocktakeTotal = ref(0)
const stocktakeLoading = ref(false)
const stocktakeError = ref('')
const stocktakeDialog = ref(false)
const stocktakeForm = reactive({ scope: 'all', skuIds: [] as number[], remark: '' })
const creatingStocktake = ref(false)
const stocktakeDetailVisible = ref(false)
const stocktakeDetail = ref<any>(null)
const detailRows = ref<any[]>([])
const detailReadonly = ref(false)
const savingStocktake = ref(false)

function stocktakeStatusMeta(status: string) {
  if (status === 'completed') return { label: '已完成', type: 'success' }
  if (status === 'cancelled') return { label: '已取消', type: 'info' }
  return { label: '草稿', type: 'warning' }
}

async function loadStocktakes() {
  stocktakeLoading.value = true
  stocktakeError.value = ''
  try {
    const response: any = await getStocktakes({ ...stocktakeQuery })
    const data = dataOf(response)
    stocktakes.value = data.items || []
    stocktakeTotal.value = data.total || 0
  } catch (e: any) {
    stocktakeError.value = e.message || '盘点单加载失败'
  } finally {
    stocktakeLoading.value = false
  }
}

function openStocktakeDialog() {
  stocktakeForm.scope = 'all'
  stocktakeForm.skuIds = []
  stocktakeForm.remark = ''
  stocktakeDialog.value = true
}

async function submitStocktake() {
  if (stocktakeForm.scope === 'partial' && !stocktakeForm.skuIds.length) {
    ElMessage.warning('请至少选择一个SKU')
    return
  }
  creatingStocktake.value = true
  try {
    await createStocktake({
      remark: stocktakeForm.remark || undefined,
      skuIds: stocktakeForm.scope === 'partial' ? stocktakeForm.skuIds : undefined
    })
    ElMessage.success('盘点单已创建')
    stocktakeDialog.value = false
    await loadStocktakes()
  } catch (e: any) {
    ElMessage.error(e.message || '创建失败')
  } finally {
    creatingStocktake.value = false
  }
}

async function openStocktakeDetail(id: number, readonly = false) {
  const response: any = await getStocktakeDetail(id)
  stocktakeDetail.value = dataOf(response)
  detailRows.value = (stocktakeDetail.value?.items || []).map((item: any) => ({ ...item, countedQty: item.countedQty ?? undefined }))
  detailReadonly.value = readonly || stocktakeDetail.value?.status !== 'draft'
  stocktakeDetailVisible.value = true
}

function rowDiffSign(row: any): number {
  return rowDiff(row) ?? 0
}
function rowDiffText(row: any): string {
  const diff = rowDiff(row)
  if (diff === null) return '-'
  return `${diff > 0 ? '+' : ''}${diff}`
}
function rowDiff(row: any): number | null {
  if (row.countedQty === undefined || row.countedQty === null || row.countedQty === '') return null
  return Number(row.countedQty) - Number(row.systemQty)
}

async function saveStocktake(action: 'save' | 'complete') {
  if (detailReadonly.value || !stocktakeDetail.value) return
  const items = detailRows.value.map((row) => ({
    skuId: row.skuId,
    countedQty: Number(row.countedQty),
    remark: row.remark || undefined
  }))
  if (items.some((item) => !Number.isInteger(item.countedQty) || item.countedQty < 0)) {
    ElMessage.warning('请填写有效的实盘数（非负整数）')
    return
  }
  savingStocktake.value = true
  try {
    if (action === 'save') {
      await updateStocktakeItems(stocktakeDetail.value.id, { items })
      ElMessage.success('已保存草稿')
    } else {
      await completeStocktake(stocktakeDetail.value.id, { items })
      ElMessage.success('盘点已完成，差异已调整库存')
    }
    stocktakeDetailVisible.value = false
    await loadStocktakes()
    await loadStock()
    await loadMovements()
  } catch (e: any) {
    ElMessage.error(e.message || '保存失败')
  } finally {
    savingStocktake.value = false
  }
}

async function handleCancelStocktake(id: number) {
  try {
    await ElMessageBox.confirm('确认取消该盘点单？已填写的实盘数将不会生效。', '取消盘点', { type: 'warning' })
    await cancelStocktake(id)
    ElMessage.success('盘点单已取消')
    await loadStocktakes()
  } catch (e) {
    if (e !== 'cancel' && e !== 'close') ElMessage.error((e as any).message || '取消失败')
  }
}

onMounted(async () => {
  await Promise.all([loadBrandCategories(), loadSkuOptions(), loadStock()])
  await Promise.all([loadMovements(), loadAdjustments(), loadStocktakes()])
})
</script>

<template>
  <section>
    <div class="page-heading">
      <div><h1>库存管理</h1><p>库存总览、出入库流水、手动出入库与定期盘点</p></div>
    </div>
    <el-card shadow="never">
      <el-tabs v-model="activeTab">
        <el-tab-pane label="库存总览" name="stock">
          <el-form inline>
            <el-form-item><el-input v-model="stockQuery.keyword" clearable placeholder="商品名称 / 编码 / SKU编码" @keyup.enter="searchStock" /></el-form-item>
            <el-form-item><el-select v-model="stockQuery.brandId" clearable placeholder="品牌" style="width:150px"><el-option v-for="brand in brands" :key="brand.id" :label="brand.name" :value="brand.id" /></el-select></el-form-item>
            <el-form-item><el-select v-model="stockQuery.categoryId" clearable placeholder="分类" style="width:150px"><el-option v-for="category in categories" :key="category.id" :label="category.name" :value="category.id" /></el-select></el-form-item>
            <el-form-item><el-switch v-model="stockQuery.lowStock" active-text="只看低库存" /></el-form-item>
            <el-form-item v-if="stockQuery.lowStock" label="阈值">
              <el-input-number v-model="stockQuery.lowStockThreshold" :min="0" :max="1000" />
            </el-form-item>
            <el-button type="primary" @click="searchStock">查询</el-button>
          </el-form>
          <PageTable :loading="stockLoading" :error="stockError" :empty="!stockItems.length" @retry="loadStock">
            <el-table :data="stockItems">
              <el-table-column prop="skuCode" label="SKU编码" width="160" />
              <el-table-column prop="productName" label="商品名称" min-width="180" />
              <el-table-column prop="specText" label="规格" width="120" />
              <el-table-column prop="saleUnit" label="单位" width="80" />
              <el-table-column label="库存" width="120">
                <template #default="{ row }">
                  <el-tag :type="row.stockNum <= stockQuery.lowStockThreshold ? 'warning' : 'success'">{{ row.stockNum }}</el-tag>
                </template>
              </el-table-column>
              <el-table-column prop="brandName" label="品牌" width="120" />
              <el-table-column prop="categoryName" label="分类" width="120" />
              <el-table-column prop="minOrderQty" label="起订量" width="90" />
            </el-table>
            <el-pagination v-model:current-page="stockQuery.page" v-model:page-size="stockQuery.pageSize" :total="stockTotal" layout="total, sizes, prev, pager, next" @change="loadStock" />
          </PageTable>
        </el-tab-pane>

        <el-tab-pane label="库存流水" name="movements">
          <el-form inline>
            <el-form-item><el-input v-model.number="movementQuery.skuId" clearable placeholder="SKU ID" style="width:120px" /></el-form-item>
            <el-form-item>
              <el-select v-model="movementQuery.type" clearable placeholder="变动类型" style="width:150px">
                <el-option v-for="(meta, key) in movementTypeMap" :key="key" :label="meta.label" :value="key" />
              </el-select>
            </el-form-item>
            <el-form-item><el-date-picker v-model="movementQuery.dateFrom" type="date" placeholder="开始日期" value-format="YYYY-MM-DD" /></el-form-item>
            <el-form-item><el-date-picker v-model="movementQuery.dateTo" type="date" placeholder="结束日期" value-format="YYYY-MM-DD" /></el-form-item>
            <el-button type="primary" @click="searchMovements">查询</el-button>
          </el-form>
          <PageTable :loading="movementLoading" :error="movementError" :empty="!movementItems.length" @retry="loadMovements">
            <el-table :data="movementItems">
              <el-table-column prop="createdAt" label="时间" width="180"><template #default="{ row }">{{ new Date(row.createdAt).toLocaleString() }}</template></el-table-column>
              <el-table-column prop="productName" label="商品" min-width="180" />
              <el-table-column prop="specText" label="规格" width="120" />
              <el-table-column label="变动" width="100">
                <template #default="{ row }"><span :style="{ color: row.changeQty > 0 ? '#67c23a' : '#f56c6c' }">{{ row.changeQty > 0 ? '+' : '' }}{{ row.changeQty }}</span></template>
              </el-table-column>
              <el-table-column prop="beforeQty" label="变动前" width="90" />
              <el-table-column prop="afterQty" label="变动后" width="90" />
              <el-table-column label="类型" width="110"><template #default="{ row }"><el-tag :type="movementTypeMeta(row.type).type as any">{{ movementTypeMeta(row.type).label }}</el-tag></template></el-table-column>
              <el-table-column prop="sourceType" label="来源" width="110" />
              <el-table-column prop="operatorName" label="操作人" width="100" />
              <el-table-column prop="remark" label="备注" min-width="140" />
            </el-table>
            <el-pagination v-model:current-page="movementQuery.page" v-model:page-size="movementQuery.pageSize" :total="movementTotal" layout="total, sizes, prev, pager, next" @change="loadMovements" />
          </PageTable>
        </el-tab-pane>

        <el-tab-pane label="手动出入库" name="adjustments">
          <div class="tab-actions">
            <el-button v-if="canAdjust" type="primary" @click="openAdjustmentDialog">新建出入库单</el-button>
          </div>
          <PageTable :loading="adjustmentLoading" :error="adjustmentError" :empty="!adjustments.length" @retry="loadAdjustments">
            <el-table :data="adjustments">
              <el-table-column prop="adjustmentNo" label="单号" width="200" />
              <el-table-column label="类型" width="100"><template #default="{ row }"><el-tag :type="row.type === 'manual_in' ? 'success' : 'warning'">{{ adjustmentTypeLabel(row.type) }}</el-tag></template></el-table-column>
              <el-table-column prop="itemCount" label="明细行数" width="100" />
              <el-table-column label="合计变动" width="110"><template #default="{ row }"><span :style="{ color: row.totalChange > 0 ? '#67c23a' : '#f56c6c' }">{{ row.totalChange > 0 ? '+' : '' }}{{ row.totalChange }}</span></template></el-table-column>
              <el-table-column prop="reason" label="原因" min-width="160" />
              <el-table-column prop="operatorName" label="操作人" width="100" />
              <el-table-column prop="createdAt" label="时间" width="180"><template #default="{ row }">{{ new Date(row.createdAt).toLocaleString() }}</template></el-table-column>
              <el-table-column label="操作" width="90"><template #default="{ row }"><el-button link type="primary" @click="openAdjustmentDetail(row.id)">详情</el-button></template></el-table-column>
            </el-table>
            <el-pagination v-model:current-page="adjustmentQuery.page" v-model:page-size="adjustmentQuery.pageSize" :total="adjustmentTotal" layout="total, sizes, prev, pager, next" @change="loadAdjustments" />
          </PageTable>
        </el-tab-pane>

        <el-tab-pane label="库存盘点" name="stocktakes">
          <div class="tab-actions">
            <el-button v-if="canAdjust" type="primary" @click="openStocktakeDialog">新建盘点单</el-button>
          </div>
          <PageTable :loading="stocktakeLoading" :error="stocktakeError" :empty="!stocktakes.length" @retry="loadStocktakes">
            <el-table :data="stocktakes">
              <el-table-column prop="stocktakeNo" label="盘点单号" width="200" />
              <el-table-column label="状态" width="100"><template #default="{ row }"><el-tag :type="stocktakeStatusMeta(row.status).type as any">{{ stocktakeStatusMeta(row.status).label }}</el-tag></template></el-table-column>
              <el-table-column prop="itemCount" label="盘点项数" width="100" />
              <el-table-column prop="remark" label="备注" min-width="160" />
              <el-table-column prop="operatorName" label="创建人" width="100" />
              <el-table-column prop="createdAt" label="创建时间" width="180"><template #default="{ row }">{{ new Date(row.createdAt).toLocaleString() }}</template></el-table-column>
              <el-table-column label="操作" width="170">
                <template #default="{ row }">
                  <el-button link type="primary" @click="openStocktakeDetail(row.id, row.status !== 'draft')">{{ row.status === 'draft' ? '录入盘点' : '查看' }}</el-button>
                  <el-button v-if="row.status === 'draft' && canAdjust" link type="danger" @click="handleCancelStocktake(row.id)">取消</el-button>
                </template>
              </el-table-column>
            </el-table>
            <el-pagination v-model:current-page="stocktakeQuery.page" v-model:page-size="stocktakeQuery.pageSize" :total="stocktakeTotal" layout="total, sizes, prev, pager, next" @change="loadStocktakes" />
          </PageTable>
        </el-tab-pane>
      </el-tabs>
    </el-card>

    <el-dialog v-model="adjustmentDialog" title="新建手动出入库单" width="820px">
      <el-form label-width="90px">
        <el-form-item label="类型">
          <el-radio-group v-model="adjustmentForm.type">
            <el-radio-button value="manual_in">入库</el-radio-button>
            <el-radio-button value="manual_out">出库</el-radio-button>
          </el-radio-group>
        </el-form-item>
        <el-form-item label="备注"><el-input v-model="adjustmentForm.reason" maxlength="255" placeholder="例如：期初库存、损耗、赠品、采购补录" /></el-form-item>
        <el-form-item label="明细">
          <div class="adj-rows">
            <div v-for="(row, index) in adjustmentForm.rows" :key="index" class="adj-row">
              <el-select v-model="row.skuId" filterable placeholder="选择商品规格" style="flex:1">
                <el-option v-for="sku in skuOptions" :key="sku.id" :label="`${sku.productName} ${sku.specText}（库存 ${sku.stockNum}）`" :value="sku.id" />
              </el-select>
              <el-input-number v-model="row.quantity" :min="1" :max="99999" />
              <el-button text type="danger" @click="removeAdjustmentRow(index)">移除</el-button>
            </div>
            <el-button text type="primary" @click="addAdjustmentRow">+ 添加一行</el-button>
          </div>
        </el-form-item>
      </el-form>
      <template #footer><el-button @click="adjustmentDialog = false">取消</el-button><el-button type="primary" :loading="adjusting" @click="submitAdjustment">保存并生效</el-button></template>
    </el-dialog>

    <el-dialog v-model="adjustmentDetailVisible" title="出入库单详情" width="760px">
      <template v-if="adjustmentDetail">
        <el-descriptions :column="2" border>
          <el-descriptions-item label="单号">{{ adjustmentDetail.adjustmentNo }}</el-descriptions-item>
          <el-descriptions-item label="类型">{{ adjustmentTypeLabel(adjustmentDetail.type) }}</el-descriptions-item>
          <el-descriptions-item label="操作人">{{ adjustmentDetail.operator?.name || '-' }}</el-descriptions-item>
          <el-descriptions-item label="时间">{{ new Date(adjustmentDetail.createdAt).toLocaleString() }}</el-descriptions-item>
          <el-descriptions-item label="备注" :span="2">{{ adjustmentDetail.reason || '-' }}</el-descriptions-item>
        </el-descriptions>
        <el-table :data="adjustmentDetail.movements || []" style="margin-top:16px">
          <el-table-column prop="sku.product.name" label="商品" min-width="180" />
          <el-table-column prop="sku.specText" label="规格" width="140" />
          <el-table-column label="变动" width="100"><template #default="{ row }"><span :style="{ color: row.changeQty > 0 ? '#67c23a' : '#f56c6c' }">{{ row.changeQty > 0 ? '+' : '' }}{{ row.changeQty }}</span></template></el-table-column>
          <el-table-column prop="beforeQty" label="变动前" width="90" />
          <el-table-column prop="afterQty" label="变动后" width="90" />
        </el-table>
      </template>
    </el-dialog>

    <el-dialog v-model="stocktakeDialog" title="新建盘点单" width="560px">
      <el-form label-width="90px">
        <el-form-item label="盘点范围">
          <el-radio-group v-model="stocktakeForm.scope">
            <el-radio-button value="all">全部启用商品</el-radio-button>
            <el-radio-button value="partial">按SKU选择</el-radio-button>
          </el-radio-group>
        </el-form-item>
        <el-form-item v-if="stocktakeForm.scope === 'partial'" label="SKU">
          <el-select v-model="stocktakeForm.skuIds" multiple filterable style="width:100%" placeholder="选择要盘点的SKU">
            <el-option v-for="sku in skuOptions" :key="sku.id" :label="`${sku.productName} ${sku.specText}（库存 ${sku.stockNum}）`" :value="sku.id" />
          </el-select>
        </el-form-item>
        <el-form-item label="备注"><el-input v-model="stocktakeForm.remark" maxlength="255" /></el-form-item>
      </el-form>
      <template #footer><el-button @click="stocktakeDialog = false">取消</el-button><el-button type="primary" :loading="creatingStocktake" @click="submitStocktake">创建盘点单</el-button></template>
    </el-dialog>

    <el-dialog v-model="stocktakeDetailVisible" :title="detailReadonly ? '盘点单详情' : '录入盘点'" width="880px">
      <el-alert v-if="detailReadonly" type="info" :closable="false" style="margin-bottom:12px" title="盘点单已完成或已取消，仅可查看" />
      <el-alert v-else type="warning" :closable="false" style="margin-bottom:12px" title="实盘数为实际清点的数量，保存后仍可修改；完成盘点后将按差异调整库存" />
      <el-table :data="detailRows" max-height="420">
        <el-table-column prop="sku.product.name" label="商品" min-width="180" />
        <el-table-column prop="sku.specText" label="规格" width="130" />
        <el-table-column prop="systemQty" label="账面数" width="90" />
        <el-table-column label="实盘数" width="150">
          <template #default="{ row }">
            <el-input-number v-if="!detailReadonly" v-model="row.countedQty" :min="0" :max="999999" controls-position="right" style="width:120px" />
            <span v-else>{{ row.countedQty ?? '-' }}</span>
          </template>
        </el-table-column>
        <el-table-column label="差异" width="100">
          <template #default="{ row }">
            <span v-if="rowDiff(row) !== null" :style="{ color: rowDiffSign(row) > 0 ? '#67c23a' : rowDiffSign(row) < 0 ? '#f56c6c' : 'inherit' }">{{ rowDiffText(row) }}</span>
            <span v-else>-</span>
          </template>
        </el-table-column>
        <el-table-column label="备注" min-width="140"><template #default="{ row }"><el-input v-if="!detailReadonly" v-model="row.remark" maxlength="255" /><span v-else>{{ row.remark || '-' }}</span></template></el-table-column>
      </el-table>
      <template #footer>
        <el-button @click="stocktakeDetailVisible = false">关闭</el-button>
        <template v-if="!detailReadonly">
          <el-button :loading="savingStocktake" @click="saveStocktake('save')">保存草稿</el-button>
          <el-button type="primary" :loading="savingStocktake" @click="saveStocktake('complete')">完成盘点</el-button>
        </template>
      </template>
    </el-dialog>
  </section>
</template>

<style scoped>
.tab-actions { display: flex; justify-content: flex-end; margin-bottom: 14px; }
.adj-rows { display: flex; flex-direction: column; gap: 8px; width: 100%; }
.adj-row { display: flex; align-items: center; gap: 10px; }
.adj-row .el-select { flex: 1; }
.page-heading { justify-content: space-between; }
.el-pagination { justify-content: flex-end; margin-top: 16px; }
</style>