#!/bin/bash

echo "=========================================="
echo "检查长时间占用的数据库连接"
echo "=========================================="
echo ""

echo "📊 1. 所有 caigou_user 连接的详细信息"
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
    info
FROM information_schema.processlist
WHERE user = 'caigou_user'
ORDER BY time DESC;
" 2>/dev/null || echo "需要 MySQL root 密码"

echo ""
echo "📊 2. 检查是否有长时间运行的事务"
echo "----------------------------------------"
mysql -u root -p"${MYSQL_ROOT_PASSWORD:-}" -e "
SELECT 
    trx_id,
    trx_state,
    trx_started,
    TIMESTAMPDIFF(SECOND, trx_started, NOW()) as duration_seconds,
    trx_mysql_thread_id,
    LEFT(trx_query, 100) as query
FROM information_schema.innodb_trx
ORDER BY trx_started;
" 2>/dev/null || echo "需要 MySQL root 密码"

echo ""
echo "📊 3. 检查连接池配置（从应用日志）"
echo "----------------------------------------"
echo "检查 Prisma 连接池配置..."
grep -i "connection_limit\|pool_timeout" /root/caigou/caigou/apps/api/.env 2>/dev/null || echo "未找到 .env 文件"

echo ""
echo "=========================================="
echo "检查完成"
echo "=========================================="

