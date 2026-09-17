# Product Safe Delete Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add authenticated single-product and batch-product safe deletion that archives products, removes them from the admin list and mini program, and preserves all historical relations.

**Architecture:** Reuse the existing `ProductStatus.archived` value and current list filters instead of physically deleting rows. Add dedicated backend archive methods and routes, then expose them through the admin API and add single/batch confirmation flows in the product list. All implementation follows TDD with focused backend and UI contract tests.

**Tech Stack:** NestJS, Prisma, class-validator, Jest, Supertest, Vue 3, Element Plus, Axios, Node.js test runner.

---

### Task 1: Implement ProductService safe archive behavior

**Files:**
- Create: `backend/test/product-safe-delete.spec.ts`
- Modify: `backend/src/product/product.service.ts:148`

- [ ] **Step 1: Write the failing service tests**

Create `backend/test/product-safe-delete.spec.ts`:

```ts
import { BadRequestException, NotFoundException } from '@nestjs/common'
import { ProductService } from '../src/product/product.service'

describe('ProductService safe delete', () => {
  it('archives an existing product', async () => {
    const findUnique = jest.fn().mockResolvedValue({ id: 17, status: 'active' })
    const update = jest.fn().mockResolvedValue({ id: 17, status: 'archived' })
    const service = new ProductService({ product: { findUnique, update } } as any, {} as any, {} as any)

    await expect(service.archiveProduct(17)).resolves.toEqual({ id: 17, status: 'archived' })
    expect(update).toHaveBeenCalledWith({
      where: { id: 17 },
      data: { status: 'archived' },
      select: { id: true, status: true }
    })
  })

  it('treats an already archived product as a successful idempotent delete', async () => {
    const findUnique = jest.fn().mockResolvedValue({ id: 17, status: 'archived' })
    const update = jest.fn()
    const service = new ProductService({ product: { findUnique, update } } as any, {} as any, {} as any)

    await expect(service.archiveProduct(17)).resolves.toEqual({ id: 17, status: 'archived' })
    expect(update).not.toHaveBeenCalled()
  })

  it('rejects deleting a missing product', async () => {
    const findUnique = jest.fn().mockResolvedValue(null)
    const service = new ProductService({ product: { findUnique } } as any, {} as any, {} as any)

    await expect(service.archiveProduct(999)).rejects.toBeInstanceOf(NotFoundException)
  })

  it('deduplicates IDs and archives products in one update', async () => {
    const updateMany = jest.fn().mockResolvedValue({ count: 2 })
    const service = new ProductService({ product: { updateMany } } as any, {} as any, {} as any)

    await expect(service.batchArchiveProducts([3, 3, 7])).resolves.toEqual({
      productIds: [3, 7],
      status: 'archived',
      updatedCount: 2
    })
    expect(updateMany).toHaveBeenCalledWith({
      where: { id: { in: [3, 7] }, status: { not: 'archived' } },
      data: { status: 'archived' }
    })
  })

  it.each([[], [0], [-1], [1.5]])('rejects invalid archive IDs: %p', async (productIds) => {
    const service = new ProductService({} as any, {} as any, {} as any)

    await expect(service.batchArchiveProducts(productIds)).rejects.toBeInstanceOf(BadRequestException)
  })
})
```

- [ ] **Step 2: Run the service test and verify RED**

Run:

```powershell
cd backend
npm test -- --runTestsByPath test/product-safe-delete.spec.ts
```

Expected: FAIL because `archiveProduct` and `batchArchiveProducts` do not exist.

- [ ] **Step 3: Implement the minimal service methods**

Add to `ProductService` near the current status update methods:

```ts
  async archiveProduct(id: number) {
    if (!Number.isInteger(id) || id <= 0) {
      throw new BadRequestException({ message: '请选择有效商品', errorCode: 'PRO_1004' })
    }

    const product = await this.prisma.product.findUnique({
      where: { id },
      select: { id: true, status: true }
    })
    if (!product) {
      throw new NotFoundException({ message: '商品不存在', errorCode: 'PRO_1001' })
    }
    if (product.status === 'archived') return product

    return this.prisma.product.update({
      where: { id },
      data: { status: 'archived' },
      select: { id: true, status: true }
    })
  }

  async batchArchiveProducts(productIds: number[]) {
    if (!productIds.length || productIds.some(id => !Number.isInteger(id) || id <= 0)) {
      throw new BadRequestException({ message: '请选择有效商品', errorCode: 'PRO_1004' })
    }

    const uniqueProductIds = [...new Set(productIds)]
    const result = await this.prisma.product.updateMany({
      where: { id: { in: uniqueProductIds }, status: { not: 'archived' } },
      data: { status: 'archived' }
    })
    return {
      productIds: uniqueProductIds,
      status: 'archived',
      updatedCount: result.count
    }
  }
```

- [ ] **Step 4: Run the service test and verify GREEN**

Run:

```powershell
cd backend
npm test -- --runTestsByPath test/product-safe-delete.spec.ts
```

Expected: PASS with 5 safe-delete tests.

### Task 2: Add authenticated archive DTOs and HTTP routes

**Files:**
- Modify: `backend/src/product/dto/create-product.dto.ts:134`
- Modify: `backend/src/product/product.controller.ts:4`
- Modify: `backend/test/product.contract.spec.ts:18`

- [ ] **Step 1: Add failing HTTP contract tests**

Extend the `mockProduct` object in `backend/test/product.contract.spec.ts`:

```ts
    archiveProduct: jest.fn().mockResolvedValue({ id: 1, status: 'archived' }),
    batchArchiveProducts: jest.fn().mockResolvedValue({ productIds: [1, 2], status: 'archived', updatedCount: 2 }),
```

Add the following tests after the batch-status contract test:

```ts
  it('DELETE /api/v1/products/:id safely archives one product', async () => {
    const res = await request(app.getHttpServer())
      .delete('/api/v1/products/1')
      .set('Authorization', 'Bearer mock-token')
      .expect(200)

    expect(mockProduct.archiveProduct).toHaveBeenCalledWith(1)
    expect(res.body.data).toEqual({ id: 1, status: 'archived' })
  })

  it('PATCH /api/v1/products/batch-archive safely archives selected products', async () => {
    const res = await request(app.getHttpServer())
      .patch('/api/v1/products/batch-archive')
      .set('Authorization', 'Bearer mock-token')
      .send({ productIds: [1, 2] })
      .expect(200)

    expect(mockProduct.batchArchiveProducts).toHaveBeenCalledWith([1, 2])
    expect(res.body.data.updatedCount).toBe(2)
  })
```

- [ ] **Step 2: Run the contract test and verify RED**

Run:

```powershell
cd backend
npm test -- --runTestsByPath test/product.contract.spec.ts
```

Expected: FAIL with missing `DELETE /products/:id` and `PATCH /products/batch-archive` routes.

- [ ] **Step 3: Add the batch archive DTO**

Append to `backend/src/product/dto/create-product.dto.ts`:

```ts
export class BatchArchiveProductsDto {
  @ApiProperty({ type: [Number], example: [1, 2, 3] })
  @IsArray()
  @ArrayNotEmpty()
  @IsInt({ each: true })
  @Min(1, { each: true })
  productIds: number[]
}
```

Do not add `ArrayUnique`; the service intentionally accepts duplicate IDs and deduplicates them.

- [ ] **Step 4: Add the authenticated controller routes**

Update the DTO import in `backend/src/product/product.controller.ts`:

```ts
import { BatchArchiveProductsDto, BatchUpdateProductStatusDto, CreateProductDto, UpdateProductDto, UpdateProductStatusDto } from './dto/create-product.dto'
```

Add the static batch route near the existing batch-status route:

```ts
  @Patch('products/batch-archive')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: '批量安全删除商品' })
  async batchArchiveProducts(@Body() dto: BatchArchiveProductsDto) {
    return this.product.batchArchiveProducts(dto.productIds)
  }
```

Add the single delete route near the existing single-product status route:

```ts
  @Delete('products/:id')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: '安全删除商品' })
  async archiveProduct(@Param('id', ParseIntPipe) id: number) {
    return this.product.archiveProduct(id)
  }
```

- [ ] **Step 5: Run service and contract tests**

Run:

```powershell
cd backend
npm test -- --runTestsByPath test/product-safe-delete.spec.ts test/product.contract.spec.ts
```

Expected: PASS for all service and HTTP contract tests.

### Task 3: Add admin API methods and safe-delete controls

**Files:**
- Create: `tests/product-safe-delete-ui-contract.test.js`
- Modify: `admin-web/src/api/product.ts:23`
- Modify: `admin-web/src/views/product/ProductListView.vue:1`

- [ ] **Step 1: Write the failing admin contract tests**

Create `tests/product-safe-delete-ui-contract.test.js`:

```js
const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')

const root = path.resolve(__dirname, '..')
const read = (relativePath) => fs.readFileSync(path.join(root, relativePath), 'utf8')

test('商品 API 暴露单个和批量安全删除方法', () => {
  const api = read('admin-web/src/api/product.ts')

  assert.match(api, /export function deleteProduct/)
  assert.match(api, /http\.delete\(`\/products\/\$\{id\}`\)/)
  assert.match(api, /export function batchArchiveProducts/)
  assert.match(api, /patch\('\/products\/batch-archive'/)
})

test('商品列表支持单个和批量安全删除', () => {
  const view = read('admin-web/src/views/product/ProductListView.vue')

  assert.match(view, /async function handleDelete/)
  assert.match(view, /async function handleBatchDelete/)
  assert.match(view, /批量删除/)
  assert.match(view, /@click="handleDelete\(row\)"/)
  assert.match(view, /batchArchiveProducts/)
})

test('批量下架只提交选中的已上架商品', () => {
  const view = read('admin-web/src/views/product/ProductListView.vue')

  assert.match(view, /selectedRows\.value\.filter\(row => row\.status === 'active'\)/)
  assert.doesNotMatch(view, /:selectable="isRowSelectable"/)
})
```

- [ ] **Step 2: Run the UI contract test and verify RED**

Run:

```powershell
node --test tests/product-safe-delete-ui-contract.test.js
```

Expected: FAIL because the API functions and UI handlers do not exist.

- [ ] **Step 3: Add the admin API methods**

Add to `admin-web/src/api/product.ts`:

```ts
export function deleteProduct(id: number) {
  return http.delete(`/products/${id}`)
}

export function batchArchiveProducts(productIds: number[]) {
  return http.patch('/products/batch-archive', { productIds })
}
```

- [ ] **Step 4: Add selection state and delete handlers**

Update the Vue imports:

```ts
import { computed, onMounted, reactive, ref } from 'vue'
import { batchArchiveProducts, batchUpdateProductStatus, deleteProduct, getBrands, getCategories, getProducts, updateProductStatus } from '../../api/product'
```

Add state and derived selection counts:

```ts
const batchDeleteLoading = ref(false)
const selectedActiveRows = computed(() => selectedRows.value.filter(row => row.status === 'active'))
```

Change `batchDisable` to use only active rows:

```ts
async function batchDisable() {
  const productIds = selectedRows.value.filter(row => row.status === 'active').map(row => row.id)
  if (!productIds.length) return
  // Keep the existing confirmation, API call, success message and loading cleanup.
}
```

Add a pagination-safe refresh helper and delete handlers:

```ts
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
```

Remove `isRowSelectable`, allowing both active and disabled products to be selected.

- [ ] **Step 5: Add the batch and row action controls**

Update the batch toolbar:

```vue
<div class="batch-toolbar">
  <el-button type="danger" plain :disabled="!selectedActiveRows.length" :loading="batchLoading" @click="batchDisable">批量下架</el-button>
  <el-button type="danger" :disabled="!selectedRows.length" :loading="batchDeleteLoading" @click="handleBatchDelete">批量删除</el-button>
  <span>已选择 {{ selectedRows.length }} 件商品，其中 {{ selectedActiveRows.length }} 件已上架</span>
</div>
```

Allow selection of every displayed row:

```vue
<el-table-column type="selection" width="48" />
```

Increase the action column width and add the row delete action:

```vue
<el-table-column label="操作" width="240">
  <template #default="{ row }">
    <el-button link type="primary" @click="router.push(`/products/${row.id}/edit`)">编辑 / 规格</el-button>
    <el-button link :type="row.status === 'active' ? 'warning' : 'success'" @click="toggle(row)">{{ row.status === 'active' ? '下架' : '上架' }}</el-button>
    <el-button link type="danger" @click="handleDelete(row)">删除</el-button>
  </template>
</el-table-column>
```

- [ ] **Step 6: Run the UI contract tests and verify GREEN**

Run:

```powershell
node --test tests/product-batch-off-shelf-ui-contract.test.js tests/product-safe-delete-ui-contract.test.js
```

Expected: PASS for existing batch-off-shelf behavior and new delete behavior.

### Task 4: Run full verification

**Files:**
- Verify only; no additional files expected.

- [ ] **Step 1: Run focused backend tests**

```powershell
cd backend
npm test -- --runTestsByPath test/product-safe-delete.spec.ts test/product-batch-status.spec.ts test/product.contract.spec.ts
```

Expected: all focused backend tests PASS.

- [ ] **Step 2: Run backend static verification**

```powershell
cd backend
npm run typecheck
npm run build
```

Expected: both commands exit with code `0`.

- [ ] **Step 3: Run admin static verification**

```powershell
cd admin-web
npm run typecheck
npm run build
```

Expected: both commands exit with code `0`.

- [ ] **Step 4: Run all root contract tests**

```powershell
$testFiles = Get-ChildItem -LiteralPath 'tests' -Filter '*.test.js' -File | Sort-Object Name | Select-Object -ExpandProperty FullName
node --test $testFiles
```

Expected: all mini program and admin contract tests PASS.

- [ ] **Step 5: Verify the acceptance checklist**

- Single delete uses `DELETE /products/:id` and archives instead of physically deleting.
- Batch delete deduplicates IDs and archives in one database update.
- Active and disabled products can both be selected for deletion.
- Batch off-shelf only submits selected active products.
- Archived products remain excluded by existing admin and mini program queries.
- No Prisma migration or relation deletion is introduced.
