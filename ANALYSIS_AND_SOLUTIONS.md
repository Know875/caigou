# 诊断结果分析和解决方案

## 📊 当前状态分析

### ✅ 正常的部分
- **Node.js 进程 CPU 使用率**：1-2%（正常）
- **数据库连接数**：5-6 个（很少，说明没有连接池耗尽）
- **网络连接数**：37 个已建立连接（正常）

### ⚠️ 问题部分
- **数据库连接平均占用时间**：85 秒（过长！）
- **最长连接时间**：204 秒（超过 3 分钟！）
- **系统 CPU 使用率**：98.3%（但 Node.js 进程 CPU 很低）

---

## 🔍 问题分析

### 问题 1：数据库连接被长时间占用

**症状**：
- 只有 5 个连接，但平均占用 85 秒
- 最长连接占用 204 秒

**可能的原因**：
1. **连接泄漏**：连接创建后没有正确释放
2. **长时间事务**：有事务长时间未提交
3. **Prisma 连接池配置问题**：连接池可能没有正确配置

**检查方法**：
```bash
# 查看这些连接在做什么
mysql -u root -p -e "
SELECT 
    id,
    user,
    host,
    db,
    command,
    time,
    state,
    info
FROM information_schema.processlist
WHERE user = 'caigou_user'
ORDER BY time DESC;
"

# 检查是否有长时间运行的事务
mysql -u root -p -e "
SELECT 
    trx_id,
    trx_state,
    trx_started,
    TIMESTAMPDIFF(SECOND, trx_started, NOW()) as duration_seconds,
    trx_mysql_thread_id,
    LEFT(trx_query, 100) as query
FROM information_schema.innodb_trx
ORDER BY trx_started;
"
```

---

### 问题 2：系统 CPU 使用率高，但 Node.js 进程 CPU 低

**症状**：
- 系统 CPU 使用率 98.3%
- 但 Node.js 进程 CPU 只有 1-2%
- softirq 进程占用 187.8% CPU

**可能的原因**：
1. **网络 I/O 瓶颈**：softirq 高表示网络中断处理占用大量 CPU
2. **其他系统进程**：可能有其他进程占用 CPU
3. **监控时间点不同**：top 和 ps 的采样时间不同

**检查方法**：
```bash
# 实时查看 CPU 使用率最高的进程
top -b -n 1 | head -n 20

# 查看网络中断统计
cat /proc/interrupts | grep -i eth

# 查看系统负载详情
vmstat 1 5
```

---

## 🛠️ 解决方案

### 方案 1：检查并修复连接泄漏

**步骤 1：查看连接详情**
```bash
mysql -u root -p -e "
SELECT 
    id,
    user,
    host,
    db,
    command,
    time,
    state,
    info
FROM information_schema.processlist
WHERE user = 'caigou_user'
ORDER BY time DESC;
"
```

**步骤 2：如果发现连接长时间占用但没有查询，可能是连接泄漏**

**修复方法**：
1. 检查 Prisma 连接池配置是否正确
2. 确保所有数据库操作都正确关闭连接
3. 添加连接超时配置

**检查 Prisma 配置**：
```bash
# 查看 .env 文件中的 DATABASE_URL
cat /root/caigou/caigou/apps/api/.env | grep DATABASE_URL

# 应该包含 connection_limit 和 pool_timeout
# 例如：DATABASE_URL="mysql://...?connection_limit=50&pool_timeout=20"
```

---

### 方案 2：添加连接超时和查询超时

如果连接被长时间占用，可以添加超时配置。

**修改 Prisma 服务**（如果需要）：
- 添加连接超时
- 添加查询超时
- 确保连接正确释放

---

### 方案 3：优化网络 I/O（如果 softirq 是瓶颈）

**如果网络 I/O 是瓶颈**：
1. 检查是否有大量小请求
2. 考虑使用 HTTP/2
3. 优化 API 响应大小
4. 添加响应压缩

---

### 方案 4：减少实例数（如果 CPU 是瓶颈）

**如果系统 CPU 持续高，可以暂时减少实例数**：
```bash
# 1. 修改 ecosystem.config.js
cd /root/caigou/caigou
nano ecosystem.config.js

# 将 instances 从 2 改为 1（临时测试）
# caigou-api: instances: 1
# caigou-web: instances: 1

# 2. 重新加载
pm2 reload ecosystem.config.js

# 3. 观察 CPU 使用率
pm2 monit
```

---

## 📋 立即执行的检查命令

### 1. 查看长时间占用的连接详情
```bash
mysql -u root -p -e "
SELECT 
    id,
    user,
    host,
    db,
    command,
    time,
    state,
    info
FROM information_schema.processlist
WHERE user = 'caigou_user'
ORDER BY time DESC;
"
```

### 2. 检查是否有长时间事务
```bash
mysql -u root -p -e "
SELECT 
    trx_id,
    trx_state,
    trx_started,
    TIMESTAMPDIFF(SECOND, trx_started, NOW()) as duration_seconds,
    trx_mysql_thread_id,
    LEFT(trx_query, 100) as query
FROM information_schema.innodb_trx
ORDER BY trx_started;
"
```

### 3. 检查 Prisma 连接池配置
```bash
# 查看 DATABASE_URL 配置
cat /root/caigou/caigou/apps/api/.env | grep DATABASE_URL

# 或者查看应用启动日志
pm2 logs caigou-api --lines 50 | grep -i "connection\|pool\|database"
```

### 4. 实时监控系统 CPU
```bash
# 查看 CPU 使用率最高的进程（实时）
top -b -n 1 | head -n 20

# 或者使用 htop（如果安装了）
htop
```

---

## 🎯 预期结果

- **修复连接泄漏**：连接占用时间应该 < 10 秒
- **优化网络 I/O**：softirq CPU 使用率应该 < 50%
- **减少实例数**：系统 CPU 使用率应该 < 70%

---

## ⚠️ 重要提示

1. **先诊断，再优化**：不要盲目修改，先找出具体问题
2. **监控变化**：每次优化后观察 5-10 分钟
3. **备份配置**：修改前备份配置文件

