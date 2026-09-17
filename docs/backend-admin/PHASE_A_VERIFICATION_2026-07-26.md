# Phase A 验证记录

更新时间：2026-07-26

## 已验证

- `docker compose -f docker-compose.dev.yml config`：通过。
- 后端 TypeScript 语法扫描：14 个 `.ts` 文件，0 个语法诊断。
- Prisma Schema 静态关系扫描：模型关系的反向字段检查通过。
- Prisma Schema 关系标量字段扫描：0 个缺失字段。
- `project.config.json` 已排除 `backend`、`admin-web`、`docs`、`node_modules`、`dist`、`coverage`。

## 未验证及原因

- `npm install`：失败。当前机器到 `registry.npmjs.org:443` 和 `registry.npmmirror.com:443` 的 TCP 连接不可用，命令超时。
- `npm ci`：失败。尚未生成 `backend/package-lock.json`，npm 返回 `EUSAGE`。
- `npm run lint/typecheck/test/build`：未执行成功，依赖的 `eslint`、`tsc`、`jest`、`nest` 尚未安装。
- Prisma `generate/migrate/seed`：未执行，缺少 Prisma CLI、生成客户端和可连接的 MySQL。
- Docker Compose 启动：失败。Docker Desktop 进程存在，但 `docker_engine` pipe 不存在；`com.docker.service` 无法启动，Docker daemon 未就绪。
- `/health`、`/health/ready`：未启动后端，暂无真实 HTTP 证据。

## 本轮代码修正

- 完整化第一期 Prisma 模型、租户关系、RBAC 关联、客户等级/协议价、库存和审计关系。
- 将开发 seed 改为幂等演示数据：角色、权限、客户、用户、12 个分类、20 个商品/SKU、库存和协议价。
- 将 Prisma、Redis、MinIO provider 从静态假实现改为真实连接/健康检查结构。
- 接入配置校验、requestId、统一响应、异常过滤器、Swagger 和真实 readiness 检查。
- 将健康 HTTP 测试从 `expect(true)` 占位改为 Nest HTTP 合同测试。

## 恢复后执行顺序

```powershell
docker desktop start
docker info
docker compose -f docker-compose.dev.yml up -d mysql redis minio
npm.cmd --prefix backend install --registry=https://registry.npmjs.org
npm.cmd --prefix backend ci
npm.cmd --prefix backend run prisma:generate
npm.cmd --prefix backend run db:migrate
npm.cmd --prefix backend run db:seed:dev
npm.cmd --prefix backend run lint
npm.cmd --prefix backend run typecheck
npm.cmd --prefix backend run test
npm.cmd --prefix backend run test:e2e
npm.cmd --prefix backend run build
npm.cmd --prefix backend run dev
Invoke-RestMethod http://127.0.0.1:3000/health
Invoke-RestMethod http://127.0.0.1:3000/health/ready
```

在上述命令全部获得真实退出码前，不得把 Phase A 标记为完成，也不要进入 auth/brand/product/profile 的业务实现验收。
