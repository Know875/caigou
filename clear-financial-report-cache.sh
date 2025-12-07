#!/bin/bash
# 清除财务报表缓存的脚本

echo "正在清除财务报表缓存..."

# 方法 1：清除所有财务报表缓存（推荐）
redis-cli KEYS "financial_report:*" | xargs redis-cli DEL

# 或者方法 2：只清除特定日期的缓存
# redis-cli DEL "financial_report:day:2025-11-30:all"
# redis-cli DEL "financial_report:week:2025-11-30:all"
# redis-cli DEL "financial_report:month:2025-11-30:all"

echo "缓存已清除！"

