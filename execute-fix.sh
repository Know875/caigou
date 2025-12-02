#!/bin/bash

# 修复 RFQ-1764574989800 的中标供应商显示错误
# 使用方法: ./execute-fix.sh

# 配置数据库连接信息（请根据实际情况修改）
DB_HOST="${DB_HOST:-localhost}"
DB_USER="${DB_USER:-root}"
DB_NAME="${DB_NAME:-your_database_name}"
SQL_FILE="fix-rfq-1764574989800-award-supplier.sql"
BACKUP_FILE="backup_$(date +%Y%m%d_%H%M%S).sql"

# 颜色输出
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

echo -e "${YELLOW}=== 开始执行修复脚本 ===${NC}"
echo ""

# 检查 SQL 文件是否存在
if [ ! -f "$SQL_FILE" ]; then
    echo -e "${RED}错误: 找不到 SQL 文件 $SQL_FILE${NC}"
    exit 1
fi

# 1. 备份数据库
echo -e "${YELLOW}1. 备份数据库...${NC}"
mysqldump -h $DB_HOST -u $DB_USER -p $DB_NAME > $BACKUP_FILE 2>&1
if [ $? -eq 0 ]; then
    echo -e "${GREEN}   ✅ 备份成功: $BACKUP_FILE${NC}"
else
    echo -e "${RED}   ❌ 备份失败，退出${NC}"
    exit 1
fi

# 2. 询问是否继续
echo ""
read -p "是否继续执行修复脚本？(y/N): " confirm
if [ "$confirm" != "y" ] && [ "$confirm" != "Y" ]; then
    echo "已取消执行"
    exit 0
fi

# 3. 执行修复脚本
echo ""
echo -e "${YELLOW}2. 执行修复脚本...${NC}"
mysql -h $DB_HOST -u $DB_USER -p $DB_NAME < $SQL_FILE 2>&1
if [ $? -eq 0 ]; then
    echo -e "${GREEN}   ✅ 脚本执行成功${NC}"
else
    echo -e "${RED}   ❌ 脚本执行失败${NC}"
    echo -e "${YELLOW}   可以恢复备份: mysql -h $DB_HOST -u $DB_USER -p $DB_NAME < $BACKUP_FILE${NC}"
    exit 1
fi

# 4. 验证结果
echo ""
echo -e "${YELLOW}3. 验证修复结果...${NC}"
mysql -h $DB_HOST -u $DB_USER -p $DB_NAME << 'EOF'
SET @rfq_no = 'RFQ-1764574989800';
SET @rfq_id = (SELECT id FROM rfqs WHERE rfqNo = @rfq_no);

SELECT 
    ri.productName as '商品名称',
    u.username as '供应商',
    qi.price as '价格',
    CASE 
        WHEN a.id IS NOT NULL AND a.quoteId = qi.quoteId THEN '✅ 正确'
        ELSE '❌ 仍有问题'
    END as '状态'
FROM rfq_items ri
INNER JOIN quote_items qi ON ri.id = qi.rfqItemId
INNER JOIN quotes q ON qi.quoteId = q.id
INNER JOIN users u ON q.supplierId = u.id
INNER JOIN awards a ON a.rfqId = ri.rfqId AND a.supplierId = q.supplierId AND a.status != 'CANCELLED'
WHERE ri.rfqId = @rfq_id
  AND ri.item_status = 'AWARDED'
ORDER BY ri.productName;
EOF

echo ""
echo -e "${GREEN}=== 执行完成 ===${NC}"
echo -e "${YELLOW}备份文件: $BACKUP_FILE${NC}"

