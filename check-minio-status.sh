#!/bin/bash

# 快速检查 MinIO 服务状态

set -e

echo "=========================================="
echo "检查 MinIO 服务状态"
echo "=========================================="
echo ""

# 1. 检查 systemd 服务状态
echo "📊 1. 检查 systemd 服务状态"
echo "----------------------------------------"
if systemctl is-active --quiet minio; then
    echo "✓ MinIO 服务正在运行"
    systemctl status minio --no-pager -l | head -10
else
    echo "✗ MinIO 服务未运行"
    echo ""
    echo "尝试启动 MinIO 服务..."
    systemctl start minio
    sleep 3
    if systemctl is-active --quiet minio; then
        echo "✓ MinIO 服务已启动"
    else
        echo "✗ MinIO 服务启动失败"
        echo "查看错误日志:"
        journalctl -u minio -n 20 --no-pager
    fi
fi
echo ""

# 2. 检查端口监听
echo "📊 2. 检查端口监听"
echo "----------------------------------------"
if ss -tulpn | grep -q ":9000"; then
    echo "✓ 端口 9000 正在监听"
    ss -tulpn | grep ":9000"
else
    echo "✗ 端口 9000 未监听"
fi
echo ""

if ss -tulpn | grep -q ":9001"; then
    echo "✓ 端口 9001 正在监听"
    ss -tulpn | grep ":9001"
else
    echo "✗ 端口 9001 未监听"
fi
echo ""

# 3. 检查 MinIO 进程
echo "📊 3. 检查 MinIO 进程"
echo "----------------------------------------"
MINIO_PIDS=$(pgrep -f "minio server" || echo "")
if [ -n "$MINIO_PIDS" ]; then
    echo "✓ 找到 MinIO 进程:"
    ps aux | grep "[m]inio server" || echo "无进程"
else
    echo "✗ 未找到 MinIO 进程"
fi
echo ""

# 4. 测试 MinIO 连接
echo "📊 4. 测试 MinIO 连接"
echo "----------------------------------------"
HTTP_CODE=$(curl -s -o /dev/null -w "%{http_code}" --max-time 5 http://127.0.0.1:9000 2>/dev/null || echo "000")
if [ "$HTTP_CODE" != "000" ] && [ "$HTTP_CODE" != "" ]; then
    echo "✓ MinIO API 可访问 (HTTP $HTTP_CODE)"
else
    echo "✗ MinIO API 无响应"
    echo "尝试详细连接测试:"
    curl -v http://127.0.0.1:9000 --max-time 5 2>&1 | head -20 || echo "连接失败"
fi
echo ""

# 5. 检查 MinIO 数据目录
echo "📊 5. 检查 MinIO 数据目录"
echo "----------------------------------------"
if [ -d "/data/minio" ]; then
    echo "✓ 数据目录存在: /data/minio"
    ls -lh /data/minio | head -5
else
    echo "✗ 数据目录不存在: /data/minio"
fi
echo ""

# 6. 检查 MinIO 二进制文件
echo "📊 6. 检查 MinIO 二进制文件"
echo "----------------------------------------"
if [ -f "/opt/minio/minio" ]; then
    echo "✓ MinIO 二进制文件存在: /opt/minio/minio"
    ls -lh /opt/minio/minio
else
    echo "✗ MinIO 二进制文件不存在: /opt/minio/minio"
fi
echo ""

# 7. 查看最近的服务日志
echo "📊 7. 查看最近的服务日志（最后 10 行）"
echo "----------------------------------------"
journalctl -u minio -n 10 --no-pager || echo "无日志"
echo ""

# 8. 建议
echo "=========================================="
echo "诊断完成"
echo "=========================================="
echo ""
if ! systemctl is-active --quiet minio; then
    echo "⚠️  MinIO 服务未运行，请执行以下命令启动:"
    echo "   sudo systemctl start minio"
    echo "   sudo systemctl enable minio  # 设置开机自启"
    echo ""
    echo "或者手动启动:"
    echo "   nohup /opt/minio/minio server /data/minio \\"
    echo "     --address 0.0.0.0:9000 \\"
    echo "     --console-address 0.0.0.0:9001 \\"
    echo "     > /var/log/minio-standalone.log 2>&1 &"
    echo ""
fi

if ! ss -tulpn | grep -q ":9000"; then
    echo "⚠️  端口 9000 未监听，MinIO 可能未正常启动"
    echo "   请检查日志: journalctl -u minio -f"
    echo ""
fi

echo "测试 MinIO 连接:"
echo "   curl http://127.0.0.1:9000"
echo "   curl http://127.0.0.1:9001"
echo ""

