#!/bin/bash

echo "=========================================="
echo "清理临时脚本和测试文件"
echo "=========================================="
echo ""

# 创建备份目录（可选）
BACKUP_DIR="./temp-files-backup-$(date +%Y%m%d_%H%M%S)"
mkdir -p "$BACKUP_DIR"

echo "📊 1. 删除诊断脚本"
echo "----------------------------------------"
# 诊断脚本
rm -f check-*.sh
rm -f diagnose-*.sh
rm -f quick-diagnose.sh
echo "✓ 已删除诊断脚本"

echo ""
echo "📊 2. 删除恶意软件清理脚本（已清理完成）"
echo "----------------------------------------"
# 恶意软件清理脚本（已清理完成，可以删除）
rm -f cleanup-malware.sh
rm -f complete-cleanup.sh
rm -f final-cleanup.sh
rm -f finalize-cleanup.sh
rm -f finish-cleanup.sh
rm -f kill-and-block.sh
rm -f check-suspicious-process.sh
echo "✓ 已删除恶意软件清理脚本"

echo ""
echo "📊 3. 删除临时 SQL 脚本（问题已解决）"
echo "----------------------------------------"
# 临时 SQL 脚本（问题已解决，可以删除）
rm -f check-*.sql
rm -f fix-*.sql
rm -f verify-*.sql
rm -f analyze-*.sql
rm -f view-*.sql
# 但保留 migrations 目录下的迁移脚本
echo "✓ 已删除临时 SQL 脚本（保留 migrations/ 目录）"

echo ""
echo "📊 4. 删除临时文档"
echo "----------------------------------------"
# 临时文档（问题已解决，可以删除）
rm -f FIX_*.md
rm -f CHECK_*.md
rm -f QUICK_*.md
rm -f DEBUG_*.md
rm -f VIEW_*.md
rm -f HOW_TO_EXECUTE_SQL_SCRIPTS.md
rm -f test-auto-close-rfq.md
rm -f award-items-迁移说明.md
rm -f 中标逻辑问题分析.md
# 但保留重要文档
echo "✓ 已删除临时文档（保留 README.md, DEPLOYMENT.md, CHANGELOG.md 等）"

echo ""
echo "📊 5. 删除临时 PowerShell 脚本（Windows 开发用）"
echo "----------------------------------------"
# Windows 开发用的临时脚本（服务器上不需要）
rm -f execute-fix.ps1
rm -f export_database.ps1
rm -f start-*.ps1
rm -f start-*.cmd
rm -f stop-*.ps1
echo "✓ 已删除 Windows 临时脚本"

echo ""
echo "📊 6. 保留的重要文件"
echo "----------------------------------------"
echo "✓ README.md - 项目说明"
echo "✓ DEPLOYMENT.md - 部署文档"
echo "✓ CHANGELOG.md - 更新日志"
echo "✓ PROJECT.md - 项目文档"
echo "✓ deploy.sh - 部署脚本"
echo "✓ ecosystem.config.js - PM2 配置"
echo "✓ migrations/ - 数据库迁移脚本"
echo "✓ scripts/ - 工具脚本"

echo ""
echo "=========================================="
echo "清理完成"
echo "=========================================="
echo ""
echo "📋 清理统计："
echo "- 诊断脚本：已删除"
echo "- 清理脚本：已删除"
echo "- 临时 SQL：已删除"
echo "- 临时文档：已删除"
echo "- Windows 脚本：已删除"
echo ""
echo "⚠️  重要文件已保留："
echo "- README.md, DEPLOYMENT.md, CHANGELOG.md"
echo "- deploy.sh, ecosystem.config.js"
echo "- migrations/ 和 scripts/ 目录"

