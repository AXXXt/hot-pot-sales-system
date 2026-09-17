# Cursor 提示词：管理后台完整构建

请直接执行本任务，不要只给方案或伪代码。

---

## 1. 项目当前状态

这是一个火锅食材 B2B 小程序项目，三端架构：

| 端 | 技术栈 | 状态 |
|---|---|---|
| 小程序 `pages/` | 微信原生 + WXML/WXSS | UI 已完成，已接入后端真实 API |
| 后端 `backend/` | NestJS + Prisma + MySQL/Redis/MinIO | 核心 API 就绪，运行在 `http://127.0.0.1:3000` |
| 管理后台 `admin-web/` | Vue 3 + Element Plus + Vite + Pinia | **仅有空壳，需要你完整构建** |

**后端已验证通过：**
- `/health` → `{"status":"ok"}`
- `/health/ready` → database/redis/minio 均 ok
- Swagger 文档：`http://127.0.0.1:3000/api/docs`
- 登录流程通：验证码 `123456`（development），手机号 `13800000000`，返回 JWT
- 商品列表/详情/SKU/分类/品牌 接口通，20 条种子数据

**种子数据摘要：**
- 租户：`demo` | 品牌：`演示品牌` | 超级管理员：`13800000000`
- 分类：12 个 | 商品：20 个 | SKU：20 个 | 仓库：1 个 | 库存：每种 20+
- 客户：1 个（演示客户）| 协议价：20 条 | 角色：6 个 | 权限：12 条

---

## 2. 不可破坏的边界

- **只修改 `admin-web/` 目录和 `backend/src/` 目录**，不动小程序代码
- 管理后台用 Element Plus，图标用 `@element-plus/icons-vue`（已安装）
- 后端返回统一结构：`{ code: 0, message: "success", data: ..., requestId: "..." }`
- code !== 0 即为错误，额外含 `errorCode` 字段
- 后端字段为 camelCase，前端直接使用
- 金额为字符串（Decimal），展示保留两位小数

---

## 3. 管理后台架构

```
admin-web/src/
├── api/               # axios 封装 + 各模块 API
│   ├── request.ts     # 基地址 3000/api/v1、Bearer token、401 刷新、错误提示
│   ├── auth.ts        # sendCode / login / refreshToken / logout / getProfile
│   ├── product.ts     # 商品 CRUD + 分类 + SKU + 品牌
│   ├── customer.ts    # 客户 + 等级 + 协议价
│   ├── order.ts       # 订单 + 状态流转 + 改价
│   ├── inventory.ts   # 库存 + 仓库 + 调整 + 日志
│   ├── user.ts        # 用户 + 角色 + 权限
│   ├── audit.ts       # 审计日志
│   └── system.ts      # 系统配置
├── stores/
│   ├── auth.ts        # token/user/profile/roles/permissions/menus/brands
│   └── app.ts         # sidebar collapse、breadcrumb
├── router/
│   └── index.ts       # 路由定义 + 登录守卫 + 权限检查
├── layouts/
│   └── MainLayout.vue # 左侧导航（el-menu）+ 顶部栏 + 退出 + <router-view>
├── views/
│   ├── login/LoginView.vue
│   ├── dashboard/DashboardView.vue
│   ├── product/       # CategoryList、ProductList、ProductEdit
│   ├── customer/      # CustomerList、CustomerDetail、CustomerLevel
│   ├── order/         # OrderList、OrderDetail、OrderCreate
│   ├── inventory/     # WarehouseList、InventoryList、InventoryAdjust、InventoryLog
│   ├── user/          # UserList、RoleList、RoleEdit
│   ├── audit/AuditLogList.vue
│   └── system/SystemConfig.vue
├── App.vue
└── main.ts
```

---

## 4. API 接口清单

### 4.1 已就绪（前端直接调用）

| 方法 | 路径 | 说明 |
|------|------|------|
| POST | `/auth/send-code` | `{ phone }` |
| POST | `/auth/login` | `{ phone, code }` → `{ accessToken, refreshToken, user }` |
| POST | `/auth/refresh-token` | `{ refreshToken }` → `{ accessToken, refreshToken }` |
| POST | `/auth/logout` | 需 Bearer |
| GET | `/auth/profile` | → `{ user, customer, tenant, brands, roles, permissions, menus }` |
| GET | `/products` | query: `brandId, categoryId, keyword, sortBy, inStock, page, pageSize` |
| GET | `/products/:id` | 详情含 skus/brand/category/unit |
| GET | `/products/:id/skus` | SKU 列表 |
| GET | `/product-categories` | query: `brandId` |
| GET | `/brands` | 品牌列表 |

### 4.2 需要你新建的后端接口

以下接口后端尚未实现。需在 `backend/src/` 下创建 domain module（controller + service + dto + module），并在 `app.module.ts` 中注册。统一前缀 `/api/v1`。

**商品 CRUD**

| 方法 | 路径 | 说明 |
|------|------|------|
| POST | `/products` | body: `{ brandId, categoryId, code, name, subtitle, baseSpec, mainImageUrl, description, deliveryText, unitId }` |
| PATCH | `/products/:id` | 更新商品 |
| PATCH | `/products/:id/status` | `{ status: "active" \| "disabled" }` |
| POST | `/products/:id/skus` | `{ skuCode, name, specText, saleUnit, basePrice, minOrderQty }` |
| PATCH | `/skus/:id` | 更新 SKU（路径直接在 controller 上） |
| PATCH | `/skus/:id/status` | `{ status: "active" \| "disabled" }` |
| POST | `/product-categories` | `{ brandId, name, code, sortOrder }` |
| PATCH | `/product-categories/:id` | 更新分类 |

**库存**

| 方法 | 路径 | 说明 |
|------|------|------|
| GET | `/inventories` | query: `brandId, warehouseId, skuId, page, pageSize` |
| POST | `/inventories/adjust` | `{ skuId, warehouseId, changeQty, reason }`，原子化更新，校验 onHandQty - changeQty ≥ 0（出库时），同步写 inventory_logs |
| GET | `/inventories/logs` | query: `skuId, page, pageSize` |
| GET | `/warehouses` | 列表 |
| POST | `/warehouses` | `{ brandId, name, address }` |

**客户**

| 方法 | 路径 | 说明 |
|------|------|------|
| GET | `/customers` | query: `keyword, page, pageSize`，关联 customerLevel |
| GET | `/customers/:id` | 详情含 level、priceRules |
| POST | `/customers` | `{ customerName, customerType, contactName, contactPhone, address, customerLevelId }` |
| PATCH | `/customers/:id` | |
| GET | `/customer-levels` | 列表 |
| POST | `/customer-levels` | `{ brandId, name, code, discountRate }` |
| GET | `/customer-price-rules` | query: `customerId` |
| POST | `/customer-price-rules` | `{ brandId, customerId, productId, skuId, priceType: "agreement"\|"manual", price }` |

**订单**

| 方法 | 路径 | 说明 |
|------|------|------|
| GET | `/orders` | query: `status, customerId, page, pageSize` |
| GET | `/orders/:id` | 含 items、statusLogs、priceAdjustments |
| POST | `/orders` | `{ customerId, items: [{ skuId, quantity }], remark }`，创建时写入 order_items 快照（商品名/规格/单价）、计算金额、生成 orderNo |
| POST | `/orders/:id/confirm` | pending_confirm → confirmed，扣减库存（available - quantity, reserved + quantity → reserved - quantity, onHand - quantity） |
| POST | `/orders/:id/cancel` | → cancelled，释放预留库存 |
| POST | `/orders/:id/complete` | → completed |
| POST | `/orders/:id/adjust-price` | `{ afterAmount, reason }`，写 priceAdjustments，重新计算 payableAmount |

**订单状态白名单：**
- `draft → pending_confirm`
- `pending_confirm → confirmed | cancelled`
- `confirmed → cancelled`（特殊取消）
- `confirmed → completed`（简化流程）
- 非法转换返回明确错误

**用户与权限**

| 方法 | 路径 | 说明 |
|------|------|------|
| GET | `/users` | query: `page, pageSize`，含 roles |
| POST | `/users` | `{ tenantId, phone, name, userType, customerId?, roleIds: [] }` |
| PATCH | `/users/:id` | 含状态 `active/disabled`、角色更新 |
| GET | `/roles` | 列表 |
| POST | `/roles` | `{ tenantId, name, code, description }` |
| PATCH | `/roles/:id` | |
| POST | `/roles/:id/permissions` | `{ permissionIds: [] }` |
| GET | `/permissions` | 权限树 |

**审计**

| 方法 | 路径 | 说明 |
|------|------|------|
| GET | `/audit-logs` | query: `operatorId, module, action, page, pageSize` |
| GET | `/audit-logs/:id` | 含 beforeData/afterData |

**系统**

| 方法 | 路径 | 说明 |
|------|------|------|
| GET | `/system-configs` | |
| PUT | `/system-configs/:key` | `{ configValue, remark }` |

---

## 5. 前端页面详细要求

### 5.1 登录页 `/login`
- 手机号输入 + 验证码输入 + 「获取验证码」按钮（60s 倒计时，发送中禁用）
- 验证码输入框 6 位数字
- 调用 sendCode → login → 存储 token → getProfile → 存入 Pinia → 跳转 `/dashboard`
- 错误提示用 ElMessage
- 已登录用户访问 `/login` 自动跳转 dashboard

### 5.2 Dashboard `/dashboard`
- **聚合卡片行**（4~5 个 el-statistic 卡片，el-row + el-col）：今日订单数、今日销售额、待确认、库存预警
- 数据来源：调 `/orders` 统计 + 调 `/inventories` 查预警（availableQty ≤ warningQty）
- **趋势图**：安装 `echarts`，近 7 日订单量折线图（从 `/orders` 按日期聚合）
- **最新订单**：el-table 展示最近 10 条，点击跳详情
- 无数据时显示 el-empty，不显示假数据
- loading 时显示 el-skeleton

### 5.3 商品管理
- **分类页** `/products/categories`：el-table，列：名称/编码/排序/操作（编辑按钮 + 弹窗表单）。顶部「新建分类」按钮。
- **商品列表** `/products`：搜索栏（关键词 el-input + 分类 el-select + 品牌切换）+ el-table（名称/分类/规格/推荐标记/状态 tag/操作）+ 分页。操作列：编辑、上下架（switch）、删除。
- **商品编辑** `/products/:id/edit`：el-form（名称/副标题/编码/规格/分类/单位/描述/配送说明/推荐开关/主图 URL）。新建和编辑复用同一组件。
- **SKU 管理**：在商品编辑页内嵌 el-table，列：编码/名称/规格/售价/起订量/状态/操作。支持行内新建（弹窗 el-dialog）。

### 5.4 库存管理
- **仓库列表** `/inventory/warehouses`：简单 el-table + 新建弹窗
- **库存查询** `/inventory`：筛选（仓库 el-select + SKU 搜索）+ el-table（SKU/仓库/在手量/可用量/预留量/锁定量/预警量/状态标签）+ 分页。可用量 ≤ 预警量时行高亮橙色。
- **库存调整** `/inventory/adjust`：el-form（选择仓库 + 选择商品 SKU + 调整数量 ± + 原因 textarea）。提交前二次确认。
- **库存日志** `/inventory/logs`：el-table（SKU/仓库/类型 tag/变化量/前后数量/原因/时间）+ 分页。

### 5.5 客户管理
- **客户列表** `/customers`：搜索关键词 + el-table（名称/类型/联系人/电话/等级/状态/操作）+ 分页
- **客户详情** `/customers/:id`：基本信息卡片 + 协议价表格（SKU/价格/类型/有效期）。新建/编辑用 el-dialog。
- **客户等级** `/customers/levels`：el-table + 新建/编辑弹窗

### 5.6 订单管理
- **订单列表** `/orders`：状态 tabs（全部/待确认/已确认/已完成/已取消）+ el-table（订单号/客户/金额/状态 tag/时间/操作）+ 分页
- **订单详情** `/orders/:id`：订单信息卡片 + 商品明细表格 + 金额汇总 + 状态时间线（el-timeline）+ 操作栏（确认/取消/完成/改价，按钮按状态显隐）
- **创建订单** `/orders/create`：选择客户（el-select 搜索）→ 选择商品（搜索 + el-table 多选 SKU + 数量输入）→ 确认创建
- **改价**：在详情弹窗中输入调整后金额 + 原因

### 5.7 用户与权限
- **用户列表** `/users`：el-table（姓名/手机/类型/状态/角色/操作）+ 分页。新建/编辑用 el-dialog（含角色多选 el-select）。
- **角色列表** `/roles`：el-table + 新建/编辑弹窗。编辑弹窗内含权限树（el-tree，多选勾选，default-checked 根据已有权限）。

### 5.8 审计日志 `/audit-logs`
- 搜索栏（操作人/模块/动作 el-select）+ el-table（操作人/模块/动作 tag/目标/时间/详情按钮）+ 分页
- 详情弹窗：beforeData 和 afterData 用 JSON 对比展示（可用 `vue-json-pretty` 或自己写 pre 标签）

### 5.9 系统配置 `/system`
- el-table（Key/Value/备注/操作）+ 编辑弹窗（el-input 或 el-input-number 根据 configType）

---

## 6. 设计与交互规范

- **布局**：`<el-container>` + `<el-aside>`（固定左侧导航，260px）+ `<el-main>`
- **导航**：`<el-menu>` router 模式，从 profile.menus 动态生成，图标用 Element Plus Icons
- **顶部栏**：当前用户名称 + 品牌切换（如有多个 brand）+ 退出按钮
- **配色**：中性黑白灰为主，蓝用于聚焦，绿/橙/红仅用于状态标签
- **表格**：统一 `stripe` `border` 样式，操作列固定在右侧 `fixed="right"`
- **弹窗**：`el-dialog` 宽度 520~640px，表单 `label-width="100px"`
- **三态**：每个数据组件必须有 loading（el-skeleton/v-loading）/ empty（el-empty）/ error（el-alert + 重试按钮）
- **危险操作**：`ElMessageBox.confirm` 二次确认
- **消息提示**：成功 `ElMessage.success`，失败 `ElMessage.error`
- **CSS 变量**：颜色/间距/字体通过 CSS 变量定义在 `:root`，方便后续加暗色模式

---

## 7. 执行顺序（严格按此顺序）

1. `api/request.ts` — axios 封装
2. `api/auth.ts` + `stores/auth.ts` + `router/index.ts` — 认证层
3. `layouts/MainLayout.vue` + `App.vue` + `main.ts` — 壳
4. `views/login/LoginView.vue` — 登录（此时应可完成登录→dashboard 闭环）
5. `api/product.ts` + `views/dashboard/DashboardView.vue` — 工作台
6. 后端：商品 CRUD 接口 + contract 测试
7. 前端：分类 + 商品列表 + 商品编辑 + SKU 管理
8. 后端：库存/仓库接口 + 测试
9. 前端：仓库 + 库存查询 + 调整 + 日志
10. 后端：客户/等级/协议价接口 + 测试
11. 前端：客户列表 + 详情 + 等级
12. 后端：订单接口 + 测试
13. 前端：订单列表 + 详情 + 创建 + 状态流转
14. 后端：用户/角色/权限接口 + 测试
15. 前端：用户 + 角色 + 权限
16. 后端：审计/系统配置接口 + 测试
17. 前端：审计日志 + 系统配置

---

## 8. 验收标准

- 每个页面调用真实 `http://127.0.0.1:3000/api/v1` 接口
- 不做 `setTimeout` 假加载、硬编码 Mock 数组
- 前端：`npm run lint` 通过、`npm run typecheck` 通过、`npm run build` 成功
- 后端：`npm run lint` 通过、`npm run typecheck` 通过、`npm run test` 新测试通过
- 每个页面有 loading / empty / error 三态
- 完成后输出测试结果截图或命令行输出

从第 1 步开始执行。
