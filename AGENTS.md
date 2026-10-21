# 协作约定

## 开发入口

- 开工前阅读 `dev-docs/development_handoff.md`、`dev-docs/local_development.md`；涉及线上时再阅读 `dev-docs/production_deployment.md`。
- 小程序默认连接 `https://weiduoxian.cn`，根目录 `config.js` 保持 `isDevelopment: false`。未经用户明确要求，不切到本地后端。后台与采购站本地开发可使用独立本地后端。
- `start-dev.cmd` 不初始化演示数据。已有数据库先备份；不执行 `migrate reset`、`db push` 或 `docker compose down -v`。
- 密钥、`.env`、数据库备份、临时令牌和用户私人文件不提交；示例文件只填写占位值。不要把生产登录验证码或供应商凭据写入文档。
- 在源码目录修改小程序，生成目录仅调试使用。截图放在项目监控目录以外，避免开发者工具重复编译和样式异常。
- 线上发布、GitHub推送、微信开发版上传和微信正式审核发布分别记录结果；上传开发版不代表正式版已发布。

## 图片查看规则（用户要求）

DeepSeek Responses 兼容接口可能因同轮并发多个 `view_image` 使会话无法继续。因此一轮只查看一张图片，查看完再发起下一次；不要把多个 `view_image` 放入同一并发批次。

## 跨会话消息规则（用户要求）

在本机使用 DeepSeek 供应商时，不使用 `send_message_to_thread` 给其他已有会话发消息，可能导致缺少 `call_id` 的投递记录，使目标会话持续 HTTP 422。需要已有会话继续工作时，让用户在该会话直接发消息。
