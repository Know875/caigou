#!/bin/bash

# 诊断图片代理问题

set -e

echo "=========================================="
echo "诊断图片代理问题"
echo "=========================================="
echo ""

cd /root/caigou/caigou

# 1. 检查 MinIO 服务
echo "📊 1. 检查 MinIO 服务"
echo "----------------------------------------"
if systemctl is-active --quiet minio; then
    echo "✓ MinIO 服务正在运行"
else
    echo "✗ MinIO 服务未运行"
    echo "启动: sudo systemctl start minio"
fi

if ss -tulpn | grep -q ":9000"; then
    echo "✓ 端口 9000 正在监听"
else
    echo "✗ 端口 9000 未监听"
fi
echo ""

# 2. 测试 MinIO 连接
echo "📊 2. 测试 MinIO 连接"
echo "----------------------------------------"
HTTP_CODE=$(curl -s -o /dev/null -w "%{http_code}" --max-time 5 http://127.0.0.1:9000 2>/dev/null || echo "000")
if [ "$HTTP_CODE" != "000" ]; then
    echo "✓ MinIO API 可访问 (HTTP $HTTP_CODE)"
else
    echo "✗ MinIO API 无响应"
fi
echo ""

# 3. 检查 Web 服务日志
echo "📊 3. 检查 Web 服务日志（最近 50 行，包含 proxy-image）"
echo "----------------------------------------"
if command -v pm2 &> /dev/null || [ -f "/usr/lib/node_modules/pm2/bin/pm2" ]; then
    PM2_CMD=$(command -v pm2 || echo "/usr/lib/node_modules/pm2/bin/pm2")
    echo "PM2 日志:"
    $PM2_CMD logs caigou-web --lines 50 --nostream 2>/dev/null | grep -i "proxy\|image\|error" | tail -20 || echo "无相关日志"
else
    if [ -f "logs/web-out.log" ]; then
        echo "Web 日志:"
        tail -50 logs/web-out.log | grep -i "proxy\|image\|error" || echo "无相关日志"
    fi
    if [ -f "logs/web-error.log" ]; then
        echo "Web 错误日志:"
        tail -50 logs/web-error.log | grep -i "proxy\|image\|error" || echo "无相关日志"
    fi
fi
echo ""

# 4. 测试图片代理接口
echo "📊 4. 测试图片代理接口"
echo "----------------------------------------"
# 创建一个测试 URL（需要替换为实际的图片 URL）
TEST_URL="http://127.0.0.1:9000/eggpurchase/payment-qrcodes/test.jpg"
ENCODED_URL=$(echo -n "$TEST_URL" | jq -sRr @uri 2>/dev/null || echo "$TEST_URL")

echo "测试代理接口..."
PROXY_RESPONSE=$(curl -s -o /dev/null -w "%{http_code}" --max-time 10 "http://127.0.0.1:3000/api/proxy-image?url=$ENCODED_URL" 2>/dev/null || echo "000")
if [ "$PROXY_RESPONSE" = "200" ]; then
    echo "✓ 代理接口正常 (HTTP 200)"
elif [ "$PROXY_RESPONSE" = "400" ] || [ "$PROXY_RESPONSE" = "403" ]; then
    echo "⚠️ 代理接口返回 $PROXY_RESPONSE（可能是 URL 无效或签名过期）"
elif [ "$PROXY_RESPONSE" = "500" ]; then
    echo "✗ 代理接口返回 500（服务器错误）"
    echo "查看详细错误:"
    curl -s "http://127.0.0.1:3000/api/proxy-image?url=$ENCODED_URL" 2>/dev/null | head -20
else
    echo "⚠️ 代理接口响应异常 (HTTP $PROXY_RESPONSE)"
fi
echo ""

# 5. 检查环境变量
echo "📊 5. 检查环境变量"
echo "----------------------------------------"
echo "NEXT_PUBLIC_API_URL: ${NEXT_PUBLIC_API_URL:-未设置}"
echo "API_URL: ${API_URL:-未设置}"
echo ""

# 6. 检查构建文件
echo "📊 6. 检查构建文件"
echo "----------------------------------------"
if [ -f "apps/web/.next/server/app/api/proxy-image/route.js" ]; then
    echo "✓ proxy-image 路由已构建"
    ls -lh apps/web/.next/server/app/api/proxy-image/route.js
else
    echo "✗ proxy-image 路由未构建"
    echo "需要重新构建: cd apps/web && npm run build"
fi
echo ""

# 7. 建议
echo "=========================================="
echo "诊断完成"
echo "=========================================="
echo ""
echo "如果图片仍然无法加载，可能的原因:"
echo "1. 签名 URL 已过期（7天有效期）"
echo "2. MinIO 服务未运行"
echo "3. Web 服务未正确构建或重启"
echo ""
echo "建议操作:"
echo "1. 检查 MinIO 服务: sudo systemctl status minio"
echo "2. 重新构建 Web: cd apps/web && npm run build"
echo "3. 重启 Web 服务: pm2 restart caigou-web"
echo "4. 查看实时日志: pm2 logs caigou-web --lines 100"
echo ""

