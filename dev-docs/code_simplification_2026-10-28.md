# 代码简化与提升建议（2026-10-28）

本轮基于 `2a8fccb` 和现有工作区检查项目，并按用户指定的 [Anthropic code-simplifier 规则](https://github.com/anthropics/claude-plugins-official/blob/main/plugins/code-simplifier/agents/code-simplifier.md)实施整理：保持原有行为，减少重复与嵌套，使用明确命名。该链接是 Claude agent 的规则文件，本轮读取并应用规则，没有安装或运行 Claude 插件；原生小程序继续使用项目现有 CommonJS 模块规范。

## 已完成

| 位置 | 原问题 | 整理结果 |
| --- | --- | --- |
| `pages/cart/cart.js`、`components/business/cart-sheet/cart-sheet.js` | 两个入口重复转换商品快照、价格、数量及可调整状态 | 提取纯函数 `utils/cart-presentation.js`，页面保留品牌等专属字段；复用可购列表，避免重复判断不可购状态 |
| `store/modules/cart.js` | 校验响应检查、单商品更新及数量检查混在一起；重复计算品牌及不可购提示 | 分离库存边界检查与单商品更新；使用提前返回消除已确定条件；删除必然被覆盖的赋值；用 `existingItem` 代替反复索引 |
| `services/repeat-order.js` | 聚合规格、计算可加数量、生成商品和统计混杂；`held`、`min`、`desired` 含义不够明确 | 单商品计算独立为 `buildRepeatItem`，使用 `existingQuantity`、`minOrderQty`、`desiredQuantity`；循环通过 `continue` 处理不可购项；结果反馈使用提前返回减少嵌套 |
| `backend/src/product/product.service.ts` | 商品排序和分页使用嵌套三元；单次使用的单商品价格包装方法增加跳转 | 明确按库存过滤、按价格排序、分页的顺序；统一内存分页条件；删除包装方法；补充泛型中的起订量类型，去掉该处 `any` 断言 |
| `web-customer/src/stores/cart.ts` | `flatMap` 每次都返回单元素数组；`priceMap` 实际包含完整校验信息 | 改用 `map` 和直接返回商品，重命名为 `validationBySku`，展开缺失规格分支 |

本轮修改7个运行源码文件（含1个新增共享模块），并调整2个现有测试的模块加载映射。库存、起订量、价格回退、用户所选数量、按品牌拆单和异步会话校验保持原有规则。

## 验证

| 检查 | 结果 |
| --- | --- |
| 根目录全部非数据库集成 Node 测试 | 274项通过 |
| 后端商品、目录、定价相关单元及契约测试 | 21套、175项通过 |
| 采购站全部单元测试 | 4套、18项通过 |
| 后端 `typecheck`、`lint`、`build` | 全部通过 |
| 采购站 `typecheck`、`build` | 全部通过 |
| 本轮已有文件 `git diff --check` | 通过 |

另使用临时脚本，将本轮修改文件的 HEAD 版本与整理后实现做输入矩阵对比：210组商品展示、420组购物车校验及更新、1,512组复购输入，合计2,142组结果一致。覆盖零价、缺失/异常价格、数字字符串、异常数量、起订量、库存不足、已有数量及失效规格。脚本未连接后端或数据库。

以上属于自动化与构建验证；没有执行数据库集成、浏览器交互或微信真机验收。构建存在下述体积提示，但成功完成。

## 后续优先提升点

1. **订单事务职责过多。** `backend/src/order/order.service.ts` 的 `createOrder` 同时负责身份与范围检查、规格校验、定价、快照和订单持久化；`submitFinance` 同时处理付款凭证、报价版本、额度占用、状态更新和通知记录。适合先提取纯计算与校验，再拆分事务内步骤，明确传递同一个 `Prisma.TransactionClient`。下一轮应配合订单、账期与并发隔离集成测试。
2. **管理后台库存页面集中管理多个工作流。** `admin-web/src/views/inventory/InventoryView.vue` 同时维护库存总览、流水、调整单和盘点的查询、加载、错误与弹窗状态，存在较多 `any`。适合按业务页签拆成组件与对应状态逻辑，并为接口响应补齐类型，减少不同工作流之间的维护耦合。
3. **采购站入口资源偏大。** 本轮构建的入口 JS 为1,270.47 kB，gzip后410.53 kB，Vite提示超过500 kB。`web-customer/src/main.ts` 全量注册 Element Plus 及其全部图标。建议先用构建分析确认占比，再评估组件和图标按需导入、依赖拆包，并对照首次加载体验验证收益。

## 整理阶段工作区状态

最初整理阶段保留已有的官网、协议、组件样式和留存工具等未提交工作，没有修改 `.env`、数据库或根目录 `config.js`。

## 已授权发布续办

用户随后授权推送并发布。业务源码`5624394`已推送`main`，GitHub CI四项全部通过；北京时间18:45:04，平台v1.3.21 / `ai-20261028-2`上线成功，27类业务摘要一致，仍24项迁移。微信1.3.14开发包405,026字节已上传，正式审核发布未完成。详细备份、预检拦截修正及验证见[发布记录](testing/2026-10-28-code-simplifier-release.md)。
