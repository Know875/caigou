#!/bin/bash

# AwardItems 表迁移脚本
# 使用方法：bash migrations/执行迁移.sh

set -e  # 遇到错误立即退出

echo "=== 开始执行 AwardItems 表迁移 ==="

# 1. 创建 award_items 表
echo ""
echo "步骤 1: 创建 award_items 表..."
mysql -u root -p caigou < migrations/add-award-items-table.sql
if [ $? -eq 0 ]; then
    echo "✓ award_items 表创建成功"
else
    echo "✗ award_items 表创建失败"
    exit 1
fi

# 2. 迁移现有数据
echo ""
echo "步骤 2: 迁移现有 Award 数据到 AwardItem..."
mysql -u root -p caigou < migrations/migrate-existing-awards-to-award-items.sql
if [ $? -eq 0 ]; then
    echo "✓ 数据迁移成功"
else
    echo "✗ 数据迁移失败"
    exit 1
fi

echo ""
echo "=== 迁移完成 ==="
echo ""
echo "请检查迁移结果："
echo "  SELECT COUNT(*) as total_award_items FROM award_items;"
echo "  SELECT COUNT(DISTINCT awardId) as awards_with_items FROM award_items;"

