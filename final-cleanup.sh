#!/bin/bash

echo "=========================================="
echo "最终清理：删除启动机制"
echo "=========================================="
echo ""

# 1. 终止所有恶意进程
echo "📊 1. 终止所有恶意进程"
echo "----------------------------------------"
kill -9 212081 2>/dev/null && echo "✓ 已终止进程 212081" || echo "进程可能已不存在"
pkill -9 -f "fghgf" && echo "✓ 已终止所有 fghgf 进程" || echo "无 fghgf 进程"
pkill -9 -f "health.sh" && echo "✓ 已终止所有 health.sh 进程" || echo "无 health.sh 进程"
pkill -9 -f "rondo" && echo "✓ 已终止所有 rondo 进程" || echo "无 rondo 进程"

# 等待进程终止
sleep 2

# 2. 删除启动脚本和链接
echo ""
echo "📊 2. 删除启动脚本和链接"
echo "----------------------------------------"
rm -f /etc/init.d/rondo && echo "✓ 已删除 /etc/init.d/rondo" || echo "文件可能已不存在"
rm -f /etc/rc3.d/S99rondo && echo "✓ 已删除 /etc/rc3.d/S99rondo" || echo "链接可能已不存在"
rm -f /etc/rc*.d/*rondo* && echo "✓ 已删除所有 rondo 启动链接" || echo "无相关链接"

# 3. 禁用 systemd 服务
echo ""
echo "📊 3. 禁用 systemd 服务"
echo "----------------------------------------"
systemctl stop rondo.service 2>/dev/null && echo "✓ 已停止 rondo 服务" || echo "服务可能已停止"
systemctl disable rondo.service 2>/dev/null && echo "✓ 已禁用 rondo 服务" || echo "服务可能已禁用"
rm -f /etc/systemd/system/rondo.service 2>/dev/null && echo "✓ 已删除服务文件" || echo "服务文件可能已不存在"
systemctl daemon-reload 2>/dev/null && echo "✓ 已重新加载 systemd" || echo "无法重新加载 systemd"

# 4. 删除恶意文件和目录
echo ""
echo "📊 4. 删除恶意文件和目录"
echo "----------------------------------------"
rm -rf /etc/rondo && echo "✓ 已删除 /etc/rondo 目录" || echo "目录可能已不存在"
rm -f /tmp/fghgf /tmp/config.json /dev/health.sh && echo "✓ 已删除临时恶意文件" || echo "文件可能已不存在"

# 锁定文件，防止被重新创建
touch /tmp/fghgf /tmp/config.json /dev/health.sh 2>/dev/null
chmod 000 /tmp/fghgf /tmp/config.json /dev/health.sh 2>/dev/null
chattr +i /tmp/fghgf /tmp/config.json /dev/health.sh 2>/dev/null || true
echo "✓ 已锁定文件，防止被重新创建"

# 5. 使用 ufw 阻止恶意 IP（如果 iptables 不可用）
echo ""
echo "📊 5. 阻止恶意网络连接"
echo "----------------------------------------"
if command -v ufw &> /dev/null; then
    ufw deny from 205.185.126.196 2>/dev/null && echo "✓ 已阻止 205.185.126.196" || echo "规则可能已存在"
    ufw deny from 80.64.16.241 2>/dev/null && echo "✓ 已阻止 80.64.16.241" || echo "规则可能已存在"
    ufw deny out to 205.185.126.196 2>/dev/null && echo "✓ 已阻止出站到 205.185.126.196" || echo "规则可能已存在"
    ufw deny out to 80.64.16.241 2>/dev/null && echo "✓ 已阻止出站到 80.64.16.241" || echo "规则可能已存在"
elif command -v iptables &> /dev/null; then
    iptables -A OUTPUT -d 205.185.126.196 -j DROP 2>/dev/null && echo "✓ 已阻止出站连接到 205.185.126.196" || echo "规则可能已存在"
    iptables -A OUTPUT -d 80.64.16.241 -j DROP 2>/dev/null && echo "✓ 已阻止出站连接到 80.64.16.241" || echo "规则可能已存在"
    iptables -A INPUT -s 205.185.126.196 -j DROP 2>/dev/null && echo "✓ 已阻止入站连接从 205.185.126.196" || echo "规则可能已存在"
    iptables -A INPUT -s 80.64.16.241 -j DROP 2>/dev/null && echo "✓ 已阻止入站连接从 80.64.16.241" || echo "规则可能已存在"
else
    echo "⚠️  未找到防火墙工具，请手动安装 ufw 或 iptables"
    echo "   安装 ufw: apt install ufw"
    echo "   安装 iptables: apt install iptables"
fi

# 6. 检查系统负载
echo ""
echo "📊 6. 检查系统负载"
echo "----------------------------------------"
top -b -n 1 | head -n 5

# 7. 检查剩余恶意进程
echo ""
echo "📊 7. 检查剩余恶意进程"
echo "----------------------------------------"
ps aux | grep -E "fghgf|health.sh|rondo" | grep -v grep || echo "✓ 无恶意进程"

# 8. 检查恶意网络连接
echo ""
echo "📊 8. 检查恶意网络连接"
echo "----------------------------------------"
ss -tunp | grep -E "205.185.126.196|80.64.16.241" || echo "✓ 无恶意网络连接"

# 9. 验证启动脚本已删除
echo ""
echo "📊 9. 验证启动脚本已删除"
echo "----------------------------------------"
ls -la /etc/init.d/ | grep -i "rondo" || echo "✓ 无 rondo 启动脚本"
ls -la /etc/rc*.d/ | grep -i "rondo" || echo "✓ 无 rondo 启动链接"
systemctl list-units --type=service | grep -i "rondo" || echo "✓ 无 rondo 服务"

echo ""
echo "=========================================="
echo "清理完成"
echo "=========================================="
echo ""
echo "⚠️  重要提示："
echo "1. 恶意软件的启动机制已删除"
echo "2. 建议重启服务器验证清理效果"
echo "3. 重启后检查系统负载和进程"
echo "4. 如果系统负载仍然很高，考虑重装系统"

