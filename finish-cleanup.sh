#!/bin/bash

echo "=========================================="
echo "完成清理：终止剩余恶意进程并安装防火墙"
echo "=========================================="
echo ""

# 1. 终止恶意网络连接进程
echo "📊 1. 终止恶意网络连接进程"
echo "----------------------------------------"
kill -9 2834028 2>/dev/null && echo "✓ 已终止进程 2834028 (恶意网络连接)" || echo "进程可能已不存在"
pkill -9 -f "bash.*205.185.126.196" && echo "✓ 已终止所有恶意网络连接进程" || echo "无相关进程"

# 等待进程终止
sleep 2

# 2. 检查 CPU 使用率最高的进程
echo ""
echo "📊 2. 检查 CPU 使用率最高的进程"
echo "----------------------------------------"
ps aux --sort=-%cpu | head -n 10

# 3. 安装并配置防火墙
echo ""
echo "📊 3. 安装并配置防火墙"
echo "----------------------------------------"
if ! command -v ufw &> /dev/null && ! command -v iptables &> /dev/null; then
    echo "正在安装 ufw..."
    apt update -qq && apt install -y ufw > /dev/null 2>&1
    if command -v ufw &> /dev/null; then
        echo "✓ ufw 安装成功"
    else
        echo "⚠️  ufw 安装失败，尝试安装 iptables..."
        apt install -y iptables > /dev/null 2>&1
    fi
fi

# 配置防火墙规则
if command -v ufw &> /dev/null; then
    ufw --force enable > /dev/null 2>&1
    ufw deny from 205.185.126.196 2>/dev/null && echo "✓ 已阻止 205.185.126.196" || echo "规则可能已存在"
    ufw deny from 80.64.16.241 2>/dev/null && echo "✓ 已阻止 80.64.16.241" || echo "规则可能已存在"
    ufw deny out to 205.185.126.196 2>/dev/null && echo "✓ 已阻止出站到 205.185.126.196" || echo "规则可能已存在"
    ufw deny out to 80.64.16.241 2>/dev/null && echo "✓ 已阻止出站到 80.64.16.241" || echo "规则可能已存在"
    echo "✓ 防火墙规则已配置"
elif command -v iptables &> /dev/null; then
    iptables -A OUTPUT -d 205.185.126.196 -j DROP 2>/dev/null && echo "✓ 已阻止出站连接到 205.185.126.196" || echo "规则可能已存在"
    iptables -A OUTPUT -d 80.64.16.241 -j DROP 2>/dev/null && echo "✓ 已阻止出站连接到 80.64.16.241" || echo "规则可能已存在"
    iptables -A INPUT -s 205.185.126.196 -j DROP 2>/dev/null && echo "✓ 已阻止入站连接从 205.185.126.196" || echo "规则可能已存在"
    iptables -A INPUT -s 80.64.16.241 -j DROP 2>/dev/null && echo "✓ 已阻止入站连接从 80.64.16.241" || echo "规则可能已存在"
    echo "✓ 防火墙规则已配置"
else
    echo "⚠️  无法安装防火墙工具，请手动安装"
fi

# 4. 检查系统负载
echo ""
echo "📊 4. 检查系统负载"
echo "----------------------------------------"
top -b -n 1 | head -n 5

# 5. 检查剩余恶意进程
echo ""
echo "📊 5. 检查剩余恶意进程"
echo "----------------------------------------"
ps aux | grep -E "fghgf|health.sh|rondo|205.185.126.196|80.64.16.241" | grep -v grep || echo "✓ 无恶意进程"

# 6. 检查恶意网络连接
echo ""
echo "📊 6. 检查恶意网络连接"
echo "----------------------------------------"
ss -tunp | grep -E "205.185.126.196|80.64.16.241" || echo "✓ 无恶意网络连接"

# 7. 检查是否有其他高 CPU 进程
echo ""
echo "📊 7. 检查是否有其他高 CPU 进程"
echo "----------------------------------------"
HIGH_CPU=$(ps aux --sort=-%cpu | head -n 6 | tail -n 5 | awk '{if ($3 > 50) print $0}')
if [ -n "$HIGH_CPU" ]; then
    echo "⚠️  发现高 CPU 使用率进程："
    echo "$HIGH_CPU"
else
    echo "✓ 无异常高 CPU 进程"
fi

echo ""
echo "=========================================="
echo "清理完成"
echo "=========================================="
echo ""
echo "📋 建议后续操作："
echo "1. 等待 1-2 分钟，观察系统负载是否继续下降"
echo "2. 如果系统负载仍然很高，检查是否有其他恶意进程"
echo "3. 考虑重启服务器以彻底清理"
echo "4. 重启后检查系统负载和进程"

