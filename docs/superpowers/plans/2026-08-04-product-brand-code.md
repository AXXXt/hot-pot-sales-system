# Product Brand Management and Automatic Code Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add managed brands, backend-authoritative product naming and coding, per-category global historical sequences, safe brand/category deletion, and correct product-code display/search.

**Architecture:** Keep product identity generation authoritative in the NestJS backend. Use a pure pinyin/formatting utility plus an atomic `ProductCategory.productSequence` counter inside Prisma interactive transactions; expose separate authenticated brand-management endpoints while preserving the existing public active-brand endpoint. The Vue admin consumes these APIs, treats product name/code as generated read-only values, and keeps existing mini-program read paths compatible.

**Tech Stack:** NestJS 11, Prisma 6, MySQL, `pinyin-pro`, Jest, Supertest, Vue 3, Element Plus, Axios, Node.js test runner.

**Execution note:** The workspace does not expose usable Git repository metadata and the user did not request commits, so commit steps are intentionally omitted.

---

## File Map

**Create:**

- `backend/src/product/product-code.ts` — pure pinyin normalization, sequence formatting, and product-code construction.
- `backend/src/brand/dto/brand.dto.ts` — brand-management request validation.
- `backend/src/brand/brand.service.ts` — brand CRUD, safe deletion, restore, and product-name synchronization.
- `backend/src/brand/brand.controller.ts` — authenticated `/admin/brands` endpoints.
- `backend/src/brand/brand.module.ts` — brand module wiring.
- `backend/prisma/migrations/20260804150000_product_brand_code/migration.sql` — category sequence field and counter backfill.
- `backend/prisma/backfill-brand-codes.ts` — deterministic legacy brand-code normalization with conflict detection.
- `backend/test/product-code.spec.ts` — pure naming/code utility tests.
- `backend/test/product-brand-code-schema.spec.ts` — schema and migration contract tests.
- `backend/test/brand-management.spec.ts` — brand service behavior tests.
- `backend/test/brand.contract.spec.ts` — brand HTTP contract tests.
- `backend/test/product-generated-code.spec.ts` — product create/update identity tests.
- `backend/test/product-category-lifecycle.spec.ts` — category rename/delete/restore tests.
- `admin-web/src/views/product/BrandView.vue` — brand management page.
- `tests/product-brand-code-ui-contract.test.js` — admin route/menu/form/list contract tests.

**Modify:**

- `backend/package.json`, `backend/package-lock.json` — add `pinyin-pro` and brand backfill script.
- `backend/prisma/schema.prisma` — add `ProductCategory.productSequence`.
- `backend/prisma/seed.dev.ts` — use a valid uppercase brand prefix for seeded data.
- `backend/src/app.module.ts` — import `BrandModule`.
- `backend/src/product/dto/create-product.dto.ts` — require `brandId`; make client `name`/`code` deprecated optional inputs that the service ignores.
- `backend/src/product/product.service.ts` — generated identity, code search, category lifecycle, and category code-segment output.
- `backend/src/product/product.controller.ts` — managed category list/restore routes and updated product contract.
- `backend/test/product.contract.spec.ts` — updated create/update/category route contracts.
- `backend/test/product-visibility.spec.ts` — preserve active category visibility behavior.
- `admin-web/src/api/product.ts` — brand/category management APIs.
- `admin-web/src/router/index.ts` — brand management route.
- `admin-web/src/layouts/MainLayout.vue` — brand management menu item.
- `admin-web/src/views/product/ProductEditView.vue` — brand selection, generated previews, read-only identity, identity-change confirmation.
- `admin-web/src/views/product/ProductListView.vue` — display `code` and preserve name/code keyword search.
- `admin-web/src/views/product/CategoryView.vue` — managed list, safe-delete messaging, disabled status, and restore.
- `tests/product-category-ui-contract.test.js` — category lifecycle UI expectations.
- `docs/superpowers/specs/2026-08-04-product-brand-code-design.md` — update implementation status only after verification.

---

### Task 1: Product Code Utility

**Files:**
- Create: `backend/src/product/product-code.ts`
- Create: `backend/test/product-code.spec.ts`
- Modify: `backend/package.json`
- Modify: `backend/package-lock.json`

- [ ] **Step 1: Write the failing pure-function tests**

```ts
import {
  buildProductCode,
  formatProductSequence,
  normalizeBrandPrefix,
  toBrandPrefix,
  toCategorySegment
} from '../src/product/product-code'

describe('product code helpers', () => {
  it('generates an uppercase brand prefix from Chinese', () => {
    expect(toBrandPrefix('德品')).toBe('DEPIN')
  })

  it('normalizes a manually entered brand prefix', () => {
    expect(normalizeBrandPrefix(' de-pin 01 ')).toBe('DEPIN01')
  })

  it('generates title-cased category pinyin', () => {
    expect(toCategorySegment('鸭血')).toBe('YaXue')
  })

  it('pads only sequences shorter than three digits', () => {
    expect(formatProductSequence(1)).toBe('001')
    expect(formatProductSequence(99)).toBe('099')
    expect(formatProductSequence(1000)).toBe('1000')
  })

  it('builds the approved product code', () => {
    expect(buildProductCode('DEPIN', '鸭血', 1)).toBe('DEPIN-YaXue-001')
  })
})
```

- [ ] **Step 2: Run the test and verify RED**

Run:

```powershell
Push-Location backend
npm.cmd test -- --runTestsByPath test/product-code.spec.ts
Pop-Location
```

Expected: FAIL because `product-code.ts` does not exist.

- [ ] **Step 3: Install the pinyin dependency**

Run:

```powershell
Push-Location backend
npm.cmd install pinyin-pro
Pop-Location
```

Expected: `backend/package.json` and `backend/package-lock.json` contain `pinyin-pro`.

- [ ] **Step 4: Implement the pure utility**

```ts
import { pinyin } from 'pinyin-pro'

const BRAND_PREFIX_PATTERN = /^[A-Z0-9]+$/

function syllables(value: string): string[] {
  return pinyin(value.trim(), { toneType: 'none', type: 'array' })
    .map((part) => part.replace(/[^A-Za-z0-9]/g, ''))
    .filter(Boolean)
}

export function normalizeBrandPrefix(value: string): string {
  return value.trim().toUpperCase().replace(/[^A-Z0-9]/g, '')
}

export function isValidBrandPrefix(value: string): boolean {
  return BRAND_PREFIX_PATTERN.test(value)
}

export function toBrandPrefix(name: string): string {
  return normalizeBrandPrefix(syllables(name).join(''))
}

export function toCategorySegment(name: string): string {
  return syllables(name)
    .map((part) => `${part.charAt(0).toUpperCase()}${part.slice(1).toLowerCase()}`)
    .join('')
}

export function formatProductSequence(sequence: number): string {
  return String(sequence).padStart(3, '0')
}

export function buildProductCode(brandPrefix: string, categoryName: string, sequence: number): string {
  return `${normalizeBrandPrefix(brandPrefix)}-${toCategorySegment(categoryName)}-${formatProductSequence(sequence)}`
}
```

- [ ] **Step 5: Run the test and verify GREEN**

Run the Task 1 test command again.

Expected: 5 tests pass.

---

### Task 2: Category Historical Sequence Schema and Backfill

**Files:**
- Create: `backend/test/product-brand-code-schema.spec.ts`
- Create: `backend/prisma/migrations/20260804150000_product_brand_code/migration.sql`
- Create: `backend/prisma/backfill-brand-codes.ts`
- Modify: `backend/prisma/schema.prisma`
- Modify: `backend/package.json`
- Modify: `backend/prisma/seed.dev.ts`

- [ ] **Step 1: Write the failing schema contract test**

```ts
import fs from 'node:fs'
import path from 'node:path'

describe('product brand code schema', () => {
  const root = path.resolve(__dirname, '..')

  it('stores a per-category historical sequence', () => {
    const schema = fs.readFileSync(path.join(root, 'prisma/schema.prisma'), 'utf8')
    expect(schema).toMatch(/productSequence\s+Int\s+@default\(0\)\s+@map\("product_sequence"\)/)
  })

  it('backfills from product count and maximum numeric suffix', () => {
    const sql = fs.readFileSync(
      path.join(root, 'prisma/migrations/20260804150000_product_brand_code/migration.sql'),
      'utf8'
    )
    expect(sql).toMatch(/ADD COLUMN `product_sequence`/)
    expect(sql).toMatch(/COUNT\(\*\)/)
    expect(sql).toMatch(/SUBSTRING_INDEX\(`code`, '-', -1\)/)
    expect(sql).toMatch(/GREATEST/)
  })
})
```

- [ ] **Step 2: Run the schema test and verify RED**

Run:

```powershell
Push-Location backend
npm.cmd test -- --runTestsByPath test/product-brand-code-schema.spec.ts
Pop-Location
```

Expected: FAIL because the field and migration are absent.

- [ ] **Step 3: Add the Prisma field**

Add to `ProductCategory` after `sortOrder`:

```prisma
productSequence Int @default(0) @map("product_sequence")
```

- [ ] **Step 4: Add the SQL migration**

```sql
ALTER TABLE `product_categories`
  ADD COLUMN `product_sequence` INTEGER NOT NULL DEFAULT 0 AFTER `sort_order`;

UPDATE `product_categories` AS `category`
LEFT JOIN (
  SELECT
    `category_id`,
    COUNT(*) AS `product_count`,
    MAX(
      CASE
        WHEN `code` REGEXP '-[0-9]+$'
          THEN CAST(SUBSTRING_INDEX(`code`, '-', -1) AS UNSIGNED)
        ELSE 0
      END
    ) AS `max_suffix`
  FROM `products`
  WHERE `category_id` IS NOT NULL
  GROUP BY `category_id`
) AS `stats` ON `stats`.`category_id` = `category`.`id`
SET `category`.`product_sequence` = GREATEST(
  COALESCE(`stats`.`product_count`, 0),
  COALESCE(`stats`.`max_suffix`, 0)
);
```

- [ ] **Step 5: Add deterministic legacy brand normalization**

Create `backfill-brand-codes.ts` that:

```ts
import { PrismaClient } from '@prisma/client'
import { isValidBrandPrefix, normalizeBrandPrefix, toBrandPrefix } from '../src/product/product-code'

const prisma = new PrismaClient()

async function main() {
  const brands = await prisma.brand.findMany({ orderBy: [{ tenantId: 'asc' }, { id: 'asc' }] })
  const used = new Set<string>()
  const updates: Array<{ id: number; code: string }> = []

  for (const brand of brands) {
    const normalizedExisting = normalizeBrandPrefix(brand.code)
    const code = isValidBrandPrefix(normalizedExisting) && normalizedExisting
      ? normalizedExisting
      : toBrandPrefix(brand.name)
    const key = `${brand.tenantId}:${code}`
    if (!code || used.has(key)) throw new Error(`品牌编码冲突: ${brand.name} -> ${code || '(empty)'}`)
    used.add(key)
    if (brand.code !== code) updates.push({ id: brand.id, code })
  }

  await prisma.$transaction(updates.map((item) => prisma.brand.update({
    where: { id: item.id },
    data: { code: item.code }
  })))
}

main().finally(() => prisma.$disconnect())
```

Add script:

```json
"db:backfill-brand-codes": "ts-node prisma/backfill-brand-codes.ts"
```

Update the seeded brand code to a valid uppercase prefix such as `YANSHI`.

- [ ] **Step 6: Generate Prisma Client and verify GREEN**

Run:

```powershell
Push-Location backend
npm.cmd run prisma:generate
npm.cmd test -- --runTestsByPath test/product-brand-code-schema.spec.ts
Pop-Location
```

Expected: Prisma Client generation succeeds and both schema tests pass.

---

### Task 3: Brand Management Backend

**Files:**
- Create: `backend/src/brand/dto/brand.dto.ts`
- Create: `backend/src/brand/brand.service.ts`
- Create: `backend/src/brand/brand.controller.ts`
- Create: `backend/src/brand/brand.module.ts`
- Create: `backend/test/brand-management.spec.ts`
- Create: `backend/test/brand.contract.spec.ts`
- Modify: `backend/src/app.module.ts`

- [ ] **Step 1: Write failing service tests**

Cover these exact behaviors:

```ts
it('suggests DEPIN for 德品')
it('creates a brand with an automatic prefix when code is omitted')
it('rejects a duplicate tenant brand prefix with ConflictException')
it('physically deletes a brand without historical products')
it('disables a brand with historical products')
it('restores a disabled brand')
it('renaming a brand updates product names but preserves product codes')
```

The rename test must mock products with categories and assert updates contain only:

```ts
{ name: '新品牌鸭血' }
```

and never contain `code`.

- [ ] **Step 2: Run the service test and verify RED**

Run:

```powershell
Push-Location backend
npm.cmd test -- --runTestsByPath test/brand-management.spec.ts
Pop-Location
```

Expected: FAIL because `BrandService` does not exist.

- [ ] **Step 3: Implement DTO validation**

Create DTOs with:

```ts
export class CreateBrandDto {
  @IsString() @MinLength(1) name: string
  @IsOptional() @IsString() code?: string
  @IsOptional() @IsInt() @Min(0) sortOrder?: number
  @IsOptional() @IsString() logoUrl?: string
  @IsOptional() @IsString() description?: string
}

export class UpdateBrandDto extends PartialType(CreateBrandDto) {}
```

- [ ] **Step 4: Implement BrandService**

Required public methods:

```ts
list(tenantId: number, status?: 'active' | 'disabled')
suggestCode(name: string)
create(tenantId: number, dto: CreateBrandDto)
update(tenantId: number, id: number, dto: UpdateBrandDto)
delete(tenantId: number, id: number)
restore(tenantId: number, id: number)
```

Use these response shapes:

```ts
{ id, deletionMode: 'physical', linkedProductCount: 0 }
{ id, deletionMode: 'disabled', linkedProductCount }
```

Map Prisma `P2002` to:

```ts
throw new ConflictException({ message: '品牌编码前缀已存在', errorCode: 'BRD_1002' })
```

- [ ] **Step 5: Implement authenticated controller/module wiring**

Expose:

```text
GET    /api/v1/admin/brands
GET    /api/v1/admin/brands/code-suggestion?name=德品
POST   /api/v1/admin/brands
PATCH  /api/v1/admin/brands/:id
DELETE /api/v1/admin/brands/:id
PATCH  /api/v1/admin/brands/:id/restore
```

All routes use `JwtAuthGuard` and `req.user.tenantId`.

- [ ] **Step 6: Write and run HTTP contract tests**

Assert authentication, route delegation, `201` create, `200` delete/restore, and the two deletion modes.

Run:

```powershell
Push-Location backend
npm.cmd test -- --runTestsByPath test/brand-management.spec.ts test/brand.contract.spec.ts
Pop-Location
```

Expected: both suites pass.

---

### Task 4: Backend-Authoritative Product Identity

**Files:**
- Create: `backend/test/product-generated-code.spec.ts`
- Modify: `backend/src/product/dto/create-product.dto.ts`
- Modify: `backend/src/product/product.service.ts`
- Modify: `backend/test/product.contract.spec.ts`

- [ ] **Step 1: Write failing generated-identity tests**

Tests must assert:

```ts
it('creates 德品鸭血 with DEPIN-YaXue-001')
it('shares category sequence across different brands')
it('skips an already-used generated code and advances the category counter')
it('ignores client supplied name and code')
it('keeps code when brand and category do not change')
it('allocates a new code when brand changes')
it('allocates a new code when category changes')
it('searches by product name or product code')
```

The create test should call:

```ts
service.create({ brandId: 4, categoryId: 8, name: '伪造名称', code: 'MANUAL' }, 1)
```

and assert Prisma receives generated `name` and `code` instead.

- [ ] **Step 2: Run the tests and verify RED**

Run:

```powershell
Push-Location backend
npm.cmd test -- --runTestsByPath test/product-generated-code.spec.ts
Pop-Location
```

Expected: FAIL because create still defaults to the first brand and trusts client identity fields.

- [ ] **Step 3: Update DTOs**

Add required `brandId` to `CreateProductDto`:

```ts
@ApiProperty({ example: 1 })
@IsInt()
brandId: number
```

Keep `name` and `code` optional/deprecated for request compatibility, but document that the service ignores them. Add optional `brandId` to `UpdateProductDto`.

- [ ] **Step 4: Add a private identity allocator**

Inside `ProductService`, add an interactive-transaction helper using `Prisma.TransactionClient`:

```ts
private async allocateIdentity(
  tx: Prisma.TransactionClient,
  tenantId: number,
  brandId: number,
  categoryId: number
) {
  const brand = await tx.brand.findFirst({
    where: { id: brandId, tenantId, status: 'active' },
    select: { id: true, name: true, code: true }
  })
  const category = await tx.productCategory.findFirst({
    where: { id: categoryId, tenantId, status: 'active' },
    select: { id: true, name: true }
  })
  if (!brand) throw new BadRequestException({ message: '品牌不存在或已停用', errorCode: 'BRD_1003' })
  if (!category) throw new BadRequestException({ message: '分类不存在或已停用', errorCode: 'CAT_1003' })

  for (let attempt = 0; attempt < 100; attempt += 1) {
    const sequence = await tx.productCategory.update({
      where: { id: category.id },
      data: { productSequence: { increment: 1 } },
      select: { productSequence: true }
    })
    const code = buildProductCode(brand.code, category.name, sequence.productSequence)
    if (code.length > 64) {
      throw new BadRequestException({ message: '自动生成的商品编码超过 64 个字符', errorCode: 'PRO_1004' })
    }
    const collision = await tx.product.findFirst({ where: { tenantId, code }, select: { id: true } })
    if (!collision) return { brand, category, name: `${brand.name}${category.name}`, code }
  }
  throw new ConflictException({ message: '无法分配唯一商品编码', errorCode: 'PRO_1005' })
}
```

- [ ] **Step 5: Replace create/update identity handling**

Create uses `prisma.$transaction(async (tx) => ...)`, calls `allocateIdentity`, and never writes `dto.name` or `dto.code`.

Update loads the current product, removes `name`, `code`, `brandId`, and `categoryId` from ordinary update data, and only calls `allocateIdentity` when either identity id changes.

- [ ] **Step 6: Search by name or code**

Replace the current name-only keyword condition with:

```ts
if (keyword) {
  where.OR = [
    { name: { contains: keyword } },
    { code: { contains: keyword } }
  ]
}
```

- [ ] **Step 7: Run product identity and contract tests**

Run:

```powershell
Push-Location backend
npm.cmd test -- --runTestsByPath test/product-generated-code.spec.ts test/product.contract.spec.ts
Pop-Location
```

Expected: both suites pass.

---

### Task 5: Category Rename, Safe Delete, Managed List, and Restore

**Files:**
- Create: `backend/test/product-category-lifecycle.spec.ts`
- Modify: `backend/src/product/product.service.ts`
- Modify: `backend/src/product/product.controller.ts`
- Modify: `backend/test/product-visibility.spec.ts`
- Modify: `backend/test/product.contract.spec.ts`

- [ ] **Step 1: Write failing category lifecycle tests**

Cover:

```ts
it('renaming a category updates linked product names without changing codes')
it('physically deletes a category with no historical products')
it('disables a category with historical products')
it('restores a disabled category')
it('managed category list includes disabled categories and product counts')
it('public category list still returns only active categories')
```

- [ ] **Step 2: Run and verify RED**

Run:

```powershell
Push-Location backend
npm.cmd test -- --runTestsByPath test/product-category-lifecycle.spec.ts
Pop-Location
```

- [ ] **Step 3: Implement managed list and virtual pinyin segment**

Add:

```ts
async managedCategories(tenantId: number) {
  const rows = await this.prisma.productCategory.findMany({
    where: { tenantId, status: { in: ['active', 'disabled'] } },
    include: { _count: { select: { products: true } } },
    orderBy: { sortOrder: 'asc' }
  })
  return rows.map((row) => ({ ...row, codeSegment: toCategorySegment(row.name) }))
}
```

Also add `codeSegment` to public active category results so the admin product editor can render `DEPIN-YaXue-***` without duplicating pinyin logic.

- [ ] **Step 4: Implement rename synchronization and safe deletion**

`updateCategory` runs in a transaction. When `name` changes, fetch linked products with their brands and update only `name` to `${brand.name}${newName}`.

`deleteCategory` returns one of:

```ts
{ id, deletionMode: 'physical', linkedProductCount: 0 }
{ id, deletionMode: 'disabled', linkedProductCount }
```

Add `restoreCategory(id, tenantId)` to set `status: 'active'`.

- [ ] **Step 5: Add authenticated management routes**

```text
GET   /api/v1/admin/product-categories
PATCH /api/v1/admin/product-categories/:id/restore
```

Existing public `GET /product-categories` remains active-only.

- [ ] **Step 6: Run lifecycle, visibility, and contract tests**

Run:

```powershell
Push-Location backend
npm.cmd test -- --runTestsByPath test/product-category-lifecycle.spec.ts test/product-visibility.spec.ts test/product.contract.spec.ts
Pop-Location
```

Expected: all suites pass.

---

### Task 6: Admin Brand APIs, Route, Menu, and Page

**Files:**
- Create: `admin-web/src/views/product/BrandView.vue`
- Create: `tests/product-brand-code-ui-contract.test.js`
- Modify: `admin-web/src/api/product.ts`
- Modify: `admin-web/src/router/index.ts`
- Modify: `admin-web/src/layouts/MainLayout.vue`

- [ ] **Step 1: Write the failing UI contract test**

Assert source contracts:

```js
assert.match(router, /products\/brands/)
assert.match(layout, /品牌管理/)
assert.match(api, /getManagedBrands/)
assert.match(api, /suggestBrandCode/)
assert.match(api, /restoreBrand/)
assert.match(brandView, /品牌编码前缀/)
assert.match(brandView, /关联商品数/)
assert.match(brandView, /恢复/)
```

- [ ] **Step 2: Run and verify RED**

Run:

```powershell
node --test tests\product-brand-code-ui-contract.test.js
```

Expected: FAIL because route, page, and APIs do not exist.

- [ ] **Step 3: Add brand management API functions**

```ts
export function getManagedBrands(params: Record<string, unknown> = {}) {
  return http.get('/admin/brands', { params })
}

export function suggestBrandCode(name: string) {
  return http.get('/admin/brands/code-suggestion', { params: { name } })
}

export function createBrand(data: Record<string, unknown>) {
  return http.post('/admin/brands', data)
}

export function updateBrand(id: number, data: Record<string, unknown>) {
  return http.patch(`/admin/brands/${id}`, data)
}

export function deleteBrand(id: number) {
  return http.delete(`/admin/brands/${id}`)
}

export function restoreBrand(id: number) {
  return http.patch(`/admin/brands/${id}/restore`)
}
```

- [ ] **Step 4: Add route and menu**

Add route `/products/brands` with permission `brand:manage`. Add the menu item between 商品管理 and 分类管理.

- [ ] **Step 5: Build BrandView**

The page must provide:

- Status filter: all/active/disabled.
- Columns: name, code, `_count.products`, sort order, status, actions.
- Name blur or “重新生成” action calling `suggestBrandCode` when the code was not manually edited.
- Create/edit dialog.
- Delete confirmation using backend `deletionMode` messaging.
- Restore action for disabled brands.

- [ ] **Step 6: Run the UI contract test and typecheck**

Run:

```powershell
node --test tests\product-brand-code-ui-contract.test.js
Push-Location admin-web
npm.cmd run typecheck
Pop-Location
```

Expected: contract test and Vue typecheck pass.

---

### Task 7: Product Editor Generated Identity UX

**Files:**
- Modify: `admin-web/src/views/product/ProductEditView.vue`
- Modify: `tests/product-brand-code-ui-contract.test.js`

- [ ] **Step 1: Add failing editor contract assertions**

Assert:

```js
assert.match(editor, /getBrands/)
assert.match(editor, /form\.brandId/)
assert.match(editor, /generatedName/)
assert.match(editor, /generatedCodePreview/)
assert.match(editor, /readonly/)
assert.match(editor, /更换品牌或分类将生成新商品编码/)
assert.doesNotMatch(editor, /code:\s*form\.productCode/)
```

- [ ] **Step 2: Run and verify RED**

Run the root UI contract test.

Expected: FAIL because brand selection and generated previews are absent.

- [ ] **Step 3: Load brands and categories together**

Use:

```ts
const [brandResponse, categoryResponse] = await Promise.all([getBrands(), getCategories()])
```

Store original `brandId` and `categoryId` when editing.

- [ ] **Step 4: Add computed previews**

```ts
const selectedBrand = computed(() => brands.value.find((item) => item.id === form.brandId))
const selectedCategory = computed(() => categories.value.find((item) => item.id === form.categoryId))
const generatedName = computed(() => selectedBrand.value && selectedCategory.value
  ? `${selectedBrand.value.name}${selectedCategory.value.name}`
  : '')
const generatedCodePreview = computed(() => selectedBrand.value && selectedCategory.value
  ? `${selectedBrand.value.code}-${selectedCategory.value.codeSegment}-***`
  : '')
```

When editing without identity changes, display the actual stored `form.productCode`; otherwise display the preview.

- [ ] **Step 5: Make identity fields authoritative**

- Brand and category are required selects.
- Name and code inputs are `readonly`.
- Save body includes `brandId` and `categoryId` but excludes `name` and `code`.
- If identity changed, show:

```ts
await ElMessageBox.confirm(
  '更换品牌或分类将生成新商品编码，旧编码不会再次使用。是否继续？',
  '重新生成商品编码',
  { type: 'warning', confirmButtonText: '继续保存', cancelButtonText: '取消' }
)
```

- [ ] **Step 6: Show the returned formal code**

After create/update, read the returned product, set `form.productCode = product.code`, and show a success message containing the formal code before routing or refreshing.

- [ ] **Step 7: Run contract test and typecheck**

Run the Task 6 verification commands again.

Expected: all pass.

---

### Task 8: Product List and Category Management UI

**Files:**
- Modify: `admin-web/src/api/product.ts`
- Modify: `admin-web/src/views/product/ProductListView.vue`
- Modify: `admin-web/src/views/product/CategoryView.vue`
- Modify: `tests/product-brand-code-ui-contract.test.js`
- Modify: `tests/product-category-ui-contract.test.js`

- [ ] **Step 1: Write failing list/category UI assertions**

Assert:

```js
assert.match(productList, /prop="code" label="商品编码"/)
assert.doesNotMatch(productList, /prop="productCode"/)
assert.match(productApi, /getManagedCategories/)
assert.match(productApi, /restoreCategory/)
assert.match(categoryView, /关联商品数/)
assert.match(categoryView, /已停用/)
assert.match(categoryView, /恢复/)
```

- [ ] **Step 2: Run and verify RED**

Run:

```powershell
node --test tests\product-brand-code-ui-contract.test.js tests\product-category-ui-contract.test.js
```

- [ ] **Step 3: Fix the product code column**

Replace:

```vue
<el-table-column prop="productCode" label="商品编码" width="140" />
```

with:

```vue
<el-table-column prop="code" label="商品编码" width="180" />
```

- [ ] **Step 4: Add managed category APIs**

```ts
export function getManagedCategories() {
  return http.get('/admin/product-categories')
}

export function restoreCategory(id: number) {
  return http.patch(`/admin/product-categories/${id}/restore`)
}
```

- [ ] **Step 5: Update CategoryView lifecycle UI**

- Load managed categories.
- Display product count and status.
- Show “恢复” for disabled categories.
- Keep “删除” for active categories.
- Use backend `deletionMode` to show either “分类已永久删除” or “分类已有历史商品，已安全停用”.
- Remove the old message that associated products were changed to “暂无分类”.

- [ ] **Step 6: Run UI tests and typecheck**

Run:

```powershell
node --test tests\product-brand-code-ui-contract.test.js tests\product-category-ui-contract.test.js
Push-Location admin-web
npm.cmd run typecheck
Pop-Location
```

Expected: all pass.

---

### Task 9: Migration, Full Verification, and Design Status

**Files:**
- Modify: `docs/superpowers/specs/2026-08-04-product-brand-code-design.md`

- [ ] **Step 1: Validate and apply the database migration**

Run:

```powershell
Push-Location backend
npx.cmd prisma validate
npm.cmd run prisma:generate
npx.cmd prisma migrate dev
npm.cmd run db:backfill-brand-codes
Pop-Location
```

Expected: schema validates, migration applies, counters are populated, and brand normalization reports no conflicts.

- [ ] **Step 2: Run focused backend tests**

```powershell
Push-Location backend
npm.cmd test -- --runTestsByPath test/product-code.spec.ts test/product-brand-code-schema.spec.ts test/brand-management.spec.ts test/brand.contract.spec.ts test/product-generated-code.spec.ts test/product-category-lifecycle.spec.ts
Pop-Location
```

Expected: all new suites pass.

- [ ] **Step 3: Run full backend verification**

```powershell
Push-Location backend
npm.cmd test
npm.cmd run lint
npm.cmd run typecheck
npm.cmd run build
Pop-Location
```

Expected: zero failed tests, zero lint errors, successful typecheck and build.

- [ ] **Step 4: Run full admin and root verification**

```powershell
Push-Location admin-web
npm.cmd run lint
npm.cmd run typecheck
npm.cmd run build
Pop-Location

$testFiles = Get-ChildItem tests -Filter *.test.js -File | Select-Object -ExpandProperty FullName
node --test $testFiles
```

Expected: admin lint/typecheck/build succeed and every root contract test passes. If Vite/esbuild is denied parent-directory access by the sandbox, rerun only `npm.cmd run build` with approved escalation.

- [ ] **Step 5: Verify the real API behavior**

Using an authenticated local admin token:

1. Create brand `德品`; assert prefix `DEPIN`.
2. Create or select category `鸭血`.
3. Create first product; assert name `德品鸭血` and code matching `DEPIN-YaXue-\d{3,}`.
4. Create a second brand and another `鸭血` product; assert the numeric suffix increments globally.
5. Query the product list by the exact code; assert the product is returned.
6. Delete a brand with historical products; assert `deletionMode=disabled`.
7. Restore the brand.
8. Remove diagnostic data using explicit IDs created by this verification only.

- [ ] **Step 6: Mark the design as implemented**

Append an implementation-status section recording:

- Migration name.
- Main files changed.
- Final test counts.
- Real API examples.
- Any intentionally retained legacy behavior.

Expected: design and implementation remain traceable in one approved specification.

---

## Final Acceptance Checklist

- [ ] Product list renders `Product.code`.
- [ ] Keyword search matches product name and code.
- [ ] Brand management supports create/edit/delete/restore.
- [ ] Historical brands/categories are disabled rather than physically removed.
- [ ] Product creation requires explicit brand and category.
- [ ] Product name is generated as brand name plus category name.
- [ ] Product code is generated as uppercase brand prefix, title-cased category pinyin, and category-global historical sequence.
- [ ] Concurrent creates cannot receive the same sequence/code.
- [ ] Brand/category changes generate a new code and never reuse the old one.
- [ ] Brand/category renames update product names but preserve product codes.
- [ ] Existing product codes remain unchanged and visible.
- [ ] Schema migration and legacy brand normalization complete without conflicts.
- [ ] Backend, admin, and root test/build verification all pass.
