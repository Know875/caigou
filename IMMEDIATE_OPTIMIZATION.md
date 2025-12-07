# 🚨 立即优化方案（CPU 负载过高）

## 📊 当前问题分析

从监控数据看：
- **CPU 使用率：98.3%** ⚠️ 非常高
- **负载平均值：8.55** ⚠️ 系统过载
- **softirq 进程占用 187.8% CPU** ⚠️ 可能是网络 I/O 瓶颈
- **内存使用：81%** ⚠️ 较高但可接受

---

## 🔍 立即诊断（在服务器上执行）

### 1. 检查数据库连接数和慢查询

```bash
# 检查数据库连接数
mysql -u root -p -e "
SELECT 
    '当前连接数' as metric,
    VARIABLE_VALUE as value
FROM information_schema.GLOBAL_STATUS 
WHERE VARIABLE_NAME = 'Threads_connected'
UNION ALL
SELECT 
    '最大连接数' as metric,
    VARIABLE_VALUE as value
FROM information_schema.GLOBAL_VARIABLES 
WHERE VARIABLE_NAME = 'max_connections';
"

# 检查长时间运行的查询（> 2秒）
mysql -u root -p -e "
SELECT 
    id,
    user,
    time,
    state,
    LEFT(info, 100) as query
FROM information_schema.processlist
WHERE time > 2
  AND command != 'Sleep'
ORDER BY time DESC
LIMIT 10;
"
```

### 2. 检查网络 I/O（softirq 高可能是网络问题）

```bash
# 查看网络流量
iftop -n -i eth0

# 或者使用 nethogs 查看每个进程的网络使用
nethogs

# 检查网络连接数
netstat -an | wc -l
ss -s
```

### 3. 检查是否有进程占用过多 CPU

```bash
# 查看 CPU 使用率最高的进程
ps aux --sort=-%cpu | head -n 20

# 查看 Node.js 进程的详细状态
pm2 monit
```

---

## 🛠️ 立即优化方案

### 方案 1：如果 CPU 是瓶颈，暂时减少实例数

**如果 CPU 使用率持续 98%+，可能是实例数过多导致 CPU 竞争。**

```bash
# 1. 修改 ecosystem.config.js，减少实例数
cd /root/caigou/caigou
nano ecosystem.config.js

# 将 instances 从 2 改为 1（临时）
# caigou-api: instances: 1
# caigou-web: instances: 1

# 2. 重新加载配置
pm2 reload ecosystem.config.js

# 3. 观察 CPU 使用率
pm2 monit
```

**⚠️ 注意**：减少实例数会降低并发能力，但可以缓解 CPU 压力。

---

### 方案 2：优化数据库查询（如果有慢查询）

```bash
# 1. 启用慢查询日志
mysql -u root -p << EOF
SET GLOBAL slow_query_log = 'ON';
SET GLOBAL long_query_time = 1;  -- 记录超过 1 秒的查询
SET GLOBAL log_queries_not_using_indexes = 'ON';
EOF

# 2. 查看慢查询日志位置
mysql -u root -p -e "SHOW VARIABLES LIKE 'slow_query_log_file';"

# 3. 查看最近的慢查询
mysql -u root -p -e "
SELECT 
    start_time,
    user_host,
    query_time,
    lock_time,
    rows_sent,
    rows_examined,
    LEFT(sql_text, 200) as query
FROM mysql.slow_log
ORDER BY start_time DESC
LIMIT 10;
"
```

---

### 方案 3：终止长时间运行的查询（紧急）

**如果发现有查询运行超过 5 分钟，立即终止：**

```bash
# 查看长时间运行的查询
mysql -u root -p -e "
SELECT 
    id,
    user,
    time,
    LEFT(info, 100) as query
FROM information_schema.processlist
WHERE time > 300
  AND command != 'Sleep'
ORDER BY time DESC;
"

# 终止这些查询（谨慎操作！）
# 替换 <process_id> 为实际的进程 ID
mysql -u root -p -e "KILL <process_id>;"
```

---

### 方案 4：检查并优化 Redis（如果使用）

```bash
# 检查 Redis 连接数
redis-cli INFO clients

# 检查 Redis 内存使用
redis-cli INFO memory

# 检查队列长度
redis-cli LLEN bull:auction:wait
redis-cli LLEN bull:ocr:wait
```

---

### 方案 5：添加请求限流（防止过载）

如果系统持续过载，可以考虑添加请求限流。

---

## 📈 监控建议

### 持续监控关键指标

```bash
# 1. 实时监控 PM2
pm2 monit

# 2. 实时监控系统资源
htop

# 3. 监控数据库连接数
watch -n 5 'mysql -u root -p"YOUR_PASSWORD" -e "SHOW STATUS LIKE \"Threads_connected\";"'

# 4. 监控慢查询
watch -n 10 'mysql -u root -p"YOUR_PASSWORD" -e "SELECT COUNT(*) FROM information_schema.processlist WHERE time > 2 AND command != \"Sleep\";"'
```

---

## 🎯 预期效果

- **减少实例数**：CPU 使用率降低 30-50%
- **优化慢查询**：响应时间提升 50-80%
- **终止长时间查询**：立即释放资源

---

## ⚠️ 重要提示

1. **先诊断，再优化**：不要盲目减少实例数，先找出瓶颈
2. **监控变化**：每次优化后观察 5-10 分钟
3. **备份配置**：修改前备份 `ecosystem.config.js`

---

## 📞 下一步

1. 执行诊断命令，找出具体瓶颈
2. 根据诊断结果选择对应的优化方案
3. 持续监控，确认优化效果

