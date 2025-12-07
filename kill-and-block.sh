#!/bin/bash

echo "=========================================="
echo "终止恶意进程并阻止恢复"
echo "=========================================="
echo ""

# 1. 立即终止所有恶意进程
echo "📊 1. 终止所有恶意进程"
echo "----------------------------------------"
kill -9 212069 2>/dev/null && echo "✓ 已终止进程 212069 (fghgf)" || echo "进程可能已不存在"
kill -9 212081 2>/dev/null && echo "✓ 已终止进程 212081 (health.sh)" || echo "进程可能已不存在"
kill -9 2834028 2>/dev/null && echo "✓ 已终止进程 2834028 (恶意网络连接)" || echo "进程可能已不存在"

# 终止所有相关进程
pkill -9 -f "fghgf" && echo "✓ 已终止所有 fghgf 进程" || echo "无 fghgf 进程"
pkill -9 -f "health.sh" && echo "✓ 已终止所有 health.sh 进程" || echo "无 health.sh 进程"

# 等待进程终止
sleep 2

# 2. 删除恶意文件（防止自动恢复）
echo ""
echo "📊 2. 删除恶意文件并锁定"
echo "----------------------------------------"
rm -f /tmp/fghgf && echo "✓ 已删除 /tmp/fghgf"
rm -f /tmp/config.json && echo "✓ 已删除 /tmp/config.json"
rm -f /dev/health.sh && echo "✓ 已删除 /dev/health.sh"

# 锁定文件，防止被重新创建
touch /tmp/fghgf && chmod 000 /tmp/fghgf && chattr +i /tmp/fghgf 2>/dev/null && echo "✓ 已锁定 /tmp/fghgf" || echo "无法锁定文件"
touch /tmp/config.json && chmod 000 /tmp/config.json && chattr +i /tmp/config.json 2>/dev/null && echo "✓ 已锁定 /tmp/config.json" || echo "无法锁定文件"
touch /dev/health.sh && chmod 000 /dev/health.sh && chattr +i /dev/health.sh 2>/dev/null && echo "✓ 已锁定 /dev/health.sh" || echo "无法锁定文件"

# 3. 阻止恶意网络连接
echo ""
echo "📊 3. 阻止恶意网络连接"
echo "----------------------------------------"
# 阻止出站连接
iptables -A OUTPUT -d 205.185.126.196 -j DROP 2>/dev/null && echo "✓ 已阻止出站连接到 205.185.126.196" || echo "规则可能已存在"
iptables -A OUTPUT -d 80.64.16.241 -j DROP 2>/dev/null && echo "✓ 已阻止出站连接到 80.64.16.241" || echo "规则可能已存在"

# 阻止入站连接
iptables -A INPUT -s 205.185.126.196 -j DROP 2>/dev/null && echo "✓ 已阻止入站连接从 205.185.126.196" || echo "规则可能已存在"
iptables -A INPUT -s 80.64.16.241 -j DROP 2>/dev/null && echo "✓ 已阻止入站连接从 80.64.16.241" || echo "规则可能已存在"

# 4. 检查所有定时任务
echo ""
echo "📊 4. 再次检查定时任务"
echo "----------------------------------------"
echo "Root crontab:"
crontab -l 2>/dev/null | grep -v "^#" | grep -v "^$" || echo "无定时任务"

echo ""
echo "系统 crontab:"
cat /etc/crontab 2>/dev/null | grep -v "^#" | grep -v "^$" || echo "无定时任务"

echo ""
echo "Cron 目录:"
ls -la /etc/cron.d/ 2>/dev/null

# 5. 检查系统服务
echo ""
echo "📊 5. 检查系统服务"
echo "----------------------------------------"
systemctl list-units --type=service --state=running | grep -i "rondo\|fghgf\|suspicious" || echo "无相关服务"

# 6. 检查启动脚本
echo ""
echo "📊 6. 检查启动脚本"
echo "----------------------------------------"
ls -la /etc/init.d/ | grep -i "rondo\|fghgf\|suspicious" || echo "无相关脚本"
ls -la /etc/systemd/system/ | grep -i "rondo\|fghgf\|suspicious" || echo "无相关服务文件"

# 7. 检查系统负载
echo ""
echo "📊 7. 检查系统负载"
echo "----------------------------------------"
top -b -n 1 | head -n 5

# 8. 检查剩余恶意进程
echo ""
echo "📊 8. 检查剩余恶意进程"
echo "----------------------------------------"
ps aux | grep -E "fghgf|health.sh|205.185.126.196" | grep -v grep || echo "✓ 无恶意进程"

# 9. 检查网络连接
echo ""
echo "📊 9. 检查恶意网络连接"
echo "----------------------------------------"
ss -tunp | grep -E "205.185.126.196|80.64.16.241" || echo "✓ 无恶意网络连接"

echo ""
echo "=========================================="
echo "清理完成"
echo "=========================================="
echo ""
echo "⚠️  重要提示："
echo "1. 恶意软件有自动恢复机制，需要持续监控"
echo "2. 建议立即更改 SSH 密码和密钥"
echo "3. 检查系统完整性，考虑重装系统"
echo "4. 监控系统负载，如果再次升高，立即检查"

