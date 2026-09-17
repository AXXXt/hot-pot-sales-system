# Pixso Admin UI Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 将 Pixso 食品配送品牌语言迁移到 Vue 管理端，同时保留桌面信息效率、路由、API、权限和中文操作。

**Architecture:** 新建集中式主题 CSS 并在 Element Plus 后加载，先覆盖全局变量和通用控件，再调整主框架与关键页面的硬编码颜色。业务脚本、路由、API 和 Pinia Store 默认不改。

**Tech Stack:** Vue 3、TypeScript、Element Plus、Pinia、Vite、Vitest

---

### Task 1: 管理端主题契约测试

**Files:** Create `admin-web/src/styles/theme.test.ts`, `admin-web/src/styles/theme.css`; Modify `admin-web/src/main.ts`

- [ ] 测试读取 `theme.css`，断言品牌红、暖背景、Element Plus 主色变量和中文字体栈存在。
- [ ] 运行 `npm.cmd --prefix admin-web run test:unit -- src/styles/theme.test.ts`，确认先因主题文件缺失或变量缺失而失败。
- [ ] 创建主题文件并在 Element Plus 样式之后导入，使测试转绿。

### Task 2: 全局框架与登录

**Files:** Modify `admin-web/src/App.vue`, `admin-web/src/layouts/MainLayout.vue`, `admin-web/src/views/login/LoginView.vue`

- [ ] 将侧边栏改为深红渐变，保留中文菜单、权限过滤、折叠和退出。
- [ ] 统一顶栏、面包屑、内容背景、页面标题和 Element Plus 控件。
- [ ] 登录页使用红色渐变背景和白色圆角卡，保留认证与中文错误提示。

### Task 3: 工作台与通用展示

**Files:** Modify `admin-web/src/views/dashboard/DashboardView.vue`, `admin-web/src/components/PageTable.vue`, `admin-web/src/components/ModuleSkeleton.vue`, `admin-web/src/views/SkeletonView.vue`, `admin-web/src/views/system/ForbiddenView.vue`

- [ ] 工作台增加品牌概览区并重绘真实指标卡，不新增虚构指标。
- [ ] 统一表格容器、加载骨架、空状态和无权限页面。

### Task 4: 商品与分类

**Files:** Modify `admin-web/src/views/product/ProductListView.vue`, `admin-web/src/views/product/ProductEditView.vue`, `admin-web/src/views/product/CategoryView.vue`

- [ ] 重绘页面头部、筛选、表格、图片、状态和抽屉。
- [ ] 保留商品、SKU、上下架、图片上传和分类增删改逻辑。
- [ ] 主操作使用品牌红，危险与成功操作保留语义色。

### Task 5: 客户、订单与用户

**Files:** Modify `admin-web/src/views/customer/CustomerList.vue`, `admin-web/src/views/customer/CustomerDetail.vue`, `admin-web/src/views/customer/components/ProductVisibilityCard.vue`, `admin-web/src/views/orders/OrderListView.vue`, `admin-web/src/views/orders/OrderDetailView.vue`, `admin-web/src/views/user/UserListView.vue`

- [ ] 客户卡片与详情使用品牌红和白卡，保留审核、等级、可见范围与权限。
- [ ] 订单列表与详情使用票据式汇总和中文状态，保留报价、审批、发货、取消、完成和调价。
- [ ] 用户与角色页面统一表格、筛选、标签、弹窗和主操作。

### Task 6: 管理端验证

- [ ] 运行 `npm.cmd --prefix admin-web run test:unit`，要求零失败。
- [ ] 运行 `npm.cmd --prefix admin-web run typecheck`，要求退出码 0。
- [ ] 运行 `npm.cmd --prefix admin-web run lint`，要求退出码 0；不修复无关历史问题。
- [ ] 运行 `npm.cmd --prefix admin-web run build`，要求退出码 0。
- [ ] 启动管理端并检查登录、侧栏、工作台、商品、客户和订单的桌面与窄屏布局。
