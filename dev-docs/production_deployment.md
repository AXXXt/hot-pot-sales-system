# 唯多鲜生产测试环境部署记录

更新日期：2026-10-02。维护：项目负责人及 Codex。

## 当前环境

- 腾讯云轻量服务器：152.136.138.118，Ubuntu 24.04，2 核、2GB、40GB 系统盘。
- SSH 用户：ubuntu，使用本机密钥登录；私钥不在项目中。
- 服务目录：`/opt/weiduoxian`。所有 Compose 命令在此目录执行并加 `sudo`。
- 当前后端版本：`weiduoxian-backend:20261002-3`。2026-10-02 增加限时白名单体验验证码，已保留上一个镜像。
- 官网：https://weiduoxian.cn 和 https://www.weiduoxian.cn。
- 客户采购台：https://app.weiduoxian.cn。
- 管理后台：https://admin.weiduoxian.cn。
- 同源 API：`/api/v1`。小程序接口源：https://weiduoxian.cn。
- 数据库、Redis、MinIO 没有发布宿主机端口；公网只需 22、80、443。
- `.env` 由服务器随机生成，root 所有、权限 600；不要提交、截图或打印内容。
- 超级管理员手机号：18137222005。按用户授权临时启用固定体验验证码，见下方限制。
- 小程序备案号（用户提供）：豫ICP备2026048317号-1X。网站备案尚未通过，不能将此号码用于官网网站备案展示。
- 网站备案等待期间的业务自动化测试使用本机隔离数据库，不向服务器写入测试订单。2026-10-02 用户授权为四个号码启用限时体验验证码，未开放任意手机号。

## 已完成验证

- 15 个数据库迁移全部成功，初始化正式租户、超级管理员和 15 项权限。
- 未导入开发演示客户、商品或订单。
- 后端、MySQL、Redis、MinIO 健康检查通过。
- 四个域名 HTTPS 有效，HTTP 跳转 HTTPS；证书初始到期日为 2026-12-30。
- Certbot 自动续期演练和 Nginx 续期重载钩子通过。
- 公网浏览器验证官网、客户登录、后台登录，1440px 和 390px 宽度均通过。
- 未登录订单和用户资料返回 401；初始部署时短信发送返回 SMS_DISABLED，后按用户授权切换限时体验模式。
- 商品图片公开读取通过；付款凭证匿名读取和篡改签名均被拒绝，有效签名读取通过。
- 已将备份下载到本机受限目录，并在独立 MySQL 容器中恢复验证。

## 常用运维

```bash
cd /opt/weiduoxian
sudo docker compose ps
sudo docker compose logs --tail 100 backend
sudo docker stats --no-stream
sudo docker compose exec -T backend node -e 'fetch("http://localhost:3000/health/ready").then(async r=>console.log(r.status,await r.text()))'
sudo systemctl list-timers --all certbot.timer weiduoxian-backup.timer
sudo certbot renew --dry-run --run-deploy-hooks --no-random-sleep-on-renew
```

浏览器可检查 `/health`；依赖就绪检查 `/health/ready` 仅在后端内部执行。

## 发布流程

生产服务器无法稳定拉取 Docker Hub 镜像。本次在本机构建并导出，通过 SCP 上传、`docker load` 导入。不要在 2GB 服务器上直接构建前端和后端。

1. 后端使用 `deploy/backend.Dockerfile` 构建。发布标签必须同时更新镜像导出脚本和服务器 `.env` 的 RELEASE_TAG。
2. 客户端和管理端分别使用 `VITE_API_BASE_URL=/api/v1` 构建，不能把 localhost 编入生产包。
3. 上传构建产物到对应 `sites/customer`、`sites/admin`；官网上传到 `sites/official`。先备份旧产物，保留旧版本哈希资源一段时间，避免已打开的页面加载旧资源失败。
4. 后端发布前先备份，再执行迁移，最后替换后端服务。不得运行 `seed.dev.ts`。
5. 不要覆盖生产 `.env`，不要运行 `docker compose down -v`。

```bash
cd /opt/weiduoxian
sudo systemctl start weiduoxian-backup.service
sudo docker compose run --rm --no-deps --pull never backend node node_modules/prisma/build/index.js migrate deploy
sudo docker compose up -d --pull never --wait
sudo docker compose exec -T nginx nginx -s reload
```

后端容器重建后必须重载 Nginx，让反向代理重新解析容器地址。

`deploy/init-env.sh` 只用于首次初始化，已存在 `.env` 时不会覆盖。
`deploy/bootstrap.cjs` 幂等初始化租户和管理员，不会提升其他类型的已有账号权限。
`deploy/smoke.cjs` 可复制到后端容器 `/app/deploy-smoke.cjs`，使用管理员手机号环境变量运行；会创建并清除测试存储对象，不会插入测试订单。

## 备份与恢复

- 每日北京时间 03:30 左右执行 `weiduoxian-backup.timer`。
- 归档位置：`/var/backups/weiduoxian`，root 可读；保留最近约一周。
- 包含 MySQL 一致性事务导出、MinIO 对象、站点文件、Compose、Nginx、生产密钥和证书。
- 对象当前使用不可变随机键；备份先导出数据库再复制对象。若以后支持覆盖或删除对象，应改为维护窗口或快照备份。
- Redis 会话不备份；灾难恢复后用户需要重新登录。
- 首份已验证异机副本：本机 `deploy/.work/backups/20261001T164243Z.tar.gz`，该目录限制为当前 Windows 用户访问且被 Git 忽略。
- 目前自动备份仍保存在同一台服务器。自动异地备份、失败通知和容量告警尚未配置，正式营业前应接入。

恢复应先在隔离环境进行，禁止未经确认覆盖在线数据库。解包后 `database.sql.gz` 是业务库导出，`objects.tar.gz` 是 MinIO 数据，`config.tar.gz` 含密钥。恢复 MinIO 数据前应停止文件写入；恢复证书、`.env` 时保持严格权限。

本机数据库恢复验证命令：

```powershell
node deploy/verify-backup.cjs deploy/.work/backups/database.sql.gz
```

该脚本创建无公网端口的临时 MySQL 容器，恢复后核对迁移、管理员、租户、权限数量，并删除临时容器及其数据卷。当前断言对应首次空库初始化；业务数据和权限数量增长后需相应调整。

## 正式营业前待办

1. 真实短信按用户要求暂缓：当前 `SMS_PROVIDER=experience`，仅四个白名单号码在限时窗口可用。正式营业前必须关闭固定验证码并完成真实厂商 API、签名模板、限流和登录联调；只修改厂商名称不能实现真实发送。
2. 等待网站 ICP 备案通过，核对 weiduoxian.cn 对应记录后补充页脚展示链接；证书账号目前未登记通知邮箱。
3. 确认用户协议和隐私政策草稿，不能把草稿视作已确认法律文本。
4. 配置真实品牌、普通客户等级（code 为 normal）、单位、分类和商品库存；没有 normal 等级时新客户不能注册。
5. 在微信公众平台配置 request、uploadFile、downloadFile 合法域名 `https://weiduoxian.cn`，重新上传体验版，完成真机验证及审核发布。微信 AppSecret 和订阅消息模板尚未配置。
6. 接入自动异地备份、失败通知、资源告警；做真实采购、审核、付款凭证、发货和退款全流程验收。
7. 目前只验证空载和功能正确性，未做容量压测。上线前检查系统安全更新及固定版本容器镜像的更新情况，并安排有备份的升级窗口。

参考：[Certbot 官方文档](https://eff-certbot.readthedocs.io/en/stable/using.html)。

## 临时体验验证码（2026-10-02）

- 用户明确授权固定验证码 `123456`，不发送真实短信。小程序、客户网站和管理后台共用这一后端设置，无需重新上传小程序。
- 仅允许 `18137222005,13937802005,15890322005,13060070064`。固定验证码不证明手机号所有权，知晓号码和验证码者可登录，禁止用于正式交易或向公众开放。
- 先点击获取验证码，再在 5 分钟内填写 `123456`；使用后失效。手机号/IP 发送间隔 60 秒，错误 5 次暂时锁定。
- 配置为 `SMS_PROVIDER=experience`、`SMS_TEST_PHONES` 和 `SMS_TEST_EXPIRES_AT=2026-10-08T17:55:00Z`，即北京时间 **2026-10-09 01:55** 到期。启动时不得设置超过未来 7 天的窗口。
- 发送和校验每次检查白名单及到期时间；Redis 故障时拒绝请求，不回退内存。测试验证码使用独立缓存命名空间，不会被今后的真实短信服务接受。
- 到期后停止获取验证码和验证码登录，不会使后端启动失败，也不会主动注销已有会话。
- 关闭方式：在服务器 root 权限下编辑 `/opt/weiduoxian/.env`，将 `SMS_PROVIDER` 改为 `disabled`，然后在该目录执行 `sudo docker compose up -d --no-deps --pull never --wait backend` 和 `sudo docker compose exec -T nginx nginx -s reload`。正式接入真实短信前保持关闭。
- 用户要求品牌及普通客户等级自行在后台配置，因此本次不初始化品牌、等级、客户、商品或订单。三个客户测试号码需要自行注册并通过管理员审核；普通客户等级的编码须为 `normal`。
- 发布前备份：`/var/backups/weiduoxian/20261001T180238Z.tar.gz`。发布脚本保留 `.env.before-experience-20261002-3` 和 `compose.before-experience-20261002-3.yml`，前者包含密钥，仅 root 可读，禁止下载到公开目录。
- 本地验证：后端 257 项测试、小程序 39 项测试、后端 typecheck/lint、Docker 构建通过。
- 服务器验证：四个白名单验证码可用，错误码和重复使用被拒绝，名单外发送/登录返回 403；HTTPS 管理员登录、资料获取、退出通过。四站点、私有凭证保护正常。基础数据只读检查为品牌 0、普通客户等级 0、商品 0，仅管理员已存在。
- 外网限制（本次复测）：服务器经 Nginx HTTPS 登录全流程及本机访问公网 IP 的 HTTPS 健康检查返回 200；用户电脑经 curl、Node、Edge 访问公网 HTTPS 均被连接重置，HTTP 可返回 301。尚未确定是本地网络还是公网链路问题，不能据此宣称手机端登录已验证；需要手机实际网络复测，不关闭证书/域名校验、不改用 HTTP 绕过。

### 2026-10-02 上午：体验版获取验证码失败排查

- 用户确认使用管理员手机号 `18137222005`。再次检查白名单和有效期正常，服务器内部 POST `/api/v1/auth/send-code` 返回 HTTP 201、`sent: true`，Nginx HTTPS 健康检查返回 200。
- 服务健康；最近 2 小时 Nginx 日志未见短信请求。外网复测仍在 TLS 握手阶段连接重置；仅抓取 TCP SYN/RST 元数据，确认 443 的 SYN 已到达 Nginx 容器并返回 SYN-ACK，随后收到入站 RST。因此不能简单归因于未开放 443。
- 仍需用户手机浏览器访问 `https://weiduoxian.cn/health` 的结果，以及微信公众平台的 request 合法域名配置。未取得手机原始 `errMsg`，不能确认其失败原因与本机外网重置完全一致。
- 网站备案未通过是需向腾讯云核实的阻断方向，不根据抓包直接断言备案拦截。参考官方：https://cloud.tencent.com/document/product/243/20220 。
- 修正小程序 `services/request.js`：将微信 `errMsg` 转换为页面读取的 `message`，区分域名白名单、TLS、超时、连接重置和一般网络故障；保留原始错误，不记录手机号、验证码或令牌。主请求及刷新请求显式设置 15 秒超时，不自动重发验证码。
- 小程序 47 项测试通过。上述提示修复只在本地代码中，需要重新上传体验版后生效；未宣称修复公网链路，也未修改域名、证书、防火墙或用户业务数据。
