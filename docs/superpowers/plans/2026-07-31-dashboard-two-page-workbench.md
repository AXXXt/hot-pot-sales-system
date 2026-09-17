# 双页面横向工作台实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 将管理端首页工作台从单页瀑布流改造成“待办工作台 / 经营概览”双页面横向切换布局。

**Architecture:** 保留现有 `getDashboardStats()` 数据加载和图表几何计算，仅在管理端工作台增加页面状态、顶部 tab、左右切换和横向滑动容器。将库存预警前 5 条的排序与截断提取为纯函数，避免把业务排序逻辑埋在 Vue 模板中；完整预警数量继续使用后端返回的 `inventoryWarnings`，全部数据通过商品管理入口查看。

**Tech Stack:** Vue 3 `<script setup lang="ts">`、TypeScript、Element Plus、scoped CSS、Vitest、Vite。

---

## 文件边界

- Create: `C:\Users\26381\Desktop\miniprogram\admin-web\src\views\dashboard\dashboard-presenters.ts` — 工作台展示层的低库存排序与前 5 条截断函数。
- Create: `C:\Users\26381\Desktop\miniprogram\admin-web\src\views\dashboard\dashboard-presenters.test.ts` — 低库存展示排序和截断的单元测试。
- Modify: `C:\Users\26381\Desktop\miniprogram\admin-web\src\views\dashboard\DashboardView.vue` — 双页面状态、tab/箭头/手势交互、页面模板和样式。
- Reuse: `C:\Users\26381\Desktop\miniprogram\admin-web\src\views\dashboard\chart-geometry.ts` — 保留现有趋势图和环图几何计算，不改接口和统计口径。
- Verify: `C:\Users\26381\Desktop\miniprogram\docs\superpowers\specs\2026-07-31-dashboard-two-page-workbench-design.md` — 以已确认设计说明作为验收依据。

本次不修改后端文件、数据库 schema、路由定义和商品管理页。

## Task 1: 增加库存预警展示辅助函数

**Files:**
- Create: `C:\Users\26381\Desktop\miniprogram\admin-web\src\views\dashboard\dashboard-presenters.ts`
- Test: `C:\Users\26381\Desktop\miniprogram\admin-web\src\views\dashboard\dashboard-presenters.test.ts`

- [ ] **Step 1: Write the failing unit tests**

覆盖三个可观察行为：

```ts
import { describe, expect, it } from 'vitest'
import { getTopLowStockItems } from './dashboard-presenters'

describe('dashboard presenters', () => {
  it('puts zero-stock items before other low-stock items', () => {
    const result = getTopLowStockItems([
      { id: 1, productId: 1, skuName: '库存 4', availableQty: 4, warningQty: 10 },
      { id: 2, productId: 2, skuName: '库存 0', availableQty: 0, warningQty: 10 },
      { id: 3, productId: 3, skuName: '库存 2', availableQty: 2, warningQty: 10 }
    ])

    expect(result.map((item) => item.skuName)).toEqual(['库存 0', '库存 2', '库存 4'])
  })

  it('sorts by stock-to-warning ratio, then available quantity', () => {
    const result = getTopLowStockItems([
      { id: 1, productId: 1, skuName: '比例 50%', availableQty: 5, warningQty: 10 },
      { id: 2, productId: 2, skuName: '比例 20%', availableQty: 2, warningQty: 10 },
      { id: 3, productId: 3, skuName: '比例 10%', availableQty: 1, warningQty: 10 },
      { id: 4, productId: 4, skuName: '同类更低', availableQty: 1, warningQty: 5 }
    ])

    expect(result.map((item) => item.skuName)).toEqual(['比例 10%', '同类更低', '比例 20%', '比例 50%'])
  })

  it('returns at most five items without mutating the source list', () => {
    const source = Array.from({ length: 7 }, (_, index) => ({
      id: index,
      productId: index,
      skuName: `SKU ${index}`,
      availableQty: index,
      warningQty: 10
    }))

    const result = getTopLowStockItems(source)

    expect(result).toHaveLength(5)
    expect(source).toHaveLength(7)
  })
})
```

- [ ] **Step 2: Run the focused test and verify it fails**

Run from `C:\Users\26381\Desktop\miniprogram\admin-web`:

```powershell
npm run test:unit -- src/views/dashboard/dashboard-presenters.test.ts
```

Expected: FAIL because `dashboard-presenters.ts` does not exist yet.

- [ ] **Step 3: Implement the minimal presenter function**

Add a typed item shape and a non-mutating sort/slice implementation:

```ts
export interface DashboardLowStockItem {
  id: number | string
  productId: number | string
  skuName: string
  warehouse?: string | null
  availableQty?: number | string | null
  warningQty?: number | string | null
}

function toFiniteNumber(value: unknown): number {
  const amount = Number(value)
  return Number.isFinite(amount) ? amount : 0
}

function riskRatio(item: DashboardLowStockItem): number {
  const availableQty = toFiniteNumber(item.availableQty)
  const warningQty = toFiniteNumber(item.warningQty)
  if (warningQty <= 0) return availableQty > 0 ? 1 : 0
  return availableQty / warningQty
}

export function getTopLowStockItems(
  items: DashboardLowStockItem[] | null | undefined,
  limit = 5
): DashboardLowStockItem[] {
  return [...(items || [])]
    .map((item, index) => ({ item, index }))
    .sort((left, right) => {
      const ratioDifference = riskRatio(left.item) - riskRatio(right.item)
      if (ratioDifference !== 0) return ratioDifference

      const quantityDifference = toFiniteNumber(left.item.availableQty) - toFiniteNumber(right.item.availableQty)
      if (quantityDifference !== 0) return quantityDifference

      return left.index - right.index
    })
    .slice(0, Math.max(0, limit))
    .map(({ item }) => item)
}
```

- [ ] **Step 4: Run the focused test and verify it passes**

Run:

```powershell
npm run test:unit -- src/views/dashboard/dashboard-presenters.test.ts
```

Expected: 3 tests passed.

## Task 2: Add two-page state and navigation behavior

**Files:**
- Modify: `C:\Users\26381\Desktop\miniprogram\admin-web\src\views\dashboard\DashboardView.vue:1-95`

- [ ] **Step 1: Add page state and presenter import**

Import `computed` as already used and add `getTopLowStockItems` plus `DashboardLowStockItem`. Define:

```ts
type DashboardPage = 'tasks' | 'overview'
const activePage = ref<DashboardPage>('tasks')
const swipeStart = ref<{ x: number; y: number } | null>(null)
const activePageIndex = computed(() => activePage.value === 'tasks' ? 0 : 1)
const topLowStockItems = computed(() => getTopLowStockItems(stats.value?.lowStockItems, 5))
const pageTitle = computed(() => activePage.value === 'tasks' ? '今日待办' : '经营概览')
const pageSubtitle = computed(() => activePage.value === 'tasks' ? '优先处理高风险事项，再查看经营表现' : '用销售趋势和订单结构快速判断经营表现')
```

- [ ] **Step 2: Add explicit page switching helpers**

Implement a single source of truth for tab, arrows, and keyboard navigation:

```ts
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
```

Use a 48px threshold so normal clicks on cards do not trigger a page change. Keep vertical scrolling available with `touch-action: pan-y` on the viewport.

- [ ] **Step 3: Keep existing data and navigation functions intact**

Retain `fetchStats`, `statusTag`, `statusText`, the trend computed values, donut computed values, `fmt`, and existing router destinations. Add only the new page-state functions and `topLowStockItems` presenter computed value; do not re-query or recalculate backend totals in the browser.

## Task 3: Replace the single-flow template with two focused pages

**Files:**
- Modify: `C:\Users\26381\Desktop\miniprogram\admin-web\src\views\dashboard\DashboardView.vue:97-249`

- [ ] **Step 1: Update the dashboard header and page controls**

Change the internal heading to use `pageTitle` and `pageSubtitle`. Add a tablist with two buttons and left/right buttons. Each tab must set `aria-selected` from `activePage`, and each arrow must have an explicit Chinese `aria-label`.

The header keeps the existing refresh button and its loading state.

- [ ] **Step 2: Add the horizontal page viewport**

Wrap the loaded `stats` content in a viewport and track:

```vue
<div
  class="dashboard-viewport"
  tabindex="0"
  @keydown="handlePageKeydown"
  @pointerdown="handlePointerDown"
  @pointerup="handlePointerUp"
  @pointercancel="clearPointerStart"
>
  <div class="dashboard-track" :style="{ transform: `translateX(-${activePageIndex * 50}%)` }">
    <section class="dashboard-page dashboard-page--tasks" aria-labelledby="tasks-page-title">
      <!-- task page -->
    </section>
    <section class="dashboard-page dashboard-page--overview" aria-labelledby="overview-page-title">
      <!-- overview page -->
    </section>
  </div>
</div>
```

Use a CSS transition on `transform` for the 240–300ms slide and respect `prefers-reduced-motion`.

- [ ] **Step 3: Build the task page content**

Render:

- Three equal summary cards for `stats.pendingOrders`, `stats.pendingShipments || 0`, and `stats.inventoryWarnings || 0`.
- A primary `高风险库存` card showing `topLowStockItems`, with each row linking to `/products/{productId}/edit`.
- The full count in the card header/footer: `仅展示前 5 条` and `查看全部 {{ stats.inventoryWarnings || 0 }} 个` linking to `/products`.
- Two compact order task cards linking to `/orders`.
- A compact recent-order strip showing at most the first three `stats.recentOrders` entries; keep the existing status text mapping and detail route for any visible order.
- The existing quick actions for new product, customer management, and category management as a compact bottom action row.

When `topLowStockItems` is empty, show `暂无预警` and retain the `查看商品管理` action. Do not render a full inventory table on the task page.

- [ ] **Step 4: Build the overview page content**

Render:

- Three equal summary cards for today orders, today revenue, and month revenue.
- The existing trend chart and its three small chart KPIs in the wider card.
- The existing donut chart and legend in the narrower card.
- A compact top-products list limited to the first three existing `stats.topProducts` rows.
- A compact customer overview using only existing fields: active customers, total customers, and active products.
- Keep chart empty states when the corresponding computed arrays are empty.

Do not add new customer metrics or hard-coded fake values.

- [ ] **Step 5: Remove the old duplicated content flow**

After both pages render the required modules, remove the old top-level six-card metric grid, the old single chart row, the old full low-stock card, and the full recent-orders table from the loaded content path. This prevents the old waterfall layout from remaining below the new pages.

## Task 4: Adjust layout, chart proportions, and responsive styles

**Files:**
- Modify: `C:\Users\26381\Desktop\miniprogram\admin-web\src\views\dashboard\DashboardView.vue:251-336`

- [ ] **Step 1: Add page shell styles**

Add styles for `.dashboard-viewport`, `.dashboard-track`, `.dashboard-page`, `.page-switcher`, `.page-tab`, `.page-arrow`, `.task-page-grid`, `.overview-chart-row`, and compact summary/list modules.

The page track is two equal-width panels; the task-page main grid uses approximately `2fr 1fr`; the overview chart row uses approximately `1.3fr .7fr` so the trend remains the primary visual.

- [ ] **Step 2: Reuse and scope existing chart styles**

Keep the existing warm palette, trend geometry, donut geometry, badges, legend styles, and empty states. Adjust only container height, padding, and grid proportions so the overview fits without the previous long vertical flow.

Keep the current semantic colors: wine red for primary/risk emphasis, warm gold for pending states, and green for positive changes.

- [ ] **Step 3: Add responsive behavior**

At widths below 1180px, stack the task page columns and overview chart cards. At widths below 640px, reduce summary cards to two columns and allow the page tabs to wrap without clipping. The page track must not create an extra horizontal scrollbar; only the viewport itself handles the page transform.

Add:

```css
.dashboard-viewport { overflow: hidden; touch-action: pan-y; outline: none; }
.dashboard-track { display: flex; width: 200%; transition: transform .28s ease; }
.dashboard-page { width: 50%; min-width: 0; }
@media (prefers-reduced-motion: reduce) {
  .dashboard-track { transition: none; }
}
```

- [ ] **Step 4: Remove obsolete waterfall-only rules**

Delete or replace the six-column metric grid, full-width orders table spacing, and styles that assume `info-row` and `orders-card` are always rendered below the charts. Do not remove shared styles still used by the new task or overview pages.

## Task 5: Verify behavior and build output

**Files:**
- Test: `C:\Users\26381\Desktop\miniprogram\admin-web\src\views\dashboard\dashboard-presenters.test.ts`
- Verify: `C:\Users\26381\Desktop\miniprogram\admin-web\src\views\dashboard\DashboardView.vue`

- [ ] **Step 1: Run focused presenter tests**

Run:

```powershell
npm run test:unit -- src/views/dashboard/dashboard-presenters.test.ts
```

Expected: 3 tests passed.

- [ ] **Step 2: Run all frontend unit tests**

Run:

```powershell
npm run test:unit
```

Expected: all existing tests plus the new presenter tests pass.

- [ ] **Step 3: Run type checking and lint**

Run:

```powershell
npm run typecheck
npm run lint
```

Expected: typecheck exits 0 and lint reports 0 errors. Existing warnings, if any, must not increase because of this change.

- [ ] **Step 4: Run the production build**

Run:

```powershell
npm run build
```

Expected: Vite production build exits 0 and emits the admin-web bundle.

- [ ] **Step 5: Perform manual acceptance checks**

With the admin web page open:

1. Default page is `待办工作台`.
2. The header tabs, arrows, and left/right swipe switch between pages.
3. The task page shows exactly three summary cards and no more than five inventory rows.
4. `查看全部 N 个` routes to `/products`; a row routes to its product edit page.
5. The overview page shows three business KPIs, a wider trend chart, and a narrower donut chart.
6. Refreshing data keeps the current page and loading state remains visible on the refresh button.
7. Narrow viewport does not clip text or create an unrelated horizontal scrollbar.

No git commit is created in this session; the working tree is left ready for review.
