<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { ElMessage } from 'element-plus'
import { Edit } from '@element-plus/icons-vue'
import { getProductVisibility, updateProductVisibility } from '../../../api/customer'
import { getProducts } from '../../../api/product'

type VisibilityMode = 'factory' | 'all' | 'custom'

const props = defineProps<{ customerId: number }>()

const loading = ref(true)
const saving = ref(false)
const productsLoading = ref(false)
const selectorVisible = ref(false)
const mode = ref<VisibilityMode>('factory')
const selectedIds = ref<number[]>([])
const visibleProductCount = ref(0)
const products = ref<any[]>([])
const keyword = ref('')
const categoryId = ref<number | ''>('')

const modeOptions: Array<{ value: VisibilityMode; label: string; description: string }> = [
  { value: 'factory', label: '工厂自产', description: '仅展示已启用的工厂自产商品' },
  { value: 'all', label: '全部商品', description: '展示全部已启用商品' },
  { value: 'custom', label: '自定义商品', description: '仅展示为该客户单独勾选的商品' }
]

const dataOf = (response: any) => response?.data ?? response ?? {}

const currentDescription = computed(() => (
  modeOptions.find(option => option.value === mode.value)?.description || ''
))

const categories = computed(() => {
  const map = new Map<number, string>()
  products.value.forEach((product: any) => {
    if (product.category?.id) map.set(product.category.id, product.category.name)
  })
  return [...map.entries()].map(([id, name]) => ({ id, name }))
})

const filteredProducts = computed(() => {
  const normalizedKeyword = keyword.value.trim().toLowerCase()
  return products.value.filter((product: any) => {
    const matchesKeyword = !normalizedKeyword || String(product.name || '').toLowerCase().includes(normalizedKeyword)
    const matchesCategory = !categoryId.value || product.category?.id === categoryId.value
    return matchesKeyword && matchesCategory
  })
})

async function loadVisibility() {
  loading.value = true
  try {
    const response: any = await getProductVisibility(props.customerId)
    const data = dataOf(response)
    mode.value = data.mode || 'factory'
    selectedIds.value = Array.isArray(data.productIds) ? data.productIds : []
    visibleProductCount.value = Number(data.visibleProductCount || 0)
  } catch (error: any) {
    ElMessage.error(error?.message || '可见商品配置加载失败')
  } finally {
    loading.value = false
  }
}

async function loadProducts() {
  if (products.value.length) return
  productsLoading.value = true
  try {
    const response: any = await getProducts({ page: 1, pageSize: 500 })
    const data = dataOf(response)
    products.value = data.items || data || []
  } catch (error: any) {
    ElMessage.error(error?.message || '商品列表加载失败')
  } finally {
    productsLoading.value = false
  }
}

async function openSelector() {
  selectorVisible.value = true
  await loadProducts()
}

function confirmSelection() {
  if (!selectedIds.value.length) {
    ElMessage.warning('请至少选择一个商品')
    return
  }
  selectorVisible.value = false
}

async function saveVisibility() {
  if (mode.value === 'custom' && !selectedIds.value.length) {
    ElMessage.warning('自定义模式至少选择一个商品')
    return
  }

  saving.value = true
  try {
    const response: any = await updateProductVisibility(props.customerId, {
      mode: mode.value,
      productIds: mode.value === 'custom' ? selectedIds.value : []
    })
    const data = dataOf(response)
    mode.value = data.mode
    selectedIds.value = data.productIds || []
    visibleProductCount.value = Number(data.visibleProductCount || 0)
    ElMessage.success('可见商品已更新')
  } catch (error: any) {
    ElMessage.warning(error?.message || '保存失败')
  } finally {
    saving.value = false
  }
}

onMounted(loadVisibility)
</script>

<template>
  <el-card v-loading="loading" shadow="never" class="visibility-card">
    <template #header>
      <div class="card-header">
        <strong>可见商品</strong>
        <el-tag type="info" effect="plain">当前 {{ visibleProductCount }} 件</el-tag>
      </div>
    </template>

    <div class="mode-row">
      <el-radio-group v-model="mode" class="mode-control">
        <el-radio-button v-for="option in modeOptions" :key="option.value" :value="option.value">
          {{ option.label }}
        </el-radio-button>
      </el-radio-group>
      <el-button v-if="mode === 'custom'" :icon="Edit" @click="openSelector">
        选择商品（{{ selectedIds.length }}）
      </el-button>
    </div>

    <div class="mode-description">{{ currentDescription }}</div>

    <div class="card-actions">
      <el-button type="primary" :loading="saving" @click="saveVisibility">保存配置</el-button>
    </div>

    <el-dialog v-model="selectorVisible" title="选择客户可见商品" width="min(760px, 92vw)">
      <div class="selector-toolbar">
        <el-input v-model="keyword" clearable placeholder="搜索商品名称" />
        <el-select v-model="categoryId" clearable placeholder="全部分类">
          <el-option v-for="category in categories" :key="category.id" :label="category.name" :value="category.id" />
        </el-select>
      </div>

      <div v-loading="productsLoading" class="product-selector">
        <el-empty v-if="!productsLoading && !filteredProducts.length" description="没有符合条件的商品" />
        <el-checkbox-group v-else v-model="selectedIds">
          <label v-for="product in filteredProducts" :key="product.id" class="product-option">
            <el-checkbox :value="product.id" />
            <span class="product-name">{{ product.name }}</span>
            <span class="product-category">{{ product.category?.name || '未分类' }}</span>
          </label>
        </el-checkbox-group>
      </div>

      <template #footer>
        <span class="selected-count">已选择 {{ selectedIds.length }} 件</span>
        <el-button @click="selectorVisible = false">取消</el-button>
        <el-button type="primary" :disabled="!selectedIds.length" @click="confirmSelection">确认选择</el-button>
      </template>
    </el-dialog>
  </el-card>
</template>

<style scoped>
.visibility-card { margin-top: 16px; }
.card-header, .mode-row, .card-actions { display: flex; align-items: center; }
.card-header, .mode-row { justify-content: space-between; gap: 16px; }
.mode-control { display: flex; flex-wrap: wrap; }
.mode-description { margin-top: 12px; color: var(--brand-text-soft); font-size: 13px; }
.card-actions { justify-content: flex-end; margin-top: 18px; }
.selector-toolbar { display: grid; grid-template-columns: minmax(0, 1fr) 180px; gap: 12px; margin-bottom: 14px; }
.product-selector { min-height: 240px; max-height: 420px; overflow-y: auto; border: 1px solid var(--brand-border); border-radius: 14px; }
.product-option { min-height: 50px; padding: 0 14px; display: grid; grid-template-columns: 28px minmax(0, 1fr) 120px; align-items: center; border-bottom: 1px solid #f2e7e5; cursor: pointer; font-size: 14px; line-height: 20px; }
.product-option:last-child { border-bottom: 0; }
.product-option:hover { background: #fff2ef; }
.product-name { min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; color: var(--brand-text); }
.product-category { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; color: var(--brand-text-soft); font-size: 12px; text-align: right; }
.selected-count { margin-right: auto; color: var(--brand-text-soft); font-size: 13px; }

@media (max-width: 640px) {
  .mode-row { align-items: flex-start; flex-direction: column; }
  .selector-toolbar { grid-template-columns: 1fr; }
  .product-option { grid-template-columns: 28px minmax(0, 1fr); }
  .product-category { grid-column: 2; text-align: left; padding-bottom: 8px; }
}
</style>
