#!/bin/bash

echo "=========================================="
echo "慢查询诊断"
echo "=========================================="
echo ""

echo "📊 1. 检查当前正在运行的慢查询（> 2秒）"
echo "----------------------------------------"
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
WHERE time > 2 AND command != 'Sleep'
ORDER BY time DESC
LIMIT 20;
"

echo ""
echo "📊 2. 检查慢查询日志是否启用"
echo "----------------------------------------"
mysql -u root -p -e "
SHOW VARIABLES LIKE 'slow_query%';
SHOW VARIABLES LIKE 'long_query_time';
"

echo ""
echo "📊 3. 启用慢查询日志（如果未启用）"
echo "----------------------------------------"
echo "执行以下命令启用慢查询日志："
echo "mysql -u root -p -e \"SET GLOBAL slow_query_log = 'ON'; SET GLOBAL long_query_time = 2;\""

echo ""
echo "📊 4. 查看最近 10 条慢查询（如果日志已启用）"
echo "----------------------------------------"
SLOW_LOG=$(mysql -u root -p -e "SHOW VARIABLES LIKE 'slow_query_log_file';" | grep slow_query_log_file | awk '{print $2}')
if [ -f "$SLOW_LOG" ]; then
    echo "慢查询日志位置: $SLOW_LOG"
    echo "最近 10 条慢查询："
    tail -n 50 "$SLOW_LOG" | grep -A 5 "Query_time" | head -n 50
else
    echo "慢查询日志未启用或文件不存在"
fi

echo ""
echo "📊 5. 检查数据库索引使用情况"
echo "----------------------------------------"
mysql -u root -p caigou -e "
SELECT 
    TABLE_NAME,
    INDEX_NAME,
    SEQ_IN_INDEX,
    COLUMN_NAME,
    CARDINALITY
FROM information_schema.STATISTICS
WHERE TABLE_SCHEMA = 'caigou'
AND TABLE_NAME IN ('Rfq', 'RfqItem', 'Quote', 'QuoteItem', 'Award', 'AwardItem', 'Order')
ORDER BY TABLE_NAME, INDEX_NAME, SEQ_IN_INDEX;
"

echo ""
echo "=========================================="
echo "诊断完成"
echo "=========================================="

