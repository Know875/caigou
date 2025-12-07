#!/bin/bash

echo "=========================================="
echo "性能测试脚本"
echo "=========================================="
echo ""

# 获取 API 地址
API_URL="${API_URL:-http://localhost:8081}"

echo "📊 测试 API 地址: $API_URL"
echo ""

# 检查 API 是否可访问
echo "1. 检查 API 健康状态..."
HEALTH_RESPONSE=$(curl -s -w "\nHTTP_CODE:%{http_code}\nTIME:%{time_total}" "$API_URL/api/health")
HTTP_CODE=$(echo "$HEALTH_RESPONSE" | grep "HTTP_CODE" | cut -d: -f2)
TIME=$(echo "$HEALTH_RESPONSE" | grep "TIME" | cut -d: -f2)

if [ "$HTTP_CODE" = "200" ]; then
    echo "✓ API 健康检查通过 (响应时间: ${TIME}s)"
else
    echo "✗ API 健康检查失败 (HTTP $HTTP_CODE)"
    exit 1
fi

echo ""
echo "2. 测试询价单列表查询性能..."
echo "----------------------------------------"

# 测试询价单列表（需要认证，这里只测试响应时间）
echo "测试 /api/rfqs 接口..."
RFQ_START=$(date +%s.%N)
RFQ_RESPONSE=$(curl -s -w "\nHTTP_CODE:%{http_code}\nTIME:%{time_total}\nSIZE:%{size_download}" \
    -H "Authorization: Bearer YOUR_TOKEN_HERE" \
    "$API_URL/api/rfqs?limit=10" 2>/dev/null || echo "HTTP_CODE:401")
RFQ_END=$(date +%s.%N)
RFQ_TIME=$(echo "$RFQ_RESPONSE" | grep "TIME" | cut -d: -f2)
RFQ_SIZE=$(echo "$RFQ_RESPONSE" | grep "SIZE" | cut -d: -f2)

if [ -n "$RFQ_TIME" ]; then
    echo "  响应时间: ${RFQ_TIME}s"
    if [ -n "$RFQ_SIZE" ]; then
        RFQ_SIZE_KB=$(echo "scale=2; $RFQ_SIZE / 1024" | bc)
        echo "  响应大小: ${RFQ_SIZE_KB} KB"
    fi
else
    echo "  ⚠️  需要认证，无法测试（这是正常的）"
fi

echo ""
echo "3. 测试统计接口性能..."
echo "----------------------------------------"

STATS_START=$(date +%s.%N)
STATS_RESPONSE=$(curl -s -w "\nHTTP_CODE:%{http_code}\nTIME:%{time_total}\nSIZE:%{size_download}" \
    -H "Authorization: Bearer YOUR_TOKEN_HERE" \
    "$API_URL/api/rfqs/stats" 2>/dev/null || echo "HTTP_CODE:401")
STATS_END=$(date +%s.%N)
STATS_TIME=$(echo "$STATS_RESPONSE" | grep "TIME" | cut -d: -f2)
STATS_SIZE=$(echo "$STATS_RESPONSE" | grep "SIZE" | cut -d: -f2)

if [ -n "$STATS_TIME" ]; then
    echo "  响应时间: ${STATS_TIME}s"
    if [ -n "$STATS_SIZE" ]; then
        STATS_SIZE_KB=$(echo "scale=2; $STATS_SIZE / 1024" | bc)
        echo "  响应大小: ${STATS_SIZE_KB} KB"
    fi
else
    echo "  ⚠️  需要认证，无法测试（这是正常的）"
fi

echo ""
echo "4. 检查响应压缩..."
echo "----------------------------------------"

COMPRESSION_CHECK=$(curl -s -I -H "Accept-Encoding: gzip, deflate" "$API_URL/api/health" | grep -i "content-encoding")
if [ -n "$COMPRESSION_CHECK" ]; then
    echo "✓ 响应压缩已启用: $COMPRESSION_CHECK"
else
    echo "⚠️  响应压缩未检测到（可能需要安装 compression 包）"
fi

echo ""
echo "=========================================="
echo "测试完成"
echo "=========================================="
echo ""
echo "💡 提示："
echo "- 完整的性能测试需要在浏览器中测试"
echo "- 打开开发者工具 → Network 标签"
echo "- 查看 API 请求的响应时间和大小"
echo "- 对比优化前后的数据"

