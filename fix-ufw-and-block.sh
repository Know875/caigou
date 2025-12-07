#!/bin/bash

echo "=========================================="
echo "修复防火墙并阻止恶意软件"
echo "=========================================="
echo ""

# 1. 终止所有恶意进程
echo "📊 1. 终止所有恶意进程"
echo "----------------------------------------"
pkill -9 -f "fghgf" 2>/dev/null && echo "✓ 已终止 fghgf 进程" || echo "无 fghgf 进程"
pkill -9 -f "health.sh" 2>/dev/null && echo "✓ 已终止 health.sh 进程" || echo "无 health.sh 进程"
pkill -9 -f "89.144.31.18" 2>/dev/null && echo "✓ 已终止恶意下载进程" || echo "无恶意下载进程"

# 2. 清理所有恶意定时任务
echo ""
echo "📊 2. 清理所有恶意定时任务"
echo "----------------------------------------"
crontab -l 2>/dev/null | grep -v "89.144.31.18" | grep -v "80.64.16.241" | grep -v "205.185.126.196" | grep -v "rondo" | grep -v "unk.sh" | grep -v "corn" | grep -v "whale-corps-dev" | grep -v "pub-dc84e32afcfa417fa04d36454032549b" | crontab - 2>/dev/null
echo "✓ 已清理 root crontab"

sed -i '/89.144.31.18/d' /etc/crontab 2>/dev/null
sed -i '/80.64.16.241/d' /etc/crontab 2>/dev/null
sed -i '/205.185.126.196/d' /etc/crontab 2>/dev/null
sed -i '/rondo/d' /etc/crontab 2>/dev/null
echo "✓ 已清理系统 crontab"

# 3. 配置防火墙（使用完整路径）
echo ""
echo "📊 3. 配置防火墙"
echo "----------------------------------------"
# 查找 ufw 的完整路径
UFW_PATH=$(which ufw 2>/dev/null || find /usr -name ufw 2>/dev/null | head -n 1)

if [ -n "$UFW_PATH" ]; then
    echo "找到 ufw: $UFW_PATH"
    $UFW_PATH --force enable > /dev/null 2>&1
    $UFW_PATH deny from 89.144.31.18 2>/dev/null && echo "✓ 已阻止 89.144.31.18" || echo "规则可能已存在"
    $UFW_PATH deny from 80.64.16.241 2>/dev/null && echo "✓ 已阻止 80.64.16.241" || echo "规则可能已存在"
    $UFW_PATH deny from 205.185.126.196 2>/dev/null && echo "✓ 已阻止 205.185.126.196" || echo "规则可能已存在"
    $UFW_PATH deny out to 89.144.31.18 2>/dev/null && echo "✓ 已阻止出站到 89.144.31.18" || echo "规则可能已存在"
    $UFW_PATH deny out to 80.64.16.241 2>/dev/null && echo "✓ 已阻止出站到 80.64.16.241" || echo "规则可能已存在"
    $UFW_PATH deny out to 205.185.126.196 2>/dev/null && echo "✓ 已阻止出站到 205.185.126.196" || echo "规则可能已存在"
    echo "✓ 防火墙规则已配置"
else
    echo "⚠️  未找到 ufw，尝试使用 iptables"
    # 使用 iptables 作为备选
    if command -v iptables &> /dev/null; then
        iptables -A INPUT -s 89.144.31.18 -j DROP 2>/dev/null && echo "✓ 已阻止 89.144.31.18" || echo "规则可能已存在"
        iptables -A INPUT -s 80.64.16.241 -j DROP 2>/dev/null && echo "✓ 已阻止 80.64.16.241" || echo "规则可能已存在"
        iptables -A INPUT -s 205.185.126.196 -j DROP 2>/dev/null && echo "✓ 已阻止 205.185.126.196" || echo "规则可能已存在"
        iptables -A OUTPUT -d 89.144.31.18 -j DROP 2>/dev/null && echo "✓ 已阻止出站到 89.144.31.18" || echo "规则可能已存在"
        iptables -A OUTPUT -d 80.64.16.241 -j DROP 2>/dev/null && echo "✓ 已阻止出站到 80.64.16.241" || echo "规则可能已存在"
        iptables -A OUTPUT -d 205.185.126.196 -j DROP 2>/dev/null && echo "✓ 已阻止出站到 205.185.126.196" || echo "规则可能已存在"
        echo "✓ iptables 规则已配置"
    else
        echo "⚠️  未找到防火墙工具，请手动安装：apt install -y ufw"
    fi
fi

# 4. 检查恶意网络连接
echo ""
echo "📊 4. 检查恶意网络连接"
echo "----------------------------------------"
ss -tunp | grep -E "89.144.31.18|80.64.16.241|205.185.126.196" || echo "✓ 无恶意网络连接"

# 5. 检查剩余恶意进程
echo ""
echo "📊 5. 检查剩余恶意进程"
echo "----------------------------------------"
ps aux | grep -E "fghgf|health.sh|rondo|89.144.31.18" | grep -v grep || echo "✓ 无恶意进程"

# 6. 检查系统负载
echo ""
echo "📊 6. 检查系统负载"
echo "----------------------------------------"
top -b -n 1 | head -n 5

echo ""
echo "=========================================="
echo "清理完成"
echo "=========================================="

