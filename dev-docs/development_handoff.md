# 跨电脑开发交接

更新日期：2026-10-21。仓库：[AXXXt/hot-pot-sales-system](https://github.com/AXXXt/hot-pot-sales-system)，日常同步分支 `main`。

## 当前产品状态

线上已发布 **v1.3.0**，发布标识 **`ai-20261021-10`**，对应发布信息在 `deploy/releases/ai-20261021-10.json`。详细发布和验证记录以 `dev-docs/production_deployment.md` 为准。

三期运营扩展已上线后端、后台及采购站，见[商品、库存与接单扩展](admin/operations_workflow.md)：规格图片/复制、包装换算、AI批量库存、每规格补货参数与采购草稿、订单预占、客户清单转订单草稿、批次保质期。新增两项迁移，本地及线上均为18项；不要重复构建或回填历史预占。版本中心旧16项迁移版本已停用切换，保留历史资料；不能直接回滚到忽略预占与批次的旧逻辑。

| 应用 | 地址/目录 | 技术 |
| --- | --- | --- |
| 微信小程序 | 根目录 `pages/`、`components/`、`services/`、`store/` | 原生 JS/WXML/WXSS |
| 管理后台 | https://admin.weiduoxian.cn / `admin-web/` | Vue 3、TypeScript、Element Plus |
| 客户采购站 | https://app.weiduoxian.cn / `web-customer/` | Vue 3、TypeScript、Element Plus |
| 获客官网 | https://weiduoxian.cn / `official-site/` | 静态 HTML/CSS/JS |
| 后端 | https://weiduoxian.cn/api/v1 / `backend/` | NestJS 11、Prisma 6 |
| 基础设施 | `docker-compose.dev.yml`、`deploy/` | MySQL、Redis、MinIO、Nginx |

近期已完成并上线：

- 腾讯云真实短信接入及发送失败处理、手机号与发送频率校验。生产继续使用真实服务商，本地开发短信为固定验证码模式。
- AI 运营助手：配置、对话、包装图识别、业务草稿、确认执行、权限校验、模型密钥加密及审计。模型回复不会直接创建正式商品，执行需要确认。
- 平台版本中心与发布 worker：预检、备份、版本切换、审计及失败恢复。独立版本控制服务固定 `ai-20261021-3`，与业务后端版本分开。
- 小程序、后台、采购站与官网界面调整；个人中心、常购/复购、库存和商品权限相关修复。具体历史见部署及模块文档。
- 商品采用“管理标签＋真实商品名＋编码”：数据库 `Product.name` 是品牌加分类生成的标签；`subtitle` 是可修改的真实商品名。接口 `name` 与 `displayName` 返回真实展示名，`managementLabel` 返回标签。真实名称缺失回退标签。新订单保存下单时名称快照，不回写历史订单。详见 `dev-docs/admin/product_names.md`。
- 商品支持最多9张图片、单张5MB，后台上传/排序/设为主图/删除，图库属于商品，全部SKU共用；`images` 保持顺序，首图同步 `mainImageUrl`，兼容单图商品。小程序与采购站详情滑动查看。详见 `dev-docs/admin/product_images.md`。

微信 **1.3.0开发包已上传**，包体339587字节，不等于正式审核发布完成。小程序新包装单位选择、规格图片、大图预览及价格“起”等新展示需新包正式发布。本机会话无法打开微信公众平台网页，遇到的浏览器访问策略限制未绕过；正式审核发布应在有权限的微信后台完成。

v1.2.6建立的多规格最低实际价格标“起”、AI一句话库存调整草稿与确认流水、新建SKU自动延续编码继续保留；详见 `dev-docs/admin/stock_and_sku.md`。v1.3.0包装换算由运营人员人工设置，既有SKU默认未配置包装、未开启批次。库存只在确认后写入，规格编码在后端事务中自动分配，不应恢复手填编码。

## 新电脑首次准备（Windows）

准备 Git、Node.js 24（生产 Docker 构建所用版本）、Docker Desktop 和微信开发者工具。项目没有根目录 npm 包，依赖分别在三个应用中安装。

```powershell
git clone https://github.com/AXXXt/hot-pot-sales-system.git
cd hot-pot-sales-system

foreach ($app in @('backend', 'admin-web', 'web-customer')) {
  Push-Location $app
  try {
    npm ci
    if ($LASTEXITCODE -ne 0) { throw "npm ci failed: $app" }
  } finally { Pop-Location }
}

if (!(Test-Path -LiteralPath backend/.env)) {
  Copy-Item backend/.env.example backend/.env
}
node scripts/local-environment.cjs check

# 新电脑先拉取镜像；start-dev.cmd 自身使用 --pull never。
docker compose -f docker-compose.dev.yml pull
docker compose -f docker-compose.dev.yml up -d --wait
node scripts/local-environment.cjs migrate
```

上述迁移脚本只接受本机 `127.0.0.1:3307/b2b_miniapp`，先检查连通性、备份，再生成 Prisma Client、应用迁移。当前包含18个迁移目录。命令任何一步失败时先处理失败，不继续后续步骤。

只有确认是**首次创建的空开发数据库**时，才可进入 `backend/` 执行 `npm run db:seed:dev` 写入演示账号和商品。已有开发库不要重跑种子或重置数据。演示管理员 `13800000000`、客户 `13900000000`，需先获取验证码再输入 `123456`，仅适用于本地开发短信。

然后运行 `start-dev.cmd`，或：

```powershell
powershell.exe -NoProfile -ExecutionPolicy Bypass -File scripts/local-dev.ps1 start
```

本地后台 `http://127.0.0.1:5173`、采购站 `http://127.0.0.1:5174`、官网 `http://127.0.0.1:5180`、后端 `http://127.0.0.1:3000`。停止使用 `stop-dev.cmd`；不会删除数据库卷。

**小程序按用户要求默认连接线上**：

```powershell
node scripts/prepare-local-mini.cjs
```

微信开发者工具导入 `.wx-local-project`，默认项目名 `weiduoxian-online-development`，`baseUrl=https://weiduoxian.cn`、`isDevelopment=false`。未经用户明确要求，不加 `--local-backend`，不修改根目录 `config.js`。后台与采购站的本地 API 不会自动改变小程序接口源。旧环境令牌或购物车不可混入另一环境。

## 不会随 GitHub 同步的内容

- `node_modules`、构建目录、生成的 `.wx-local-project`、进程日志、截图及测试报告，需要在新电脑重新生成。
- `.env`、服务器 SSH 私钥、腾讯云/微信/模型凭据，以及 AI 加密主密钥，不进入仓库。新电脑开发使用独立本地配置；确需运维时从受控渠道单独配置，不能把密钥粘贴到源码、聊天提示词或提交记录。
- 数据库、Redis、MinIO 数据卷和业务图片文件不随代码复制。克隆仓库不会复制旧电脑或生产的商品、订单和图片；迁移这些数据是另一项操作，不默认下载生产数据。
- `output/`、`tmp/` 内的包装设计产物、证明材料和临时脚本保留在原电脑；运行时所需品牌图片已随各应用的正式资源目录同步。
- `project.private.config.json` 是机器配置，微信开发者工具可自行生成。

本地 AI 功能如需保存模型凭据，应单独在本地 `.env` 配置32随机字节的Base64 `AI_ENCRYPTION_KEY`。生产已有主密钥必须保留，替换后将无法解密既有模型配置。

## 验证与发布

2026-10-21 v1.2.5 已验证：后端45套件/352项，隔离数据库19项，根目录85项，管理端单元17项，采购站单元8项；采购站浏览器24项，管理端浏览器覆盖23项（其中1项首轮页面加载超时，单独重跑该文件3项通过）。原生模拟器通过轮播与线上接口检查。生产商品、SKU、分类、历史订单和AI配置哈希保持一致。

v1.2.6新增验证：后端46套件/366项、隔离数据库4套件/24项、根目录87项、后台浏览器25项通过；采购站26项覆盖，首轮24项通过，两个桌面冷启动超时在定向6项重跑中全部通过。库存测试覆盖重复并发确认、陈旧预览、单位不一致及权限撤销；SKU测试覆盖并发续号。线上7类业务模型全行哈希、配置环境及9个编译模块已核对。

v1.3.0运营扩展验证：源码基线 `08f9978` 的GitHub CI四项任务全通过，后端47套件/369项、隔离数据库5套件/34项、根目录及发布Node测试93项、管理端/采购站单元17/8项及浏览器29/28项通过。详细范围见 `admin/operations_workflow.md`。本地及线上18项迁移先备份后应用；生产116个编译模块、84个网站资源、11类业务表原有列摘要及环境配置核对通过，实际模型两类草稿及线上页面、原生模拟器验收通过，没有向正式库存或订单写测试数据。

日常可按改动范围选择以下命令，不必每次重跑全部检查：

```powershell
node --test tests/*.test.js

# backend/ 中
npm run typecheck
npm test
npm run build

# admin-web/、web-customer/ 中分别运行
npm run typecheck
npm run test:unit
npm run test:e2e
```

数据库集成测试须使用数据库名以 `_test` 结尾的独立 `TEST_DATABASE_URL`，先为同一测试库应用迁移，不能指向生产或日常开发库。浏览器测试用的 Chrome 或 Playwright 浏览器需在新电脑准备；原生自动化脚本依赖的 `.codex-mini-automator` 是本地工具目录，不是应用运行依赖。

GitHub Actions 使用 Node 24，根目录测试单独安装两个网站的 Vite 依赖。后台经营日期按上海时区统计，相关测试使用显式 `+08:00` 时间，避免换到UTC主机后日期偏移。发布 worker 的POSIX测试核对root文件所有权，CI在隔离runner中使用 `sudo python3` 运行；Windows会跳过这一项，不应因此删除生产所有权校验。

两个网站生产构建设置 `VITE_API_BASE_URL=/api/v1`。后台发布还需设置 `VITE_PLATFORM_VERSION`、`VITE_PLATFORM_RELEASE_ID`，并执行 `npx vite build --config vite.platform.config.ts` 构建独立版本中心。具体切换流程见生产部署记录，不直接覆盖服务器 `.env`。

正式小程序上传使用**独立运行文件白名单目录**，仅复制 `assets/components/constants/pages/services/store/styles/utils`、`app.js/app.json/app.wxss/config.js/sitemap.json` 和 `project.config.json`，核对生产地址并启用 `urlCheck`，不要上传调试生成目录。原仓库根目录上传曾因源包超过2MB被拒绝。

## 可复制给下一台电脑 AI 的提示词

```text
这是“唯哆鲜火锅食材B2B销售平台”，请接着现有项目开发。
仓库：https://github.com/AXXXt/hot-pot-sales-system.git，基线分支 main。

先阅读 AGENTS.md、README.md、dev-docs/development_handoff.md、dev-docs/local_development.md；涉及线上再读 dev-docs/production_deployment.md。先检查当前分支与未提交修改，保留已有工作，再核对 main 最新代码。

目前线上平台为 v1.3.0 / ai-20261021-10：原生微信小程序 + Vue管理后台 + Vue采购网站 + 静态官网 + NestJS/Prisma后端。已完成真实商品名与管理标签分离、商品最多9张图片及轮播、多规格最低实际价标“起”、AI库存调整草稿确认入库/出库、后端事务自动续规格编码，请基于现状继续，不要重新实现或撤回。微信1.3.0开发包已上传，正式审核发布尚未完成，小程序新展示需要新包发布。

三期运营扩展已上线后端、管理台和采购站：先读 dev-docs/admin/operations_workflow.md，保留现有实现；本地及线上均为18项迁移。新功能包括规格图片/复制、箱袋共用SKU基础库存、AI整单库存草稿、每规格补货建议和采购草稿、订单提交预占/审核扣减/取消释放、客户清单按协议价分品牌建订单草稿、批次保质期与历史库存补批次。不要重建或自动回填历史库存/预占，不要直接换回忽略预占与批次的旧程序。既有SKU未自动配置箱袋比例或开启批次，按实际资料设置。

小程序 config.js 必须保持 https://weiduoxian.cn、isDevelopment=false，模拟器默认也连接线上。未经我明确要求不要切本地后端。后台和采购站可使用独立本地后端。
商品数据库 name 是自动管理标签、subtitle 是真实商品名；接口 name/displayName 展示真实名，managementLabel 是标签。图库 images 有序，首张同步 mainImageUrl，各SKU共用；改名/图库不影响编码、规格和库存。

新电脑先检查依赖与配置，按交接文档安装三个应用的 npm 依赖，创建独立本地 .env 并启动 Docker。已有数据库先备份，不清库、不重置、不自动导入演示数据；仅确认首次空开发库时初始化演示数据。GitHub 不含数据库、对象存储文件、SSH密钥或服务商凭据，缺失时明确说明，不打印或提交任何密钥。

请先简要报告当前分支、版本、工作区与环境状态，然后根据我接下来的需求直接实施并做必要验证。此次代码拉取不代表获得线上发布授权；后续需要发布时先完成可审查变更和验证，再按我当次授权执行。区分 GitHub推送、网站后端部署、微信开发版上传和正式发布。

我接下来要开发的需求是：【在此填写具体需求】。
```
