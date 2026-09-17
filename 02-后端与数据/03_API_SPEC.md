# 火锅食材 B2B 小程序与管理系统 API 规范

> 适用范围：微信小程序、网页客户端、网页管理端、公司官网、统一后端服务。
>
> 目标：建立一套稳定、可扩展、易协作、适合真实商业项目落地的 RESTful API 规范。

---

## 1. 设计原则

1. 所有接口统一版本管理
2. 所有接口统一鉴权、统一响应、统一错误码
3. 所有核心业务必须由后端校验，不依赖前端
4. 所有写操作必须可审计
5. 所有列表接口必须分页
6. 接口命名必须清晰、可读、可维护
7. 接口设计要优先满足业务落地，而不是追求形式主义

---

## 2. API 总体约定

### 2.1 基础路径

统一使用版本前缀：

```text
/api/v1
```

### 2.2 请求格式

- 请求体默认使用 JSON
- GET 请求使用 query 参数
- 文件上传使用 `multipart/form-data`

### 2.3 响应格式

统一响应结构：

```json
{
  "code": 0,
  "message": "success",
  "data": {},
  "requestId": "req_123456789"
}
```

### 2.4 错误响应格式

```json
{
  "code": 4001,
  "message": "订单不存在",
  "data": null,
  "requestId": "req_123456789"
}
```

### 2.5 分页响应格式

```json
{
  "code": 0,
  "message": "success",
  "data": {
    "items": [],
    "page": 1,
    "pageSize": 20,
    "total": 100
  },
  "requestId": "req_123456789"
}
```

### 2.6 时间格式

统一使用 ISO 8601 或后端统一约定的标准时间格式，建议：

```text
2026-07-25T12:30:45+08:00
```

### 2.7 金额格式

- 金额字段统一使用数字类型
- 不在前端自行做精度舍入
- 与价格相关的字段必须以分或高精度 decimal 统一处理，前后端约定一致

---

## 3. 鉴权规范

### 3.1 登录方式

- 手机号 + 验证码登录
- 后续可扩展微信授权绑定

### 3.2 Token 规范

- `Authorization: Bearer <accessToken>`
- Access Token 短有效期
- Refresh Token 独立接口刷新

### 3.3 权限控制

后端必须校验：

- 用户身份
- 租户权限
- 品牌权限
- 角色权限
- 操作权限

### 3.4 常见鉴权错误码

- `AUTH_1001`：未登录
- `AUTH_1002`：登录失效
- `AUTH_1003`：无权限
- `AUTH_1004`：账号被禁用

---

## 4. 统一错误码体系

### 4.1 分类建议

- `AUTH_`：认证授权
- `CUS_`：客户
- `PRO_`：商品
- `ORD_`：订单
- `INV_`：库存
- `PAY_`：结算支付
- `TEN_`：租户品牌
- `SYS_`：系统
- `FILE_`：文件

### 4.2 典型错误码示例

- `ORD_1001` 订单不存在
- `ORD_1002` 订单状态不允许当前操作
- `INV_1001` 库存不足
- `PRO_1001` 商品不存在
- `CUS_1001` 客户不存在
- `FILE_1001` 文件上传失败

---

## 5. 接口命名规范

### 5.1 RESTful 规则

- `GET`：查询
- `POST`：创建或动作触发
- `PUT`：整体更新
- `PATCH`：局部更新
- `DELETE`：删除

### 5.2 路径命名

使用复数名词：

- `/customers`
- `/products`
- `/orders`
- `/inventories`

动作型接口使用语义化子路径：

- `/orders/{id}/confirm`
- `/orders/{id}/cancel`
- `/orders/{id}/price-adjust`

---

## 6. 通用接口约定

### 6.1 分页参数

- `page`
- `pageSize`
- `keyword`
- `status`
- `startAt`
- `endAt`

### 6.2 排序参数

- `sortBy`
- `sortOrder`

### 6.3 过滤参数

- `tenantId`
- `brandId`
- `customerId`
- `categoryId`
- `warehouseId`

### 6.4 请求追踪

- 每个请求必须生成 `requestId`
- 服务端日志、错误日志、审计日志都要带 `requestId`

---

## 7. 认证接口

### 7.1 发送验证码

```http
POST /api/v1/auth/send-code
```

#### 请求

```json
{
  "phone": "13800000000",
  "scene": "login"
}
```

#### 响应

```json
{
  "code": 0,
  "message": "success",
  "data": {
    "expireSeconds": 60
  },
  "requestId": "req_xxx"
}
```

### 7.2 手机号验证码登录

```http
POST /api/v1/auth/login
```

#### 请求

```json
{
  "phone": "13800000000",
  "code": "123456"
}
```

#### 响应

```json
{
  "code": 0,
  "message": "success",
  "data": {
    "accessToken": "xxx",
    "refreshToken": "yyy",
    "expiresIn": 7200,
    "user": {
      "id": 1,
      "name": "张三",
      "phone": "13800000000",
      "roles": ["admin"]
    }
  },
  "requestId": "req_xxx"
}
```

### 7.3 刷新 Token

```http
POST /api/v1/auth/refresh-token
```

### 7.4 退出登录

```http
POST /api/v1/auth/logout
```

---

## 8. 租户与品牌接口

### 8.1 租户列表

```http
GET /api/v1/tenants
```

### 8.2 品牌列表

```http
GET /api/v1/brands
```

### 8.3 当前用户可访问品牌

```http
GET /api/v1/brands/accessible
```

---

## 9. 客户接口

### 9.1 客户列表

```http
GET /api/v1/customers
```

### 9.2 客户详情

```http
GET /api/v1/customers/{id}
```

### 9.3 创建客户

```http
POST /api/v1/customers
```

### 9.4 更新客户

```http
PATCH /api/v1/customers/{id}
```

### 9.5 客户等级列表

```http
GET /api/v1/customer-levels
```

### 9.6 客户专属价格查询

```http
GET /api/v1/customers/{id}/price-rules
```

---

## 10. 商品接口

### 10.1 商品列表

```http
GET /api/v1/products
```

支持筛选：

- 品牌
- 分类
- 关键字
- 上下架状态
- 推荐状态

### 10.2 商品详情

```http
GET /api/v1/products/{id}
```

### 10.3 SKU 列表

```http
GET /api/v1/products/{id}/skus
```

### 10.4 创建商品

```http
POST /api/v1/products
```

### 10.5 更新商品

```http
PATCH /api/v1/products/{id}
```

### 10.6 分类列表

```http
GET /api/v1/product-categories
```

---

## 11. 库存接口

### 11.1 库存列表

```http
GET /api/v1/inventories
```

### 11.2 库存详情

```http
GET /api/v1/inventories/{id}
```

### 11.3 库存调整

```http
POST /api/v1/inventories/{id}/adjust
```

#### 请求

```json
{
  "changeQty": 10,
  "reason": "盘点修正"
}
```

### 11.4 库存日志

```http
GET /api/v1/inventory-logs
```

---

## 12. 订单接口

### 12.1 创建订单

```http
POST /api/v1/orders
```

#### 请求

```json
{
  "customerId": 1,
  "brandId": 1,
  "warehouseId": 1,
  "remark": "尽快发货",
  "items": [
    {
      "skuId": 101,
      "quantity": 10
    }
  ]
}
```

#### 响应

```json
{
  "code": 0,
  "message": "success",
  "data": {
    "orderId": 10001,
    "orderNo": "ORD202607250001",
    "status": "pending_confirm"
  },
  "requestId": "req_xxx"
}
```

### 12.2 订单列表

```http
GET /api/v1/orders
```

### 12.3 订单详情

```http
GET /api/v1/orders/{id}
```

### 12.4 确认订单

```http
POST /api/v1/orders/{id}/confirm
```

### 12.5 取消订单

```http
POST /api/v1/orders/{id}/cancel
```

### 12.6 修改订单价格

```http
POST /api/v1/orders/{id}/price-adjust
```

#### 请求

```json
{
  "reason": "大客户专供价",
  "items": [
    {
      "orderItemId": 9001,
      "newPrice": 88.5
    }
  ]
}
```

### 12.7 订单状态流转记录

```http
GET /api/v1/orders/{id}/status-logs
```

---

## 13. 结算接口

### 13.1 结算单列表

```http
GET /api/v1/settlements
```

### 13.2 结算单详情

```http
GET /api/v1/settlements/{id}
```

### 13.3 生成结算单

```http
POST /api/v1/settlements/generate
```

### 13.4 记录付款

```http
POST /api/v1/payments
```

---

## 14. 文件接口

### 14.1 文件上传

```http
POST /api/v1/files/upload
```

#### 请求

`multipart/form-data`

### 14.2 文件列表

```http
GET /api/v1/files
```

### 14.3 文件详情

```http
GET /api/v1/files/{id}
```

---

## 15. 管理端系统接口

### 15.1 角色列表

```http
GET /api/v1/roles
```

### 15.2 权限树

```http
GET /api/v1/permissions/tree
```

### 15.3 用户列表

```http
GET /api/v1/users
```

### 15.4 用户授权角色

```http
POST /api/v1/users/{id}/roles
```

### 15.5 审计日志列表

```http
GET /api/v1/audit-logs
```

---

## 16. 官网接口

如果官网与业务系统共用后端，可提供：

### 16.1 首页配置

```http
GET /api/v1/website/home-config
```

### 16.2 留资提交

```http
POST /api/v1/website/leads
```

### 16.3 产品介绍内容

```http
GET /api/v1/website/products
```

---

## 17. 接口安全要求

- 登录接口限流
- 敏感接口必须鉴权
- 文件上传限制类型与大小
- 所有写接口必须做参数校验
- 所有租户数据必须强隔离
- 关键操作必须记录审计日志

---

## 18. 接口版本与兼容

### 18.1 版本策略

- 主版本通过 URL 管理
- 重大变更必须新增版本，不可直接破坏旧版

### 18.2 向后兼容原则

- 新增字段优先，少删字段
- 状态枚举扩展时保留旧值兼容
- 前端灰度期允许同时兼容新旧字段

---

## 19. 前后端协作约定

### 19.1 后端必须提前提供

- 接口文档
- 返回字段定义
- 枚举值
- 错误码表
- 示例数据

### 19.2 前端必须遵守

- 不擅自假设接口字段
- 不绕过权限判断
- 不在前端硬编码业务规则

---

## 20. 最终落地建议

对于这个项目，建议第一阶段优先完成以下接口域：

- auth
- tenants / brands
- customers
- products
- inventories
- orders
- audit-logs
- files
- roles / permissions

这些接口足够支撑微信小程序、网页客户端、管理端和官网的第一版上线。
