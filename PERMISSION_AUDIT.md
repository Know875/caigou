# 权限检查报告

## 检查时间
2025-01-21

## 角色定义
根据 `PROJECT.md` 和代码中的定义，系统有以下角色：
- **ADMIN** (管理员)
- **BUYER** (采购员)
- **SUPPLIER** (供应商)
- **STORE** (门店)
- **USER** (用户，可能未使用)

## 权限检查结果

### ✅ 权限控制正确的模块

#### 1. Admin Controller (`apps/api/src/modules/admin/admin.controller.ts`)
- ✅ 所有接口都使用 `@Roles('ADMIN')` 装饰器限制
- ✅ `getSuppliers` 接口允许 ADMIN 和 BUYER 访问
- ✅ 删除门店操作有明确的权限检查

#### 2. DingTalk Controller (`apps/api/src/modules/dingtalk/dingtalk.controller.ts`)
- ✅ 所有接口都有明确的 ADMIN 权限检查

#### 3. Notification Controller (`apps/api/src/modules/notification/notification.controller.ts`)
- ✅ 所有用户都可以查看自己的通知（合理）

#### 4. Report Controller (`apps/api/src/modules/report/report.controller.ts`)
- ✅ 供应商财务看板：供应商只能查看自己的数据
- ✅ 管理员和采购员可以查看所有供应商的数据

### ⚠️ 需要改进的模块

#### 1. User Controller (`apps/api/src/modules/user/user.controller.ts`)
**问题：**
- ❌ `findAll()` - 获取用户列表没有权限限制，任何登录用户都可以查看所有用户列表
- ❌ `findOne()` - 获取用户详情没有权限限制

**建议：**
- 应该限制为只有 ADMIN 可以查看用户列表
- 或者至少限制为 ADMIN 和 BUYER 可以查看

#### 2. RFQ Controller (`apps/api/src/modules/rfq/rfq.controller.ts`)
**问题：**
- ⚠️ `create()` - 创建询价单没有明确的角色限制（虽然Service层有门店检查）
- ⚠️ `publish()` - 发布询价单没有明确的角色限制
- ⚠️ `close()` - 关闭询价单没有明确的角色限制（虽然Service层有门店检查）
- ⚠️ `awardItem()` - 选商操作没有明确的角色限制
- ⚠️ `delete()` - 删除询价单没有明确的角色限制

**建议：**
- 创建询价单：应该限制为 ADMIN、BUYER、STORE（供应商不应该能创建）
- 发布询价单：应该限制为 ADMIN、BUYER、STORE
- 关闭询价单：应该限制为 ADMIN、BUYER、STORE
- 选商操作：应该限制为 ADMIN、BUYER（供应商不应该能选商）
- 删除询价单：应该限制为 ADMIN、BUYER

#### 3. Quote Controller (`apps/api/src/modules/quote/quote.controller.ts`)
**问题：**
- ⚠️ `award()` - 选商操作没有明确的角色限制

**建议：**
- 选商操作应该限制为只有 ADMIN 和 BUYER 可以操作

#### 4. Shipment Controller (`apps/api/src/modules/shipment/shipment.controller.ts`)
**问题：**
- ⚠️ `create()` - 创建发货单没有明确的角色限制

**建议：**
- 创建发货单应该限制为只有 SUPPLIER 可以操作

#### 5. Order Controller (`apps/api/src/modules/order/order.controller.ts`)
**问题：**
- ⚠️ `create()` - 创建订单没有明确的角色限制
- ⚠️ `importHistoryData()` - 导入历史数据没有明确的角色限制

**建议：**
- 创建订单：可能需要限制为 ADMIN、BUYER、STORE
- 导入历史数据：应该限制为 ADMIN、BUYER

#### 6. AfterSales Controller (`apps/api/src/modules/after-sales/after-sales.controller.ts`)
**问题：**
- ⚠️ `create()` - 创建售后工单没有明确的角色限制
- ⚠️ `assignToSupplier()` - 下发工单没有明确的角色限制
- ⚠️ `confirmResolution()` - 确认售后完成没有明确的角色限制

**建议：**
- 创建售后工单：可能需要限制为 ADMIN、BUYER、STORE
- 下发工单：应该限制为 ADMIN、BUYER
- 确认售后完成：应该限制为 ADMIN、BUYER

#### 7. Import Controller (`apps/api/src/modules/import/import.controller.ts`)
**问题：**
- ⚠️ `importProductsAndCreateRfq()` - 导入商品并创建询价单没有明确的角色限制

**建议：**
- 应该限制为 ADMIN、BUYER、STORE（供应商不应该能导入）

## 权限矩阵（期望）

| 功能 | ADMIN | BUYER | SUPPLIER | STORE |
|------|-------|-------|----------|-------|
| 创建询价单 | ✅ | ✅ | ❌ | ✅ |
| 发布询价单 | ✅ | ✅ | ❌ | ✅ |
| 关闭询价单 | ✅ | ✅ | ❌ | ✅ |
| 查看询价单 | ✅ | ✅ | ✅ (已发布) | ✅ (自己门店) |
| 提交报价 | ❌ | ❌ | ✅ | ❌ |
| 选商 | ✅ | ✅ | ❌ | ❌ |
| 创建发货单 | ❌ | ❌ | ✅ | ❌ |
| 上传面单 | ❌ | ❌ | ✅ (自己的) | ❌ |
| 上传付款截图 | ✅ | ✅ | ❌ | ❌ |
| 创建订单 | ✅ | ✅ | ❌ | ✅ |
| 查看订单 | ✅ | ✅ | ❌ | ✅ (自己门店) |
| 创建售后工单 | ✅ | ✅ | ❌ | ✅ |
| 下发售后工单 | ✅ | ✅ | ❌ | ❌ |
| 确认售后完成 | ✅ | ✅ | ❌ | ❌ |
| 查看报表 | ✅ | ✅ | ✅ (自己的) | ✅ (自己门店) |
| 用户管理 | ✅ | ❌ | ❌ | ❌ |
| 系统配置 | ✅ | ❌ | ❌ | ❌ |

## 建议修复优先级

### 高优先级
1. **User Controller** - 用户列表应该限制为只有 ADMIN 可以查看
2. **RFQ Controller** - 选商操作应该限制为只有 ADMIN 和 BUYER
3. **Quote Controller** - 选商操作应该限制为只有 ADMIN 和 BUYER

### 中优先级
4. **Shipment Controller** - 创建发货单应该限制为只有 SUPPLIER
5. **RFQ Controller** - 创建/发布/关闭询价单应该明确限制角色
6. **AfterSales Controller** - 下发工单和确认完成应该限制角色

### 低优先级
7. **Order Controller** - 创建订单和导入历史数据应该限制角色
8. **Import Controller** - 导入功能应该限制角色

## 修复记录

### 已修复的问题（2025-01-21）

#### ✅ 高优先级修复
1. **User Controller**
   - ✅ 添加了 `@Roles('ADMIN', 'BUYER')` 装饰器
   - ✅ 添加了双重权限检查

2. **RFQ Controller**
   - ✅ `create()` - 添加了供应商权限检查
   - ✅ `createFromFile()` - 添加了供应商权限检查
   - ✅ `publish()` - 添加了供应商权限检查
   - ✅ `close()` - 添加了供应商权限检查
   - ✅ `awardItem()` - 添加了管理员和采购员权限检查
   - ✅ `delete()` - 添加了管理员和采购员权限检查

3. **Quote Controller**
   - ✅ `award()` - 添加了管理员和采购员权限检查

4. **Shipment Controller**
   - ✅ `create()` - 添加了供应商权限检查

#### ✅ 中优先级修复
5. **AfterSales Controller**
   - ✅ `assignToSupplier()` - 添加了管理员和采购员权限检查
   - ✅ `confirmResolution()` - 添加了管理员和采购员权限检查

6. **Import Controller**
   - ✅ `importProductsAndCreateRfq()` - 添加了供应商权限检查

7. **Order Controller**
   - ✅ `importHistoryData()` - 添加了管理员和采购员权限检查

## 权限修复（2025-01-21 第二次修复）

### 修复内容：确保ADMIN拥有所有权限，门店和供应商只能看到自己的数据

#### ✅ 已修复的Controller

1. **Shipment Controller**
   - ✅ `findAll()` - ADMIN不受门店过滤限制
   - ✅ 供应商只能看到自己的发货单（已正确）

2. **AfterSales Controller**
   - ✅ `findAll()` - ADMIN不受门店过滤限制
   - ✅ `getStats()` - ADMIN不受门店过滤限制
   - ✅ 供应商只能看到自己的工单（已正确）

3. **RFQ Controller**
   - ✅ `getUnquotedItems()` - ADMIN可以看到所有未报价商品
   - ✅ `getShipmentOverview()` - ADMIN可以看到所有发货状态

4. **Order Controller**
   - ✅ `findAll()` - ADMIN不受门店过滤限制
   - ✅ `findHistoryData()` - ADMIN不受门店过滤限制
   - ✅ `getHistoryStats()` - ADMIN不受门店过滤限制

5. **Report Controller**
   - ✅ `getFinancialReport()` - ADMIN不受门店过滤限制

6. **Quote Controller**
   - ✅ `findAll()` - ADMIN可以看到所有报价（逻辑已正确，注释已更新）

7. **Award Controller**
   - ✅ `findAll()` - ADMIN和BUYER可以看到所有中标（已正确）

### 权限控制原则

1. **ADMIN权限**：
   - ✅ 可以看到所有数据（不受门店/供应商过滤限制）
   - ✅ 可以执行所有操作
   - ✅ 在查询时，如果role是ADMIN，跳过门店过滤

2. **门店权限**：
   - ✅ 只能看到自己门店的数据（通过`getStoreFilter`实现）
   - ✅ 不能看到其他门店的数据

3. **供应商权限**：
   - ✅ 只能看到自己的报价、发货单、售后工单
   - ✅ 不能看到其他供应商的数据

4. **采购员权限**：
   - ✅ 可以看到所有数据（与ADMIN类似，但某些管理功能受限）

## 总结

### 修复前
大部分权限控制是通过 Service 层的业务逻辑实现的，但 Controller 层缺少明确的角色限制装饰器。

### 修复后
1. ✅ 在 Controller 层添加了明确的权限检查
2. ✅ 在 Service 层保留了业务逻辑检查作为双重保障
3. ✅ 对于敏感操作（如用户管理、选商等），同时使用了装饰器和业务逻辑检查

### 剩余建议
1. 可以考虑在更多地方使用 `@Roles()` 装饰器，使权限控制更加统一和清晰
2. 对于门店用户的权限，Service 层已经有很好的检查，Controller 层可以进一步明确
3. 建议定期审查权限控制，确保新增功能都有适当的权限限制

