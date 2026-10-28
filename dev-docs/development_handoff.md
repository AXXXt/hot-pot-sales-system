# 跨电脑开发交接

## 2026-10-28 代码整理已推送上线（当前版本）

平台当前为 **v1.3.21 / ai-20261028-2**，北京时间18:45:04发布成功，操作d499a09c-29d3-4e81-82fa-c3d19a3d0da5，发布前完整备份20261028T104419Z.tar.gz。仍24项迁移，27类业务摘要一致；管理台63/采购站36/官网两域名各25份HTTPS核对通过，六服务运行，独立control-20261024-2和新版官网保持。业务提交5624394及最终元数据0d42e71已推送main，业务CI四项全通过。微信最新为 **1.3.14开发包405026字节、192个运行源文件**，仍连接线上，正式审核发布未完成。本轮没有真机业务复验，其他协议/留存待办继续保留。详情见[发布记录](testing/2026-10-28-code-simplifier-release.md)；下文10月27日及更早版本段落保留当时状态。

更新日期：2026-10-24。仓库：[AXXXt/hot-pot-sales-system](https://github.com/AXXXt/hot-pot-sales-system)，日常同步分支 `main`。

## 当前产品状态

当前线上为第九批 **v1.3.20 / `ai-20261024-4`**，独立控制镜像及界面 **`control-20261024-2`**，生产24项迁移。操作`901dcfa8-18af-45e8-be09-fa49fe1de7e4`成功，切换前备份`20261024T062400Z.tar.gz`。146个运行JS、329个锁定生产依赖、后台63/采购站36/官网19/控制界面4份HTTPS文件核对一致，六服务运行；发布窗口24类原业务、三张新增表、Lead新字段及敏感环境摘要前后相同。

首发v1.3.19 / `ai-20261024-3`曾因官网`.vite`缓存误包而在HTTPS验证失败，操作`50e73aac-36f5-440b-af4b-aa52c44f32df`记failed；自动恢复原应用，保留已应用的24项增量结构，没有还原数据库。修正白名单后，通过指定失败操作、原镜像20迁移前缀/校验和与精确24结构的严格恢复边界向前发布v1.3.20，固定worker及公共回滚权限未放宽。详见[第九批报告](testing/2026-10-24/batch-09-report.md)和[部署记录](production_deployment.md)。

微信最新为 **1.3.13开发包，404980字节、191个运行源文件**，最终调试目录`mini-release-1.3.13-final`，仍连接`https://weiduoxian.cn`、`isDevelopment=false`；**微信正式审核发布尚未完成**。PC自动真机调试已启动并保留QA登录，常规业务优先PC；手机相册、隐私/订阅拒绝与记忆选择、iOS及移动设备兼容性仍需专项证据。步骤见[本地调试文档](local_development.md)，仅启动成功不计业务通过。

本批补齐会话退出/轮换、协议及同意留痕、注册状态票据、角色权限与员工品牌范围界面、客户等级/负责人和人工服务申请闭环。客户等级仅分类，折扣率字段不自动定价；有效协议价优先，否则基础价。服务申请结案不自动注销、退款、开票或调整库存；正式协议地区、期限与退换货仍待经营方确认。

**环境不要混淆：本机日常`b2b_miniapp`仍20项迁移，本批独立`_test`库及生产为24项；没有替日常库执行本批迁移。** 源码含24个迁移目录，日常联调新功能前须按下文先备份、受控应用迁移。不要重置、重建或导入生产数据。

PC线上更正服务申请已结案，帮助电话及分类清除复验通过；原14类业务摘要一致，QA库存0/22、预占/已用额度/未读0，完整收尾备份`20261024T070448Z.tar.gz`成功。主矩阵203项为82通过、118部分、3受阻，详见第九批报告。本轮从`7c02fb1`收集源码，`f8fe23d`业务源码和`8136982`首轮CI修复已推送；后续MinIO构建适配及最终Git/CI结果以报告文末为准，本批不是全项目验收或微信正式可发布结论。

### 历史批次（保留当时状态）

第八批为 **v1.3.18 / ai-20261024-2**，当时微信为1.3.12开发包。公开线索限频TTL故障修复已完整重编译发布，仍20迁移；后端73套663单元、230Node、库存4及线索5真实隔离集成通过。134运行JS/329依赖、55后台/33采购/4固定控制UI HTTPS、22类模型/env和完整218采购资源核对通过。QA恢复原状态、PC进货单经本人允许后清空，原14类摘要一致，收尾备份20261024T030129Z.tar.gz。203项31通过、152部分、6失败、12待执行、1待复验、1受阻；新增失败是公开留资协议入口/同意记录缺口，仍未全验收。详见[第八批报告](testing/2026-10-24/batch-08-report.md)。下方第七批及更早段落为历史。

2026-10-24第七批续测：平台 **v1.3.17 / ai-20261024-1**，微信 **1.3.12开发包（目录mini-release-1.3.12-final）**。后台中文确认已部署；小程序两个进货单入口的库存/起订量、校验失败重试和异步会话保护已补，新包真机验证超库存拦截、主动调整、规格停用恢复和重新取价，通知异常及切号边界以unit/mock为主，尚未全部真机验收。后端71套639单元、3套27真实隔离集成、223原生Node、后台21单元66Edge通过。本批平台复用v1.3.16后端镜像及采购站产物，仍20迁移。QA原图库/标记/下架、原库存0/22及价/起订量已恢复，复制SKU41停用零库存，原14类摘要一致；收尾备份20261024T015649Z.tar.gz。详见[第七批报告](testing/2026-10-24/batch-07-report.md)与[今日203项矩阵](testing/2026-10-24/test-cases.csv)。全项目仍未完成，微信正式发布和本轮GitHub推送未执行。以下10月23日段落保留历史。

2026-10-23第六批及第一轮收尾（2026/10/23 18:10）：当前后端、管理台及采购站v1.3.16/ai-20261023-11，微信保持1.3.11开发包。管理员恢复/越权、改密事务、采购站会话修复已部署。后端69套/609单元、21套/127真实隔离集成、175原生Node、后台21单元/59Edge、采购站15单元/40Edge通过；后端类型/lint/构建和双站类型/构建通过。采购站没有独立lint脚本，本批未安装依赖或声称执行该检查。203项部分通过127、通过31、修复待复验1、失败5、待执行38、受阻1，未全部完成；见[第一轮汇总](testing/2026-10-23/round-01-report.md)与[第六批报告](testing/2026-10-23/batch-06-report.md)。QA库存0/22、预占/额度使用/未读0，原14类摘要一致，完整备份20261023T100939Z.tar.gz。正式微信未发布、正式跳转受阻、本轮GitHub未推送。下方旧段落保留历史。

第八批时线上已发布 **v1.3.18**，发布标识 **`ai-20261024-2`**。报价完成、审核通过、发货三种微信订阅提醒及订单站内消息已部署；微信关联旧账号时，由本人在主动订阅后的弹窗确认切换，后台不会静默转移。保留管理端密码登录、一次性设置链接与改密。当时为20项迁移，独立控制镜像固定`control-20261022-1`；该段不作为第九批当前版本记录。

三期运营扩展已上线后端、后台及采购站，见[商品、库存与接单扩展](admin/operations_workflow.md)：规格图片/复制、包装换算、AI批量库存、每规格补货参数与采购草稿、订单预占、客户清单转订单草稿、批次保质期。运营扩展增加到18项迁移，密码登录新增第19项；不要重复构建或回填历史预占。旧18项及更早迁移版本已停用直接切换，不能回滚到绕过凭据版本、忽略预占或批次的旧逻辑。

[微信订单提醒及站内消息](admin/wechat_notifications.md)已部署：业务按钮一并申请未来提醒，提交订单/草稿申请三种、确认报价并支付申请两种；拒绝仍可办理，进度可在站内查看。历史单独功能测试收信和开发版跳转通过；完整联调中三条实际QA订单微信提醒均收到，但全局formal跳转因小程序尚未正式发布而受阻。QA订单2已完成、1/3/4取消，保留流水并清零占用；没有真实收付款或配送。首页分类快捷栏已移除，当时开发包为1.3.12，正式审核发布仍待完成。

## 应用与开发约定

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
- 平台版本中心与发布 worker：预检、备份、版本切换、审计及失败恢复。独立版本控制服务当前为 `control-20261024-2`，与业务后端标签分开，并校验密码凭据版本及会话；固定worker未因本次恢复放宽schema边界。
- 小程序、后台、采购站与官网界面调整；个人中心、常购/复购、库存和商品权限相关修复。具体历史见部署及模块文档。
- 商品采用“管理标签＋真实商品名＋编码”：数据库 `Product.name` 是品牌加分类生成的标签；`subtitle` 是可修改的真实商品名。接口 `name` 与 `displayName` 返回真实展示名，`managementLabel` 返回标签。真实名称缺失回退标签。新订单保存下单时名称快照，不回写历史订单。详见 `dev-docs/admin/product_names.md`。
- 商品支持最多9张图片、单张5MB，后台上传/排序/设为主图/删除，图库属于商品，全部SKU共用；`images` 保持顺序，首图同步 `mainImageUrl`，兼容单图商品。小程序与采购站详情滑动查看。详见 `dev-docs/admin/product_images.md`。

当前微信 **1.3.13开发包已上传**，包体404980字节、191个运行源文件，不等于正式审核发布完成。最终目录`mini-release-1.3.13-final`；不要继续使用旧1.3.12目录或同版本未上传候选。正式用户使用新功能仍需微信正式审核发布，本机会话未执行该步骤。

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

# 先拉取MySQL/Redis；已有MinIO镜像继续复用，start-dev.cmd使用--pull never。
docker compose -f docker-compose.dev.yml pull mysql redis
docker image inspect minio/minio:RELEASE.2025-01-20T14-49-07Z --format "{{.Id}}"
# 若缺MinIO镜像，先按local_development.md显式源码构建，再继续。
docker compose -f docker-compose.dev.yml up -d --pull never --wait
node scripts/local-environment.cjs migrate
```

上述迁移脚本只接受本机 `127.0.0.1:3307/b2b_miniapp`，先检查连通性、备份，再生成 Prisma Client、应用迁移。源码当前包含24个迁移目录；本机日常库记录仍为20项，尚未执行本批增量，不能把隔离库/生产24项等同于日常库已升级。命令任何一步失败时先处理失败，不继续后续步骤。

原MinIO tag外部下载已失败，新电脑不能再依赖全量`compose pull`。已有本机旧镜像继续复用；确实缺失时可先运行`node scripts/build-local-minio.cjs --plan --tag minio/minio:RELEASE.2025-01-20T14-49-07Z`，核对后用`--build`显式构建。脚本不覆盖检测到的既有tag、不启停服务或迁移数据，固定官方源码并使用Go校验；新建镜像不声称与生产镜像字节一致。完整命令和本机Docker/builder限制见[MinIO本地fallback](local_development.md#新电脑缺失minio镜像时)。

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

目前线上平台为 v1.3.20 / ai-20261024-4，独立控制服务及界面control-20261024-2：原生微信小程序 + Vue管理后台 + Vue采购网站 + 静态官网 + NestJS/Prisma后端。本轮从HEAD7c02fb1开始，f8fe23d业务源码及8136982首轮CI修复已推送；最终Git/CI结果及后续依赖适配以第九批报告文末为准。微信1.3.13开发包404980字节/191文件已上传，PC更正申请结案/帮助/分类清除及070448收尾备份已完成，正式版未发布；正式消息跳转及手机专有边界仍待。PC、mock、VM与隔离浏览器不等同手机验收。

生产及本批隔离_test库24项迁移，日常本机b2b_miniapp仍20项，源码有24个迁移目录；没有替日常库执行本批增量，先备份并按本地受控迁移脚本处理。保留密码凭据/当前设备退出与轮换、协议留痕、注册状态票据、角色/品牌范围、规格图片/复制、包装换算、库存草稿、补货计划、订单预占、客户清单和批次。客户等级仅分类，成交价使用有效协议价，否则商品基础价。人工服务申请不等同自动销户、退款或税票。读dev-docs/admin/operations_workflow.md、customer_service.md和password_login.md；通知用法见wechat_notifications.md。不得回填历史预占或回滚到忽略凭据、预占、批次和新增记录的旧程序。

小程序 config.js 必须保持 https://weiduoxian.cn、isDevelopment=false，模拟器默认也连接线上。未经我明确要求不要切本地后端。后台和采购站可使用独立本地后端。
商品数据库 name 是自动管理标签、subtitle 是真实商品名；接口 name/displayName 展示真实名，managementLabel 是标签。图库 images 有序，首张同步 mainImageUrl，各SKU共用；改名/图库不影响编码、规格和库存。

新电脑先检查依赖与配置，按交接文档安装三个应用的 npm 依赖，创建独立本地 .env 并启动 Docker。已有数据库先备份，不清库、不重置、不自动导入演示数据；仅确认首次空开发库时初始化演示数据。GitHub 不含数据库、对象存储文件、SSH密钥或服务商凭据，缺失时明确说明，不打印或提交任何密钥。

请先简要报告当前分支、版本、工作区与环境状态，然后根据我接下来的需求直接实施并做必要验证。此次代码拉取不代表获得线上发布授权；后续需要发布时先完成可审查变更和验证，再按我当次授权执行。区分 GitHub推送、网站后端部署、微信开发版上传和正式发布。

我接下来要开发的需求是：【在此填写具体需求】。
```
