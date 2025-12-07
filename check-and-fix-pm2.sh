#!/bin/bash

# 检查并修复 PM2 命令问题

set -e

echo "=========================================="
echo "检查 PM2 状态"
echo "=========================================="
echo ""

# 1. 查找 PM2 可执行文件
echo "📊 1. 查找 PM2 可执行文件"
echo "----------------------------------------"
PM2_PATHS=(
    "/usr/lib/node_modules/pm2/bin/pm2"
    "/usr/local/bin/pm2"
    "$(which pm2 2>/dev/null)"
    "$HOME/.npm-global/bin/pm2"
    "/root/.npm-global/bin/pm2"
)

PM2_CMD=""
for path in "${PM2_PATHS[@]}"; do
    if [ -n "$path" ] && [ -f "$path" ]; then
        PM2_CMD="$path"
        echo "✓ 找到 PM2: $PM2_CMD"
        break
    fi
done

if [ -z "$PM2_CMD" ]; then
    echo "✗ 未找到 PM2 可执行文件"
    echo "尝试安装 PM2..."
    npm install -g pm2
    PM2_CMD=$(which pm2 || echo "/usr/local/bin/pm2")
fi
echo ""

# 2. 检查 PM2 进程
echo "📊 2. 检查 PM2 进程"
echo "----------------------------------------"
if pgrep -f "pm2" > /dev/null; then
    echo "✓ PM2 进程正在运行"
    ps aux | grep pm2 | grep -v grep | head -3
else
    echo "⚠️ PM2 进程未运行"
fi
echo ""

# 3. 检查 PM2 服务状态
echo "📊 3. 检查 PM2 服务状态"
echo "----------------------------------------"
if [ -n "$PM2_CMD" ]; then
    $PM2_CMD status
else
    echo "无法检查状态（PM2 未找到）"
fi
echo ""

# 4. 创建 PM2 别名脚本
echo "📊 4. 创建 PM2 别名脚本"
echo "----------------------------------------"
if [ -n "$PM2_CMD" ]; then
    # 创建便捷脚本
    cat > /usr/local/bin/pm2 << EOF
#!/bin/bash
$PM2_CMD "\$@"
EOF
    chmod +x /usr/local/bin/pm2
    echo "✓ 已创建 /usr/local/bin/pm2 别名"
    
    # 添加到 PATH（如果不在）
    if ! echo "$PATH" | grep -q "/usr/local/bin"; then
        echo "export PATH=\$PATH:/usr/local/bin" >> ~/.bashrc
        export PATH=$PATH:/usr/local/bin
        echo "✓ 已添加到 PATH"
    fi
else
    echo "⚠️ 无法创建别名（PM2 未找到）"
fi
echo ""

# 5. 测试 PM2 命令
echo "📊 5. 测试 PM2 命令"
echo "----------------------------------------"
if command -v pm2 &> /dev/null; then
    echo "✓ pm2 命令可用"
    pm2 --version
else
    echo "⚠️ pm2 命令仍不可用，使用完整路径:"
    echo "  $PM2_CMD status"
    echo "  $PM2_CMD logs"
fi
echo ""

# 6. 显示服务状态
echo "📊 6. 服务状态"
echo "----------------------------------------"
if command -v pm2 &> /dev/null; then
    pm2 status
elif [ -n "$PM2_CMD" ]; then
    $PM2_CMD status
fi
echo ""

# 7. 检查服务健康
echo "📊 7. 检查服务健康"
echo "----------------------------------------"
echo "检查 API 服务..."
API_RESPONSE=$(curl -s -o /dev/null -w "%{http_code}" --max-time 5 http://localhost:8081/api/health 2>/dev/null || echo "000")
if [ "$API_RESPONSE" = "200" ]; then
    echo "✓ API 服务正常 (HTTP $API_RESPONSE)"
else
    echo "⚠️ API 服务响应异常 (HTTP $API_RESPONSE)"
fi

echo "检查 Web 服务..."
WEB_RESPONSE=$(curl -s -o /dev/null -w "%{http_code}" --max-time 5 http://localhost:3000 2>/dev/null || echo "000")
if [ "$WEB_RESPONSE" = "200" ] || [ "$WEB_RESPONSE" = "304" ]; then
    echo "✓ Web 服务正常 (HTTP $WEB_RESPONSE)"
else
    echo "⚠️ Web 服务响应异常 (HTTP $WEB_RESPONSE)"
fi
echo ""

# 8. 检查 MinIO
echo "📊 8. 检查 MinIO 服务"
echo "----------------------------------------"
if systemctl is-active --quiet minio; then
    echo "✓ MinIO 服务正在运行"
    if ss -tulpn | grep -q ":9000"; then
        echo "✓ MinIO 端口 9000 正在监听"
    else
        echo "⚠️ MinIO 端口 9000 未监听"
    fi
else
    echo "✗ MinIO 服务未运行"
    echo "启动 MinIO: sudo systemctl start minio"
fi
echo ""

echo "=========================================="
echo "完成"
echo "=========================================="
echo ""
echo "PM2 命令:"
if command -v pm2 &> /dev/null; then
    echo "  pm2 status    - 查看状态"
    echo "  pm2 logs      - 查看日志"
    echo "  pm2 restart all - 重启所有服务"
else
    echo "  使用: $PM2_CMD status"
    echo "  或重新登录以加载 PATH"
fi
echo ""

