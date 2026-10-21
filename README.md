# 火锅食材 B2B 销售平台

微信小程序（客户下单）+ Vue 管理后台（内部运营）+ NestJS 后端 + MySQL/Redis/MinIO 的 B2B 火锅食材订货平台。

当前已发布版本：**v1.2.6（2026-10-21，`ai-20261021-9`）**。在新电脑继续开发前，请先阅读[开发交接与接续提示词](dev-docs/development_handoff.md)、[本地联调环境](dev-docs/local_development.md)和[生产部署记录](dev-docs/production_deployment.md)。

仓库还包含待发布的[商品、库存与接单扩展](dev-docs/admin/operations_workflow.md)：规格专属图与复制、包装换算、AI批量库存、库存预占、补货草稿、采购清单转订单及批次保质期。新电脑须应用全部18个迁移；这些源码更新不代表线上或微信正式版已发布。

## 技术栈

| 端 | 技术 |
|---|---|
| 小程序 | 原生微信小程序（glass-easel 组件框架） |
| 管理后台 `admin-web/` | Vue 3 + TypeScript + Vite + Pinia + Element Plus |
| 后端 `backend/` | NestJS 11 + Prisma 6 + JWT + Swagger |
| 基础设施 | MySQL 8.4 / Redis 7.4 / MinIO（docker-compose） |

## 目录结构

```
miniprogram/
├─ app.js / app.json / config.js    # 小程序入口、tabBar、后端地址
├─ pages/                            # 小程序页面（home/category/product-detail/cart/checkout/orders/order-detail/profile/login...）
├─ components/                       # 小程序自定义组件
├─ services/                         # 小程序 API 封装（wx.request + token 刷新 + 字段适配）
├─ store/                            # 小程序本地状态（auth/brand/cart/config）
├─ admin-web/                        # Vue 管理后台
│  └─ src/views/                     # dashboard/product/inventory/customer/order/user/audit/system
├─ backend/                          # NestJS 后端
│  ├─ src/                           # auth/product/inventory/order/customer/user/brand/dashboard/audit/system/upload
│  ├─ prisma/                        # 数据库模型、迁移、种子
│  └─ test/                          # Jest 测试
├─ docs/                             # 架构/设计文档
└─ docker-compose.dev.yml            # 本地基础设施
```

## 快速启动（开发环境）

本机已有数据时，优先双击根目录 `start-dev.cmd`：自动备份并应用缺失迁移，启动后端、管理端、采购网站和官网，不重新写入演示数据。停止时使用 `stop-dev.cmd`，不会删除数据库或关闭其他项目。详细地址及小程序导入方法见 [本地联调环境](dev-docs/local_development.md)。

以下手动初始化步骤仅用于新的空开发数据库；已有环境不要重跑 `db:seed:dev`。

### 1. 启动基础设施（MySQL/Redis/MinIO）

```powershell
docker compose -f docker-compose.dev.yml up -d
```

### 2. 初始化数据库

```powershell
cd backend
if (!(Test-Path -LiteralPath .env)) { Copy-Item .env.example .env }
npm ci
npx prisma generate
npx prisma migrate deploy   # 应用迁移
npm run db:seed:dev         # 写入演示数据（幂等）
```

### 3. 启动后端（端口 3000）

```powershell
cd backend
npm run dev
# Swagger 文档: http://127.0.0.1:3000/api/docs
```

### 4. 启动管理后台（端口 5173）

```powershell
cd admin-web
npm ci
npm run dev
# 访问: http://127.0.0.1:5173
```

### 5. 小程序

运行 `node scripts/prepare-local-mini.cjs` 后，用微信开发者工具导入 `.wx-local-project`，项目名为 `weiduoxian-online-development`，默认连接线上 `https://weiduoxian.cn`。仅在明确需要本地后端联调时使用 `--local-backend`，不要擅自切换。

不要修改根目录 `config.js` 的生产地址，不要上传调试生成目录。正式上传应使用只包含运行文件的独立发布目录；原项目源包曾超过微信2MB限制。当前1.2.6开发包已上传，正式审核发布待微信后台操作。

## 演示账号（开发环境）

| 端 | 手机号 | 验证码 | 说明 |
|---|---|---|---|
| 管理后台 | 13800000000 | 123456 | 超级管理员 |
| 小程序 | 13900000000 | 123456 | 已审核演示客户 |

> 短信服务开发模式固定验证码 `123456`（`SMS_PROVIDER=development`）。
> 新手机号注册后需在管理后台「客户管理」审核通过才能登录。

## 环境变量

- 后端：`backend/.env`（参考 `backend/.env.example`、`backend/.env.production.example`）
- 管理后台：`admin-web/.env.development`（`VITE_API_BASE_URL` 指向后端 `/api/v1`）

生产环境强制项（不满足会启动失败）：
- `JWT_ACCESS_SECRET` / `JWT_REFRESH_SECRET` 必须使用强随机密钥
- `SMS_PROVIDER` 必须为真实短信服务商

## 测试

```powershell
# 后端
cd backend
npm run typecheck   # tsc --noEmit
npm run lint        # eslint --max-warnings=0
npm test            # Jest；最近一次验证47套件、369项

# 管理后台
cd admin-web
npm run typecheck   # vue-tsc --noEmit
npm run test:unit   # vitest
```

## 备份

```powershell
.\scripts\backup-db.ps1        # mysqldump 备份到 backup/ 目录
```

## 部署

- 开发/测试：`start-dev.cmd` 一键启动本地整套环境
- 生产：建议后端 Docker 化 + Nginx 反代 HTTPS + MySQL/Redis/MinIO 独立部署，
  详见 `docs/` 与 `05-运维与发布/`。

## 库存管理（进销存）

管理后台「库存管理」提供以下能力：

- **库存总览**：按 SKU 展示实时库存，支持商品名称/编码、品牌、分类、低库存筛选
- **库存流水**：记录每一笔库存变动（订单出库、取消退回、手动出入库、盘点盘盈/盘亏），含变动前后数量、操作人与来源单号
- **手动出入库**：期初库存、损耗、赠品、采购补录等场景，支持多明细批量提交，出库自动校验库存
- **库存盘点**：创建盘点单（全量或指定 SKU）→ 录入实盘数 → 保存草稿 → 完成盘点自动生成盘盈/盘亏调整并写入库存流水

后端接口：`/api/v1/inventory/*`（权限：`inventory:read` / `inventory:adjust`）。

## 新增 Web 应用

### web-customer（PC 客户采购端）

面向已审核通过的火锅餐饮客户，提供商品浏览、进货单、按品牌下单、订单状态跟踪与一键复购。

```bash
cd web-customer
npm ci
npm run dev
```

- 本地地址：<http://127.0.0.1:5174>
- 默认 API：`http://127.0.0.1:3000/api/v1`
- 可用 `.env` 配置 `VITE_API_BASE_URL`
- 生产构建：`npm run build`

### official-site（获客官网）

静态营销官网，介绍公司、供应链能力、采购流程和联系方式。

```bash
cd official-site
# 可直接使用任意静态服务器
npx serve .
```

### 后端 CORS

本地联调时需要在 `backend/.env` 的 `CORS_ORIGIN` 中追加 Web 客户端地址：

```env
CORS_ORIGIN=http://127.0.0.1:5173,http://localhost:5173,http://127.0.0.1:5174,http://localhost:5174
```
