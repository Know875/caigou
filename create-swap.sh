#!/bin/bash

echo "=========================================="
echo "创建交换空间（Swap）"
echo "=========================================="
echo ""

# 检查是否已有交换空间
if swapon --show | grep -q .; then
    echo "✓ 交换空间已存在："
    swapon --show
    exit 0
fi

# 检查磁盘空间
echo "📊 1. 检查磁盘空间"
echo "----------------------------------------"
df -h / | tail -n 1

# 创建 2GB 交换文件
SWAP_SIZE=2G
SWAP_FILE=/swapfile

echo ""
echo "📊 2. 创建交换文件（${SWAP_SIZE}）"
echo "----------------------------------------"

# 检查交换文件是否已存在
if [ -f "$SWAP_FILE" ]; then
    echo "⚠️  交换文件已存在，跳过创建"
else
    # 创建交换文件
    echo "正在创建交换文件，这可能需要几分钟..."
    fallocate -l $SWAP_SIZE $SWAP_FILE 2>/dev/null || dd if=/dev/zero of=$SWAP_FILE bs=1M count=2048 2>/dev/null
    
    if [ $? -eq 0 ]; then
        echo "✓ 交换文件创建成功"
    else
        echo "✗ 交换文件创建失败"
        exit 1
    fi
fi

# 设置权限
echo ""
echo "📊 3. 设置交换文件权限"
echo "----------------------------------------"
chmod 600 $SWAP_FILE
echo "✓ 权限设置完成"

# 格式化为交换空间
echo ""
echo "📊 4. 格式化为交换空间"
echo "----------------------------------------"
mkswap $SWAP_FILE
if [ $? -eq 0 ]; then
    echo "✓ 格式化成功"
else
    echo "✗ 格式化失败"
    exit 1
fi

# 启用交换空间
echo ""
echo "📊 5. 启用交换空间"
echo "----------------------------------------"
swapon $SWAP_FILE
if [ $? -eq 0 ]; then
    echo "✓ 交换空间已启用"
else
    echo "✗ 启用失败"
    exit 1
fi

# 验证
echo ""
echo "📊 6. 验证交换空间"
echo "----------------------------------------"
swapon --show
free -h

# 设置为永久（添加到 /etc/fstab）
echo ""
echo "📊 7. 设置为永久（添加到 /etc/fstab）"
echo "----------------------------------------"
if ! grep -q "$SWAP_FILE" /etc/fstab; then
    echo "$SWAP_FILE none swap sw 0 0" >> /etc/fstab
    echo "✓ 已添加到 /etc/fstab"
else
    echo "✓ 已在 /etc/fstab 中"
fi

echo ""
echo "=========================================="
echo "交换空间创建完成"
echo "=========================================="
echo ""
echo "💡 现在可以重新启动服务了"

