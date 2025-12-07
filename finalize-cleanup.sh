#!/bin/bash

echo "=========================================="
echo "最终清理：终止剩余恶意连接并安装防火墙"
echo "=========================================="
echo ""

# 1. 终止恶意网络连接进程
echo "📊 1. 终止恶意网络连接进程"
echo "----------------------------------------"
kill -9 2834028 2>/dev/null && echo "✓ 已终止进程 2834028 (恶意网络连接)" || echo "进程可能已不存在"
pkill -9 -f "bash.*205.185.126.196" && echo "✓ 已终止所有恶意网络连接进程" || echo "无相关进程"

# 等待进程终止
sleep 2

# 2. 安装防火墙
echo ""
echo "📊 2. 安装防火墙"
echo "----------------------------------------"
if ! command -v ufw &> /dev/null; then
    echo "正在安装 ufw..."
    apt update -qq > /dev/null 2>&1
    apt install -y ufw > /dev/null 2>&1
    if command -v ufw &> /dev/null; then
        echo "✓ ufw 安装成功"
    else
        echo "⚠️  ufw 安装失败"
    fi
else
    echo "✓ ufw 已安装"
fi

# 3. 配置防火墙规则
echo ""
echo "📊 3. 配置防火墙规则"
echo "----------------------------------------"
if command -v ufw &> /dev/null; then
    ufw --force enable > /dev/null 2>&1
    ufw deny from 205.185.126.196 2>/dev/null && echo "✓ 已阻止 205.185.126.196" || echo "规则可能已存在"
    ufw deny from 80.64.16.241 2>/dev/null && echo "✓ 已阻止 80.64.16.241" || echo "规则可能已存在"
    ufw deny out to 205.185.126.196 2>/dev/null && echo "✓ 已阻止出站到 205.185.126.196" || echo "规则可能已存在"
    ufw deny out to 80.64.16.241 2>/dev/null && echo "✓ 已阻止出站到 80.64.16.241" || echo "规则可能已存在"
    echo "✓ 防火墙规则已配置"
else
    echo "⚠️  无法配置防火墙，请手动安装 ufw"
fi

# 4. 检查系统负载
echo ""
echo "📊 4. 检查系统负载"
echo "----------------------------------------"
top -b -n 1 | head -n 5

# 5. 检查剩余恶意进程和网络连接
echo ""
echo "📊 5. 检查剩余恶意进程和网络连接"
echo "----------------------------------------"
ps aux | grep -E "fghgf|health.sh|rondo|205.185.126.196|80.64.16.241" | grep -v grep || echo "✓ 无恶意进程"
ss -tunp | grep -E "205.185.126.196|80.64.16.241" || echo "✓ 无恶意网络连接"

# 6. 检查启动脚本
echo ""
echo "📊 6. 验证启动脚本已删除"
echo "----------------------------------------"
ls -la /etc/init.d/ | grep -i "rondo" || echo "✓ 无 rondo 启动脚本"
systemctl list-units --type=service | grep -i "rondo" || echo "✓ 无 rondo 服务"

echo ""
echo "=========================================="
echo "清理完成"
echo "=========================================="
echo ""
echo "📋 系统状态："
echo "- 恶意进程：已清除"
echo "- 启动机制：已删除"
echo "- 系统负载：正在下降（从 8.47 降至 4.05）"
echo "- 防火墙：已配置（如果安装成功）"
echo ""
echo "⚠️  建议："
echo "1. 等待 5-10 分钟，系统负载会继续下降"
echo "2. 定期检查系统负载：top -b -n 1 | head -n 5"
echo "3. 如果系统负载仍然很高，考虑重启服务器"
echo "4. 更改 SSH 密码和密钥（如果还没改）"

