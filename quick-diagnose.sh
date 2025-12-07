#!/bin/bash

echo "=========================================="
echo "快速系统诊断"
echo "=========================================="
echo ""

# 1. 检查数据库连接数（使用正确的语法）
echo "📊 1. 数据库连接状态"
echo "----------------------------------------"
mysql -u root -p"${MYSQL_ROOT_PASSWORD:-}" << EOF 2>/dev/null || echo "需要 MySQL root 密码"
SHOW STATUS LIKE 'Threads_connected';
SHOW VARIABLES LIKE 'max_connections';
SELECT 
    '活跃连接数（非 Sleep）' as metric,
    COUNT(*) as value
FROM information_schema.processlist
WHERE command != 'Sleep';
EOF

echo ""
echo "📊 2. 长时间运行的查询（> 2秒，排除 event_scheduler）"
echo "----------------------------------------"
mysql -u root -p"${MYSQL_ROOT_PASSWORD:-}" -e "
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
WHERE time > 2
  AND command != 'Sleep'
  AND user != 'event_scheduler'
ORDER BY time DESC
LIMIT 10;
" 2>/dev/null || echo "需要 MySQL root 密码"

echo ""
echo "📊 3. 所有非 Sleep 连接（查看实际使用情况）"
echo "----------------------------------------"
mysql -u root -p"${MYSQL_ROOT_PASSWORD:-}" -e "
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
" 2>/dev/null || echo "需要 MySQL root 密码"

echo ""
echo "📊 4. PM2 进程状态"
echo "----------------------------------------"
pm2 status

echo ""
echo "📊 5. 系统负载和 CPU"
echo "----------------------------------------"
uptime
echo ""
echo "CPU 使用率最高的进程（前 10）："
ps aux --sort=-%cpu | head -n 11 | tail -n 10

echo ""
echo "📊 6. 内存使用"
echo "----------------------------------------"
free -h

echo ""
echo "📊 7. 网络连接统计"
echo "----------------------------------------"
ss -s

echo ""
echo "=========================================="
echo "诊断完成"
echo "=========================================="

