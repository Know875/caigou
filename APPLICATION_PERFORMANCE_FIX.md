# 应用层性能优化方案

## 📊 问题确认

从诊断结果看：
- ✅ **网络连接正常**：41 个 ESTABLISHED 连接，每个 IP 最多 4 个连接
- ✅ **没有异常连接**：没有明显的攻击或异常流量
- ⚠️ **CPU 使用率 99%**：但网络连接数不多
- ⚠️ **系统负载 8.68**：系统过载

**结论**：问题不在网络 I/O，而在**应用层处理慢**。

---

## 🔍 发现的问题

### 1. `findAll` 方法查询过重

**问题**：`rfq.service.ts` 的 `findAll` 方法包含太多嵌套的 `include`，导致查询非常慢：

```typescript
include: {
  store: true,
  buyer: {...},
  orders: { include: { order: true } },
  items: true,
  quotes: { include: { supplier: {...} } },
  awards: { include: { quote: { include: { items: true } } } },
}
```

**影响**：当询价单数量多时，查询会非常慢，导致 CPU 使用率飙升。

### 2. 重复查询

**问题**：在 `filters?.status === 'PUBLISHED'` 分支中，又执行了一次 `findMany` 查询（第 1162 行），这是不必要的。

### 3. 生产环境日志过多

**问题**：代码中有大量的 `debug` 日志，在生产环境中会影响性能。

---

## 🛠️ 立即优化方案

### 方案 1：优化 `findAll` 查询（最关键！）

**目的**：减少查询数据量，提升查询速度

**优化步骤**：

1. **减少不必要的 include**
   - 只在需要时查询 `awards` 和 `quotes`
   - 使用 `select` 而不是 `include`，只查询需要的字段

2. **添加分页**
   - 默认只返回前 50 条记录
   - 使用 `take` 和 `skip` 实现分页

3. **在数据库层过滤**
   - 将过滤逻辑移到 `where` 条件中，而不是在应用层过滤

### 方案 2：减少生产环境日志

**目的**：减少日志输出，提升性能

**优化步骤**：
- 将所有 `debug` 日志改为只在 `development` 环境输出
- 减少不必要的 `log` 输出

### 方案 3：检查并优化慢查询

**目的**：找出并优化数据库慢查询

**立即执行**：

```bash
# 1. 启用慢查询日志
mysql -u root -p -e "
SET GLOBAL slow_query_log = 'ON';
SET GLOBAL long_query_time = 2;
SET GLOBAL log_queries_not_using_indexes = 'ON';
"

# 2. 检查当前正在运行的慢查询
mysql -u root -p -e "
SELECT 
    id,
    user,
    time,
    state,
    LEFT(info, 100) as query
FROM information_schema.processlist
WHERE time > 2 AND command != 'Sleep'
ORDER BY time DESC
LIMIT 20;
"

# 3. 查看慢查询日志位置
mysql -u root -p -e "SHOW VARIABLES LIKE 'slow_query_log_file';"
```

---

## 📋 立即执行的检查命令

### 1. 检查慢查询

```bash
# 检查当前正在运行的慢查询（> 2秒）
mysql -u root -p -e "
SELECT 
    id,
    user,
    time,
    state,
    LEFT(info, 100) as query
FROM information_schema.processlist
WHERE time > 2 AND command != 'Sleep'
ORDER BY time DESC
LIMIT 20;
"
```

### 2. 检查 PM2 日志中的错误

```bash
# 查看最近的错误日志
pm2 logs caigou-api --lines 100 --err | grep -i "error\|slow\|timeout"
```

### 3. 检查 API 响应时间

```bash
# 测试 API 响应时间
time curl -s http://localhost:8081/api/rfq > /dev/null
```

---

## 🎯 预期效果

- **优化 `findAll` 查询**：查询速度提升 5-10 倍，CPU 使用率降低 50-70%
- **减少日志输出**：CPU 使用率降低 5-10%
- **优化慢查询**：数据库响应时间降低 30-50%

---

## ⚠️ 重要提示

1. **先检查慢查询**：执行检查命令，确认是否有慢查询
2. **逐步优化**：先优化最慢的查询，再优化其他
3. **监控变化**：每次优化后观察 5-10 分钟

