<script setup lang="ts">
import { computed } from 'vue'
import { ShoppingCart } from '@element-plus/icons-vue'
import type { Product } from '../api/catalog'
import { formatAmount } from '../utils/format'

const props = defineProps<{ product: Product }>()
const sku = computed(() => props.product.skus?.[0])
const image = computed(() => props.product.mainImageUrl || 'data:image/svg+xml;utf8,<svg xmlns="http://www.w3.org/2000/svg" width="320" height="180"><rect width="100%" height="100%" fill="%23f1e6e1"/><text x="50%" y="52%" font-size="36" text-anchor="middle" fill="%238d1c1c">%E9%A3%9F%E6%9D%90</text></svg>')
</script>

<template>
  <el-card class="product-card" shadow="hover" :body-style="{ padding: 0 }">
    <router-link :to="`/products/${product.id}`"><img class="product-image" :src="image" :alt="product.name" /></router-link>
    <div class="product-body">
      <router-link class="product-name" :to="`/products/${product.id}`">{{ product.name }}</router-link>
      <div class="muted sku-line">{{ sku?.specText || product.baseSpec || '多规格可选' }}</div>
      <div class="product-meta">
        <div><span class="price">¥{{ formatAmount(sku?.customerPrice || sku?.basePrice) }}</span><small class="muted">/{{ sku?.saleUnit || '件' }}</small></div>
        <el-button size="small" type="primary" round :icon="ShoppingCart" :disabled="!sku || sku.stockNum <= 0" @click="$emit('add', product, sku!)">加购</el-button>
      </div>
    </div>
  </el-card>
</template>

<style scoped>
.sku-line { margin-top: 5px; font-size: 12px; min-height: 18px; }
</style>