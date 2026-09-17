# Global Product Categories and Switch Layout Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Remove every category-to-brand dependency and reorganize the product status switches into the approved three-column layout.

**Architecture:** Product categories become tenant-global records while products retain their own brand relation. The category endpoint returns all visible active categories without brand filtering, and both admin and mini-program callers stop sending a category brand parameter. UI behavior is guarded by source-contract tests, while backend behavior and Prisma schema changes are covered by Jest and Prisma validation.

**Tech Stack:** Vue 3, Element Plus, WeChat Mini Program JavaScript, NestJS, Prisma 6, MySQL, Jest, Vitest, Node test runner.

---

## File Map

- Modify: `backend/src/product/product.controller.ts` — remove the category `brandId` query contract.
- Modify: `backend/src/product/product.service.ts` — query global visible categories and create categories without `brandId`.
- Modify: `backend/src/product/dto/create-category.dto.ts` — remove category brand fields.
- Modify: `backend/prisma/schema.prisma` — remove the category-brand relation and replace indexes.
- Create: `backend/prisma/migrations/20260729110000_global_product_categories/migration.sql` — safely drop the category brand column after a tenant/code uniqueness guard.
- Modify: `backend/prisma/seed.dev.ts` — seed tenant-global categories.
- Modify: `backend/test/product.contract.spec.ts` — verify the controller no longer forwards a brand ID.
- Modify: `backend/test/product-visibility.spec.ts` — verify category visibility without a brand predicate.
- Create: `backend/test/product-category-schema.spec.ts` — protect the Prisma relation and index contract.
- Modify: `admin-web/src/api/product.ts` — make `getCategories()` parameterless.
- Modify: `admin-web/src/views/product/CategoryView.vue` — remove all category brand UI and payload state.
- Modify: `admin-web/src/views/product/ProductEditView.vue` — add the approved three-column switch grid.
- Modify: `pages/category/category.js` — request global categories.
- Create: `tests/product-category-ui-contract.test.js` — protect admin and mini-program UI contracts.

### Task 1: Add failing backend regression tests

- [ ] **Step 1: Update the HTTP contract test**

+ In `backend/test/product.contract.spec.ts`, change the category request to omit `brandId` and assert that the authenticated user ID is the only service argument:

```ts
it('GET /api/v1/product-categories returns global categories', async () => {
  mockProduct.categories.mockClear()

  const res = await request(app.getHttpServer()).get('/api/v1/product-categories').expect(200)

  expect(mockProduct.categories).toHaveBeenCalledWith(1)
  expect(res.body.data[0].name).toBe('Cat')
})
```

- [ ] **Step 2: Update the visibility service test**

+ In `backend/test/product-visibility.spec.ts`, call `service.categories(7)`, assert `whereForUser(7)`, and assert that the Prisma `where` object contains only category status plus visible products:

```ts
await service.categories(7)

expect(visibility.whereForUser).toHaveBeenCalledWith(7)
expect(findMany).toHaveBeenCalledWith({
  where: {
    status: 'active',
    products: { some: { status: 'active', isFactoryProduct: true } }
  },
  orderBy: { sortOrder: 'asc' }
})
```

- [ ] **Step 3: Add a Prisma schema contract test**

+ Create `backend/test/product-category-schema.spec.ts` that reads `prisma/schema.prisma`, extracts the `Brand` and `ProductCategory` model blocks, and asserts:
+
+```ts
+expect(categoryModel).not.toMatch(/brandId|brands+Brand/)
+expect(categoryModel).toContain('@@unique([tenantId, code])')
+expect(categoryModel).toContain('@@index([tenantId, status])')
+expect(brandModel).not.toMatch(/categoriess+ProductCategory[]/)
+```

- [ ] **Step 4: Run the focused tests and verify RED**

Run:

```powershell
npm.cmd --prefix backend test -- product.contract.spec.ts product-visibility.spec.ts product-category-schema.spec.ts
```

Expected: FAIL because the controller still supplies `brandId`, the service still filters by `brandId`, and the Prisma schema still declares the relation.

### Task 2: Implement global categories in the backend

- [ ] **Step 1: Remove the controller brand query**

+ In `backend/src/product/product.controller.ts`, remove the category endpoint's `@ApiQuery({ name: 'brandId' ... })`, remove the parsed `brandId` parameter, and call:
+
+```ts
+return this.product.categories(req.user?.sub)
+```

- [ ] **Step 2: Remove brand fields from category DTOs**

+ In `backend/src/product/dto/create-category.dto.ts`, remove both `brandId` properties and their validators from `CreateCategoryDto` and `UpdateCategoryDto`.

- [ ] **Step 3: Update category service methods**

+ Change the read method to:
+
+```ts
+async categories(userId?: number) {
+  const accessWhere = await this.visibility.whereForUser(userId)
+  return this.prisma.productCategory.findMany({
+    where: {
+      status: 'active',
+      products: { some: { status: 'active', ...accessWhere } }
+    },
+    orderBy: { sortOrder: 'asc' }
+  })
+}
+```
+
+ Change category creation data to omit `brandId`.

- [ ] **Step 4: Update Prisma schema and seed data**

+ Remove `Brand.categories`, `ProductCategory.brandId`, and `ProductCategory.brand`. Replace category indexes with:
+
+```prisma
+@@unique([tenantId, code])
+@@index([tenantId, status])
+```
+
+ In `backend/prisma/seed.dev.ts`, use `tenantId_code` for category upserts and omit `brandId` from category creation.

- [ ] **Step 5: Add the migration**

+ Create `backend/prisma/migrations/20260729110000_global_product_categories/migration.sql` with this order:
+
+```sql
+CREATE UNIQUE INDEX `product_categories_tenant_id_code_key`
+  ON `product_categories`(`tenant_id`, `code`);
+
+ALTER TABLE `product_categories`
+  DROP FOREIGN KEY `product_categories_brand_id_fkey`;
+
+DROP INDEX `product_categories_tenant_id_brand_id_code_key`
+  ON `product_categories`;
+
+DROP INDEX `product_categories_tenant_id_brand_id_status_idx`
+  ON `product_categories`;
+
+ALTER TABLE `product_categories`
+  DROP COLUMN `brand_id`;
+
+CREATE INDEX `product_categories_tenant_id_status_idx`
+  ON `product_categories`(`tenant_id`, `status`);
+```
+
+ Creating the tenant/code unique index first makes duplicate data fail before any column or foreign key is removed.

- [ ] **Step 6: Run backend tests and Prisma checks**

Run:

```powershell
npm.cmd --prefix backend test -- product.contract.spec.ts product-visibility.spec.ts product-category-schema.spec.ts
npm.cmd --prefix backend exec -- prisma validate --schema prisma/schema.prisma
npm.cmd --prefix backend run prisma:generate
npm.cmd --prefix backend run typecheck
```

Expected: all commands exit 0.

### Task 3: Add failing admin and mini-program UI contracts

- [ ] **Step 1: Create the source contract test**

+ Create `tests/product-category-ui-contract.test.js` with Node's test runner. Assert that:
+
+```js
+assert.doesNotMatch(categoryView, /getBrands|form.brandId|label="品牌"/)
+assert.doesNotMatch(categoryView, /const brandss*=/)
+assert.match(categoryView, /:disabled="!form.name"/)
+assert.doesNotMatch(productApi, /getCategories(brandId/)
+assert.doesNotMatch(categoryPage, /getProductCategories({s*brandId/)
+assert.match(categoryPage, /getProductCategories()/)
+assert.match(productEditor, /class="product-flag-grid"/)
+assert.equal((productEditor.match(/class="product-flag-item"/g) || []).length, 5)
+assert.match(productEditor, /grid-template-columns:s*repeat(3, minmax(0, 1fr))/)
+assert.match(productEditor, /@media (max-width: 768px)[sS]*grid-template-columns:s*1fr/)
+```

- [ ] **Step 2: Run the source contract and verify RED**

Run:

```powershell
node --test tests/product-category-ui-contract.test.js
```

Expected: FAIL because the brand UI and request parameters still exist and the switch grid has not been added.

### Task 4: Implement the admin and mini-program UI

- [ ] **Step 1: Simplify category API calls**

+ Change `admin-web/src/api/product.ts` to:
+
+```ts
+export function getCategories() {
+  return http.get('/product-categories')
+}
+```

- [ ] **Step 2: Remove brand state and controls from CategoryView**

+ In `admin-web/src/views/product/CategoryView.vue`:
+
+  - Remove `getBrands` and the `brands` ref.
+  - Load only categories.
+  - Remove `brandId` from form initialization, edit mapping, create payload, and save-button validation.
+  - Remove the table brand column and form brand item.
+  - Keep name, parent category, sort order, edit, and delete behavior unchanged.
+
- [ ] **Step 3: Add the approved switch grid**

+ Replace the five mixed-width `el-col` switch items in `admin-web/src/views/product/ProductEditView.vue` with one full-width column containing:
+
+```vue
+<div class="product-flag-grid">
+  <div class="product-flag-item"><span>工厂自产</span><el-switch v-model="form.isFactoryProduct" /></div>
+  <div class="product-flag-item"><span>支持样品</span><el-switch v-model="form.supportSample" /></div>
+  <div class="product-flag-item"><span>推荐商品</span><el-switch v-model="form.isRecommended" /></div>
+  <div class="product-flag-item"><span>新品</span><el-switch v-model="form.isNew" /></div>
+  <div class="product-flag-item"><span>热销</span><el-switch v-model="form.isHot" /></div>
+</div>
+```
+
+ Add scoped CSS with a three-column desktop grid, consistent label widths and gaps, and a single-column rule at `768px`.

- [ ] **Step 4: Remove mini-program category brand parameter**

+ In `pages/category/category.js`, change category loading to:
+
+```js
+const res = await getProductCategories()
+```
+
+ Keep product list `brandId` filtering unchanged.

- [ ] **Step 5: Run UI tests and static checks**

Run:

```powershell
node --test tests/product-category-ui-contract.test.js tests/product-feed-ui-contract.test.js
npm.cmd --prefix admin-web run test:unit
npm.cmd --prefix admin-web run typecheck
npm.cmd --prefix admin-web run build
```

Expected: all commands exit 0.

### Task 5: Validate and apply the database migration

- [ ] **Step 1: Verify the exact live target and duplicate risk**

+ Inspect `docker-compose.dev.yml` for the current MySQL database and credentials. Query:
+
+```sql
+SELECT COUNT(*) AS category_count FROM product_categories;
+SELECT tenant_id, code, COUNT(*) AS duplicate_count
+FROM product_categories
+GROUP BY tenant_id, code
+HAVING COUNT(*) > 1;
+```
+
+ Expected: the duplicate query returns zero rows. If duplicates exist, stop before applying the migration and report them without changing data.

- [ ] **Step 2: Apply the migration without stopping existing services**

Run:

```powershell
npm.cmd --prefix backend exec -- prisma migrate deploy --schema prisma/schema.prisma
```

Expected: migration `20260729110000_global_product_categories` applies successfully.

- [ ] **Step 3: Re-query the resulting schema**

+ Confirm `product_categories.brand_id` no longer exists, the row count is unchanged, and `products.category_id` values still point to existing categories.

### Task 6: Run full verification

- [ ] **Step 1: Run all automated tests**

Run:

```powershell
npm.cmd --prefix backend test
npm.cmd --prefix backend run typecheck
npm.cmd --prefix backend run build
npm.cmd --prefix admin-web run test:unit
npm.cmd --prefix admin-web run typecheck
npm.cmd --prefix admin-web run build
node --test tests/*.test.js
```

Expected: every command exits 0 with zero failed tests.

- [ ] **Step 2: Verify requirement-specific source state**

Run focused searches confirming no category brand references remain in the category schema, DTO, service, controller, admin category view, category API, or mini-program category request. Product-level brand references must remain.

- [ ] **Step 3: Record the no-Git limitation**

+ This checkout has no usable Git metadata, so do not claim commits were created. Report modified files and verification outputs directly.
