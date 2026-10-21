# 平台版本、更新通知与回滚

版本：1.2.0｜更新日期：2026-10-21｜作者：Codex

## 使用方式

- 运营台右上角显示当前服务端版本号。点击可查看本版功能说明；同一账号首次看到新版本时出现一次通知，未读状态保留至查看。
- 左侧“版本与更新”打开独立版本中心。普通运营人员可查看版本说明，平台所属租户的有效超级管理员可更新或回滚。
- 先选择已准备的目标版本，再核对来源版本、目标版本及影响，最后按“确认更新”或“确认回滚”。关闭确认框不会执行。
- 切换前自动备份数据库、对象存储和配置。页面展示排队、校验、备份、切换及完成状态。失败时自动恢复来源版本。
- 更新通知不会自动刷新页面。人员保存当前工作后手动刷新；助手有未发送文字、附件或正在处理任务时，刷新确认会特别提示。
- AI 助手悬浮窗和输入区均可接收图片文件拖放。拖入后作为待发送附件展示，可删除、继续输入描述及跨页面处理；按“发送”才请求识别，创建商品仍需核对草稿并确认。
- 图片支持 JPG、PNG、WebP，单张最多 5MB，一次最多 3 张。拖入无效混合文件或超量批次会整体拒绝，保留已附照片与文字。照片继续通过原私有附件接口鉴权。

## 部署结构

```text
浏览器 /platform-updates → 独立静态站 sites/platform
浏览器 /api/v1/platform/* → platform 容器（无 Docker socket）
                         → 签名请求队列 platform/queue
宿主机 root systemd worker → 校验 → 备份 → 切换 backend 和 sites/admin
```

- `deploy/platform-api.cjs` 使用原 JWT 验证身份，通过 `StaffAccessService` 每次从数据库重新加载有效账号和权限。客户账号拒绝访问；当前部署仅所属租户 ID 1 的超级管理员可写。
- `platform` 服务固定使用 `PLATFORM_CONTROL_TAG`，业务服务使用 `RELEASE_TAG`。管理服务不随业务回滚重启。独立页面不依赖业务前端路由，因此回滚到未提供版本菜单的旧版后，仍可直接访问 `/platform-updates` 更新回来。
- 版本目录、镜像 ID、资源清单哈希与数据库迁移校验和由受信任的 root 部署程序登记在 `platform/catalog.json`。公开 API 仅接受已登记版本 ID，不接受脚本、镜像地址、文件路径或文件上传。
- 确认令牌以独立随机 32 字节密钥 HMAC-SHA256 签名，绑定账号、租户、最新权限指纹、来源、目标、目录摘要、操作编号和五分钟有效期。宿主机执行前以及备份结束后再次鉴权。
- `PLATFORM_COMMAND_KEY` 只存在于 root 600 的生产 `.env` 和管理容器环境中，不进入前端、发布包或日志。管理容器只可写专属队列，其余状态目录只读；宿主机 worker 才持有发布权限。
- 全局队列锁避免同时切换。确认重试返回已有任务。worker 中断后由 timer 恢复原版本；申请和结果写入审计，暂时无法写入的结果会继续重试。
- 发布校验目标及来源镜像 ID、完整管理台资源哈希和数据库迁移名称/校验和，健康后逐一读取 HTTPS 资源核验。旧哈希资源保留，入口最后替换。

## 已准备版本与兼容性

首次登记 v1.1.0（`ai-20261021-2`）及 v1.2.0（`ai-20261021-3`）。当前为v1.3.0（`ai-20261021-10`），线上18项迁移；16项迁移的历史版本仍保留资料，但已标记未准备，不能从页面切换。版本中心切换的是业务接口和管理台，不改官网、采购台、小程序、模型配置或短信设置。

更新与回滚仅支持已在服务器准备、校验并登记的版本。当前实现严格要求来源和目标的全部数据库迁移名称及校验和与在线数据库完全一致；不会通过页面自动执行迁移、数据库降级或数据恢复。带新迁移的版本需运维先制定兼容发布策略，不能直接绕过校验。

v1.3.0由受信任root运维程序先备份并暂停业务后端，再应用两项增量迁移，使用完整新客户端验证18项迁移后发布程序及网站。沿用版本中心操作状态及审计，独立控制镜像保持v1.2.0。旧版没有预占和批次扣减规则，因此不能仅把旧目录的schema字段改为18项来启用回滚，也不能直接恢复旧库。需要回退时先评估并处理新版业务记录，优先向前修复。具体操作、备份及验收见[生产部署记录](../production_deployment.md)。

回滚保留当前业务数据，仅恢复程序和管理台。完整数据库恢复属于独立运维操作，不由此页面触发。用户会话、包装照片、订单和商品不会随程序回滚删除。

## 后续版本准备

1. 完成代码检查、权限测试、浏览器测试及数据库兼容性检查，在本机构建镜像 `weiduoxian-backend:<release-id>`。不要在 2GB 生产服务器构建。
2. 添加 `deploy/releases/<release-id>.json`，使用新 ID、递增 sequence、语义版本、发布时间和面向管理人员的更新说明。
3. 使用 `VITE_API_BASE_URL=/api/v1`、对应 `VITE_PLATFORM_VERSION` 和 `VITE_PLATFORM_RELEASE_ID` 构建管理台；运行 `vite build --config vite.platform.config.ts` 构建独立管理页面。
4. 运行 `node deploy/package-platform-release.cjs <release-id>`，保存发布包与镜像包 SHA-256。发布目录存在时打包器拒绝覆盖。
5. 上传镜像及发布包，核对传输 SHA-256 后 `docker load`。通过服务器文件执行：`sudo bash /home/ubuntu/install-platform-control.sh <release-id> <archive-sha256> stage`，不能通过 SSH 标准输入执行发布脚本。
6. `stage` 只登记经过镜像、资源与迁移校验的版本，不切换线上版本，也不替换独立控制程序。管理人员在版本中心检查并确认更新。

首次控制程序安装使用 `bootstrap`，只支持已核验的 `ai-20261021-2` 来源，自动保存原配置到 `/opt/weiduoxian/.release-backups/platform-control-v1`。后续控制程序升级需要单独运维发布，普通业务版本更新不会替换已运行的控制程序。

## 运维与验证

- 宿主机：`weiduoxian-platform-worker.path` 接收队列请求，`weiduoxian-platform-worker.timer` 每 30 秒恢复中断任务及补写审计；`service` 以 root 运行受保护的 `platform/control/platform-worker.py`。
- 操作记录：`platform/operations/<uuid>.json`。详细日志位于 root 专用 `platform/logs/`，网页只返回必要状态，不返回命令、签名或路径。
- 备份服务仍为 `weiduoxian-backup.service`，配置归档增加控制程序和版本元数据；不归档易变队列、操作状态及日志。发布镜像和资源目录必须另行保留，不能清理仍标记 ready 的版本。
- API 测试：`node --test deploy/test/platform-api.test.cjs`。
- worker 测试：Linux root 下 `python3 -m unittest discover -s deploy/test -p test_platform_worker.py`，覆盖成功切换、备份失败、权限撤回和目标失败后的来源恢复；Windows 跳过依赖 POSIX 所有权的流程测试。
- 浏览器：`PLAYWRIGHT_CHANNEL=chrome` 运行 `tests/ai-assistant.spec.ts` 和 `tests/platform-updates.spec.ts`，15 个场景通过；管理台类型检查、17 个前端单元测试和两套生产构建通过。
