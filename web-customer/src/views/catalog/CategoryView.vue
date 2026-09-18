<script setup lang="ts">
import { onMounted, reactive, ref } from 'vue'
import { Search } from '@element-plus/icons-vue'
import { getBrands, getCategories, getProducts } from '../../api/catalog'
import type { Brand, Category, Product } from '../../api/catalog'
import { useCartStore } from '../../stores/cart'
import ProductCard from '../../components/ProductCard.vue'
import { ElMessage } from 'element-plus'

const cart = useCartStore()
const products = ref<Product[]>([])
const categories = ref<Category[]>([{ id: 0, name: '全部分类' }])
const brands = ref<Brand[]>([])
const loading = ref(false)
const total = ref(0)
const query = reactive({ page: 1, pageSize: 12, keyword: '', categoryId: 0, brandId: 0, sortBy: '', inStock: false })

async function loadFilters() {
  const [categoryResponse, brandResponse] = await Promise.all([getCategories(), getBrands()])
  categories.value = [{ id: 0, name: '全部分类' }, ...categoryResponse.data]
  brands.value = brandResponse.data
}

async function loadProducts() {
  loading.value = true
  try {
    const params: Record<string, unknown> = { page: query.page, pageSize: query.pageSize }
    if (query.keyword) params.keyword = query.keyword
    if (query.categoryId) params.categoryId = query.categoryId
    if (query.brandId) params.brandId = query.brandId
    if (query.sortBy) params.sortBy = query.sortBy
    if (query.inStock) params.inStock = 'true'
    const response = await getProducts(params)
    products.value = response.data.items
    total.value = response.data.total
  } finally {
    loading.value = false
  }
}

function search() {
  query.page = 1
  void loadProducts()
}

function resetFilters() {
  query.keyword = ''
  query.categoryId = 0
  query.brandId = 0
  query.sortBy = ''
  query.inStock = false
  search()
}

function addToCart(product: Product) {
  cart.addItem(product, product.skus[0], product.skus[0].minOrderQty || 1)
  ElMessage.success('已加入进货单')
}

onMounted(async () => {
  await loadFilters()
  await loadProducts()
})
</script>

<template>
  <div class="page">
    <h1 class="page-title">全部商品</h1>
    <el-card class="filter-card" shadow="never">
      <div class="filter-grid">
        <el-input v-model="query.keyword" placeholder="搜索商品名称或编码" clearable :prefix-icon="Search" @keyup.enter="search" @clear="search" />
        <el-select v-model="query.categoryId" placeholder="全部分类" clearable @change="search">
          <el-option v-for="item in categories" :key="item.id" :label="item.name" :value="item.id" />
        </el-select>
        <el-select v-model="query.brandId" placeholder="全部品牌" clearable @change="search">
          <el-option v-for="item in brands" :key="item.id" :label="item.name" :value="item.id" />
        </el-select>
        <el-select v-model="query.sortBy" placeholder="默认排序" clearable @change="search">
          <el-option label="价格从低到高" value="price_asc" />
          <el-option label="价格从高到低" value="price_desc" />
        </el-select>
        <el-checkbox v-model="query.inStock" @change="search">仅看有货</el-checkbox>
        <div class="filter-actions"><el-button type="primary" @click="search">查询</el-button><el-button @click="resetFilters">重置</el-button></div>
      </div>
    </el-card>

    <div v-loading="loading" class="product-grid">
      <ProductCard v-for="item in products" :key="item.id" :product="item" @add="addToCart" />
    </div>
    <el-empty v-if="!loading && !products.length" description="没有符合条件的商品" />
    <div class="pagination"><el-pagination v-model:current-page="query.page" v-model:page-size="query.pageSize" :total="total" :page-sizes="[12,24,36]" layout="total, sizes, prev, pager, next" @current-change="loadProducts" @size-change="search" /></div>
  </div>
</template>

<style scoped>
.filter-card { margin-bottom: 20px; border-radius: 16px; }
.filter-grid { display: grid; grid-template-columns: 1.4fr repeat(3, 1fr) auto auto; gap: 12px; align-items: center; }
.product-grid { display: grid; grid-template-columns: repeat(4,1fr); gap: 16px; min-height: 240px; }
.pagination { display: flex; justify-content: flex-end; margin-top: 24px; }
@media (max-width: 960px) { .filter-grid { grid-template-columns: 1fr; } .product-grid { grid-template-columns: repeat(2,1fr); } }
</style>