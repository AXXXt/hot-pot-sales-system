# Customer Product Visibility Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace channel-based product visibility with customer-level factory/all/custom catalogs, default new users to the renamed normal customer level, and enforce the same access rules through browsing, cart validation, and order creation.

**Architecture:** Add a Prisma visibility mode and customer-product join table, then centralize actor-to-product filtering in `ProductVisibilityService`. Product endpoints and `OrderService` consume that service, while customer management owns visibility configuration. The Vue admin edits catalog modes; the mini-program refreshes cached cart lines through a batch validation endpoint before checkout.

**Tech Stack:** NestJS 11, Prisma 6/MySQL, Jest, Vue 3 + Element Plus, native WeChat mini-program JavaScript/WXML/WXSS.

**Repository note:** The current checkout is not recognized as a Git repository. Run all verification checkpoints, but do not claim commits until Git metadata is restored.

---

## File Map

**Create**

- `backend/prisma/migrations/20260727090000_customer_product_visibility/migration.sql`: schema and data migration.
- `backend/src/product/product-visibility.service.ts`: shared actor-to-product access conditions and checks.
- `backend/src/product/dto/validate-cart.dto.ts`: batch cart validation request DTO.
- `backend/src/customer/dto/update-product-visibility.dto.ts`: customer visibility save DTO.
- `backend/test/product-visibility.spec.ts`: visibility service and product query tests.
- `backend/test/customer-visibility.spec.ts`: customer configuration tests.
- `backend/test/auth-registration.spec.ts`: normal-level registration tests.
- `admin-web/src/views/customer/components/ProductVisibilityCard.vue`: isolated customer catalog editor.

**Modify**

- `backend/prisma/schema.prisma`: visibility enum, fields, relations, removal of obsolete fields.
- `backend/prisma/seed.dev.ts`: normal customer level and factory product seed data.
- `backend/src/product/product.module.ts`: provide/export visibility service.
- `backend/src/product/product.service.ts`: default brand, filtered list/detail/SKU, cart validation.
- `backend/src/product/product.controller.ts`: actor context and cart validation route.
- `backend/src/product/dto/create-product.dto.ts`: remove brand/old visibility, add factory flag.
- `backend/src/customer/customer.service.ts`: remove channel writes and add visibility read/save.
- `backend/src/customer/customer.controller.ts`: expose visibility endpoints.
- `backend/src/customer/dto/create-customer.dto.ts`: remove channel and add no visibility fields to generic edit DTO.
- `backend/src/auth/auth.service.ts`: transactional registration with normal level and factory mode.
- `backend/src/order/order.module.ts`: import product module.
- `backend/src/order/order.service.ts`: reject invisible products during order creation.
- `backend/test/pricing.spec.ts`: preserve agreement pricing while injecting visibility service.
- `admin-web/src/api/customer.ts`: visibility API calls.
- `admin-web/src/views/customer/CustomerDetail.vue`: remove channel and mount visibility card.
- `admin-web/src/views/customer/CustomerList.vue`: remove channel input and payload.
- `admin-web/src/views/product/ProductEditView.vue`: remove brand/visibility and add factory switch.
- `services/api/product.js`: cart validation adapter.
- `store/modules/cart.js`: persist validity/current-price state and count valid lines only.
- `components/business/cart-sheet/cart-sheet.js`: refresh cart lines on open.
- `components/business/cart-sheet/cart-sheet.wxml`: render invalid state and block invalid checkout.
- `components/business/cart-sheet/cart-sheet.wxss`: invalid-line styles.
- `pages/checkout/checkout.js`: revalidate before display and immediately before order creation.
- `pages/cart/cart.js`: use the same validation behavior for the legacy route.

## Task 1: Database Contract and Migration

- [ ] **Step 1: Add a failing schema contract test**

Create `backend/test/product-visibility.spec.ts` with an initial source-level contract so the test fails before the schema change:

```ts
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

describe('product visibility schema', () => {
  const schema = readFileSync(join(__dirname, '../prisma/schema.prisma'), 'utf8')

  it('defines factory/all/custom customer visibility without obsolete fields', () => {
    expect(schema).toContain('enum ProductVisibilityMode')
    expect(schema).toContain('isFactoryProduct')
    expect(schema).toContain('model CustomerVisibleProduct')
    expect(schema).not.toContain('visibilityType')
    expect(schema).not.toContain('channelType')
  })
})
```

- [ ] **Step 2: Run the schema test and confirm RED**

Run from `backend`:

```powershell
npm.cmd test -- product-visibility.spec.ts
```

Expected: FAIL because the enum and new models are absent and obsolete fields still exist.

- [ ] **Step 3: Update Prisma models**

Add this enum and relationship shape to `backend/prisma/schema.prisma`:

```prisma
enum ProductVisibilityMode {
  factory
  all
  custom
}

model CustomerVisibleProduct {
  id         Int      @id @default(autoincrement())
  tenantId   Int      @map("tenant_id")
  customerId Int      @map("customer_id")
  productId  Int      @map("product_id")
  createdAt  DateTime @default(now()) @map("created_at")
  tenant     Tenant   @relation(fields: [tenantId], references: [id])
  customer   Customer @relation(fields: [customerId], references: [id], onDelete: Cascade)
  product    Product  @relation(fields: [productId], references: [id], onDelete: Cascade)

  @@unique([tenantId, customerId, productId])
  @@index([tenantId, productId])
  @@map("customer_visible_products")
}
```

Add `productVisibilityMode` and `visibleProducts` to `Customer`, add `isFactoryProduct` and `visibleToCustomers` to `Product`, and add `visibleProducts` to `Tenant`. Remove `Customer.channelType` and `Product.visibilityType`.

- [ ] **Step 4: Add the ordered MySQL migration**

Create `backend/prisma/migrations/20260727090000_customer_product_visibility/migration.sql` in this order:

```sql
ALTER TABLE `products`
  ADD COLUMN `is_factory_product` BOOLEAN NOT NULL DEFAULT false;

UPDATE `products`
SET `is_factory_product` = (`visibility_type` = 1);

ALTER TABLE `customers`
  ADD COLUMN `product_visibility_mode` ENUM('factory', 'all', 'custom') NOT NULL DEFAULT 'factory';

CREATE TABLE `customer_visible_products` (
  `id` INTEGER NOT NULL AUTO_INCREMENT,
  `tenant_id` INTEGER NOT NULL,
  `customer_id` INTEGER NOT NULL,
  `product_id` INTEGER NOT NULL,
  `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  UNIQUE INDEX `customer_visible_products_tenant_id_customer_id_product_id_key` (`tenant_id`, `customer_id`, `product_id`),
  INDEX `customer_visible_products_tenant_id_product_id_idx` (`tenant_id`, `product_id`),
  PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

ALTER TABLE `customer_visible_products`
  ADD CONSTRAINT `customer_visible_products_tenant_id_fkey` FOREIGN KEY (`tenant_id`) REFERENCES `tenants`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT `customer_visible_products_customer_id_fkey` FOREIGN KEY (`customer_id`) REFERENCES `customers`(`id`) ON DELETE CASCADE ON UPDATE CASCADE,
  ADD CONSTRAINT `customer_visible_products_product_id_fkey` FOREIGN KEY (`product_id`) REFERENCES `products`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

UPDATE `customer_levels`
SET `code` = 'normal', `name` = '普通客户'
WHERE `code` = 'standard';

ALTER TABLE `products` DROP COLUMN `visibility_type`;
ALTER TABLE `customers` DROP COLUMN `channel_type`;
```

Before applying, query for an existing `normal` code; if both `standard` and `normal` exist for one tenant/brand, stop migration and resolve the duplicate rather than deleting pricing-linked rows.

- [ ] **Step 5: Generate and validate Prisma**

Run from `backend`:

```powershell
npx.cmd prisma format
npx.cmd prisma validate
npm.cmd run prisma:generate
npm.cmd test -- product-visibility.spec.ts
```

Expected: Prisma validation succeeds and the schema contract passes.

## Task 2: Shared Product Visibility Service

- [ ] **Step 1: Add failing actor-rule tests**

Extend `backend/test/product-visibility.spec.ts` with tests for guest, internal, factory, all, and custom actors. The core expectations are:

```ts
expect(await service.whereForUser(undefined)).toEqual({ status: 'active', isFactoryProduct: true })
expect(await service.whereForUser(1)).toEqual({}) // internal user
expect(await service.whereForUser(2)).toEqual({ status: 'active', isFactoryProduct: true })
expect(await service.whereForUser(3)).toEqual({ status: 'active' })
expect(await service.whereForUser(4)).toEqual({
  status: 'active',
  visibleToCustomers: { some: { customerId: 44 } }
})
```

Mock `prisma.user.findUnique` to return `userType` and customer mode for each case. Also test that a missing user and a `customer_user` without a customer fall back to factory-only.

- [ ] **Step 2: Run and confirm RED**

```powershell
npm.cmd test -- product-visibility.spec.ts
```

Expected: FAIL because `ProductVisibilityService` does not exist.

- [ ] **Step 3: Implement the shared resolver**

Create `backend/src/product/product-visibility.service.ts` with this public interface:

```ts
@Injectable()
export class ProductVisibilityService {
  constructor(private readonly prisma: PrismaService) {}

  async whereForUser(userId?: number): Promise<Prisma.ProductWhereInput>
  async assertVisible(productId: number, userId?: number): Promise<void>
}
```

`whereForUser` must check `userType` before `customerId`, because the seeded super-admin currently has a customer association. `assertVisible` uses `findFirst({ where: { id: productId, ...accessWhere } })` and throws `NotFoundException({ message: '商品不存在或暂不可购买', errorCode: 'PRO_1001' })` when denied.

- [ ] **Step 4: Wire the module and pass tests**

Register and export `ProductVisibilityService` in `backend/src/product/product.module.ts`.

```powershell
npm.cmd test -- product-visibility.spec.ts
npm.cmd run typecheck
```

Expected: visibility tests and typecheck pass.

## Task 3: Product APIs, Default Brand, and Cart Validation

- [ ] **Step 1: Add failing product behavior tests**

In `backend/test/product-visibility.spec.ts`, instantiate `ProductService` with a mocked visibility service and assert:

- `list` merges `whereForUser` into both `findMany` and `count`.
- `detail` uses a visibility-aware `findFirst` condition.
- `skus` calls `assertVisible` and returns active SKUs only.
- `create` finds the current tenant's first active brand and writes `isFactoryProduct`.
- cart validation returns inaccessible/missing SKU IDs as invalid while applying current agreement prices to valid lines.

- [ ] **Step 2: Run and confirm RED**

```powershell
npm.cmd test -- product-visibility.spec.ts
```

Expected: FAIL on current unfiltered queries and missing cart-validation API.

- [ ] **Step 3: Update DTOs and product service**

In `backend/src/product/dto/create-product.dto.ts`, remove `brandId` and `visibilityType`; add to create and update DTOs:

```ts
@ApiPropertyOptional({ description: '是否为工厂自产商品' })
@IsOptional()
@IsBoolean()
isFactoryProduct?: boolean
```

Create `backend/src/product/dto/validate-cart.dto.ts`:

```ts
export class ValidateCartDto {
  @ApiProperty({ type: [Number] })
  @IsArray()
  @ArrayNotEmpty()
  @ArrayUnique()
  @IsInt({ each: true })
  skuIds: number[]
}
```

Update `ProductService` constructor to receive `ProductVisibilityService`. Resolve default brand with `findFirst({ where: { tenantId: 1, status: 'active' }, orderBy: [{ sortOrder: 'asc' }, { id: 'asc' }] })`; throw `PRO_1003` when none exists. Add `validateCart(skuIds, userId)` returning `{ items, invalidSkuIds }` with current price, stock, product name, specification, unit, and `available`.

- [ ] **Step 4: Pass actor context through the controller**

Update `backend/src/product/product.controller.ts` so create/update pass `req.user.sub`, and add:

```ts
@Post('products/cart-validation')
@UseGuards(JwtAuthGuard)
@ApiBearerAuth()
async validateCart(@Body() dto: ValidateCartDto, @Req() req: any) {
  return this.product.validateCart(dto.skuIds, req.user.sub)
}
```

Keep the brands endpoint for existing internal dependencies, but remove all product-edit dependence on it.

- [ ] **Step 5: Update and run HTTP contract tests**

Add `validateCart` to the mock in `backend/test/product.contract.spec.ts` and test `POST /api/v1/products/cart-validation`. Run:

```powershell
npm.cmd test -- product-visibility.spec.ts product.contract.spec.ts pricing.spec.ts
```

Expected: all targeted suites pass and agreement-price tests remain green.

## Task 4: Customer Visibility Configuration

- [ ] **Step 1: Add failing customer service tests**

Create `backend/test/customer-visibility.spec.ts` to verify:

- `getProductVisibility(id)` returns mode, selected products, and current active visible count.
- `updateProductVisibility(id, { mode: 'custom', productIds: [1, 2] })` validates same-tenant active products and replaces associations in one transaction.
- custom mode rejects an empty list, duplicates, missing products, disabled products, and cross-tenant products.
- factory/all modes clear old associations.

Assert failed validation performs no `customer.update` or `customerVisibleProduct.deleteMany` calls.

- [ ] **Step 2: Run and confirm RED**

```powershell
npm.cmd test -- customer-visibility.spec.ts
```

Expected: FAIL because customer visibility methods and DTO do not exist.

- [ ] **Step 3: Add DTO and transactional service methods**

Create `backend/src/customer/dto/update-product-visibility.dto.ts`:

```ts
export class UpdateProductVisibilityDto {
  @ApiProperty({ enum: ProductVisibilityMode })
  @IsEnum(ProductVisibilityMode)
  mode: ProductVisibilityMode

  @ApiPropertyOptional({ type: [Number] })
  @IsOptional()
  @IsArray()
  @ArrayUnique()
  @IsInt({ each: true })
  productIds?: number[]
}
```

Implement `getProductVisibility` and `updateProductVisibility` in `backend/src/customer/customer.service.ts`. Validate all IDs before opening the write transaction, then perform customer mode update, relation deletion, and optional `createMany` in one `$transaction` callback.

- [ ] **Step 4: Expose endpoints and remove channel DTO writes**

Add GET/PUT routes to `backend/src/customer/customer.controller.ts` and import `Put`. Remove `channelType` from both customer DTOs and from `CustomerService.create`. Generic customer update must continue to support existing fields but cannot mutate product visibility; only the dedicated endpoint may do so.

- [ ] **Step 5: Run targeted tests and typecheck**

```powershell
npm.cmd test -- customer-visibility.spec.ts
npm.cmd run typecheck
```

Expected: customer visibility tests and typecheck pass.

## Task 5: Normal Customer Level and Registration Defaults

- [ ] **Step 1: Add failing registration tests**

Create `backend/test/auth-registration.spec.ts` using mocked SMS, JWT, Redis, and Prisma. Verify a new registration:

- queries active level code `normal` for tenant 1;
- creates the customer with `customerLevelId` and `productVisibilityMode: 'factory'`;
- creates customer and user in one Prisma transaction;
- creates neither record when the normal level is missing.

- [ ] **Step 2: Run and confirm RED**

```powershell
npm.cmd test -- auth-registration.spec.ts
```

Expected: FAIL because current registration creates a level-less customer outside a transaction.

- [ ] **Step 3: Implement transactional registration**

In `backend/src/auth/auth.service.ts`, resolve the normal level before writes and throw a configuration `BadRequestException` when absent. Replace separate creates with:

```ts
const created = await this.prisma.$transaction(async (tx) => {
  const customer = await tx.customer.create({
    data: {
      tenantId: 1,
      customerLevelId: normalLevel.id,
      productVisibilityMode: 'factory',
      customerName: name,
      contactPhone: phone,
      contactName: contactName || name,
      address: fullAddress || undefined,
      status: 'disabled'
    }
  })
  const user = await tx.user.create({ /* existing user fields with customer.id */ })
  return { customer, user }
})
```

Refetch the new user with current `tenant` and `customer` includes only if needed by the response.

- [ ] **Step 4: Repair and update the development seed**

In `backend/prisma/seed.dev.ts`:

- change the level upsert key and data from `standard / 标准客户` to `normal / 普通客户`;
- set demo customer mode to `factory`;
- set a deterministic subset such as the first five demo products to `isFactoryProduct: true` so guest verification has data;
- fix the pre-existing malformed product loop only if `npm.cmd run typecheck` confirms it is real source corruption.

- [ ] **Step 5: Run registration tests and full typecheck**

```powershell
npm.cmd test -- auth-registration.spec.ts auth.contract.spec.ts
npm.cmd run typecheck
```

Expected: both suites and typecheck pass.

## Task 6: Enforce Visibility During Order Creation

- [ ] **Step 1: Add a failing order test**

Extend `backend/test/pricing.spec.ts` with a mocked `ProductVisibilityService` and assert that a customer order containing a SKU from an invisible product throws before `order.create`. Keep the existing agreement-price assertion.

```ts
await expect(service.create({
  customerId: 3,
  items: [{ skuId: 11, quantity: 1 }]
}, 7)).rejects.toThrow('商品不存在或暂不可购买')
expect(orderCreate).not.toHaveBeenCalled()
```

- [ ] **Step 2: Run and confirm RED**

```powershell
npm.cmd test -- pricing.spec.ts
```

Expected: FAIL because current order creation accepts every active SKU.

- [ ] **Step 3: Inject and enforce the shared service**

Import `ProductModule` in `backend/src/order/order.module.ts`. Inject `ProductVisibilityService` into `OrderService`, obtain the actor-aware product condition once, and include it in the SKU query:

```ts
const productWhere = await this.productVisibility.whereForUser(userId)
const skus = await this.prisma.productSku.findMany({
  where: { id: { in: skuIds }, status: 'active', product: productWhere },
  include: { product: { select: { id: true, name: true } } }
})
```

If any requested SKU is missing from the result, return a clear bad-request message and `PRO_1004`; do not create a partial order. Continue deriving unit prices server-side from active agreement rules.

- [ ] **Step 4: Run pricing and visibility tests**

```powershell
npm.cmd test -- pricing.spec.ts product-visibility.spec.ts
```

Expected: invisible items are rejected and agreement pricing remains correct.

## Task 7: Admin Product and Customer UI

- [ ] **Step 1: Remove obsolete product controls**

In `admin-web/src/views/product/ProductEditView.vue`:

- remove `getBrands`, `brands`, `brandId`, and `visibilityType`;
- load categories and detail only;
- send `isFactoryProduct`;
- render `<el-switch v-model="form.isFactoryProduct" />` with label “工厂自产”.

The create payload must no longer contain `brandId`.

- [ ] **Step 2: Remove channel type from customer UI**

In `CustomerList.vue`, remove `channelType` from form initialization, reset, and drawer. In `CustomerDetail.vue`, remove its description row, edit-form field, and dialog control. Keep `customerType` unchanged.

- [ ] **Step 3: Add visibility API functions**

Append to `admin-web/src/api/customer.ts`:

```ts
export function getProductVisibility(customerId: number) {
  return http.get(`/customers/${customerId}/product-visibility`)
}

export function updateProductVisibility(customerId: number, data: Record<string, unknown>) {
  return http.put(`/customers/${customerId}/product-visibility`, data)
}
```

- [ ] **Step 4: Build the isolated visibility card**

Create `ProductVisibilityCard.vue` with props `{ customerId: number }`. It loads the current mode and active products, displays a radio-button segmented mode selector, and opens a dialog for custom selection. Use a stable `Set<number>` of selected IDs so filtering does not discard selections. Disable save when custom mode has zero selections and display `visibleProductCount` returned by the backend.

The component emits no generic customer updates; it calls only the dedicated visibility endpoint. Mount it as its own top-level card in `CustomerDetail.vue` between information and agreement-price sections.

- [ ] **Step 5: Run admin checks**

```powershell
npm.cmd run typecheck
npm.cmd run build
```

Run from `admin-web`. Expected: Vue typecheck and Vite production build succeed with no `channelType`, product `brandId`, or `visibilityType` references in the edited views.

## Task 8: Mini-Program Cart Refresh and Checkout Guard

- [ ] **Step 1: Add cart validation API adapter**

In `services/api/product.js`, add:

```js
function validateCart(skuIds) {
  return request({
    url: '/api/v1/products/cart-validation',
    method: 'POST',
    data: { skuIds },
    showLoading: false
  })
}
```

Export it with the existing product API functions.

- [ ] **Step 2: Make cart state validity-aware**

In `store/modules/cart.js`, add `applyValidation(result)` that keeps every cached line but updates its current name/spec/unit/price/stock and sets `available` plus `unavailableReason`. Change `getCount()` and persisted `cartCount` to sum only lines where `available !== false`. Add `getCheckoutItems()` returning only available lines.

- [ ] **Step 3: Refresh the bottom sheet on open**

Make `cart-sheet.loadCart()` asynchronous: call `validateCart` for unique SKU IDs when logged in, apply results, then map rows. Invalid rows display “商品已下架或不在当前可见范围”, do not contribute to totals, and cannot be increased. Checkout is disabled while validation is running or while no valid lines remain.

Add a remove action for invalid rows instead of silently deleting them. Preserve the bottom-sheet interaction; do not navigate to the legacy cart page.

- [ ] **Step 4: Revalidate checkout**

In `pages/checkout/checkout.js`, replace snapshot-only `onLoad` with an async refresh using `validateCart`. Before `createOrder`, validate once more and stop with a visible message when any selected line became unavailable. Build order items only from `cart.getCheckoutItems()`.

Apply the same refresh helper in `pages/cart/cart.js` so a direct legacy route cannot bypass the state rules.

- [ ] **Step 5: Run mini-program syntax and reference checks**

From the repository root:

```powershell
node --check services\api\product.js
node --check store\modules\cart.js
node --check components\business\cart-sheet\cart-sheet.js
node --check pages\checkout\checkout.js
node --check pages\cart\cart.js
rg -n "channelType|visibilityType|getBrands|brandId" admin-web\src\views\product\ProductEditView.vue admin-web\src\views\customer\CustomerDetail.vue admin-web\src\views\customer\CustomerList.vue
```

Expected: all syntax checks exit 0; the final `rg` returns no obsolete UI references.

## Task 9: Full Verification and Live Data Audit

- [ ] **Step 1: Run static verification**

From `backend`:

```powershell
npx.cmd prisma validate
npm.cmd run lint
npm.cmd run typecheck
npm.cmd test
npm.cmd run build
```

Expected: every command exits 0. Record the exact Jest suite/test count.

- [ ] **Step 2: Apply migration to the local development database**

From repository root, first verify location and container health:

```powershell
Get-Location
docker compose -f docker-compose.dev.yml ps
```

Then from `backend`:

```powershell
npx.cmd prisma migrate deploy
npm.cmd run db:seed:dev
```

Expected: migration is applied once and seed exits 0. Do not continue if duplicate `normal`/`standard` rows make the migration ambiguous.

- [ ] **Step 3: Audit real rows**

Use Prisma Studio, MySQL CLI, or a read-only query to verify:

- no customer level displays “标准客户”;
- `normal / 普通客户` retains the prior level ID;
- every customer has `product_visibility_mode = factory` unless deliberately changed afterward;
- products formerly marked `visibility_type = 1` are factory products;
- customer visible-product rows never cross tenants.

- [ ] **Step 4: Run live API checks**

With the backend running, verify HTTP status and response body for:

- guest product list contains only factory products;
- internal admin list contains all active products;
- a factory customer cannot fetch non-factory detail or SKU endpoints (`404`);
- all/custom customer results match configuration;
- invisible SKU order creation returns a business error and creates no order;
- visible SKU order creation uses the active agreement price.

- [ ] **Step 5: Run frontend verification**

Start the admin dev server, inspect the product edit and customer detail pages, and verify at desktop and narrow widths that controls do not overlap. Compile the mini-program in WeChat DevTools and inspect the bottom cart sheet with valid and invalid products.

- [ ] **Step 6: Final regression check**

Confirm dashboard paid-sales behavior, payment/credit workflow, inventory deduction, SKU selection, and agreement prices are unchanged. Report any environment-only checks that could not be completed instead of treating build success as live deployment proof.
