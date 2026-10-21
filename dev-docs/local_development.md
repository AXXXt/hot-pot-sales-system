# 本地联调环境

更新：2026-10-21。适用：本机 Windows 开发环境；小程序调试项目默认连接线上后端。

## 当前状态

- 复用原 `miniprogram` Compose 项目及 MySQL、Redis、MinIO 数据卷，没有清库、重新导入演示数据或复制线上数据。
- MySQL 8.4.3、Redis 7.4.1、MinIO RELEASE.2025-01-20T14-49-07Z 与线上镜像版本一致。
- 2026-10-21 当前本地和线上均有16个迁移，已包含 `20261021090000_ai_operations_assistant`；线上业务版本为 `v1.2.5 / ai-20261021-8`。最初10月3日对齐时为15个迁移，相关启动故障记录保留在下文。
- 保留原有开发数据库。10月3日初次对齐时记录有3个用户、3个客户、24个商品、8个订单和5个品牌，该数量是历史快照。账号角色不自动调整，品牌与普通客户等级不重建。
- 10月3日曾与旧线上后端 `20261002-3` 核对101个编译 JS/迁移 SQL文件；该记录不代表当前版本哈希。当前发布验证以 `production_deployment.md` 为准。本地启动器继续明确设置后端监听 `127.0.0.1`。
- 网站与小程序使用本轮已发布 UI 源码。额外修正仅是官网在 localhost 下跳转本地采购站，不改变正式域名链接。

## 启动与停止

先确保 Docker Desktop 正在运行，然后双击根目录 `start-dev.cmd`。后台运行，不弹出多余终端。

```powershell
powershell.exe -NoProfile -ExecutionPolicy Bypass -File scripts/local-dev.ps1 start
powershell.exe -NoProfile -ExecutionPolicy Bypass -File scripts/local-dev.ps1 status
powershell.exe -NoProfile -ExecutionPolicy Bypass -File scripts/local-dev.ps1 stop
```

- 启动器确认数据库仅指向 `127.0.0.1:3307/b2b_miniapp`，不接受生产数据库地址。
- 容器 Healthy 后，先从 Windows 等待 MySQL 3307、Redis 6379、MinIO 9000 端口（最多 60 秒），再执行带认证的 `SELECT 1`。任一检查失败都会在备份及迁移前退出，不把容器内部健康误当作宿主机可用。
- 后端未启动时先备份，再生成 Prisma Client、应用已有迁移。不执行 `db push`、`migrate reset` 或 `seed`。
- 首次使用其他电脑时，需要分别在 `backend`、`admin-web`、`web-customer` 执行 `npm ci`，并按 `backend/.env.example` 准备本地 `.env`。本机已有配置不覆盖。
- 已由脚本启动的进程会复用；端口被其他进程占用时直接报错，不杀掉陌生进程。
- 停止脚本只结束其记录的进程及子进程，保留 Docker 容器、数据和其他项目。
- 后端监听源码自动编译；两个 Vue 网站和官网热更新。小程序生成目录需要重新运行 `node scripts/prepare-local-mini.cjs` 同步源码，勿在生成目录修改源码。

## 访问地址

| 服务 | 地址 |
| --- | --- |
| 管理后台 | http://127.0.0.1:5173/login |
| 客户采购站 | http://127.0.0.1:5174/login |
| 官网 | http://127.0.0.1:5180 |
| API 文档 | http://127.0.0.1:3000/api/docs |
| 依赖健康检查 | http://127.0.0.1:3000/health/ready |

本地现有演示管理员：`13800000000`。客户使用原有本地客户账号；本地角色不等同于线上同手机号角色。

先点击获取验证码，再填 `123456`。这是本地 development 模式，不发真实短信；同手机号发送间隔 5 秒、同 IP 10 秒，前端可能倒计时 60 秒。线上白名单和有效期完全不变。

## 小程序模拟器

导入项目根目录下的 `.wx-local-project`，默认项目名为 `weiduoxian-online-development`，连接 `https://weiduoxian.cn`。`start-dev.cmd` 和不带参数的生成命令均保持这一默认值。

这个生成目录仅包含小程序运行文件，不含后台、数据库、备份、私人文件或服务器密钥。它被 Git 和正式小程序打包规则排除。

- 当前小程序模拟器已按用户要求切回线上。仅在用户明确要求本地后端联调时执行 `node scripts/prepare-local-mini.cjs --local-backend`；此时项目名为 `weiduoxian-local-development`，且只有 `envVersion=develop`、`platform=devtools` 才使用 `http://127.0.0.1:3000`。
- 体验版、正式版、真机和无法识别环境时仍使用生产 HTTPS 地址，避免误上传 localhost。
- 本地生成项目设置 `urlCheck=false` 仅用于本机模拟器调试，原项目配置不修改。
- 切换后端后应退出旧环境登录，避免本地令牌、门店资料或购物车缓存混入线上。此前的本地验证码和客户登录验证属于历史记录。
- **本次没有配置手机局域网入口。** 手机上的 `127.0.0.1` 是手机自身，不能直接访问电脑。体验版 1.1.0 仍受正式域名公网连通性影响。手机联调需另外配置受控局域网入口和调试项目，不要公开本地开发端口。

## 隔离与备份

- MySQL 3307、Redis 6379、MinIO 9000/9001 仅绑定本机地址；后端和三个网站也只监听本机。
- 沿用原开发 JWT 和存储配置，不下载线上密钥。启动器忽略继承的生产后端连接参数。
- 日志和进程记录：`.wx-local-runtime/`。包含本地开发短信和请求日志，不要分享或提交。
- 迁移前备份：`backup/local-alignment/b2b_miniapp-*.sql`。本次首份备份为 `b2b_miniapp-2026-10-03T04-40-48-137Z.sql`，文件名使用 UTC 时间。备份不会自动删除。
- 所有备份和生成项目均不进入正式小程序包。

## 验证

```powershell
node --test tests/*.test.js
node scripts/verify-local-environment.cjs
node scripts/verify-local-mini.cjs
```

最后一项仅限显式启用本地后端，并需要生成项目的自动化端口 9421 已开启。脚本先验证模拟器实际接口源是 localhost；若仍连接线上，会在验证码请求之前终止。验证脚本使用已存在本地账号，只做登录和接口读取，不创建商品、客户或订单。登录会写入本地会话及审计记录。

已验证管理端和采购端真实登录、12 项接口读取、未登录返回 401、客户读取管理配置返回 403、桌面和手机宽度布局、官网本地链接、原生模拟器登录，以及启动器重复启动和停止后重启。未测试真实短信、微信通知送达、真实付款或手机局域网访问。

## 容器 Healthy，但启动报 P1001

2026-10-03 复现：容器内部 MySQL 查询与备份成功，但 Windows 到 3307、6379、9000 全部返回连接拒绝；其他项目的映射端口也不可访问。仅重建本项目容器未恢复，说明不能靠重新迁移或清空数据库解决。

新的启动器会报告 `LOCAL_PORTS_UNREACHABLE` 并列出具体端口。先检查 Docker Desktop 状态；必要时重启 Docker Desktop，但它会短暂中断所有本地 Docker 服务，需要先确认其他项目可暂停。不要执行 `down -v`、`migrate reset`，不要将数据库端口改为公网绑定。

单独诊断（只读，不迁移）：

```powershell
node scripts/wait-local-services.cjs
```

如果端口可达但认证查询失败，脚本会显示数据库错误代码，应核对本地连接配置和已有数据库，不要一律当作端口转发问题重启。

本次故障后续：用户授权重启 Docker Desktop，但 Docker 4.86.0 依次报告残留 `engine.sock`、`dockerInference` 无法访问以及 `DockerDesktop/Wsl/CommandTimedOut`。已在 Docker 停止后，将只含零字节通信端点的 `docker-secrets-engine` 和 `Docker/run` 目录改名保留为同级 `.stale-*` 目录，没有删除数据库卷、镜像或配置。此类通信文件问题在 [Docker 官方问题库](https://github.com/docker/for-win/issues/15064) 有同类报告。

`wsl --terminate docker-desktop`（45 秒）及 `wsl --shutdown`（30 秒）均超时，尚未恢复运行环境。需保存工作并重启 Windows，再启动 Docker Desktop 和 `start-dev.cmd`。不要把脚本回归测试通过视为此次环境已经恢复；恢复后仍需检查 `/health/ready` 和实际登录。启动器现在也会对 Docker 引擎查询设置 10 秒超时，避免在 WSL 无响应时无期限等待。

### 2026-10-04 重启后复验

用户重启 Windows 后，Docker 引擎、三个宿主机端口和 MySQL 认证查询恢复正常。

复验另发现启动预检在迁移父进程中加载了 Prisma 原生 DLL；即使 `$disconnect()` 后，Windows 仍锁住 DLL，造成 `prisma generate` 的 EPERM。已改为独立子进程执行预检，退出释放 DLL 后再备份、生成和迁移，并添加回归测试。

修复后启动脚本完整成功，15 条迁移无待执行项，四个本地服务健康。管理端和采购端的真实本地验证码登录、12 项接口读取、401/403 权限检查、桌面/移动宽度渲染、官网本地入口均通过。小程序原生模拟器也通过本地验证码请求、客户登录和首页加载验证。66 项 Node 回归测试通过，没有重置数据库或修改线上环境。
