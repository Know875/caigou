#!/bin/bash

echo "=========================================="
echo "系统性能诊断脚本"
echo "=========================================="
echo ""

# 1. 检查数据库连接数
echo "📊 1. 数据库连接状态"
echo "----------------------------------------"
mysql -u root -p"${MYSQL_ROOT_PASSWORD:-}" -e "
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
WHERE VARIABLE_NAME = 'max_connections'
UNION ALL
SELECT 
    '活跃连接数' as metric,
    COUNT(*) as value
FROM information_schema.processlist
WHERE command != 'Sleep';
" 2>/dev/null || echo "需要 MySQL root 密码"

echo ""
echo "📊 2. 长时间运行的查询（> 2秒）"
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
WHERE time > 2
  AND command != 'Sleep'
ORDER BY time DESC
LIMIT 10;
" 2>/dev/null || echo "需要 MySQL root 密码"

echo ""
echo "📊 3. PM2 进程状态"
echo "----------------------------------------"
pm2 status

echo ""
echo "📊 4. 系统负载"
echo "----------------------------------------"
uptime

echo ""
echo "📊 5. 内存使用"
echo "----------------------------------------"
free -h

echo ""
echo "📊 6. CPU 使用率最高的进程（前 10）"
echo "----------------------------------------"
ps aux --sort=-%cpu | head -n 11

echo ""
echo "📊 7. 数据库慢查询统计"
echo "----------------------------------------"
mysql -u root -p"${MYSQL_ROOT_PASSWORD:-}" -e "
SELECT 
    '慢查询总数' as metric,
    COUNT(*) as value
FROM mysql.slow_log
WHERE start_time > DATE_SUB(NOW(), INTERVAL 1 HOUR)
UNION ALL
SELECT 
    '平均查询时间' as metric,
    ROUND(AVG(query_time), 2) as value
FROM mysql.slow_log
WHERE start_time > DATE_SUB(NOW(), INTERVAL 1 HOUR);
" 2>/dev/null || echo "慢查询日志可能未启用"

echo ""
echo "=========================================="
echo "诊断完成"
echo "=========================================="

