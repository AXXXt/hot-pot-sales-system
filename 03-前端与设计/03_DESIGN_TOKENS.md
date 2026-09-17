# 火锅食材 B2B 平台 Design Tokens 规范

> 适用范围：微信小程序、网页客户端、网页管理端、官网宣传页、统一组件库。
>
> 目标：通过统一的颜色、字体、间距、圆角、阴影、动效、断点和层级规则，确保整个项目在不同终端上拥有一致、克制、高级、具备苹果味的视觉体验。

---

## 1. 设计令牌总原则

### 1.1 目标

Design Tokens 的目标不是让样式“更复杂”，而是让样式“可控、可复用、可维护”。

### 1.2 设计原则

1. 所有视觉值都必须来自令牌，不允许页面随意硬编码
2. 令牌必须支持浅色与深色双主题
3. 令牌必须兼顾小程序、Web 和管理端
4. 令牌必须稳定，不能频繁随意变动
5. 令牌命名必须语义化、可读、可扩展

---

## 2. 令牌分类

建议将设计令牌划分为以下几类：

- Color Tokens：颜色
- Typography Tokens：字体、字号、字重、行高
- Spacing Tokens：间距
- Radius Tokens：圆角
- Shadow Tokens：阴影
- Motion Tokens：动效
- Border Tokens：描边
- Z-Index Tokens：层级
- Layout Tokens：栅格、断点、容器宽度

---

## 3. 颜色令牌

### 3.1 颜色使用原则

- 主色少而精
- 状态色必须统一语义
- 颜色必须支撑深浅双主题
- 不允许页面随意引入新颜色而不进入令牌系统

### 3.2 基础色角色

#### 品牌色

- `brand.primary`：主品牌色
- `brand.secondary`：辅助品牌色
- `brand.accent`：强调色

#### 中性色

- `neutral.0`：纯白或最浅背景
- `neutral.50`：极浅灰背景
- `neutral.100`：浅灰分割
- `neutral.200`：边界灰
- `neutral.300`：弱边界
- `neutral.400`：辅助文本
- `neutral.500`：正文次级文本
- `neutral.700`：正文主文本
- `neutral.900`：深色主文本
- `neutral.950`：深色主背景

#### 状态色

- `success`：成功、完成、正常
- `warning`：预警、注意、库存紧张
- `danger`：错误、取消、失败、作废
- `info`：信息提示、说明

### 3.3 推荐颜色风格

项目整体建议围绕以下方向：

- 深色基底：石墨黑、深灰、冷黑
- 浅色基底：暖白、雾白、浅灰
- 强调色：冷蓝、银灰、低饱和绿色之一

### 3.4 颜色使用规则

- 大面积背景用中性色
- 强调色只用于关键 CTA、关键数字、重要状态
- 危险色不能滥用
- 状态标签必须统一映射

---

## 4. 字体令牌

### 4.1 字体族

建议采用系统无衬线字体优先策略：

- `font.family.base`：系统无衬线
- `font.family.mono`：等宽字体，用于数字、编码、日志、价格明细

### 4.2 字重令牌

- `font.weight.regular`
- `font.weight.medium`
- `font.weight.semibold`
- `font.weight.bold`

### 4.3 字号层级

建议建立统一字号体系：

- `font.size.xs`：标签、辅助信息
- `font.size.sm`：说明文字
- `font.size.md`：正文
- `font.size.lg`：卡片标题
- `font.size.xl`：模块标题
- `font.size.2xl`：页面标题
- `font.size.3xl`：大屏主标题
- `font.size.display`：官网主视觉标题

### 4.4 行高

- `lineHeight.tight`：标题类
- `lineHeight.normal`：正文类
- `lineHeight.relaxed`：长说明类

### 4.5 字体使用规则

- 标题偏紧凑，增强高级感
- 正文清晰易读
- 管理端数字和金额建议使用等宽或等宽风格数字
- 官网主标题可更大，但不能夸张

---

## 5. 间距令牌

### 5.1 间距体系

采用 4 或 8 的倍数体系：

- `space.0`
- `space.1` = 4px
- `space.2` = 8px
- `space.3` = 12px
- `space.4` = 16px
- `space.5` = 20px
- `space.6` = 24px
- `space.8` = 32px
- `space.10` = 40px
- `space.12` = 48px
- `space.16` = 64px

### 5.2 使用规则

- 页面边距统一
- 模块间距统一
- 卡片内部间距统一
- 禁止出现不规则魔法数值

### 5.3 推荐使用场景

- 页面外边距
- 卡片内边距
- 模块分隔
- 列表行间距
- 表单区块间距

---

## 6. 圆角令牌

### 6.1 圆角等级

- `radius.none`：无圆角
- `radius.xs`：轻微圆角
- `radius.sm`：小控件圆角
- `radius.md`：默认圆角
- `radius.lg`：卡片圆角
- `radius.xl`：大模块圆角
- `radius.full`：胶囊形

### 6.2 使用规则

- 按钮通常使用中小圆角
- 卡片使用中等圆角
- 顶部 hero 区可使用更大圆角感
- 管理端不要过度圆润，以免降低专业感

---

## 7. 阴影令牌

### 7.1 阴影原则

- 阴影要轻
- 阴影要服务层级，不服务装饰
- 深色模式中阴影更依赖透明度和边界变化

### 7.2 阴影等级

- `shadow.none`
- `shadow.sm`
- `shadow.md`
- `shadow.lg`
- `shadow.focus`

### 7.3 使用规则

- 主要用于卡片、浮层、抽屉、弹窗
- 不要所有元素都加阴影
- 重点区块可以通过阴影和边界同时表达层次

---

## 8. 描边令牌

### 8.1 描边等级

- `border.none`
- `border.subtle`
- `border.default`
- `border.strong`

### 8.2 使用规则

- 分割线和输入框优先使用轻描边
- 管理端表格使用清晰但克制的边界
- 深色模式要注意描边和背景对比

---

## 9. 动效令牌

### 9.1 时长

- `motion.duration.fast`：120ms
- `motion.duration.normal`：180ms
- `motion.duration.medium`：240ms
- `motion.duration.slow`：320ms

### 9.2 缓动

- `motion.easing.standard`
- `motion.easing.decelerate`
- `motion.easing.accelerate`
- `motion.easing.emphasized`

### 9.3 动效规则

- 快速反馈优先
- 不要使用过长动效
- 页面切换和微交互要统一节奏
- 骨架屏、按钮反馈、抽屉过渡都必须可控

---

## 10. 层级令牌

### 10.1 Z-Index 建议

- `z.base`
- `z.dropdown`
- `z.sticky`
- `z.overlay`
- `z.modal`
- `z.toast`
- `z.tooltip`

### 10.2 使用规则

- 固定导航、下拉菜单、弹窗、提示气泡必须统一层级
- 不允许随意堆高 z-index

---

## 11. 布局令牌

### 11.1 容器宽度

建议定义：

- `layout.container.sm`
- `layout.container.md`
- `layout.container.lg`
- `layout.container.xl`

### 11.2 栅格体系

- Web 端建议 12 栅格
- 管理端可采用 12 栅格 + 灵活侧栏
- 小程序优先单列布局

### 11.3 断点建议

- `breakpoint.sm`
- `breakpoint.md`
- `breakpoint.lg`
- `breakpoint.xl`

### 11.4 使用规则

- 客户端强调响应式阅读体验
- 管理端强调大屏利用率
- 官网强调品牌主视觉的容器控制

---

## 12. 主题令牌

### 12.1 浅色主题

- 背景更明亮
- 卡片更柔和
- 文本更清晰
- 边界更轻

### 12.2 深色主题

- 背景更接近黑色
- 卡片层次通过明度差与描边表达
- 强调色更收敛
- 文本对比需要足够清晰

### 12.3 主题切换规则

- 所有颜色都必须映射到语义 token
- 不允许直接写死某个页面主题色
- 切换后保持布局不变，仅改视觉风格

---

## 13. 语义颜色建议映射

### 13.1 文本语义

- `text.primary`
- `text.secondary`
- `text.tertiary`
- `text.disabled`
- `text.inverse`

### 13.2 背景语义

- `bg.canvas`
- `bg.surface`
- `bg.subtle`
- `bg.elevated`
- `bg.overlay`

### 13.3 边界语义

- `border.subtle`
- `border.default`
- `border.strong`

### 13.4 状态语义

- `status.success`
- `status.warning`
- `status.danger`
- `status.info`

### 13.5 业务语义

- `business.price`
- `business.inventory`
- `business.order`
- `business.customer`
- `business.brand`

---

## 14. 数字与金额令牌

### 14.1 金额显示

- 金额必须优先清晰
- 数字建议使用等宽视觉表现
- 小数位和货币符号统一

### 14.2 数字层级

- 大数字用于首页 KPI
- 中数字用于卡片和汇总
- 小数字用于明细和辅助

### 14.3 使用规则

- 金额不能过度装饰
- 数字必须易读
- 统计页和订单页的数字展示应统一

---

## 15. 令牌命名规范

### 15.1 命名原则

- 语义化
- 层级清晰
- 可扩展
- 不带技术实现痕迹

### 15.2 示例

- `color.bg.canvas`
- `color.text.primary`
- `space.4`
- `radius.lg`
- `shadow.md`
- `motion.duration.fast`

---

## 16. Token 使用规范

### 16.1 使用优先级

1. 先用语义 token
2. 再用基础 token
3. 不允许页面直接使用裸值

### 16.2 示例原则

- 商品卡片背景 → `bg.surface`
- 主 CTA → `brand.primary`
- 库存预警 → `status.warning`
- 分割线 → `border.subtle`

### 16.3 禁止行为

- 页面直接写 `#000000`
- 页面直接写 `16px` 而不经过 token
- 每个页面自定义一套颜色体系

---

## 17. 第一批必须落地的令牌

建议优先建立以下 token：

- `color`
- `text`
- `bg`
- `space`
- `radius`
- `shadow`
- `motion`
- `border`
- `z`
- `layout`

---

## 18. 结论

Design Tokens 是整个 UI 系统的底层基座。只有先把颜色、字号、间距、圆角、阴影、动效和层级统一起来，后面的组件库、页面模板和多端适配才会真正稳定。

对于这个项目来说，令牌不是“美化工具”，而是“保证品牌一致性和开发效率的基础设施”。
