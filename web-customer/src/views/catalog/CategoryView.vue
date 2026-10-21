<script setup lang="ts">
import { computed, onMounted, reactive, ref } from "vue";
import { ArrowRight, Box, Delete, Search } from "@element-plus/icons-vue";
import { getBrands, getCategories, getProducts } from "../../api/catalog";
import type { Brand, Category, Product, ProductSku } from "../../api/catalog";
import { useCartStore } from "../../stores/cart";
import { formatAmount } from "../../utils/format";
import ProductCard from "../../components/ProductCard.vue";
import { ElMessage } from "element-plus";

const cart = useCartStore();
const products = ref<Product[]>([]);
const categories = ref<Category[]>([{ id: 0, name: "全部食材" }]);
const brands = ref<Brand[]>([]);
const loading = ref(false);
const error = ref("");
const filterError = ref(false);
const total = ref(0);
const query = reactive({
  page: 1,
  pageSize: 12,
  keyword: "",
  categoryId: 0,
  brandId: 0,
  sortBy: "",
  inStock: false,
});
const title = computed(
  () =>
    categories.value.find((item) => item.id === query.categoryId)?.name ||
    "全部食材",
);
let requestId = 0;

async function loadFilters() {
  filterError.value = false;
  try {
    const [categoryResponse, brandResponse] = await Promise.all([
      getCategories(),
      getBrands(),
    ]);
    categories.value = [{ id: 0, name: "全部食材" }, ...categoryResponse.data];
    brands.value = brandResponse.data;
  } catch {
    filterError.value = true;
  }
}

async function loadProducts() {
  const current = ++requestId;
  loading.value = true;
  error.value = "";
  try {
    const params: Record<string, unknown> = {
      page: query.page,
      pageSize: query.pageSize,
    };
    if (query.keyword.trim()) params.keyword = query.keyword.trim();
    if (query.categoryId) params.categoryId = query.categoryId;
    if (query.brandId) params.brandId = query.brandId;
    if (query.sortBy) params.sortBy = query.sortBy;
    if (query.inStock) params.inStock = "true";
    const response = await getProducts(params);
    if (current !== requestId) return;
    products.value = response.data.items;
    total.value = response.data.total;
  } catch {
    if (current !== requestId) return;
    error.value = "商品加载失败，请重试";
    products.value = [];
    total.value = 0;
  } finally {
    if (current === requestId) loading.value = false;
  }
}
function search() {
  query.page = 1;
  void loadProducts();
}
function selectCategory(id: number) {
  query.categoryId = id;
  search();
}
function resetFilters() {
  Object.assign(query, {
    keyword: "",
    categoryId: 0,
    brandId: 0,
    sortBy: "",
    inStock: false,
  });
  search();
}
function addToCart(product: Product, sku: ProductSku) {
  if (!sku || sku.stockNum < Math.max(sku.minOrderQty, 1)) return;
  const existing = cart.items.find((item) => item.skuId === sku.id);
  if (existing && existing.quantity >= sku.stockNum) {
    ElMessage.warning("已达到当前库存上限");
    return;
  }
  cart.addItem(product, sku, sku.minOrderQty || 1);
  ElMessage.success("已加入进货单");
}
onMounted(() => {
  void loadFilters();
  void loadProducts();
});
</script>

<template>
  <div class="catalog-shell">
    <aside class="catalog-sidebar">
      <p class="eyebrow">食材目录</p>
      <h2>日常好食材</h2>
      <nav class="category-nav" aria-label="商品分类">
        <button
          v-for="item in categories"
          :key="item.id"
          :class="{ active: query.categoryId === item.id }"
          :aria-pressed="query.categoryId === item.id"
          @click="selectCategory(item.id)"
        >
          {{ item.name }}
        </button>
      </nav>
      <el-button v-if="filterError" text @click="loadFilters"
        >重新加载分类</el-button
      >
      <div class="sidebar-note">
        <el-icon><Box /></el-icon>
        <p>清楚的规格<br />安心的采购</p>
        <small>订单金额以确认报价为准</small>
      </div>
      <a
        class="about-link"
        href="https://weiduoxian.cn"
        target="_blank"
        rel="noopener"
        >关于唯哆鲜 <el-icon><ArrowRight /></el-icon
      ></a>
    </aside>
    <section class="catalog-main">
      <div class="catalog-top">
        <div>
          <p class="eyebrow">采购台 / 食材目录</p>
          <h1>
            {{ title }} <small>{{ total }}</small>
          </h1>
        </div>
        <el-input
          v-model="query.keyword"
          class="catalog-search"
          aria-label="搜索食材名称或编码"
          placeholder="搜索食材名称或编码"
          clearable
          :prefix-icon="Search"
          @keyup.enter="search"
          @clear="search"
          ><template #append
            ><el-button
              :icon="Search"
              aria-label="搜索"
              title="搜索"
              @click="search" /></template
        ></el-input>
      </div>
      <div class="catalog-toolbar">
        <div class="sort-options">
          <button
            :class="{ active: !query.sortBy }"
            @click="
              query.sortBy = '';
              search();
            "
          >
            综合
          </button>
          <el-select
            v-model="query.sortBy"
            aria-label="价格排序"
            placeholder="价格排序"
            clearable
            @change="search"
            ><el-option label="价格从低到高" value="price_asc" /><el-option
              label="价格从高到低"
              value="price_desc"
          /></el-select>
        </div>
        <el-select
          v-model="query.brandId"
          aria-label="品牌筛选"
          @change="search"
          ><el-option label="全部品牌" :value="0" /><el-option
            v-for="item in brands"
            :key="item.id"
            :label="item.name"
            :value="item.id"
        /></el-select>
        <el-checkbox v-model="query.inStock" @change="search"
          >仅看有货</el-checkbox
        ><button class="reset-filter" @click="resetFilters">重置</button>
      </div>
      <div v-loading="loading" class="product-grid" :aria-busy="loading">
        <ProductCard
          v-for="item in products"
          :key="item.id"
          :product="item"
          @add="addToCart"
        />
      </div>
      <div v-if="!loading && error" class="catalog-empty" role="alert">
        <p>{{ error }}</p>
        <el-button @click="loadProducts">重新加载</el-button>
      </div>
      <div v-else-if="!loading && !products.length" class="catalog-empty">
        <h3>没有找到相关食材</h3>
        <p>换个关键词，或看看全部食材。</p>
        <el-button @click="resetFilters">清除筛选</el-button>
      </div>
      <div class="pagination">
        <span>共 {{ total }} 件食材</span
        ><el-pagination
          v-model:current-page="query.page"
          v-model:page-size="query.pageSize"
          :total="total"
          :page-sizes="[12, 24, 36]"
          layout="prev, pager, next"
          :pager-count="5"
          @current-change="loadProducts"
          @size-change="search"
        />
      </div>
    </section>
    <aside class="cart-panel" aria-label="进货单">
      <div class="cart-panel-title">
        <h2>进货单</h2>
        <span>{{ cart.totalCount }} 件</span>
      </div>
      <p class="eyebrow">唯哆鲜 · 本次采购</p>
      <p v-if="!cart.items.length" class="cart-empty">还没有选择食材</p>
      <div v-else class="cart-items">
        <div v-for="item in cart.items" :key="item.skuId" class="cart-row">
          <router-link
            :to="`/products/${item.productId}`"
            class="cart-row-name"
            >{{ item.name }}</router-link
          >
          <p>{{ item.spec }} / {{ item.unit }}</p>
          <p v-if="item.available === false" class="cart-warning">
            {{ item.unavailableReason || "暂不可购买" }}
          </p>
          <div class="cart-row-bottom">
            <strong
              >¥{{ formatAmount(Number(item.price) * item.quantity) }}</strong
            >
            <el-input-number
              :model-value="item.quantity"
              :min="Math.max(item.minOrderQty, 1)"
              :max="Math.max(item.stockNum, item.quantity)"
              :step="1"
              :precision="0"
              size="small"
              :aria-label="`${item.name}采购数量`"
              @change="
                (value: number | undefined) =>
                  value != null && cart.setQuantity(item.skuId, value)
              "
            />
            <el-button
              text
              :icon="Delete"
              :aria-label="`移除${item.name}`"
              :title="`移除${item.name}`"
              @click="cart.setQuantity(item.skuId, 0)"
            />
          </div>
        </div>
      </div>
      <div class="cart-summary">
        <div>
          <span>预计金额</span
          ><strong>¥{{ formatAmount(cart.totalAmount) }}</strong>
        </div>
        <p>以确认报价为准</p>
        <router-link class="cart-link" to="/cart"
          >查看进货单 <el-icon><ArrowRight /></el-icon
        ></router-link>
      </div>
    </aside>
  </div>
</template>

<style scoped>
.catalog-shell {
  max-width: 1600px;
  margin: auto;
  padding: 40px;
  display: grid;
  grid-template-columns: 164px minmax(0, 1fr) 260px;
  gap: 32px;
  align-items: start;
}
.eyebrow {
  color: var(--muted);
  font-size: 12px;
  margin: 0 0 12px;
}
.catalog-sidebar h2,
.cart-panel h2 {
  margin: 0;
  font-size: 20px;
}
.category-nav {
  display: flex;
  flex-direction: column;
  gap: 6px;
  margin-top: 30px;
}
.category-nav button {
  text-align: left;
  min-height: 44px;
  padding: 12px;
  background: none;
  border: 0;
  border-radius: 4px;
  color: var(--ink);
  cursor: pointer;
  overflow-wrap: anywhere;
}
.category-nav button.active {
  background: var(--soft);
  color: var(--brand);
  font-weight: 600;
}
.sidebar-note {
  border-top: 1px solid var(--line);
  margin-top: 80px;
  padding: 24px 10px;
}
.sidebar-note > .el-icon {
  color: var(--green);
  font-size: 22px;
}
.sidebar-note p {
  line-height: 1.9;
  font-size: 16px;
}
.sidebar-note small {
  font-size: 12px;
  color: var(--muted);
}
.about-link {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 12px;
  font-size: 12px;
}
.catalog-main {
  min-width: 0;
}
.catalog-top {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 24px;
  margin-bottom: 20px;
}
h1 {
  margin: 0;
  font-size: 28px;
  font-weight: 600;
}
h1 small {
  color: var(--muted);
  font-size: 12px;
  margin-left: 12px;
  font-weight: 400;
}
.catalog-search {
  max-width: 290px;
}
.catalog-search :deep(.el-input__wrapper) {
  background: var(--soft);
  box-shadow: none;
  min-height: 44px;
}
.catalog-toolbar {
  min-height: 62px;
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 16px;
  border-bottom: 1px solid var(--line);
  margin-bottom: 24px;
  padding-bottom: 10px;
}
.catalog-toolbar .el-select {
  width: 130px;
}
.sort-options {
  display: flex;
  align-items: center;
  gap: 16px;
  margin-right: auto;
}
.sort-options button,
.reset-filter {
  background: none;
  border: 0;
  padding: 10px 0;
  min-height: 44px;
  color: var(--muted);
  cursor: pointer;
}
.sort-options button.active {
  border-bottom: 2px solid var(--ink);
  color: var(--ink);
}
.reset-filter {
  font-size: 12px;
}
.product-grid {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 28px 20px;
  min-height: 160px;
}
.catalog-empty {
  text-align: center;
  padding: 30px 0 70px;
  color: var(--muted);
}
.catalog-empty h3 {
  color: var(--ink);
}
.pagination {
  display: flex;
  flex-wrap: wrap;
  justify-content: space-between;
  align-items: center;
  gap: 12px;
  margin-top: 28px;
  font-size: 12px;
  color: var(--muted);
}
.cart-panel {
  position: sticky;
  top: 120px;
  border-left: 1px solid var(--line);
  padding-left: 24px;
  min-width: 0;
}
.cart-panel-title {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin: 8px 0 12px;
}
.cart-panel-title span {
  font-size: 12px;
}
.cart-items {
  max-height: 48vh;
  overflow-y: auto;
  scrollbar-width: thin;
}
.cart-row {
  padding: 18px 0;
  border-bottom: 1px solid var(--line);
}
.cart-row-name {
  font-size: 13px;
  font-weight: 600;
  overflow-wrap: anywhere;
}
.cart-row p {
  font-size: 11px;
  color: var(--muted);
  line-height: 1.7;
}
.cart-row p.cart-warning {
  color: var(--brand);
}
.cart-row-bottom {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 6px;
  margin-top: 16px;
}
.cart-row-bottom strong {
  margin-right: auto;
  font-size: 13px;
}
.cart-row-bottom .el-input-number {
  width: 100px;
}
.cart-row-bottom .el-button {
  width: 28px;
  padding: 4px;
  margin-left: 0;
}
.cart-empty {
  padding: 40px 0;
  color: var(--muted);
  font-size: 13px;
}
.cart-summary {
  padding-top: 32px;
}
.cart-summary > div {
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  gap: 8px;
  font-size: 12px;
}
.cart-summary strong {
  font-size: 23px;
  font-variant-numeric: tabular-nums;
}
.cart-summary p {
  text-align: right;
  color: var(--muted);
  font-size: 11px;
  margin: 10px 0 22px;
}
.cart-link {
  min-height: 48px;
  padding: 12px;
  background: var(--ink);
  color: white;
  display: flex;
  align-items: center;
  justify-content: space-between;
  border-radius: 4px;
}
@media (max-width: 1200px) {
  .catalog-shell {
    grid-template-columns: 144px minmax(0, 1fr);
    padding: 32px 24px;
    gap: 24px;
  }
  .cart-panel {
    display: none;
  }
}
@media (max-width: 760px) {
  .catalog-shell {
    display: block;
    padding: 16px 20px 40px;
  }
  .catalog-sidebar > .eyebrow,
  .catalog-sidebar > h2,
  .sidebar-note,
  .about-link {
    display: none;
  }
  .category-nav {
    flex-direction: row;
    overflow-x: auto;
    margin: 0 0 24px;
    gap: 8px;
  }
  .category-nav button {
    flex-shrink: 0;
  }
  .catalog-top {
    flex-direction: column;
    align-items: stretch;
    gap: 16px;
  }
  .catalog-search {
    max-width: none;
  }
  h1 {
    font-size: 25px;
  }
  .catalog-toolbar {
    gap: 10px;
  }
  .catalog-toolbar .el-select {
    width: 120px;
  }
  .product-grid {
    grid-template-columns: repeat(2, minmax(0, 1fr));
    gap: 24px 14px;
  }
  .pagination {
    justify-content: center;
  }
}
</style>
