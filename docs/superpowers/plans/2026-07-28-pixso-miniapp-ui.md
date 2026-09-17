# Pixso Miniapp UI Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 将 Pixso 食品配送视觉迁移到原生微信小程序，同时保留中文业务、路由、服务和状态管理。

**Architecture:** 先用静态契约测试锁定品牌令牌、中文文案和路径，再更新全局 Token 与公共组件，最后逐页改造。JS 业务逻辑默认不改，WXML 只在建立视觉分组时调整。

**Tech Stack:** 微信小程序 JavaScript、WXML、WXSS、Node.js test runner

---

### Task 1: UI 契约测试

**Files:** Create/Test `tests/ui-theme-contract.test.js`

- [ ] 断言品牌红、暖粉、暖米和蓝灰令牌存在。
- [ ] 断言 `app.json` 保留首页、分类、订单、我的四个路径和中文标签。
- [ ] 扫描核心模板，禁止 `APPLY FILTER`、`Rp ` 和外语导航替代中文。
- [ ] 运行 `node --test tests/ui-theme-contract.test.js`，确认先因令牌缺失而失败。

### Task 2: 全局令牌与应用外观

**Files:** Modify `styles/tokens.wxss`, `styles/base.wxss`, `app.wxss`, `app.json`

- [ ] 增加品牌色、渐变、卡片、圆角、阴影、文字和动效变量，并兼容现有变量名。
- [ ] 调整导航栏、页面背景和 TabBar 颜色，不改变页面路径。
- [ ] 运行 UI 契约测试，确认品牌令牌和中文导航通过。

### Task 3: 公共组件

**Files:** Modify `components/base/status-badge/status-badge.wxss`, `components/business/search-bar/search-bar.wxss`, `components/business/segmented-control/segmented-control.wxss`, `components/business/category-scroll/category-scroll.wxss`, `components/business/product-row/product-row.wxss`, `components/business/product-card/product-card.wxss`, `components/business/quantity-stepper/quantity-stepper.wxss`, `components/business/order-card/order-card.wxss`, `components/business/sticky-action-bar/sticky-action-bar.wxss`, `components/business/cart-sheet/cart-sheet.wxss`, `components/layout/page-header/page-header.wxss`, `components/layout/section-title/section-title.wxss`, `components/feedback/loading-skeleton/loading-skeleton.wxss`, `components/feedback/empty-state/empty-state.wxss`, `components/feedback/error-state/error-state.wxss`

- [ ] 统一为白色大圆角卡片、品牌红主操作和蓝灰辅助文字。
- [ ] 保留 properties、事件名称、数据集和模板结构。
- [ ] 运行 `node --test tests/ui-theme-contract.test.js tests/mini-request.test.js`。

### Task 4: 核心购物链路页面

**Files:** Modify `pages/home/home.wxml`, `pages/home/home.wxss`, `pages/category/category.wxml`, `pages/category/category.wxss`, `pages/product-detail/product-detail.wxml`, `pages/product-detail/product-detail.wxss`, `pages/cart/cart.wxml`, `pages/cart/cart.wxss`, `pages/checkout/checkout.wxml`, `pages/checkout/checkout.wxss`

- [ ] 首页建立渐变企业头部、信用概览、中文搜索、分类和商品区域，保留接口与绑定。
- [ ] 分类页统一筛选与商品卡片，保留加载、分页、空状态和购物车入口。
- [ ] 商品详情使用粉米渐变和分组白卡，保留 SKU、库存、数量、协议价格和加购。
- [ ] 购物车与结算使用商品卡和票据式汇总，保留数量、删除、库存、支付和提交。

### Task 5: 订单、个人中心和登录

**Files:** Modify `pages/orders/orders.wxml`, `pages/orders/orders.wxss`, `pages/order-detail/order-detail.wxml`, `pages/order-detail/order-detail.wxss`, `pages/profile/profile.wxml`, `pages/profile/profile.wxss`, `pages/login/login.wxml`, `pages/login/login.wxss`

- [ ] 订单列表与详情使用中文状态和红色金额，保留取消、财务和确认收货。
- [ ] 个人中心使用渐变企业头部，保留资料、地址、协议价格和退出。
- [ ] 登录注册使用白色表单卡，保留手机号、验证码、密码、协议和错误提示。

### Task 6: 小程序验证

- [ ] 运行 `node --test tests/ui-theme-contract.test.js tests/mini-request.test.js`，要求零失败。
- [ ] 使用微信开发者工具或等效渲染检查首页、详情、购物车、结算、订单和登录的绑定、溢出与安全区。
- [ ] 记录无法自动验证的交互，不把静态检查当作远程发布或真机验证。
