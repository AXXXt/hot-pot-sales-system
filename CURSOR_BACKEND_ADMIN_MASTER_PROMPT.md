# Cursor 主提示词：后端 API + 网页管理端第一期真实搭建

请直接执行本任务，不要只给方案、伪代码、静态页面或“等待我提供 baseUrl”。当前仓库还没有后端和网页管理端；你需要在本机建立可运行的开发环境，并用真实数据库、真实 API 和真实管理端页面解除小程序登录与商品接口的阻塞。

## 1. 先读文档和现有代码

开始修改前，完整阅读并以这些文件为需求依据：

- `01-项目总览/01_CODE_STANDARDS.md`
- `02-后端与数据/01_PROJECT_ARCHITECTURE.md`
- `02-后端与数据/02_DATABASE_DESIGN.md`
- `02-后端与数据/03_API_SPEC.md`
- `03-前端与设计/01_UI_UX_SPEC.md`
- `03-前端与设计/02_COMPONENT_LIBRARY.md`
- `03-前端与设计/03_DESIGN_TOKENS.md`
- `03-前端与设计/04_PAGE_LAYOUT_SPEC.md`
- `03-前端与设计/05_MOTION_GUIDELINES.md`
- `05-运维与发布/01_CI_CD_ARCHITECTURE_CN.md`
- `MINIAPP_API_INTEGRATION_CHECKLIST.md`
- 现有 `config.js`、`constants/api.js`、`services/request.js`、`services/api/*`、登录页、首页、分类页和商品详情页

先输出一张“文档要求 -> 当前代码 -> 本轮实现”的差异表，再开始编码。若文档与现有运行代码冲突，以“不破坏现有小程序 + 统一 API 规范 + 可真实联调”为准，并在实施记录中写明取舍。

## 2. 不可破坏的仓库边界

- 现有仓库根目录就是微信原生小程序，第一期禁止移动到 `apps/miniapp`，禁止改成 Taro、UniApp、React 或 Web 项目。
- 现有 `services/api` 是小程序请求封装，禁止把 NestJS 后端放进去。
- 新增 `backend/` 作为统一后端，新建 `admin-web/` 作为网页管理端；本轮不要做大规模 monorepo 搬迁。
- 同步更新 `project.config.json` 的 `packOptions.ignore`，明确排除 `backend/`、`admin-web/`、Docker、文档、测试、依赖和构建产物；验证这些新增目录不会进入微信小程序上传包。
- 只允许为真实联调最小修改小程序的环境配置、Service 适配和字段映射，禁止顺手重写已经完成的 UI。
- 不得删除、覆盖或回退仓库中已有的用户改动。

目标目录至少包括：

```text
miniprogram/
├─ backend/                 # NestJS 模块化单体
├─ admin-web/               # Vue 3 管理端
├─ docker-compose.dev.yml   # MySQL、Redis、MinIO 和可选应用服务
├─ docs/backend-admin/      # 契约、启动、联调、验收记录
└─ ...现有小程序文件保持原位
```

## 3. 技术选型已经确定，不再发散

后端使用 Node.js LTS + NestJS + TypeScript + Prisma + MySQL 8 + Redis 7；使用 JWT Access Token/Refresh Token、class-validator、Swagger/OpenAPI、结构化日志、Helmet、CORS 白名单和限流。对象存储通过接口抽象，本地开发使用 MinIO（S3 兼容），生产预留腾讯云 COS/阿里云 OSS 适配器。

管理端使用 Vue 3 + TypeScript + Vite + Pinia + Vue Router + Element Plus + Axios；图表只在真实 Dashboard 数据存在时使用 ECharts。每个应用独立安装、测试、构建，不要求现在重构成 workspace。

后端采用一个部署单元的模块化单体，按 `auth`、`tenant`、`customer`、`product`、`order`、`inventory`、`audit`、`file`、`system` 分域。`billing`、`delivery` 只保留清晰扩展边界，本轮不实现结算、支付、复杂配送。

## 4. 实施顺序：按纵向闭环推进

### 阶段 A：工程基础与可运行环境

1. 建立 NestJS、Prisma、配置校验、全局 DTO 校验、统一异常过滤器、统一响应拦截器、requestId、日志、Swagger、健康检查。
2. 建立 `docker-compose.dev.yml`，至少包含 MySQL、Redis、MinIO，提供健康检查、具名 volume 和 `.env.example`；任何密钥不得提交真实值。
3. 提供可追踪 Prisma migration 和幂等 seed；禁止用运行时 `db push` 代替正式迁移。
4. 建立 Vue 管理端壳：登录、路由守卫、Pinia 鉴权、动态菜单、权限指令、统一请求和错误恢复。
5. 先跑通 `/health`、`/health/ready`、Swagger 和数据库/Redis/MinIO 连通，再进入下一阶段。

### 阶段 B：先解除当前小程序阻塞

实现并验证：

- `POST /api/v1/auth/send-code`
- `POST /api/v1/auth/login`
- `POST /api/v1/auth/refresh-token`
- `POST /api/v1/auth/logout`
- `GET /api/v1/auth/profile`
- `GET /api/v1/brands`
- `GET /api/v1/product-categories`
- `GET /api/v1/products`
- `GET /api/v1/products/{id}`
- `GET /api/v1/products/{id}/skus`
- 商品/SKU 对应的可售库存和客户价

开发短信必须使用明确的 `development` adapter：验证码写入 Redis，有 TTL、手机号和 IP 限流、校验次数限制；HTTP 响应绝不返回验证码。允许 `SMS_DEV_CODE=123456` 供自动化测试，并仅在非生产日志中标记 `[DEV_SMS]`。`NODE_ENV=production` 时若真实短信供应商未配置，应用必须启动失败，不能自动退回固定验证码。

不要要求我提供远程 baseUrl。后端本地默认 `http://127.0.0.1:3000`；启动健康后，再把小程序开发配置指向这个地址。微信开发者工具可使用本地地址；真机联调若缺少局域网地址、HTTPS 证书或微信合法域名，要明确列为外部阻塞，不能声称真机已通过。

### 阶段 C：真实可运营管理端

按真实 API 完成以下页面，不得使用 `setTimeout`、硬编码数组或 Mock 冒充完成：

- 登录页与当前用户/租户/品牌上下文
- Dashboard：今日订单数、今日销售额、待确认/待发货、库存预警、近 7/30 日趋势、最新订单、最近审计；没有售后模块时不显示“待处理售后”假数据
- 租户与品牌管理
- 商品分类、商品、SKU、上下架、图片上传
- 仓库、库存列表、库存调整、库存日志
- 客户、客户等级、客户协议价
- 订单列表、详情、创建、确认、取消、合法状态流转、人工改价
- 用户、角色、权限树、角色授权、用户授权与启停
- 审计日志查询和详情
- 基础系统配置；文件记录可查看

补齐文档中只定义查询、但管理端实际需要的 CRUD 和聚合接口。接口仍统一在 `/api/v1` 下，通过后端权限 Guard 控制；不要只在前端隐藏按钮。

### 阶段 D：小程序真实回归

后端 API 使用统一、稳定的 camelCase JSON DTO；数据库继续使用 snake_case。不要同时返回两套重复字段。现有小程序若字段命名或分页消费方式与最终契约不同，只在 `services/api/*` 或专门 adapter 中集中转换，不要在多个页面散写兼容逻辑。

当前登录页必须继续收到 `data.accessToken`、`data.refreshToken`、`data.user`；`/auth/profile` 返回用户、客户、租户、可访问品牌、角色、权限和菜单上下文。商品列表使用标准分页 `data.items/page/pageSize/total`。请为登录、商品列表、商品详情、SKU 建立契约测试，并用真实 seed 数据验证小程序现有页面需要的全部字段。

同时修复以下真实联调阻断，但不要借机重做 UI：

- `services/request.js` 补齐 401 时的单次 Refresh Token、并发刷新合并、原请求重放和刷新失败清理登录态；防止刷新接口自身死循环。
- `components/business/product-row` 明确声明并透传 `productId`，确保列表能进入正确详情。
- `pages/home/home.js` 删除定时器假加载和恒为空商品，改为真实分类/商品接口；错误不得静默伪装成空数据。
- `pages/category/category.js` 在 Service adapter 中把现有 `category/sort` 映射为 `categoryId/sortBy/sortOrder/inStock`，并正确消费标准分页。
- `pages/profile/profile.js` 读取 auth store 和 `/auth/profile`，验证登录后资料可恢复、退出后清空。
- `constants/api.js` 不再保留会误导开发的 `https://api.example.com`；baseUrl 只有一个开发环境来源。

## 5. 数据库与领域规则

第一期实际建表至少包含：

`tenants`、`brands`、`users`、`user_brand_access`、`roles`、`permissions`、`user_roles`、`role_permissions`、`customers`、`customer_levels`、`customer_price_rules`、`product_categories`、`units`、`products`、`product_skus`、`warehouses`、`inventories`、`inventory_logs`、`orders`、`order_items`、`order_status_logs`、`order_price_adjustments`、`audit_logs`、`files`、`system_configs`。

使用 `users.customer_id` 关联客户账号，使用 `customers.sales_owner_id` 表达销售数据范围，并使用 `user_brand_access` 管理多品牌访问；不要建设通用规则引擎。结算、付款、票据、批次、效期、冷链、复杂仓配和复杂 BI 延期。商品和 SKU 使用客户端当前可接受的十进制自增 ID，不在本轮切换 UUID。

以下规则必须在后端领域层与事务中实现并有测试：

- 价格优先级：人工调价 > 客户协议价 > 客户等级价 > SKU 基础售价。
- 金额使用 `DECIMAL`/Prisma Decimal，API 输出统一的精确格式；禁止 JavaScript 浮点直接计算金额。
- 订单明细保存商品名、SKU、规格、单位、图片、单价、价格来源等下单快照。
- 订单状态转换使用白名单状态机，非法转换返回明确错误；已确认订单不得直接覆盖关键字段。
- 库存明确保存 `onHandQty`、`availableQty`、`reservedQty`、`lockedQty`，始终满足 `onHandQty = availableQty + reservedQty + lockedQty`。预占在 available 与 reserved 间转移，释放反向转移，真实出库同时减少 onHand 与 reserved；所有动作写日志。
- 库存更新必须原子化并发校验，任何路径都不得产生负库存；订单和库存联动使用事务。
- 所有核心查询强制带 `tenantId`；普通用户不得通过 query/body 自选租户。超级管理员跨租户必须显式选择并写审计。
- 销售只访问本人负责客户和订单；仓库、客服、财务按职责授权。
- 登录/退出、价格变化、库存调整、权限/角色变化、订单状态变化全部审计；审计记录包含 requestId、操作者、租户、目标、前值、后值、原因、IP、User-Agent 和时间，并脱敏敏感字段。

Seed 必须幂等，至少创建：1 个演示租户、2 个品牌、6 个默认角色、权限树、1 个超级管理员、1 个客户账号、12 个以上分类、20 个以上商品及多个 SKU、2 个仓库、正常/预警/售罄库存、客户等级与协议价、覆盖主要状态的订单。把开发账号和启动方式写入本地开发文档，不得生成生产默认密码或生产固定验证码。

## 6. API 统一合同

所有接口使用：

```json
{
  "code": 0,
  "message": "success",
  "data": {},
  "requestId": "req_xxx"
}
```

列表统一为 `data.items/page/pageSize/total`，时间统一 ISO 8601。成功 `code=0`；失败使用非零数值 `code`，并额外返回稳定字符串 `errorCode`，例如 `AUTH_3001`、`PRO_1001`、`INV_1001`。这样既满足现有小程序的数值判断，也保留文档要求的业务错误码。禁止 200 HTTP 状态包装所有错误，HTTP 状态与业务错误语义必须一致。

认证上下文至少返回：

```json
{
  "user": {},
  "customer": null,
  "tenant": {},
  "brands": [],
  "roles": [],
  "permissions": [],
  "menus": []
}
```

Swagger 必须包含 DTO、分页、枚举、错误示例、Bearer 鉴权和可直接执行的示例。新增 `docs/backend-admin/API_CONTRACT.md`，记录小程序字段映射，不允许前后端各自猜字段。

## 7. RBAC 与安全底线

- 默认角色：超级管理员、管理员、销售、仓库、客服、财务。
- 权限覆盖菜单、页面、按钮/业务动作、后端 API 四层；权限码采用 `product:create`、`inventory:adjust` 这类稳定命名。
- 菜单由 `/auth/profile` 的权限上下文生成；刷新页面后仍能恢复，路由访问、按钮展示和 API Guard 三层必须一致。
- Access Token 短期有效，Refresh Token 轮换并可撤销；退出后 Refresh Token 立即失效。
- 手机号登录只允许已存在且启用的账号；未知手机号不得自动注册为管理员，客户账号也不得自动获得任意客户或品牌权限。
- 全局 validation 使用 whitelist/forbidNonWhitelisted；上传限制 MIME、扩展名、大小和授权范围。
- CORS 使用环境白名单；生产密钥只允许来自环境变量；日志不得输出验证码、Token、手机号全量或数据库密码。
- 写接口防重复提交；订单创建必须支持幂等键或等价的服务端幂等机制。

## 8. 管理端 UI 与交互标准

这是高频运营工具，不是营销官网。默认采用明亮、安静、克制的工作台风格；“苹果感”来自排版、层级、留白、细节和流畅反馈，不来自大面积毛玻璃、渐变、超大标题或装饰性卡片。

- 固定左侧导航 + 克制顶部栏 + 主内容区 + 必要时右侧详情抽屉。
- 列表页统一为筛选区、紧凑工具栏、固定表头表格、分页；详情优先抽屉或结构化信息区；长表单分组。
- 使用系统字体栈；颜色、间距、圆角、边框、阴影全部来自语义 token；卡片圆角不超过 8px，禁止卡片套卡片。
- 主色保持中性黑白灰，链接/焦点可用克制系统蓝；绿色、橙色、红色只表达成功、预警、危险。
- 图标只用 Element Plus Icons；不使用 emoji、文本符号或手绘 SVG 冒充图标。
- 页面信息密度适合 1280–1440px 桌面工作区，1024px 仍可操作；文字、表格、操作按钮不得溢出或重叠。
- 所有页面必须有 loading、empty、error、forbidden、disabled、提交中和失败重试状态；危险操作二次确认，保存失败保留表单内容。
- 动效只用于状态反馈：快速反馈 120–180ms，常规过渡 180–260ms，抽屉/模态 240–320ms，并支持 `prefers-reduced-motion`。
- Dashboard 只展示真实聚合数据，图表少而精；禁止用随机数或静态假趋势。
- 第一轮以浅色工作台为默认，并提供功能等价的深色主题；两套主题都只能通过语义 token 实现，不能在页面中散写颜色。

## 9. 测试、验收与证据

后端至少覆盖：验证码过期/限流/错误、Token 刷新与撤销、越权与跨租户、价格优先级、金额精度、订单合法/非法状态流转、库存并发与不为负数、审计写入、分页和商品契约。

管理端至少使用 Vitest 覆盖鉴权 store、路由守卫、权限指令、API 错误恢复和关键表单；使用 Playwright 跑通：开发验证码登录 -> 新建分类/商品/SKU -> 上传图片 -> 调整库存 -> 新建客户协议价 -> 创建并确认订单 -> 查看审计日志。

完成前必须实际执行并报告：

- 后端 lint、unit test、e2e test、build
- Prisma migration 状态和幂等 seed
- 管理端 lint、unit test、build、Playwright E2E
- Docker Compose 服务健康状态
- `/health`、登录、profile、商品列表、商品详情、SKU 的真实 HTTP 响应摘要，且每个响应有 requestId
- 1440×900 和 1280×720 的管理端截图检查：无溢出、遮挡、假数据、空白断层
- 小程序登录页与商品详情的真实接口契约验证；若无法控制微信开发者工具，必须如实标为“仅 HTTP/契约测试通过，未完成开发者工具视觉验证”

仓库目前没有根级 Node 工作区，必须在两个新应用内提供稳定脚本，并至少实际运行以下等价命令（Windows 使用 `.cmd`）：

```powershell
docker compose -f docker-compose.dev.yml up -d mysql redis minio
npm.cmd --prefix backend ci
npm.cmd --prefix backend run db:migrate
npm.cmd --prefix backend run db:seed:dev
npm.cmd --prefix backend run lint
npm.cmd --prefix backend run typecheck
npm.cmd --prefix backend run test
npm.cmd --prefix backend run test:e2e
npm.cmd --prefix backend run test:contract
npm.cmd --prefix backend run build
npm.cmd --prefix admin-web ci
npm.cmd --prefix admin-web run lint
npm.cmd --prefix admin-web run typecheck
npm.cmd --prefix admin-web run test:unit
npm.cmd --prefix admin-web run test:e2e
npm.cmd --prefix admin-web run build
docker compose -f docker-compose.dev.yml up -d --build
docker compose -f docker-compose.dev.yml ps
Invoke-RestMethod http://127.0.0.1:3000/health
```

如实际脚本名不同，必须在文档中给出一一对应关系；最终报告包含真实退出码、测试数量和失败/跳过项，不能只列命令名称。

不要用“代码已写”“理论可运行”“前端已接入”作为验收。最终报告按“已完成 / 验证证据 / 外部阻塞 / 下一步”四段输出，并列出实际命令和结果摘要。

## 10. 明确停止条件

- 没有真实短信资质：本地 development adapter 继续完成联调；生产短信标为外部阻塞，不得伪造已接入。
- 没有 COS/OSS 凭证：本地 MinIO 完成真实上传；生产对象存储标为外部阻塞。
- 没有服务器、域名、HTTPS、GitHub Secrets 或微信合法域名：完成本地构建和部署文档，但不得声称远程部署、真机联调或正式发布成功。
- Docker 或端口不可用：先定位并给出精确恢复命令；不要通过删除数据、关闭安全校验或换成内存假实现来绕过。

CI/CD 只建立可靠基础：开发环境可自动部署；生产仅允许 `v*` 版本标签、GitHub Environment 人工批准、版本化 Docker 镜像、独立数据库迁移、健康检查和回滚；微信正式发布仍保持人工操作。没有凭证时只验证 workflow 结构，绝不声称部署成功。

现在先完成差异表和实施清单，然后按 A -> B -> C -> D 连续执行。每个阶段只有在可运行和有证据后才能标记完成；遇到非外部阻塞请自行排查，不要把可在本地解决的问题重新抛给我。
