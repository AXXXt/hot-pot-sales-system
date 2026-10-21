<script setup lang="ts">
import { computed, ref, watch } from "vue";
import { Plus, Picture } from "@element-plus/icons-vue";
import type { Product, ProductSku } from "../api/catalog";
import { formatAmount } from "../utils/format";

const props = defineProps<{ product: Product }>();
defineEmits<{ add: [product: Product, sku: ProductSku] }>();
const sku = computed(() => [...(props.product.skus || [])].sort((a, b) => Number(a.customerPrice ?? a.basePrice) - Number(b.customerPrice ?? b.basePrice))[0]);
const failedImage = ref(false);
watch(
  () => props.product.mainImageUrl,
  () => {
    failedImage.value = false;
  },
);
</script>

<template>
  <article class="product-card">
    <router-link
      class="product-media"
      :to="`/products/${product.id}`"
      :aria-label="`查看${product.name}`"
    >
      <img
        v-if="product.mainImageUrl && !failedImage"
        class="product-image"
        :src="product.mainImageUrl"
        :alt="product.name"
        loading="lazy"
        @error="failedImage = true"
      />
      <span v-else class="product-placeholder"
        ><el-icon><Picture /></el-icon><span>暂无商品图片</span></span
      >
      <span v-if="product.isNew || product.isHot" class="product-tag">{{
        product.isNew ? "新品" : "热销"
      }}</span>
    </router-link>
    <div class="product-body">
      <div class="product-caption">
        <span>{{
          product.category?.name || product.brand?.name || "食材"
        }}</span
        ><span>{{ sku?.skuCode }}</span>
      </div>
      <router-link class="product-name" :to="`/products/${product.id}`">{{
        product.name
      }}</router-link>
      <p class="sku-line">
        {{ [product.brand?.name, sku?.specText || product.baseSpec || "规格待确认"].filter(Boolean).join(' · ') }}
      </p>
      <div class="product-bottom">
        <div v-if="sku" class="product-price">
          <small>¥</small>{{ formatAmount(sku.customerPrice ?? sku.basePrice)
          }}<span>/ {{ sku.saleUnit || "件" }}</span><span v-if="product.skus.length > 1">起</span>
        </div>
        <span v-else class="muted">价格待确认</span>
        <router-link
          v-if="product.skus?.length > 1"
          class="sku-link"
          :to="`/products/${product.id}`"
          >选规格</router-link
        >
        <el-button
          v-else
          circle
          :icon="Plus"
          :title="
            !sku || sku.stockNum < sku.minOrderQty ? '暂不可购买' : '加入进货单'
          "
          :aria-label="`将${product.name}加入进货单`"
          :disabled="!sku || sku.stockNum < Math.max(sku.minOrderQty, 1)"
          @click="sku && $emit('add', product, sku)"
        />
      </div>
    </div>
  </article>
</template>

<style scoped>
.product-card {
  min-width: 0;
  border-bottom: 1px solid var(--line);
  background: white;
}
.product-media {
  position: relative;
  display: block;
  aspect-ratio: 1.08;
  overflow: hidden;
  background: var(--soft);
}
.product-image {
  width: 100%;
  height: 100%;
  object-fit: cover;
  display: block;
}
.product-placeholder {
  height: 100%;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 12px;
  color: var(--muted);
  font-size: 12px;
}
.product-placeholder .el-icon {
  font-size: 28px;
}
.product-tag {
  position: absolute;
  top: 10px;
  left: 10px;
  background: white;
  color: var(--green);
  font-size: 11px;
  padding: 4px 8px;
}
.product-body {
  padding: 14px 0 12px;
}
.product-caption {
  display: flex;
  justify-content: space-between;
  gap: 12px;
  color: var(--muted);
  font-size: 11px;
  margin-bottom: 8px;
  overflow-wrap: anywhere;
}
.product-caption span:last-child {
  text-align: right;
}
.product-name {
  display: block;
  font-size: 15px;
  font-weight: 600;
  line-height: 1.6;
  overflow-wrap: anywhere;
}
.sku-line {
  color: var(--muted);
  margin: 6px 0 12px;
  font-size: 12px;
  min-height: 18px;
  line-height: 1.6;
}
.product-bottom {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 6px;
  min-height: 44px;
  flex-wrap: wrap;
}
.product-price {
  color: var(--ink);
  font-size: 23px;
  font-weight: 600;
  font-variant-numeric: tabular-nums;
}
.product-price small {
  font-size: 12px;
  margin-right: 3px;
}
.product-price span {
  font-weight: 400;
  color: var(--muted);
  font-size: 12px;
  margin-left: 5px;
}
.product-bottom .el-button {
  width: 44px;
  height: 44px;
  font-size: 18px;
}
.sku-link {
  font-size: 12px;
  display: inline-flex;
  align-items: center;
  min-height: 44px;
  color: var(--green);
}
@media (max-width: 600px) {
  .product-name {
    font-size: 14px;
  }
  .product-price {
    font-size: 20px;
  }
  .product-caption {
    font-size: 10px;
  }
}
</style>
