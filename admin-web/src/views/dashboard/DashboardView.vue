<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { useRouter } from 'vue-router'
import { ArrowLeft, ArrowRight, Refresh } from '@element-plus/icons-vue'
import { getDashboardStats } from '../../api/dashboard'
import {
  DONUT_VIEW_BOX,
  TREND_GRID_LINES,
  TREND_VIEW_BOX,
  buildDonutSegments,
  buildTrendAreaPath,
  buildTrendPlot,
  formatPlotPoints
} from './chart-geometry'
import type { DashboardLowStockItem } from './dashboard-presenters'
import { getTopLowStockItems } from './dashboard-presenters'

type DashboardPage = 'tasks' | 'overview'

const router = useRouter()
const openOrders = (status: string) => router.push({ path: '/orders', query: { status } })
const loading = ref(true)
const error = ref('')
const stats = ref<any>(null)
const activePage = ref<DashboardPage>('tasks')
const swipeStart = ref<{ x: number; y: number } | null>(null)

async function fetchStats() {
  loading.value = true
  error.value = ''
  try {
    const res: any = await getDashboardStats()
    stats.value = res.data ?? res
  } catch (requestError: any) {
    error.value = requestError.message || '加载失败'
  } finally {
    loading.value = false
  }
}

onMounted(fetchStats)

const statusTag = (status: string) => {
  const map: Record<string, string> = {
    draft: 'info', pending_quote: 'warning', pending_confirm: 'warning',
    pending_finance: 'danger', pending_shipment: 'primary', shipped: 'success',
    completed: 'success', cancelled: 'danger'
  }
  return map[status] || 'info'
}

const statusText = (status: string) => {
  const map: Record<string, string> = {
    draft: '草稿', pending_quote: '待报价', pending_confirm: '待客户确认',
    pending_finance: '待财务审核', pending_shipment: '待发货', shipped: '已发货',
    completed: '已完成', cancelled: '已取消'
  }
  return map[status] || status
}

const orderChange = computed(() => {
  if (!stats.value) return { pct: 0, up: true }
  const today = Number(stats.value.todayOrders) || 0
  const yesterday = Number(stats.value.yesterdayOrders) || 0
  if (!yesterday) return { pct: today ? 100 : 0, up: true }
  const change = Math.round(((today - yesterday) / yesterday) * 100)
  return { pct: Math.abs(change), up: change >= 0 }
})

const revenueChange = computed(() => {
  if (!stats.value) return { pct: 0, up: true }
  const today = Number(stats.value.todayRevenue) || 0
  const yesterday = Number(stats.value.yesterdayRevenue) || 0
  if (!yesterday) return { pct: today ? 100 : 0, up: true }
  const change = Math.round(((today - yesterday) / yesterday) * 100)
  return { pct: Math.abs(change), up: change >= 0 }
})

const trendPlot = computed(() => buildTrendPlot(stats.value?.trend || []))
const trendPolyline = computed(() => formatPlotPoints(trendPlot.value))
const trendAreaPath = computed(() => buildTrendAreaPath(trendPlot.value))
const trendTotalRevenue = computed(() => (stats.value?.trend || []).reduce((sum: number, item: any) => sum + (Number(item.revenue) || 0), 0))
const trendTotalOrders = computed(() => (stats.value?.trend || []).reduce((sum: number, item: any) => sum + (Number(item.orders ?? item.count) || 0), 0))
const trendBestDay = computed(() => {
  if (!trendPlot.value.length) return { date: '', label: '--', value: 0, plotX: 0, plotY: 0 }
  return trendPlot.value.reduce((bestPoint, currentPoint) => currentPoint.value > bestPoint.value ? currentPoint : bestPoint, trendPlot.value[0])
})
const trendBestValue = computed(() => trendBestDay.value.value)

const donutSegments = computed(() => buildDonutSegments(stats.value?.orderStatuses || []))
const donutTotal = computed(() => donutSegments.value.reduce((sum, segment) => sum + segment.value, 0))
const donutLead = computed(() => {
  if (!donutSegments.value.length) return null
  return donutSegments.value.reduce((leadSegment, currentSegment) => currentSegment.value > leadSegment.value ? currentSegment : leadSegment, donutSegments.value[0])
})

const activePageIndex = computed(() => activePage.value === 'tasks' ? 0 : 1)
const pageTitle = computed(() => activePage.value === 'tasks' ? '今日待办' : '经营概览')
const pageSubtitle = computed(() => activePage.value === 'tasks' ? '优先处理高风险事项，再查看经营表现' : '用销售趋势和订单结构快速判断经营表现')
const topLowStockItems = computed<DashboardLowStockItem[]>(() => getTopLowStockItems(stats.value?.lowStockItems, 5))
const recentOrders = computed(() => (stats.value?.recentOrders || []).slice(0, 3))
const topProducts = computed(() => (stats.value?.topProducts || []).slice(0, 3))
const customerOverview = computed(() => [
  { label: '活跃客户', value: stats.value?.activeCustomers || 0 },
  { label: '客户总数', value: stats.value?.totalCustomers || 0 },
  { label: '在售商品', value: stats.value?.totalProducts || 0 }
])

function fmt(value: unknown): string {
  const amount = Number(value) || 0
  if (amount >= 10000) return `${(amount / 10000).toFixed(1)}万`
  return amount.toLocaleString()
}

function selectPage(page: DashboardPage) {
  activePage.value = page
}

function movePage(direction: -1 | 1) {
  if (direction < 0) selectPage('tasks')
  if (direction > 0) selectPage('overview')
}

function handlePageKeydown(event: KeyboardEvent) {
  if (event.key === 'ArrowLeft') {
    event.preventDefault()
    movePage(-1)
  }
  if (event.key === 'ArrowRight') {
    event.preventDefault()
    movePage(1)
  }
}

function handlePointerDown(event: PointerEvent) {
  swipeStart.value = { x: event.clientX, y: event.clientY }
}

function handlePointerUp(event: PointerEvent) {
  if (!swipeStart.value) return
  const deltaX = event.clientX - swipeStart.value.x
  const deltaY = event.clientY - swipeStart.value.y
  swipeStart.value = null
  if (Math.abs(deltaX) < 48 || Math.abs(deltaX) <= Math.abs(deltaY)) return
  movePage(deltaX < 0 ? 1 : -1)
}

function clearPointerStart() {
  swipeStart.value = null
}

function lowStockPercent(item: DashboardLowStockItem): number {
  const availableQty = Number(item.availableQty) || 0
  const warningQty = Number(item.warningQty) || 10
  return Math.max(0, Math.min(100, Math.round((availableQty / warningQty) * 100)))
}

function lowStockState(item: DashboardLowStockItem): string {
  const availableQty = Number(item.availableQty) || 0
  if (availableQty <= 0) return '立即处理'
  if (lowStockPercent(item) <= 25) return '高风险'
  return '需补货'
}

function lowStockStateClass(item: DashboardLowStockItem): string {
  const availableQty = Number(item.availableQty) || 0
  if (availableQty <= 0) return 'is-critical'
  if (lowStockPercent(item) <= 25) return 'is-danger'
  return 'is-warning'
}

function lowStockTitle(item: DashboardLowStockItem): string {
  return item.productName?.trim() || item.skuName?.trim() || '未命名商品'
}

function lowStockMeta(item: DashboardLowStockItem): string {
  const details: string[] = []
  const productName = item.productName?.trim()
  const skuName = item.skuName?.trim()
  if (productName) details.push(skuName || '未命名 SKU')
  details.push(item.warehouse?.trim() || '未分配仓库')
  details.push(`预警线 ${item.warningQty || 10}`)
  return details.join(' · ')
}
</script>

<template>
  <section class="dashboard">
    <div class="dash-header">
      <div>
        <h1>{{ pageTitle }}</h1>
        <p>{{ pageSubtitle }}</p>
      </div>
      <div class="dash-actions">
        <div class="page-switcher" role="tablist" aria-label="工作台页面">
          <button type="button" class="page-tab" :class="{ 'is-active': activePage === 'tasks' }" role="tab" :aria-selected="activePage === 'tasks'" @click="selectPage('tasks')">待办工作台</button>
          <button type="button" class="page-tab" :class="{ 'is-active': activePage === 'overview' }" role="tab" :aria-selected="activePage === 'overview'" @click="selectPage('overview')">经营概览</button>
        </div>
        <div class="page-arrows" aria-label="切换工作台页面">
          <el-button circle text :icon="ArrowLeft" aria-label="上一页" :disabled="activePage === 'tasks'" @click="movePage(-1)" />
          <span class="page-index">{{ activePageIndex + 1 }} / 2</span>
          <el-button circle text :icon="ArrowRight" aria-label="下一页" :disabled="activePage === 'overview'" @click="movePage(1)" />
        </div>
        <el-button :icon="Refresh" :loading="loading" @click="fetchStats">刷新数据</el-button>
      </div>
    </div>

    <div v-if="loading" class="dash-loading"><el-icon class="is-loading" :size="32"><svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="10" stroke="#ead9d7" stroke-width="3" fill="none"/><path d="M12 2a10 10 0 0 1 10 10" stroke="#8d1c1c" stroke-width="3" fill="none" stroke-linecap="round"/></svg></el-icon></div>
    <el-alert v-else-if="error" type="error" :title="error" show-icon :closable="false" class="dash-error">
      <template #default><el-button link type="primary" @click="fetchStats">重试</el-button></template>
    </el-alert>

    <template v-else-if="stats">
      <div class="dashboard-viewport" tabindex="0" @keydown="handlePageKeydown" @pointerdown="handlePointerDown" @pointerup="handlePointerUp" @pointercancel="clearPointerStart">
        <div class="dashboard-track" :style="{ transform: `translateX(-${activePageIndex * 50}%)` }">
          <section class="dashboard-page dashboard-page--tasks" aria-labelledby="tasks-page-title">
            <div class="page-heading"><div><h2 id="tasks-page-title">今日待办</h2><p>只保留需要优先处理的事项</p></div><span class="page-caption">待办优先</span></div>

            <div class="summary-grid">
              <button type="button" class="summary-card" @click="openOrders('pending_quote')"><span>待报价订单</span><strong class="is-warning">{{ stats.pendingQuotes || 0 }}</strong><small>需尽快填写报价</small></button>
              <button type="button" class="summary-card" @click="openOrders('pending_shipment')"><span>待发货订单</span><strong class="is-primary">{{ stats.pendingShipments || 0 }}</strong><small>已确认待配送</small></button>
              <button type="button" class="summary-card" @click="router.push('/products')"><span>库存预警</span><strong class="is-danger">{{ stats.inventoryWarnings || 0 }}</strong><small>仅展示风险最高前 5 条</small></button>
            </div>

            <div class="task-grid">
              <div class="dashboard-card inventory-card">
                <div class="section-head"><div><h3>高风险库存</h3><p>按库存占预警线比例排序</p></div><span class="section-note">仅展示前 5 条</span></div>
                <div v-if="topLowStockItems.length" class="low-stock-list">
                  <button v-for="item in topLowStockItems" :key="item.id" type="button" class="low-stock-item" @click="router.push('/products/' + item.productId + '/edit')">
                    <span class="low-stock-main"><strong>{{ lowStockTitle(item) }}</strong><small>{{ lowStockMeta(item) }}</small></span>
                    <span class="low-stock-status" :class="lowStockStateClass(item)"><b>剩 {{ item.availableQty || 0 }}</b><em>{{ lowStockState(item) }}</em></span>
                    <el-progress :percentage="lowStockPercent(item)" :color="Number(item.availableQty) <= 0 ? '#C43737' : lowStockPercent(item) <= 25 ? '#C43737' : '#A16207'" :show-text="false" />
                  </button>
                </div>
                <div v-else class="card-empty">暂无预警</div>
                <button type="button" class="view-all-link" @click="router.push('/products')">查看全部 {{ stats.inventoryWarnings || 0 }} 个 <span>→</span></button>
              </div>

              <div class="task-side">
                <button type="button" class="dashboard-card task-card" @click="openOrders('pending_quote')"><span>报价处理</span><strong>{{ stats.pendingQuotes || 0 }}</strong><small>待报价订单</small><em>进入订单管理 →</em></button>
                <button type="button" class="dashboard-card task-card" @click="openOrders('pending_shipment')"><span>发货处理</span><strong>{{ stats.pendingShipments || 0 }}</strong><small>已确认待配送</small><em>进入订单管理 →</em></button>
              </div>
            </div>

            <div class="recent-strip dashboard-card">
              <div class="section-head"><div><h3>近期订单</h3><p>只保留最近三条活动</p></div><span class="section-note">{{ recentOrders.length ? `最近 ${recentOrders.length} 条` : '暂无新增' }}</span></div>
              <div v-if="recentOrders.length" class="recent-order-list">
                <button v-for="order in recentOrders" :key="order.id" type="button" class="recent-order" @click="router.push('/orders/' + order.id)"><span>{{ order.orderNo }}</span><span>{{ order.customerName || '未填写客户' }}</span><el-tag :type="statusTag(order.status)" size="small">{{ statusText(order.status) }}</el-tag><b>¥{{ Number(order.payableAmount || 0).toFixed(2) }}</b></button>
              </div>
              <div v-else class="card-empty">暂无新增订单</div>
            </div>

            <div class="quick-actions"><el-button type="primary" @click="router.push('/products/create')">新建商品</el-button><el-button @click="router.push('/customers')">客户管理</el-button><el-button @click="router.push('/products/categories')">分类管理</el-button></div>
          </section>

          <section class="dashboard-page dashboard-page--overview" aria-labelledby="overview-page-title">
            <div class="page-heading"><div><h2 id="overview-page-title">经营概览</h2><p>用两张图快速判断销售趋势与订单结构</p></div><span class="page-caption">数据分析</span></div>

            <div class="summary-grid">
              <div class="summary-card"><span>今日订单</span><strong>{{ stats.todayOrders || 0 }}</strong><small :class="orderChange.up ? 'is-positive' : 'is-negative'">{{ orderChange.up ? '▲' : '▼' }} 较昨日 {{ orderChange.pct }}%</small></div>
              <div class="summary-card"><span>今日销售额</span><strong>¥{{ fmt(stats.todayRevenue || 0) }}</strong><small :class="revenueChange.up ? 'is-positive' : 'is-negative'">{{ revenueChange.up ? '▲' : '▼' }} 较昨日 {{ revenueChange.pct }}%</small></div>
              <div class="summary-card"><span>本月销售额</span><strong>¥{{ fmt(stats.monthRevenue || 0) }}</strong><small>{{ stats.activeCustomers || 0 }} 个活跃客户</small></div>
            </div>

            <div class="overview-chart-grid">
              <div class="dashboard-card chart-card chart-card--primary">
                <div class="chart-head"><div><h3>近 7 日销售趋势</h3><p>按已支付订单统计销售额，面积图突出峰值变化</p></div><span class="chart-badge">主图</span></div>
                <div v-if="trendPlot.length" class="trend-content">
                  <div class="trend-summary"><div class="chart-kpi"><span>7日销售额</span><strong>¥{{ fmt(trendTotalRevenue) }}</strong></div><div class="chart-kpi"><span>订单数</span><strong>{{ trendTotalOrders }}</strong></div><div class="chart-kpi"><span>峰值日期</span><strong>{{ trendBestDay.label }}</strong></div></div>
                  <div class="trend-visual"><svg :viewBox="TREND_VIEW_BOX" class="trend-svg" role="img" aria-label="近7日销售趋势折线面积图"><defs><linearGradient id="dashTrendArea" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stop-color="#8d1c1c" stop-opacity="0.24"/><stop offset="70%" stop-color="#d99a9a" stop-opacity="0.08"/><stop offset="100%" stop-color="#8d1c1c" stop-opacity="0"/></linearGradient><linearGradient id="dashTrendStroke" x1="0" y1="0" x2="1" y2="0"><stop offset="0%" stop-color="#b86a51"/><stop offset="100%" stop-color="#8d1c1c"/></linearGradient></defs><g class="trend-grid"><line v-for="gridLine in TREND_GRID_LINES" :key="gridLine" x1="34" x2="606" :y1="gridLine" :y2="gridLine" /></g><path :d="trendAreaPath" class="trend-area"/><polyline :points="trendPolyline" class="trend-line"/><circle v-for="point in trendPlot" :key="point.date" :cx="point.plotX.toFixed(1)" :cy="point.plotY.toFixed(1)" :r="point.value === trendBestValue && point.value > 0 ? 6 : 4" class="trend-point" :class="{ 'is-peak': point.value === trendBestValue && point.value > 0 }"/></svg><div class="trend-labels"><span v-for="point in trendPlot" :key="point.date">{{ point.label }}</span></div></div>
                </div>
                <div v-else class="chart-empty">暂无数据</div>
              </div>

              <div class="dashboard-card chart-card chart-card--secondary">
                <div class="chart-head"><div><h3>订单状态分布</h3><p>暖色环图匹配运营台品牌色</p></div><span class="chart-badge chart-badge--soft">结构</span></div>
                <div v-if="donutSegments.length" class="donut-body"><div class="donut-figure"><svg :viewBox="DONUT_VIEW_BOX" class="donut-svg" role="img" aria-label="订单状态分布环形图"><circle cx="86" cy="86" r="58" fill="none" class="donut-track"/><circle v-for="segment in donutSegments" :key="segment.name" :cx="segment.centerX" :cy="segment.centerY" :r="segment.radius" fill="none" :stroke="segment.color" stroke-width="18" :stroke-dasharray="segment.dashArray" :stroke-dashoffset="segment.dashOffset" stroke-linecap="round" transform="rotate(-90 86 86)"/><text x="86" y="82" text-anchor="middle" class="donut-center">{{ donutTotal }}</text><text x="86" y="104" text-anchor="middle" class="donut-sub">全部订单</text></svg></div><div class="donut-side"><div v-if="donutLead" class="donut-insight"><span>当前主状态</span><strong>{{ donutLead.name }}</strong><em>{{ donutLead.percentage }}</em></div><div class="donut-legend"><span v-for="segment in donutSegments" :key="segment.name" class="legend-item"><span class="legend-name"><i :style="{ background: segment.color }"></i>{{ segment.name }}</span><strong>{{ segment.value }}<small>{{ segment.percentage }}</small></strong></span></div></div></div>
                <div v-else class="chart-empty">暂无数据</div>
              </div>
            </div>

            <div class="overview-bottom-grid">
              <div class="dashboard-card overview-card"><div class="section-head"><div><h3>热销商品</h3><p>按销售额排序，最多展示前 3 条</p></div><span class="section-note">TOP 3</span></div><div v-if="topProducts.length" class="top-list"><div v-for="(product, index) in topProducts" :key="product.id || product.name" class="top-item"><span class="top-rank" :class="'rank-' + (index + 1)">{{ index + 1 }}</span><span class="top-name">{{ product.name }}</span><span class="top-qty">×{{ product.quantity }}</span><span class="top-rev">¥{{ fmt(product.revenue || 0) }}</span></div></div><div v-else class="card-empty">暂无数据</div></div>
              <div class="dashboard-card overview-card"><div class="section-head"><div><h3>客户概况</h3><p>使用现有经营统计字段</p></div><span class="section-note">当前</span></div><div class="overview-metrics"><div v-for="item in customerOverview" :key="item.label" class="overview-metric"><span>{{ item.label }}</span><strong>{{ item.value }}</strong></div></div></div>
            </div>
          </section>
        </div>
      </div>
    </template>
  </section>
</template>

<style scoped>
.dashboard { max-width: 1420px; }
.dash-header { display: flex; align-items: flex-start; justify-content: space-between; gap: 22px; margin-bottom: 24px; }
.dash-actions { display: flex; align-items: center; gap: 10px; }
.dash-loading { padding: 100px 0; text-align: center; }
.dash-error { margin-bottom: 20px; }
.page-switcher { display: inline-flex; gap: 4px; padding: 4px; border: 1px solid #eadbd7; border-radius: 12px; background: rgba(255, 250, 249, .88); }
.page-tab { padding: 7px 12px; border: 0; border-radius: 9px; background: transparent; color: var(--brand-text-soft); cursor: pointer; font: inherit; font-size: 12px; }
.page-tab.is-active { background: var(--brand-primary); color: #fff; box-shadow: 0 6px 16px rgba(102, 10, 10, .16); }
.page-arrows { display: inline-flex; align-items: center; gap: 2px; color: var(--brand-muted); }
.page-index { min-width: 28px; color: var(--brand-text-soft); font-size: 11px; text-align: center; }
.dashboard-viewport { overflow: hidden; outline: none; touch-action: pan-y; }
.dashboard-viewport:focus-visible { border-radius: 16px; box-shadow: 0 0 0 3px rgba(141, 28, 28, .18); }
.dashboard-track { display: flex; width: 200%; transition: transform .28s ease; }
.dashboard-page { width: 50%; min-width: 0; padding: 2px 1px 4px; }
.page-heading { display: flex; align-items: flex-end; justify-content: space-between; gap: 18px; margin: 0 0 14px; }
.page-heading h2 { margin: 0; color: var(--brand-text); font-size: 20px; font-weight: 800; }
.page-heading p { margin: 5px 0 0; color: var(--brand-text-soft); font-size: 12px; }
.page-caption { padding: 5px 10px; border-radius: 999px; background: #fff0ed; color: var(--brand-primary); font-size: 11px; font-weight: 700; }
.summary-grid { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 14px; margin-bottom: 16px; }
.summary-card { min-height: 112px; padding: 18px; border: 1px solid #eadbd7; border-radius: 16px; background: rgba(255, 255, 255, .92); color: var(--brand-text); cursor: pointer; text-align: left; transition: transform .2s ease, box-shadow .2s ease, border-color .2s ease; }
.summary-card:hover, .task-card:hover, .low-stock-item:hover, .recent-order:hover { transform: translateY(-2px); border-color: #d9bdb7; box-shadow: 0 14px 30px rgba(102, 10, 10, .08); }
.summary-card span, .task-card > span { display: block; color: var(--brand-text-soft); font-size: 12px; font-weight: 650; }
.summary-card strong { display: block; margin-top: 9px; color: var(--brand-text); font-size: 28px; line-height: 1; font-weight: 800; }
.summary-card strong.is-warning { color: #a16207; }
.summary-card strong.is-primary { color: var(--brand-primary); }
.summary-card strong.is-danger { color: var(--brand-accent); }
.summary-card small { display: block; margin-top: 9px; color: var(--brand-muted); font-size: 11px; }
.summary-card small.is-positive { color: #2f855a; }
.summary-card small.is-negative { color: var(--brand-accent); }
.dashboard-card { border: 1px solid #eadbd7; border-radius: 16px; background: rgba(255, 255, 255, .94); box-shadow: 0 10px 26px rgba(102, 10, 10, .045); }
.task-grid { display: grid; grid-template-columns: minmax(0, 1.45fr) minmax(260px, .55fr); gap: 16px; margin-bottom: 16px; }
.inventory-card { min-height: 360px; padding: 20px; }
.section-head { display: flex; align-items: flex-start; justify-content: space-between; gap: 14px; margin-bottom: 14px; }
.section-head h3, .chart-head h3 { margin: 0; color: var(--brand-text); font-size: 15px; font-weight: 800; }
.section-head p, .chart-head p { margin: 5px 0 0; color: var(--brand-text-soft); font-size: 11px; line-height: 1.45; }
.section-note { flex: none; color: var(--brand-muted); font-size: 11px; }
.low-stock-list { display: flex; flex-direction: column; gap: 7px; }
.low-stock-item { display: grid; grid-template-columns: minmax(0, 1fr) 70px 84px; align-items: center; gap: 12px; width: 100%; padding: 9px 10px; border: 1px solid transparent; border-radius: 10px; background: #fbf4f2; cursor: pointer; text-align: left; transition: transform .2s ease, box-shadow .2s ease, border-color .2s ease; }
.low-stock-main { min-width: 0; }
.low-stock-main strong { display: block; overflow: hidden; color: var(--brand-text); font-size: 12px; font-weight: 750; text-overflow: ellipsis; white-space: nowrap; }
.low-stock-main small { display: block; margin-top: 3px; overflow: hidden; color: var(--brand-muted); font-size: 10px; text-overflow: ellipsis; white-space: nowrap; }
.low-stock-status { text-align: right; }
.low-stock-status b { display: block; color: var(--brand-text); font-size: 12px; font-weight: 750; }
.low-stock-status em { display: block; margin-top: 2px; font-size: 10px; font-style: normal; }
.low-stock-status.is-critical b, .low-stock-status.is-critical em, .low-stock-status.is-danger b, .low-stock-status.is-danger em { color: var(--brand-accent); }
.low-stock-status.is-warning em { color: #a16207; }
.view-all-link { display: flex; justify-content: flex-end; align-items: center; gap: 4px; width: 100%; margin-top: 12px; padding: 0; border: 0; background: transparent; color: var(--brand-primary); cursor: pointer; font: inherit; font-size: 11px; }
.view-all-link span { font-size: 14px; }
.task-side { display: grid; gap: 16px; }
.task-card { min-height: 172px; padding: 20px; color: var(--brand-text); cursor: pointer; text-align: left; transition: transform .2s ease, box-shadow .2s ease, border-color .2s ease; }
.task-card strong { display: block; margin-top: 16px; color: var(--brand-text); font-size: 30px; line-height: 1; font-weight: 800; }
.task-card small { display: block; margin-top: 8px; color: var(--brand-muted); font-size: 11px; }
.task-card em { display: inline-block; margin-top: 16px; color: var(--brand-primary); font-size: 11px; font-style: normal; }
.recent-strip { padding: 18px 20px; }
.recent-order-list { display: flex; flex-direction: column; gap: 6px; }
.recent-order { display: grid; grid-template-columns: 1.15fr 1fr auto auto; align-items: center; gap: 10px; width: 100%; padding: 9px 10px; border: 1px solid transparent; border-radius: 9px; background: #fbf4f2; color: var(--brand-text); cursor: pointer; font: inherit; font-size: 11px; text-align: left; transition: transform .2s ease, box-shadow .2s ease, border-color .2s ease; }
.recent-order span:nth-child(2) { overflow: hidden; color: var(--brand-text-soft); text-overflow: ellipsis; white-space: nowrap; }
.recent-order b { color: var(--brand-primary); font-size: 11px; font-weight: 750; }
.quick-actions { display: flex; flex-wrap: wrap; gap: 10px; padding: 16px 0 4px; }
.chart-head { display: flex; align-items: flex-start; justify-content: space-between; gap: 16px; margin-bottom: 14px; }
.overview-chart-grid { display: grid; grid-template-columns: minmax(0, 1.3fr) minmax(340px, .7fr); gap: 16px; margin-bottom: 16px; }
.chart-card { min-height: 356px; padding: 20px; overflow: hidden; }
.chart-card--primary { background: linear-gradient(180deg, rgba(255, 255, 255, .98), rgba(255, 250, 249, .94)); }
.chart-card--secondary { background: radial-gradient(circle at 88% 14%, rgba(217, 154, 154, .18), transparent 34%), rgba(255, 255, 255, .96); }
.chart-badge { flex: none; padding: 5px 10px; border-radius: 999px; background: #fff0ed; color: var(--brand-primary); font-size: 11px; font-weight: 750; }
.chart-badge--soft { background: #f7efed; color: #8f7a70; }
.trend-content { display: flex; flex: 1; flex-direction: column; min-height: 0; }
.trend-summary { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 10px; margin-bottom: 12px; }
.chart-kpi { padding: 10px 12px; border: 1px solid #f0e4e2; border-radius: 14px; background: #fffaf9; }
.chart-kpi span { display: block; margin-bottom: 4px; color: var(--brand-text-soft); font-size: 11px; }
.chart-kpi strong { color: var(--brand-text); font-size: 16px; line-height: 1.2; }
.trend-visual { display: flex; flex: 1; flex-direction: column; justify-content: flex-end; min-height: 228px; }
.trend-svg { width: 100%; height: 220px; display: block; }
.trend-grid line { stroke: #f1e6e4; stroke-width: 1; stroke-dasharray: 5 7; }
.trend-area { fill: url(#dashTrendArea); }
.trend-line { fill: none; stroke: url(#dashTrendStroke); stroke-width: 4; stroke-linecap: round; stroke-linejoin: round; }
.trend-point { fill: #fff; stroke: #8d1c1c; stroke-width: 3; filter: drop-shadow(0 4px 8px rgba(102, 10, 10, .16)); }
.trend-point.is-peak { fill: #8d1c1c; stroke: #fff; stroke-width: 3.5; }
.trend-labels { display: flex; justify-content: space-between; padding: 4px 34px 0; color: var(--brand-muted); font-size: 10px; }
.donut-body { display: grid; grid-template-columns: minmax(176px, 224px) minmax(0, 1fr); gap: 18px; flex: 1; align-items: center; }
.donut-figure { display: flex; align-items: center; justify-content: center; min-height: 224px; border-radius: 22px; background: linear-gradient(145deg, #fffaf9, #f8efed); }
.donut-svg { width: min(100%, 212px); height: auto; display: block; }
.donut-track { stroke: #f0e7e4; stroke-width: 18; }
.donut-center { fill: var(--brand-text); font-size: 30px; font-weight: 850; }
.donut-sub { fill: var(--brand-text-soft); font-size: 12px; font-weight: 650; }
.donut-side { min-width: 0; }
.donut-insight { margin-bottom: 14px; padding: 13px 14px; border: 1px solid #f0e4e2; border-radius: 16px; background: rgba(255, 250, 249, .86); }
.donut-insight span { display: block; margin-bottom: 5px; color: var(--brand-text-soft); font-size: 11px; }
.donut-insight strong { display: block; color: var(--brand-text); font-size: 18px; line-height: 1.2; }
.donut-insight em { display: inline-block; margin-top: 6px; color: var(--brand-primary); font-size: 12px; font-style: normal; font-weight: 750; }
.donut-legend { display: flex; flex-direction: column; gap: 8px; }
.legend-item { display: flex; align-items: center; justify-content: space-between; gap: 10px; color: var(--brand-text-soft); font-size: 12px; }
.legend-name { display: inline-flex; align-items: center; min-width: 0; gap: 7px; }
.legend-name i { width: 9px; height: 9px; display: inline-block; border-radius: 999px; box-shadow: 0 0 0 4px rgba(141, 28, 28, .06); }
.legend-item strong { display: inline-flex; align-items: baseline; gap: 6px; color: var(--brand-text); font-size: 13px; }
.legend-item small { color: var(--brand-muted); font-size: 10px; font-weight: 650; }
.overview-bottom-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 16px; }
.overview-card { min-height: 190px; padding: 18px 20px; }
.top-list { display: flex; flex-direction: column; gap: 7px; }
.top-item { display: flex; align-items: center; gap: 10px; padding: 6px 0; font-size: 13px; }
.top-rank { width: 24px; height: 24px; display: flex; align-items: center; justify-content: center; border-radius: 9px; background: #f4e9e7; color: var(--brand-primary); font-size: 11px; font-weight: 800; }
.rank-1 { background: #fff0ed; color: var(--brand-primary); }
.rank-2 { background: #fff5df; color: #a16207; }
.rank-3 { background: #eef2f8; color: #64748b; }
.top-name { flex: 1; color: var(--brand-text); }
.top-qty { color: var(--brand-text-soft); font-size: 12px; }
.top-rev { color: var(--brand-primary); font-weight: 750; }
.overview-metrics { display: grid; grid-template-columns: repeat(3, 1fr); gap: 10px; margin-top: 24px; }
.overview-metric { padding: 14px 12px; border-radius: 12px; background: #fbf4f2; text-align: center; }
.overview-metric span { display: block; color: var(--brand-muted); font-size: 11px; }
.overview-metric strong { display: block; margin-top: 8px; color: var(--brand-text); font-size: 22px; font-weight: 800; }
.chart-empty, .card-empty { padding: 38px 0; color: var(--brand-muted); font-size: 13px; text-align: center; }
@media (max-width: 1180px) { .dash-actions { flex-wrap: wrap; justify-content: flex-end; } .task-grid, .overview-chart-grid { grid-template-columns: 1fr; } .task-side { grid-template-columns: repeat(2, minmax(0, 1fr)); } }
@media (max-width: 760px) { .dash-header { display: block; } .dash-actions { justify-content: flex-start; margin-top: 14px; } .overview-bottom-grid { grid-template-columns: 1fr; } .low-stock-item { grid-template-columns: minmax(0, 1fr) 70px; } .low-stock-item :deep(.el-progress) { grid-column: 1 / -1; } }
@media (max-width: 640px) { .summary-grid { grid-template-columns: repeat(2, minmax(0, 1fr)); } .summary-card { min-height: 106px; padding: 15px; } .summary-card strong { font-size: 24px; } .task-side { grid-template-columns: 1fr; } .trend-summary, .donut-body { grid-template-columns: 1fr; } .donut-figure { min-height: 200px; } .recent-order { grid-template-columns: 1fr auto; } .recent-order span:nth-child(2), .recent-order b { display: none; } .page-switcher { max-width: 100%; } .page-tab { padding-inline: 9px; } }
@media (prefers-reduced-motion: reduce) { .dashboard-track, .summary-card, .task-card, .low-stock-item, .recent-order { transition: none; } }
</style>
