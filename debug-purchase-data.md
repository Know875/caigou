# 电商采购清单数据调试指南

## 问题描述
电商采购清单页面看不到地址和电话，显示为 "-"

## 字段映射检查

### 前端表头 → 数据字段
- ✅ "订单号" → `item.orderNo`
- ✅ "收件人" → `item.recipient`
- ✅ "手机" → `item.phone`
- ✅ "地址" → `item.address`
- ✅ "修改地址" → `item.modifiedAddress`

**结论：字段映射正确，不是表头问题**

## 可能的原因

### 1. 订单匹配失败
如果询价单没有关联订单，或者订单匹配逻辑失败，这些字段会是 `undefined`

### 2. 订单信息缺失
如果订单记录本身就没有 `recipient`, `phone`, `address` 字段，也会显示为 "-"

## 调试步骤

### 步骤1：检查后端返回的数据
在浏览器开发者工具中：
1. 打开 Network 标签
2. 访问电商采购清单页面
3. 找到 `/rfqs/unquoted-items` 请求
4. 查看 Response，检查返回的数据结构

### 步骤2：检查订单匹配逻辑
在后端代码中，检查：
- `apps/api/src/modules/rfq/rfq.service.ts` 的 `findUnquotedItems` 方法
- 确认 `orderInfos` 是否有数据
- 确认 `matchedOrder` 是否正确匹配

### 步骤3：检查数据库
确认询价单是否关联了订单：
```sql
SELECT rfq.id, rfq.rfqNo, COUNT(order_rfq.orderId) as orderCount
FROM rfqs rfq
LEFT JOIN order_rfq ON order_rfq.rfqId = rfq.id
WHERE rfq.status IN ('CLOSED', 'AWARDED')
GROUP BY rfq.id, rfq.rfqNo;
```

## 测试命令

### 本地测试API
```bash
# 启动API服务
cd apps/api
npm run start:dev

# 在另一个终端测试API
curl -X GET http://localhost:3001/rfqs/unquoted-items \
  -H "Authorization: Bearer YOUR_TOKEN" \
  | jq '.[0] | {orderNo, recipient, phone, address}'
```

### 检查前端数据
在浏览器控制台中：
```javascript
// 访问电商采购清单页面后，在控制台执行
fetch('/api/rfqs/unquoted-items')
  .then(res => res.json())
  .then(data => {
    console.log('返回的数据:', data);
    console.log('第一个商品的订单信息:', data[0]?.recipient, data[0]?.phone, data[0]?.address);
  });
```

## 修复建议

如果确认是订单匹配问题，可以：
1. 检查订单匹配逻辑（已修复）
2. 添加日志输出，查看匹配过程
3. 确保即使没有精确匹配，也能使用第一个订单

