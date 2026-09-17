# 火锅食材 B2B 小程序与管理系统数据库设计草案

> 适用范围：微信小程序、网页客户端、管理端、官网、统一后端服务。
>
> 目标：建立一套能支撑多品牌、多客户、多角色、多价格体系、订单履约、库存、结算和审计的数据库基础模型。

---

## 1. 设计原则

1. 所有核心业务表预留 `tenant_id`
2. 核心业务表尽量保留 `brand_id`
3. 关键业务状态全部落库，不依赖前端
4. 订单、库存、改价、权限变更必须有审计记录
5. 表结构优先服务业务可落地，而不是追求过度抽象
6. 第一阶段先实现“够用且稳定”，后续再扩展批次、效期、冷链、配送等能力

---

## 2. 数据库总体策略

### 2.1 多租户策略

建议采用字段隔离型多租户：

- 所有主业务表统一增加 `tenant_id`
- 品牌、厂家、门店等实体通过 `brand_id` 或 `org_id` 区分
- 所有业务查询默认按租户过滤
- 超级管理员允许跨租户查看，但必须记录审计日志

### 2.2 数据库引擎与字符集

- 数据库：MySQL 8.x
- 字符集：`utf8mb4`
- 排序规则：`utf8mb4_0900_ai_ci` 或项目统一约定的 utf8mb4 排序规则

### 2.3 通用字段规范

建议所有主表通用字段：

- `id`
- `tenant_id`
- `brand_id`
- `status`
- `created_at`
- `updated_at`
- `deleted_at`
- `created_by`
- `updated_by`

---

## 3. 核心实体模型

### 3.1 租户 `tenants`

代表平台上的一个业务主体或组织。

#### 建议字段

- `id`
- `name`：租户名称
- `code`：租户编码
- `status`：启用状态
- `contact_name`：联系人
- `contact_phone`：联系电话
- `remark`：备注
- `created_at`
- `updated_at`

#### 说明

- 适合作为最上层隔离维度
- 如果未来有多个合作厂家或事业部接入平台，这一层会非常重要

---

### 3.2 品牌 `brands`

用于区分公司内多个品牌，例如唯哆鲜、德品、鲜见爽等。

#### 建议字段

- `id`
- `tenant_id`
- `name`
- `code`
- `logo_url`
- `description`
- `status`
- `sort_order`
- `created_at`
- `updated_at`

#### 说明

- 一个租户可拥有多个品牌
- 前台和后台都应支持按品牌筛选商品和订单

---

### 3.3 组织与门店 `org_units`

用于描述内部组织、区域、门店、仓库或合作厂家组织结构。

#### 建议字段

- `id`
- `tenant_id`
- `brand_id`
- `parent_id`
- `type`：组织类型，如 `headquarters`、`branch`、`warehouse`、`manufacturer`
- `name`
- `code`
- `status`
- `created_at`
- `updated_at`

#### 说明

- 适合承载“厂家后续也接入平台”的需求
- 如果当前不复杂，也可以先简化为组织表，后续再扩展层级关系

---

### 3.4 用户 `users`

平台统一用户表，包含内部员工和管理账号。

#### 建议字段

- `id`
- `tenant_id`
- `brand_id`
- `org_unit_id`
- `name`
- `phone`
- `password_hash`
- `avatar_url`
- `user_type`：`super_admin` / `admin` / `staff` / `customer_user`
- `status`
- `last_login_at`
- `created_at`
- `updated_at`

#### 说明

- 内部员工与客户账号可分表，也可同表区分类型
- 如果要简化一期实现，建议先统一用户体系，再通过用户类型区分

---

### 3.5 角色 `roles`

#### 建议字段

- `id`
- `tenant_id`
- `brand_id`
- `name`
- `code`
- `description`
- `status`
- `created_at`
- `updated_at`

#### 说明

- 支撑超级管理员、管理员、销售、仓库、客服、财务等角色

---

### 3.6 权限 `permissions`

#### 建议字段

- `id`
- `parent_id`
- `permission_type`：菜单、页面、按钮、API
- `name`
- `code`
- `path`
- `method`
- `description`
- `status`
- `created_at`
- `updated_at`

#### 说明

- 建议权限码使用统一命名，如 `order:create`、`inventory:adjust`
- API 权限建议和业务权限统一映射

---

### 3.7 用户角色关联 `user_roles`

#### 建议字段

- `id`
- `tenant_id`
- `user_id`
- `role_id`
- `created_at`

---

### 3.8 角色权限关联 `role_permissions`

#### 建议字段

- `id`
- `tenant_id`
- `role_id`
- `permission_id`
- `created_at`

---

## 4. 客户与价格模型

### 4.1 客户 `customers`

#### 建议字段

- `id`
- `tenant_id`
- `brand_id`
- `customer_name`
- `customer_type`：门店、批发商、厂家、其他
- `contact_name`
- `contact_phone`
- `address`
- `customer_level_id`
- `credit_term_days`
- `settlement_type`
- `status`
- `created_at`
- `updated_at`

#### 说明

- 是整个业务的核心对象之一
- 客户等级和价格规则要能灵活扩展

---

### 4.2 客户等级 `customer_levels`

#### 建议字段

- `id`
- `tenant_id`
- `brand_id`
- `name`
- `code`
- `discount_rate`
- `description`
- `status`
- `created_at`
- `updated_at`

#### 说明

- 支持客户基础等级价
- 可与专属协议价叠加使用

---

### 4.3 客户协议价 `customer_price_rules`

#### 建议字段

- `id`
- `tenant_id`
- `brand_id`
- `customer_id`
- `product_id`
- `sku_id`
- `price_type`：等级价、协议价、人工价
- `price`
- `start_at`
- `end_at`
- `status`
- `created_at`
- `updated_at`

#### 说明

- 支持大客户专供价格
- 支持按单品或 SKU 维度定价

---

### 4.4 价格调整记录 `order_price_adjustments`

#### 建议字段

- `id`
- `tenant_id`
- `brand_id`
- `order_id`
- `order_item_id`
- `before_price`
- `after_price`
- `adjust_reason`
- `adjusted_by`
- `created_at`

#### 说明

- 所有人工调价必须记录
- 这是审计和对账的重要基础

---

## 5. 商品模型

### 5.1 商品分类 `product_categories`

#### 建议字段

- `id`
- `tenant_id`
- `brand_id`
- `parent_id`
- `name`
- `code`
- `sort_order`
- `status`
- `created_at`
- `updated_at`

---

### 5.2 商品 `products`

#### 建议字段

- `id`
- `tenant_id`
- `brand_id`
- `category_id`
- `name`
- `subtitle`
- `main_image_url`
- `description`
- `unit_id`
- `status`
- `is_recommended`
- `created_at`
- `updated_at`

#### 说明

- 商品是业务展示和下单的主入口
- 建议商品主体与 SKU 分离

---

### 5.3 SKU `product_skus`

#### 建议字段

- `id`
- `tenant_id`
- `brand_id`
- `product_id`
- `sku_code`
- `name`
- `specification`
- `unit_price`
- `cost_price`
- `sale_unit`
- `status`
- `created_at`
- `updated_at`

#### 说明

- 适合不同重量、规格、包装方式
- 价格最终应以 SKU 或客户价规则计算

---

### 5.4 单位字典 `units`

#### 建议字段

- `id`
- `tenant_id`
- `name`
- `code`
- `status`
- `created_at`
- `updated_at`

#### 说明

- 如：箱、包、斤、kg、袋、瓶

---

## 6. 库存模型

### 6.1 库存 `inventories`

#### 建议字段

- `id`
- `tenant_id`
- `brand_id`
- `warehouse_id`
- `product_id`
- `sku_id`
- `available_qty`
- `reserved_qty`
- `locked_qty`
- `warning_qty`
- `status`
- `created_at`
- `updated_at`

#### 说明

- 第一版先做基础库存
- 未来可增加批次、效期、冷链字段

---

### 6.2 库存日志 `inventory_logs`

#### 建议字段

- `id`
- `tenant_id`
- `brand_id`
- `warehouse_id`
- `product_id`
- `sku_id`
- `change_type`：入库、出库、预占、释放、调整
- `change_qty`
- `before_qty`
- `after_qty`
- `ref_type`
- `ref_id`
- `created_by`
- `created_at`

#### 说明

- 所有库存变动必须留痕
- 库存日志不能被随意删除

---

### 6.3 仓库 `warehouses`

#### 建议字段

- `id`
- `tenant_id`
- `brand_id`
- `name`
- `address`
- `contact_name`
- `contact_phone`
- `status`
- `created_at`
- `updated_at`

---

## 7. 订单模型

### 7.1 订单主表 `orders`

#### 建议字段

- `id`
- `tenant_id`
- `brand_id`
- `order_no`
- `customer_id`
- `user_id`
- `warehouse_id`
- `order_status`
- `payment_status`
- `delivery_status`
- `total_amount`
- `discount_amount`
- `adjust_amount`
- `payable_amount`
- `remark`
- `confirmed_at`
- `created_at`
- `updated_at`

#### 说明

- 订单金额必须可追溯
- 价格变更要区分基础金额、折扣、调整金额

---

### 7.2 订单明细 `order_items`

#### 建议字段

- `id`
- `tenant_id`
- `brand_id`
- `order_id`
- `product_id`
- `sku_id`
- `product_name`
- `sku_name`
- `unit_price`
- `quantity`
- `amount`
- `created_at`
- `updated_at`

#### 说明

- 保留下单时商品快照
- 即使商品后续修改，也不影响历史订单

---

### 7.3 订单状态流转记录 `order_status_logs`

#### 建议字段

- `id`
- `tenant_id`
- `brand_id`
- `order_id`
- `from_status`
- `to_status`
- `operator_id`
- `remark`
- `created_at`

#### 说明

- 便于追踪订单整个生命周期

---

## 8. 结算与财务模型

### 8.1 结算单 `settlements`

#### 建议字段

- `id`
- `tenant_id`
- `brand_id`
- `settlement_no`
- `customer_id`
- `settlement_period_start`
- `settlement_period_end`
- `total_order_amount`
- `total_adjust_amount`
- `total_payable_amount`
- `settlement_status`
- `created_at`
- `updated_at`

#### 说明

- 适合月结、账期、对账业务

---

### 8.2 付款记录 `payments`

#### 建议字段

- `id`
- `tenant_id`
- `brand_id`
- `customer_id`
- `order_id`
- `settlement_id`
- `payment_method`
- `payment_amount`
- `payment_status`
- `paid_at`
- `created_at`
- `updated_at`

---

### 8.3 发票/票据 `billing_records`

#### 建议字段

- `id`
- `tenant_id`
- `brand_id`
- `customer_id`
- `settlement_id`
- `invoice_no`
- `amount`
- `bill_type`
- `file_id`
- `status`
- `created_at`
- `updated_at`

---

## 9. 审计与日志模型

### 9.1 审计日志 `audit_logs`

#### 建议字段

- `id`
- `tenant_id`
- `brand_id`
- `operator_id`
- `module`
- `action`
- `target_type`
- `target_id`
- `before_data`
- `after_data`
- `ip_address`
- `user_agent`
- `created_at`

#### 说明

- 所有敏感操作必须进入审计日志
- 审计日志建议单独索引 `operator_id`、`module`、`target_id`

---

### 9.2 登录日志 `login_logs`

#### 建议字段

- `id`
- `tenant_id`
- `user_id`
- `login_type`
- `login_result`
- `ip_address`
- `user_agent`
- `created_at`

---

## 10. 文件与资源模型

### 10.1 文件表 `files`

#### 建议字段

- `id`
- `tenant_id`
- `brand_id`
- `file_name`
- `file_url`
- `file_type`
- `file_size`
- `mime_type`
- `storage_provider`
- `created_by`
- `created_at`

#### 说明

- 用于图片、资质、合同、导出文件
- 文件服务建议与业务表分离

---

## 11. 系统配置模型

### 11.1 系统配置 `system_configs`

#### 建议字段

- `id`
- `tenant_id`
- `brand_id`
- `config_key`
- `config_value`
- `config_type`
- `remark`
- `status`
- `created_at`
- `updated_at`

#### 说明

- 用于短信签名、首页配置、默认仓库、发货时间段等业务参数

---

## 12. 索引设计建议

### 12.1 必建索引

建议为以下字段建立索引：

- `tenant_id`
- `brand_id`
- `customer_id`
- `order_no`
- `order_status`
- `product_id`
- `sku_id`
- `warehouse_id`
- `created_at`
- `operator_id`

### 12.2 联合索引建议

常见联合索引：

- `tenant_id + brand_id`
- `tenant_id + customer_id`
- `tenant_id + order_status + created_at`
- `tenant_id + product_id + sku_id`
- `tenant_id + module + action`

### 12.3 索引原则

- 高频查询字段优先建索引
- 避免滥用索引导致写入过慢
- 大表必须结合实际查询场景设计索引

---

## 13. 状态字段建议

### 13.1 通用状态

- `enabled`
- `disabled`
- `draft`
- `active`
- `archived`

### 13.2 订单状态

- `draft`
- `pending_confirm`
- `confirmed`
- `picking`
- `delivering`
- `completed`
- `cancelled`
- `refunded`

### 13.3 库存变更类型

- `inbound`
- `outbound`
- `reserve`
- `release`
- `adjust`

---

## 14. 初版建模优先级

### 14.1 第一阶段必须先建

- tenants
- brands
- users
- roles
- permissions
- customers
- customer_levels
- customer_price_rules
- products
- product_skus
- inventories
- inventory_logs
- orders
- order_items
- audit_logs
- files
- system_configs

### 14.2 可延后建

- settlements
- payments
- billing_records
- delivery_records
- org_units
- login_logs
- order_status_logs

这些表建议在第一阶段就预留设计，但可以在实现上后置。

---

## 15. 关键设计提醒

### 15.1 不要过度拆表

一期不要为了理论最优把一个业务拆成过多表。比如价格体系既要支持基础价，也要支持专属价和人工价，但不要拆成过度复杂的规则引擎。

### 15.2 不要把历史订单和当前商品强绑定

订单必须存快照字段，否则后续商品改名、改规格、改价都会影响历史数据。

### 15.3 不要把权限只做在前端

前端权限只是展示控制，后端必须做真正的鉴权和拦截。

### 15.4 不要忽略审计

商业系统最容易出问题的往往不是功能，而是“谁改了什么、什么时候改的、为什么改的”无法追溯。

---

## 16. 结论

这份数据库草案遵循两个原则：

1. 先满足业务落地
2. 为未来多品牌、多厂家、多租户、多角色协作预留空间

如果后续要继续推进，下一步建议直接补充：

- API 接口规范文档
- UI 设计风格规范文档
- 核心表字段级详细定义
- 订单状态流转图

---

## 17. 建议的下一步

在数据库设计之后，建议立即制定 UI 规范，因为前端页面风格会直接影响：

- 商品展示结构
- 管理后台信息密度
- 官网宣传页视觉定位
- 统一组件库设计

如果你认可，我下一步就继续帮你写一份《UI 页面设计风格规范》。
