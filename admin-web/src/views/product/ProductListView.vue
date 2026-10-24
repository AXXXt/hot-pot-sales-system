<script setup lang="ts">
import { computed, onMounted, reactive, ref } from 'vue'
import { useRouter } from 'vue-router'
import { ElMessage, ElMessageBox } from 'element-plus'
import PageTable from '../../components/PageTable.vue'
import { batchArchiveProducts, batchUpdateProductStatus, deleteProduct, getBrands, getCategories, getProducts, updateProductStatus } from '../../api/product'
import { downloadProductImportTemplate, importProductsExcel } from '../../api/import'
import { getCustomers } from '../../api/customer'
import { useAuthStore } from '../../stores/auth'

const importing = ref(false)
const auth = useAuthStore()
const importCustomerId = ref<number | null>(null)
const importCustomers = ref<any[]>([])
const customersLoading = ref(false)
const templateLoading = ref(false)
let customerSearch = 0
async function searchImportCustomers(keyword = '') {
  if (!auth.can('customer:manage')) return
  const sequence = ++customerSearch
  customersLoading.value = true
  try {
    const response: any = await getCustomers({ keyword, status: 'active', pageSize: 50, page: 1 })
    if (sequence === customerSearch) importCustomers.value = (response?.data?.items || []).filter((customer: any) => customer.status === 'active')
  } catch { if (sequence === customerSearch) importCustomers.value = [] }
  finally { if (sequence === customerSearch) customersLoading.value = false }
}
async function downloadTemplate() {
  if (templateLoading.value) return
  templateLoading.value = true
  try {
    const blob = await downloadProductImportTemplate(), url = URL.createObjectURL(blob)
    const anchor = document.createElement('a')
    anchor.href = url; anchor.download = '唯哆鲜商品导入模板.xlsx'; anchor.click(); URL.revokeObjectURL(url)
  } catch (e: any) { ElMessage.warning(e.message || '模板下载失败') }
  finally { templateLoading.value = false }
}
const importHelpOpen = ref(false)
const importErrorOpen = ref(false)
const importRowErrors = ref<Array<{ row: number; message: string }>>([])
const importErrorCount = ref(0)
const importExample = '品牌\t分类\t商品名称\t规格\t单位\t基础价\t起订量\n请替换为已有品牌\t请替换为已有分类\t爆汁牛筋丸\t500克/袋\t袋\t19.90\t1'

function validateImportFile(file: File) {
  if (!/\.xlsx$/i.test(file.name)) {
    ElMessage.warning('仅支持.xlsx文件，请在Excel中另存为Excel工作簿后上传')
    return false
  }
  if (file.size > 5 * 1024 * 1024) {
    ElMessage.warning('文件不能超过5MB，请拆分后导入')
    return false
  }
  return true
}

async function handleUpload(options: any) {
  if (importing.value) return
  importing.value = true
  try {
    const res: any = await importProductsExcel(options.file, importCustomerId.value)
    const d = res?.data || {}
    ElMessage.success(`导入完成：品牌 ${d.brandCount || 0}，商品 ${d.productCount || 0}，SKU ${d.skuCount || 0}，协议价 ${d.priceRuleCount || 0}，跳过 ${d.skipped || 0}`)
    await load()
  } catch (e: any) {
    if (e.importErrors?.length) {
      importRowErrors.value = e.importErrors
      importErrorCount.value = e.importErrorCount
      importErrorOpen.value = true
    } else ElMessage.warning(e.message || '导入失败')
  }
  finally { importing.value = false }
}
const router = useRouter()
const loading = ref(false)
const batchLoading = ref(false)
const batchDeleteLoading = ref(false)
const error = ref('')
const items = ref<any[]>([])
const selectedRows = ref<any[]>([])
const selectedActiveRows = computed(() => selectedRows.value.filter(row => row.status === 'active'))
const total = ref(0)
const brands = ref<any[]>([])
const categories = ref<any[]>([])
const query = reactive({ keyword: '', brandId: undefined as number | undefined, categoryId: undefined as number | undefined, page: 1, pageSize: 20 })
const dataOf = (response: any) => response.data?.data ?? response.data

async function load() {
  loading.value = true
  error.value = ''
  try {
    const response: any = await getProducts({ ...query, includeDisabled: true })
    const data = dataOf(response)
    items.value = data.items || []
    selectedRows.value = []
    total.value = data.total || 0
  } catch (requestError: any) {
    error.value = requestError.message || '商品加载失败'
  } finally {
    loading.value = false
  }
}

async function init() {
  try {
    const [brandResponse, categoryResponse]: any = await Promise.all([getBrands(), getCategories()])
    brands.value = dataOf(brandResponse).items || dataOf(brandResponse) || []
    categories.value = dataOf(categoryResponse).items || dataOf(categoryResponse) || []
  } catch {}
  await load()
}

async function toggle(row: any) {
  try {
    await ElMessageBox.confirm(`确认${row.status === 'active' ? '下架' : '上架'}该商品？`, '操作确认', {
      type: 'warning', confirmButtonText: row.status === 'active' ? '确认下架' : '确认上架', cancelButtonText: '取消'
    })
    await updateProductStatus(row.id, row.status === 'active' ? 'disabled' : 'active')
    await load()
  } catch (actionError) {
    if (actionError !== 'cancel' && actionError !== 'close') return
  }
}

function handleSelectionChange(rows: any[]) {
  selectedRows.value = rows
}

async function batchDisable() {
  const productIds = selectedRows.value.filter(row => row.status === 'active').map(row => row.id)
  if (!productIds.length) return

  try {
    await ElMessageBox.confirm(
      `确认批量下架选中的 ${productIds.length} 件商品？`,
      '批量下架确认',
      { type: 'warning', confirmButtonText: '确认下架', cancelButtonText: '取消' }
    )
    batchLoading.value = true
    const response: any = await batchUpdateProductStatus(productIds, 'disabled')
    const data = dataOf(response)
    ElMessage.success(`已下架 ${data.updatedCount ?? productIds.length} 件商品`)
    await load()
  } catch (actionError: any) {
    if (actionError !== 'cancel' && actionError !== 'close') {
      ElMessage.error(actionError.message || '批量下架失败')
    }
  } finally {
    batchLoading.value = false
  }
}

async function reloadAfterDelete(deletedOnCurrentPage: number) {
  if (items.value.length <= deletedOnCurrentPage && query.page > 1) query.page -= 1
  await load()
}

async function handleDelete(row: any) {
  try {
    await ElMessageBox.confirm(
      `确认删除商品“${row.name}”？删除后将从管理端和小程序隐藏，但历史订单会保留。`,
      '删除商品',
      { type: 'warning', confirmButtonText: '确认删除', cancelButtonText: '取消' }
    )
    await deleteProduct(row.id)
    ElMessage.success('商品已删除')
    await reloadAfterDelete(1)
  } catch (actionError) {
    if (actionError !== 'cancel' && actionError !== 'close') return
  }
}

async function handleBatchDelete() {
  const productIds = selectedRows.value.map(row => row.id)
  if (!productIds.length) return

  try {
    await ElMessageBox.confirm(
      `确认批量删除选中的 ${productIds.length} 件商品？删除后将隐藏商品，但历史订单会保留。`,
      '批量删除商品',
      { type: 'warning', confirmButtonText: '确认删除', cancelButtonText: '取消' }
    )
    batchDeleteLoading.value = true
    const response: any = await batchArchiveProducts(productIds)
    const data = dataOf(response)
    ElMessage.success(`已删除 ${data.updatedCount ?? productIds.length} 件商品`)
    await reloadAfterDelete(productIds.length)
  } catch (actionError: any) {
    if (actionError !== 'cancel' && actionError !== 'close') {
      ElMessage.error(actionError.message || '批量删除失败')
    }
  } finally {
    batchDeleteLoading.value = false
  }
}

onMounted(init)
</script>

<template>
  <section>
    <div class="page-heading">
      <div><h1>商品管理</h1><p>维护商品资料、上下架状态与规格信息</p></div>
      <div class="product-actions">
        <el-select v-if="auth.can('customer:manage')" v-model="importCustomerId" :disabled="importing" filterable remote clearable :remote-method="searchImportCustomers" :loading="customersLoading" placeholder="协议价客户（可选）" aria-label="协议价客户（可选）" style="width:230px" @visible-change="(open: boolean) => open && searchImportCustomers()">
          <el-option v-for="customer in importCustomers" :key="customer.id" :label="`${customer.customerName}（ID:${customer.id}）`" :value="customer.id" />
        </el-select>
        <el-button :loading="templateLoading" @click="downloadTemplate">下载导入模板</el-button>
        <el-button @click="importHelpOpen = true">导入格式说明</el-button>
        <el-upload :show-file-list="false" :http-request="handleUpload" :before-upload="validateImportFile" :disabled="importing" accept=".xlsx">
          <el-button :loading="importing" type="primary" plain>批量导入</el-button>
        </el-upload>
        <el-button type="primary" @click="router.push('/products/create')">新建商品</el-button>
      </div>
    </div>
    <el-card shadow="never">
      <el-form inline>
        <el-form-item><el-input v-model="query.keyword" clearable placeholder="商品名称或编码" @keyup.enter="load" /></el-form-item>
        <el-form-item><el-select v-model="query.brandId" clearable placeholder="品牌" style="width:150px"><el-option v-for="brand in brands" :key="brand.id" :label="brand.name" :value="brand.id" /></el-select></el-form-item>
        <el-form-item><el-select v-model="query.categoryId" clearable placeholder="分类" style="width:150px"><el-option v-for="category in categories" :key="category.id" :label="category.name" :value="category.id" /></el-select></el-form-item>
        <el-button type="primary" @click="query.page = 1; load()">查询</el-button>
      </el-form>
      <div class="batch-toolbar">
        <el-button type="danger" plain :disabled="!selectedActiveRows.length" :loading="batchLoading" @click="batchDisable">批量下架</el-button>
        <el-button type="danger" :disabled="!selectedRows.length" :loading="batchDeleteLoading" @click="handleBatchDelete">批量删除</el-button>
        <span>已选择 {{ selectedRows.length }} 件商品，其中 {{ selectedActiveRows.length }} 件已上架</span>
      </div>
      <PageTable :loading="loading" :error="error" :empty="!items.length" @retry="load">
        <el-table :data="items" @selection-change="handleSelectionChange">
          <el-table-column type="selection" width="48" />
          <el-table-column prop="code" label="商品编码" width="180" />
          <el-table-column prop="name" label="商品名称" min-width="230"><template #default="{ row }"><div>{{ row.displayName || row.name }} <el-tag v-if="row.nameNeedsReview" size="small" type="warning">名称待补齐</el-tag></div><small v-if="row.managementLabel" class="management-label">管理标签：{{ row.managementLabel }}</small></template></el-table-column>
          <el-table-column prop="category.name" label="分类" />
          <el-table-column prop="brand.name" label="品牌" />
          <el-table-column prop="status" label="状态" width="90"><template #default="{ row }"><el-tag :type="row.status === 'active' ? 'success' : 'info'">{{ row.status === 'active' ? '已上架' : '已下架' }}</el-tag></template></el-table-column>
          <el-table-column label="操作" width="240"><template #default="{ row }"><el-button link type="primary" @click="router.push(`/products/${row.id}/edit`)">编辑 / 规格</el-button><el-button link :type="row.status === 'active' ? 'warning' : 'success'" @click="toggle(row)">{{ row.status === 'active' ? '下架' : '上架' }}</el-button><el-button link type="danger" @click="handleDelete(row)">删除</el-button></template></el-table-column>
        </el-table>
        <el-pagination v-model:current-page="query.page" v-model:page-size="query.pageSize" :total="total" layout="total, sizes, prev, pager, next" @change="load" />
      </PageTable>
    </el-card>
    <el-dialog v-model="importHelpOpen" title="商品导入格式说明" width="min(760px, 94vw)">
      <p>仅支持.xlsx（Excel工作簿），不支持.xls或CSV。每次最多500行、5MB，首行为表头，只读取第一张工作表。</p>
      <p>复制下方示例到Excel，替换品牌、分类和商品资料后，另存为.xlsx再上传。示例使用制表符分列，不是可直接上传的文件。</p>
      <el-input :model-value="importExample" type="textarea" :rows="3" readonly aria-label="可复制的商品导入示例" />
      <ul class="import-rules">
        <li>必填表头：品牌、分类、商品名称、规格、基础价；单位可选，留空按“件”处理，建议明确填写。起订量可选，新规格默认为1，已有规格留空保留原值。</li>
        <li>“商品名称”填写客户看到的真实名称（原副标题），例如爆汁牛筋丸。管理标签仍由品牌＋分类生成。</li>
        <li>新商品的“商品编码”列留空或不添加，由系统分配。更新已有商品时可填写它的原商品编码；同品牌分类下有重名商品时必须填写编码。</li>
        <li>库存列只能留空或填0，均不会更改现有库存；实际库存请通过库存管理出入库录入。</li>
        <li>协议价／客户价列可留空；填写时请先在页面选择目标客户。需客户管理权限，只可选择已启用且在负责范围内的客户。</li>
        <li>基础价可以为0，最多两位小数。每行填写一个规格，不使用公式、日期或合并单元格；重复规格数据冲突时整批拒绝，失败不会写入任何行。</li>
        <li>需要商品维护和价格修改权限；新建商品另需创建权限。请使用已授权且启用的品牌、分类；新建品牌仅限超级管理员。</li>
      </ul>
      <template #footer><el-button type="primary" @click="importHelpOpen = false">知道了</el-button></template>
    </el-dialog>
    <el-dialog v-model="importErrorOpen" title="商品导入未完成" width="min(680px, 94vw)">
      <el-alert title="本次导入未写入任何数据，请修正后重新上传整份文件。" type="warning" :closable="false" />
      <p>共{{ importErrorCount }}处错误，{{ importErrorCount > importRowErrors.length ? `以下展示前${importRowErrors.length}处` : '错误如下' }}：</p>
      <el-table :data="importRowErrors" max-height="360" aria-label="商品导入错误行">
        <el-table-column prop="row" label="Excel行号" width="110" />
        <el-table-column prop="message" label="修改建议" min-width="240" />
      </el-table>
      <template #footer><el-button type="primary" @click="importErrorOpen = false">知道了</el-button></template>
    </el-dialog>
  </section>
</template>

<style scoped>
.page-heading { justify-content: space-between; }
.product-actions { display: flex; align-items: center; flex-wrap: wrap; gap: 10px; }
.product-actions > .el-button { margin-left: 0; }
.import-rules { padding-left: 22px; line-height: 1.8; }
.import-rules li { margin: 8px 0; }
.management-label { display: block; margin-top: 5px; color: var(--brand-text-soft); }
.batch-toolbar { display: flex; align-items: center; gap: 12px; margin-bottom: 16px; color: var(--brand-text-soft); font-size: 13px; }
.el-pagination { justify-content: flex-end; margin-top: 16px; }
</style>
