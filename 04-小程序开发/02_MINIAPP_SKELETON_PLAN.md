# 微信小程序代码骨架规划

> 适用范围：火锅食材 B2B 小程序端正式开发前的代码骨架规划。
>
> 目标：在开始写业务页面之前，先把项目结构、页面路由、状态管理、请求层、组件层、样式层和基础工具层统一起来，确保后续开发具备稳定、可维护、可扩展的骨架。

---

## 1. 当前项目现状

当前项目仍处于微信小程序默认模板状态，已有基础文件：

- `app.js`
- `app.json`
- `app.wxss`
- `pages/index/index.*`
- `pages/logs/logs.*`

当前默认模板仅适合作为空壳起点，不适合作为商业项目的正式骨架。

---

## 2. 代码骨架总目标

### 2.1 目标

- 将默认模板重构为商业项目结构
- 统一页面、组件、服务、状态和样式组织方式
- 为首页、商品页、下单页、订单页等核心页面预留稳定入口
- 让后续开发直接在标准化骨架上进行，而不是边写边改结构

### 2.2 骨架原则

1. 先搭结构，再写功能
2. 先统一入口，再写页面
3. 先统一请求层，再写业务接口
4. 先统一 UI 基座，再实现具体页面
5. 先跑通登录和首页，再逐步扩展业务页

---

## 3. 推荐项目结构

### 3.1 顶层目录

```text
miniapp/
├─ app.js
├─ app.json
├─ app.wxss
├─ project.config.json
├─ sitemap.json
├─ pages/
├─ components/
├─ services/
├─ store/
├─ utils/
├─ styles/
├─ constants/
├─ assets/
└─ typings/
```

### 3.2 目录职责

#### `pages/`

小程序页面入口目录，按业务拆分。

#### `components/`

通用组件、业务组件、页面骨架组件。

#### `services/`

接口请求、业务领域服务、数据转换逻辑。

#### `store/`

全局状态管理，放登录态、品牌、客户、购物车等共享状态。

#### `utils/`

工具函数、格式化、校验、缓存封装。

#### `styles/`

主题变量、基础样式、布局样式、通用样式片段。

#### `constants/`

常量、枚举、业务状态码、路由名。

#### `assets/`

Logo、图标、空状态图、默认占位资源。

#### `typings/`

全局类型定义、接口类型、领域模型类型。

---

## 4. 页面骨架规划

### 4.1 首期页面清单

建议首期只保留真正需要的页面：

- 首页 `pages/home`
- 分类页 `pages/category`
- 商品详情页 `pages/product-detail`
- 购物车页 `pages/cart`
- 下单页 `pages/checkout`
- 订单列表页 `pages/orders`
- 订单详情页 `pages/order-detail`
- 个人中心页 `pages/profile`
- 登录页 `pages/login`

### 4.2 不建议保留的默认页

当前默认模板中的 `logs` 页面不属于商业项目正式业务页面，建议在骨架阶段移除或保留为开发调试页，但不应进入正式页面导航。

---

## 5. app 级骨架规划

### 5.1 `app.js`

`app.js` 应只承担以下职责：

- 应用启动初始化
- 登录态恢复
- 全局配置加载
- 基础埋点或启动事件
- 全局异常处理入口

#### 推荐职责拆分

- 启动时读取本地 token
- 检查登录状态
- 初始化品牌/租户配置
- 拉取基础系统配置
- 初始化全局 store

### 5.2 `app.json`

`app.json` 应定义：

- 页面路由
- 导航栏样式
- 主题色基础配置
- 底部 tabBar
- 需要预加载的页面

### 5.3 `app.wxss`

`app.wxss` 应只放全局基准样式：

- 页面基础重置
- 全局字体和背景
- 基础容器宽度规则
- 通用辅助类

不建议在 `app.wxss` 中堆积业务样式。

---

## 6. 页面目录规范

### 6.1 每个页面标准四件套

每个页面建议统一结构：

- `.js` / `.ts`：页面逻辑
- `.wxml`：页面结构
- `.wxss`：页面样式
- `.json`：页面配置

### 6.2 页面目录命名

- 统一采用业务语义命名
- 页面目录小写加短横线
- 页面名称尽量与功能一致

示例：

- `home`
- `product-detail`
- `order-detail`
- `checkout`

---

## 7. 组件骨架规划

### 7.1 组件分类

建议将组件分为三层：

#### 基础组件

- Button
- Tag
- Badge
- Input
- EmptyState
- LoadingSkeleton

#### 业务组件

- ProductCard
- OrderCard
- PriceBlock
- InventoryBadge
- QuickActionBar

#### 页面骨架组件

- PageHeader
- SectionTitle
- FilterBar
- StickyActionBar
- SummaryPanel

### 7.2 组件目录建议

```text
components/
├─ base/
├─ business/
├─ layout/
└─ feedback/
```

---

## 8. 服务层骨架规划

### 8.1 请求层

建议建立统一请求封装：

- 自动附带 token
- 自动处理错误
- 自动处理超时
- 自动处理登录失效

### 8.2 接口模块划分

```text
services/
├─ api/
│  ├─ auth.js
│  ├─ user.js
│  ├─ brand.js
│  ├─ product.js
│  ├─ cart.js
│  ├─ order.js
│  ├─ address.js
│  ├─ config.js
│  └─ upload.js
├─ request.js
└─ response.js
```

### 8.3 服务层职责

- 请求封装
- 响应标准化
- 错误转换
- 数据适配
- 业务接口分组

---

## 9. 状态管理骨架规划

### 9.1 推荐状态域

- `auth`：登录态、token、用户信息
- `brand`：当前品牌、品牌列表
- `customer`：客户信息、等级、价格策略
- `cart`：购物车数据
- `config`：系统配置
- `ui`：全局 UI 状态，如主题切换、加载状态

### 9.2 状态管理原则

- 页面内部状态留在页面内
- 可跨页面共享的数据进入 store
- 只保存必要状态，不保存冗余派生状态

### 9.3 推荐目录

```text
store/
├─ modules/
│  ├─ auth.js
│  ├─ brand.js
│  ├─ cart.js
│  ├─ customer.js
│  └─ config.js
└─ index.js
```

---

## 10. 工具层骨架规划

### 10.1 必备工具

- 时间格式化
- 金额格式化
- 手机号脱敏
- 文件路径处理
- 本地缓存封装
- 表单校验工具
- 主题切换工具

### 10.2 推荐目录

```text
utils/
├─ request.js
├─ storage.js
├─ format.js
├─ validate.js
├─ theme.js
└─ constants.js
```

---

## 11. 样式层骨架规划

### 11.1 样式层级

建议分为三层：

- 基础变量层
- 通用样式层
- 页面样式层

### 11.2 推荐目录

```text
styles/
├─ tokens.wxss
├─ base.wxss
├─ theme-light.wxss
├─ theme-dark.wxss
└─ mixins.wxss
```

### 11.3 样式职责

- `tokens.wxss`：颜色、字号、间距、圆角、阴影变量
- `base.wxss`：全局基础样式
- `theme-light.wxss`：浅色主题
- `theme-dark.wxss`：深色主题
- `mixins.wxss`：通用样式片段

---

## 12. 常量与类型骨架规划

### 12.1 常量目录

```text
constants/
├─ routes.js
├─ status.js
├─ storage.js
├─ order.js
├─ product.js
└─ theme.js
```

### 12.2 类型目录

```text
typings/
├─ auth.d.ts
├─ user.d.ts
├─ brand.d.ts
├─ product.d.ts
├─ order.d.ts
└─ api.d.ts
```

---

## 13. 小程序首期核心链路

### 13.1 必须跑通的链路

1. 打开小程序
2. 检查登录
3. 进入首页
4. 浏览商品
5. 查看商品详情
6. 加入购物车
7. 提交订单
8. 查看订单详情
9. 完成再次购买或返回首页

### 13.2 首期不建议优先做的复杂内容

- 复杂营销活动
- 多级分销
- 复杂促销引擎
- 复杂仓配优化
- 复杂 BI 看板

---

## 14. 骨架阶段验收标准

### 14.1 结构验收

- 目录结构清晰
- 路由结构清晰
- 请求层统一
- 状态层统一
- 样式层统一

### 14.2 交互验收

- 页面能正常跳转
- 登录能恢复
- 首页能正常展示基础数据
- 骨架页面与样式能被复用

### 14.3 开发验收

- 任何新页面都能按照模板快速创建
- 任何新组件都能按照统一规范开发
- 页面不会因为架构混乱而反复重构

---

## 15. 建议的实施顺序

1. 重构 `app.json`
2. 重构 `app.js`
3. 建立 `services/request.js`
4. 建立 `store` 基础模块
5. 建立 `styles` 与 `constants`
6. 搭建通用组件库基础
7. 创建首页骨架
8. 创建分类页骨架
9. 创建商品详情页骨架
10. 创建下单页骨架
11. 创建订单页骨架
12. 联调基础接口

---

## 16. 结论

这份代码骨架规划的意义，是让小程序端从一开始就站在“可长期维护的商业项目结构”上，而不是停留在默认模板或临时拼装状态。

当这套骨架搭好后，后续页面开发会明显更快、更稳，也更容易保持你要求的苹果味、高级、克制、可落地的整体体验。
