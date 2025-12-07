# 正确的诊断命令

## 📊 1. 检查数据库连接数（使用正确的语法）

```bash
mysql -u root -p << EOF
SHOW STATUS LIKE 'Threads_connected';
SHOW VARIABLES LIKE 'max_connections';
SELECT 
    '活跃连接数（非 Sleep）' as metric,
    COUNT(*) as value
FROM information_schema.processlist
WHERE command != 'Sleep';
EOF
```

## 📊 2. 检查所有非 Sleep 连接（查看实际使用情况）

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
    LEFT(info, 80) as query
FROM information_schema.processlist
WHERE command != 'Sleep'
ORDER BY time DESC;
"
```

## 📊 3. 检查 Prisma 连接池使用情况

```bash
# 查看当前所有 caigou_user 的连接
mysql -u root -p -e "
SELECT 
    id,
    user,
    host,
    db,
    command,
    time,
    state,
    LEFT(info, 100) as query
FROM information_schema.processlist
WHERE user = 'caigou_user'
ORDER BY time DESC;
"
```

## 📊 4. 检查系统资源使用

```bash
# CPU 使用率最高的进程
ps aux --sort=-%cpu | head -n 20

# 内存使用
free -h

# 系统负载
uptime

# PM2 状态
pm2 status
pm2 monit
```

## 📊 5. 检查是否有慢查询日志

```bash
# 检查慢查询日志是否启用
mysql -u root -p -e "
SHOW VARIABLES LIKE 'slow_query_log';
SHOW VARIABLES LIKE 'long_query_time';
SHOW VARIABLES LIKE 'slow_query_log_file';
"

# 如果启用了，查看最近的慢查询
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
" 2>/dev/null || echo "慢查询日志未启用或表不存在"
```

