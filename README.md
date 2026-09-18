# 火锅食材 B2B 销售平台

微信小程序（客户下单）+ Vue 管理后台（内部运营）+ NestJS 后端 + MySQL/Redis/MinIO 的 B2B 火锅食材订货平台。

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
│  └─ src/views/                     # dashboard/product/customer/order/user/audit/system
├─ backend/                          # NestJS 后端
│  ├─ src/                           # auth/product/order/customer/user/brand/dashboard/audit/system/upload
│  ├─ prisma/                        # 数据库模型、迁移、种子
│  └─ test/                          # Jest 测试
├─ docs/                             # 架构/设计文档
└─ docker-compose.dev.yml            # 本地基础设施
```

## 快速启动（开发环境）

### 1. 启动基础设施（MySQL/Redis/MinIO）

```powershell
docker compose -f docker-compose.dev.yml up -d
```

### 2. 初始化数据库

```powershell
cd backend
npm install
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
npm install
npm run dev
# 访问: http://127.0.0.1:5173
```

### 5. 小程序

用微信开发者工具导入项目根目录（AppID 见 `project.config.json`），
`config.js` 中 `baseUrl` 指向 `http://127.0.0.1:3000`。

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
npm test            # jest（160 个用例）

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

## 新增 Web 应用

### web-customer（PC 客户采购端）

面向已审核通过的火锅餐饮客户，提供商品浏览、进货单、按品牌下单、订单状态跟踪与一键复购。

```bash
cd web-customer
npm install
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
