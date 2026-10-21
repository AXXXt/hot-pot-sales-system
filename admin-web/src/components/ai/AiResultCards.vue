<script setup lang="ts">
import { useRouter } from 'vue-router'
import type { AiCard } from '../../api/ai-assistant'
const props = defineProps<{ cards: AiCard[]; readonly?: boolean }>()
const emit = defineEmits<{ complete: [id: string] }>()
const router = useRouter()
const date = (value: string) => new Date(value).toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai', hour12: false })
</script>

<template>
  <section v-for="(card, index) in props.cards" :key="index" class="result-card">
    <strong>{{ card.title }}</strong>
    <template v-if="card.type === 'counts'"><div v-for="item in card.items" :key="item.label" class="result-row"><span>{{ item.label }}</span><el-button text @click="router.push(item.path)">{{ item.value }} →</el-button></div></template>
    <template v-else-if="card.type === 'metrics'">
      <p class="result-note">{{ date(card.start) }} 至 {{ date(card.end) }}</p>
      <div class="metric-values"><div><span>有效订单金额</span><strong>¥{{ card.amount }}</strong></div><div><span>订单数</span><strong>{{ card.orders }}</strong></div></div>
      <p class="result-note">上一相同已过时段：¥{{ card.previousAmount }}；客单价 {{ card.average ? `¥${card.average}` : '无可比数据' }}</p>
      <div v-for="(item, rank) in card.top" :key="`${item.productId}-${item.unit}`" class="rank-row"><span>{{ Number(rank) + 1 }}. {{ item.name }}</span><span>{{ item.quantity }}{{ item.unit }} · ¥{{ item.amount }}</span></div>
      <p class="result-note">{{ card.definition }}</p>
      <el-button text @click="router.push('/orders')">查看订单明细 →</el-button>
    </template>
    <template v-else-if="card.type === 'tasks'">
      <div v-for="item in card.items" :key="item.id" class="result-row"><div>{{ item.title }}<small>{{ date(item.dueAt) }}</small></div><el-button v-if="!readonly" text @click="emit('complete', item.id)">完成</el-button></div>
    </template>
    <template v-else-if="card.type === 'quote'">
      <div v-for="item in card.items" :key="item.skuId" class="result-row"><div>{{ item.name }}<small>{{ item.specText }}；订单价 ¥{{ item.currentPrice }}/{{ item.unit }}</small><small>{{ item.historicalPrice ? `历史价 ¥${item.historicalPrice}/${item.unit} · ${date(item.historicalAt)}` : '没有可用历史价' }}</small></div></div>
      <el-button text @click="router.push(`/orders/${card.orderId}`)">进入订单检查并报价 →</el-button>
    </template>
    <template v-else>
      <div v-for="item in card.items" :key="item.id" class="result-row">
        <div>
          <template v-if="card.type === 'orders'">{{ item.orderNo }}<small>{{ item.status }}</small></template>
          <template v-else-if="card.type === 'inventory'">{{ item.product.subtitle || item.product.name }}<small>{{ item.specText }} · 库存 {{ item.stockNum }}{{ item.saleUnit }}</small><small v-if="'suggestedQuantity' in item">{{ item.suggestedQuantity === null ? '近期无发货记录，暂不估算' : `建议补充 ${item.suggestedQuantity}${item.saleUnit}，近14天发货 ${item.recentQuantity}${item.saleUnit}` }}</small></template>
          <template v-else-if="card.type === 'leads'">{{ item.storeName || '未填写门店名' }}<small>{{ item.nextFollowUpAt ? date(item.nextFollowUpAt) : '待首次跟进' }}</small></template>
          <template v-else-if="card.type === 'customers'">{{ item.customerName }}<small>{{ item.status === 'active' ? '启用' : '停用' }}</small></template>
          <template v-else>{{ item.subtitle || item.name }}<small>{{ card.type === 'quality' ? [item.nameNeedsReview ? '缺商品名称' : '', !item.mainImageUrl ? '缺主图' : '', !item._count?.skus ? '缺规格' : ''].filter(Boolean).join('、') : item.code }}</small></template>
        </div>
        <el-button text @click="router.push(card.type === 'orders' ? `/orders/${item.id}` : card.type === 'customers' ? `/customers/${item.id}` : card.type === 'leads' ? '/leads' : card.type === 'inventory' ? '/inventory' : `/products/${item.id}/edit`)">查看</el-button>
      </div>
    </template>
    <p v-if="card.items && !card.items.length" class="result-note">当前权限和筛选范围内暂无记录。</p>
    <p v-if="card.note" class="result-note">{{ card.note }}</p>
  </section>
</template>

<style scoped>
.result-card { margin-top: 12px; border-top: 1px solid var(--brand-border); padding-top: 12px; font-size: 13px; }
.result-row { display: flex; align-items: center; justify-content: space-between; gap: 10px; padding: 9px 0; border-bottom: 1px solid #f0f2f0; overflow-wrap: anywhere; }
.result-row > div { min-width: 0; }
.result-row small { display: block; color: var(--brand-text-soft); margin-top: 4px; line-height: 1.6; }
.result-note { color: var(--brand-text-soft); font-size: 12px; line-height: 1.8; overflow-wrap: anywhere; }
.metric-values { display: flex; flex-wrap: wrap; gap: 24px; margin: 12px 0; }
.metric-values span { display: block; color: var(--brand-text-soft); font-size: 12px; }
.metric-values strong { display: block; font-size: 24px; margin-top: 6px; font-variant-numeric: tabular-nums; }
.rank-row { display: flex; flex-wrap: wrap; justify-content: space-between; gap: 8px; padding: 8px 0; }
</style>
