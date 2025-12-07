#!/bin/bash

echo "=========================================="
echo "彻底清理恶意软件"
echo "=========================================="
echo ""

# 1. 终止所有相关进程
echo "📊 1. 终止所有相关进程"
echo "----------------------------------------"
pkill -f "rondo" 2>/dev/null && echo "✓ 已终止 rondo 进程" || echo "无 rondo 进程"
pkill -f "unk.sh" 2>/dev/null && echo "✓ 已终止 unk.sh 进程" || echo "无 unk.sh 进程"
pkill -f "corn" 2>/dev/null && echo "✓ 已终止 corn 进程" || echo "无 corn 进程"
pkill -f "bash.*205.185.126.196" 2>/dev/null && echo "✓ 已终止恶意网络连接进程" || echo "无相关进程"

# 等待进程终止
sleep 2

# 2. 清理恶意定时任务
echo ""
echo "📊 2. 清理恶意定时任务"
echo "----------------------------------------"

# 备份当前 crontab
crontab -l > /tmp/crontab_backup_$(date +%Y%m%d_%H%M%S).txt 2>/dev/null

# 清理 root crontab
crontab -l 2>/dev/null | grep -v "rondo" | grep -v "unk.sh" | grep -v "corn" | grep -v "whale-corps-dev" | grep -v "pub-dc84e32afcfa417fa04d36454032549b" | crontab - 2>/dev/null
echo "✓ 已清理 root crontab"

# 清理系统 crontab
sed -i '/rondo/d' /etc/crontab 2>/dev/null
echo "✓ 已清理系统 crontab"

# 删除恶意 cron 文件
rm -f /etc/cron.d/rondo
echo "✓ 已删除 /etc/cron.d/rondo"

# 3. 删除恶意文件和目录
echo ""
echo "📊 3. 删除恶意文件和目录"
echo "----------------------------------------"
rm -rf /etc/rondo
echo "✓ 已删除 /etc/rondo 目录"
rm -f /tmp/corn
rm -f /tmp/unk.sh
rm -f /tmp/fghgf
rm -f /tmp/config.json
rm -f /dev/health.sh
echo "✓ 已删除临时恶意文件"

# 4. 检查并终止相关进程
echo ""
echo "📊 4. 检查剩余恶意进程"
echo "----------------------------------------"
ps aux | grep -E "rondo|unk.sh|corn|205.185.126.196" | grep -v grep || echo "✓ 无相关进程"

# 5. 检查网络连接
echo ""
echo "📊 5. 检查恶意网络连接"
echo "----------------------------------------"
ss -tunp | grep -E "205.185.126.196|80.64.16.241" || echo "✓ 无恶意网络连接"

# 6. 检查系统负载
echo ""
echo "📊 6. 检查系统负载"
echo "----------------------------------------"
top -b -n 1 | head -n 5

# 7. 检查 CPU 使用率最高的进程
echo ""
echo "📊 7. 检查 CPU 使用率最高的进程"
echo "----------------------------------------"
ps aux --sort=-%cpu | head -n 10

echo ""
echo "=========================================="
echo "清理完成"
echo "=========================================="
echo ""
echo "⚠️  重要：系统已被严重感染，建议："
echo "1. 立即更改 SSH 密码和密钥"
echo "2. 检查防火墙规则，阻止恶意 IP"
echo "3. 检查系统完整性"
echo "4. 考虑重装系统（如果可能）"
echo ""
echo "📋 后续检查命令："
echo "crontab -l                    # 检查定时任务"
echo "ps aux --sort=-%cpu | head   # 检查 CPU 使用率"
echo "ss -tunp | grep suspicious    # 检查网络连接"
echo "systemctl list-units --type=service | grep suspicious  # 检查服务"

