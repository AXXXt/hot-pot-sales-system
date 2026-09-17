<script setup lang="ts">
import { computed, onMounted, reactive, ref } from 'vue'
import { useRouter } from 'vue-router'
import { ElMessage, ElMessageBox } from 'element-plus'
import PageTable from '../../components/PageTable.vue'
import { batchArchiveProducts, batchUpdateProductStatus, deleteProduct, getBrands, getCategories, getProducts, updateProductStatus } from '../../api/product'

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
    await ElMessageBox.confirm(`确认${row.status === 'active' ? '下架' : '上架'}该商品？`, '操作确认', { type: 'warning' })
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
      { type: 'warning' }
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
      { type: 'warning', confirmButtonText: '确认删除' }
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
      { type: 'warning', confirmButtonText: '确认删除' }
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
      <el-button type="primary" @click="router.push('/products/create')">新建商品</el-button>
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
          <el-table-column prop="name" label="商品名称" min-width="200" />
          <el-table-column prop="category.name" label="分类" />
          <el-table-column prop="brand.name" label="品牌" />
          <el-table-column prop="status" label="状态" width="90"><template #default="{ row }"><el-tag :type="row.status === 'active' ? 'success' : 'info'">{{ row.status === 'active' ? '已上架' : '已下架' }}</el-tag></template></el-table-column>
          <el-table-column label="操作" width="240"><template #default="{ row }"><el-button link type="primary" @click="router.push(`/products/${row.id}/edit`)">编辑 / 规格</el-button><el-button link :type="row.status === 'active' ? 'warning' : 'success'" @click="toggle(row)">{{ row.status === 'active' ? '下架' : '上架' }}</el-button><el-button link type="danger" @click="handleDelete(row)">删除</el-button></template></el-table-column>
        </el-table>
        <el-pagination v-model:current-page="query.page" v-model:page-size="query.pageSize" :total="total" layout="total, sizes, prev, pager, next" @change="load" />
      </PageTable>
    </el-card>
  </section>
</template>

<style scoped>
.page-heading { justify-content: space-between; }
.batch-toolbar { display: flex; align-items: center; gap: 12px; margin-bottom: 16px; color: var(--brand-text-soft); font-size: 13px; }
.el-pagination { justify-content: flex-end; margin-top: 16px; }
</style>
