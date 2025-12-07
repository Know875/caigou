# 清理临时文件说明

## 📋 清理内容

### 1. 诊断脚本（已删除）
- `check-*.sh` - 各种检查脚本
- `diagnose-*.sh` - 诊断脚本
- `quick-diagnose.sh` - 快速诊断脚本

### 2. 恶意软件清理脚本（已删除）
- `cleanup-malware.sh` - 恶意软件清理脚本
- `complete-cleanup.sh` - 完整清理脚本
- `final-cleanup.sh` - 最终清理脚本
- `finalize-cleanup.sh` - 完成清理脚本
- `finish-cleanup.sh` - 结束清理脚本
- `kill-and-block.sh` - 终止和阻止脚本
- `check-suspicious-process.sh` - 检查异常进程脚本

**说明**：恶意软件已清理完成，这些脚本不再需要。

### 3. 临时 SQL 脚本（已删除）
- `check-*.sql` - 检查脚本
- `fix-*.sql` - 修复脚本
- `verify-*.sql` - 验证脚本
- `analyze-*.sql` - 分析脚本
- `view-*.sql` - 查看脚本

**说明**：问题已解决，临时 SQL 脚本不再需要。**保留 `migrations/` 目录下的迁移脚本**。

### 4. 临时文档（已删除）
- `FIX_*.md` - 修复文档
- `CHECK_*.md` - 检查文档
- `QUICK_*.md` - 快速修复文档
- `DEBUG_*.md` - 调试文档
- `VIEW_*.md` - 查看文档
- `HOW_TO_EXECUTE_SQL_SCRIPTS.md` - SQL 脚本执行说明
- `test-auto-close-rfq.md` - 测试文档
- `award-items-迁移说明.md` - 迁移说明
- `中标逻辑问题分析.md` - 分析文档

**说明**：问题已解决，临时文档不再需要。

### 5. Windows 开发脚本（已删除）
- `execute-fix.ps1` - PowerShell 脚本
- `export_database.ps1` - 数据库导出脚本
- `start-*.ps1` - 启动脚本
- `start-*.cmd` - 启动脚本
- `stop-*.ps1` - 停止脚本

**说明**：这些是 Windows 开发环境用的脚本，服务器上不需要。

## ✅ 保留的重要文件

### 文档
- `README.md` - 项目说明
- `DEPLOYMENT.md` - 部署文档
- `CHANGELOG.md` - 更新日志
- `PROJECT.md` - 项目文档

### 脚本
- `deploy.sh` - 部署脚本
- `ecosystem.config.js` - PM2 配置
- `migrations/` - 数据库迁移脚本目录
- `scripts/` - 工具脚本目录

## 🚀 使用方法

```bash
# 1. 进入项目目录
cd /root/caigou/caigou

# 2. 拉取最新代码
git pull origin main

# 3. 运行清理脚本
bash cleanup-temp-files.sh

# 4. 提交清理结果（可选）
git add -A
git commit -m "清理临时脚本和测试文件"
git push origin main
```

## ⚠️ 注意事项

1. **备份**：清理前建议先备份（脚本会创建备份目录）
2. **确认**：清理前请确认这些文件确实不再需要
3. **迁移脚本**：`migrations/` 目录下的文件会保留
4. **工具脚本**：`scripts/` 目录下的文件会保留

## 📊 清理效果

清理后：
- 项目根目录更整洁
- 减少文件数量 50+ 个
- 保留所有重要文件
- 不影响项目运行

