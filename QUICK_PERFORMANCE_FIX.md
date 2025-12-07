# 系统卡顿快速优化方案

## 🚨 立即执行的优化（优先级最高）

### 1. 增加数据库连接池（最关键！）

**问题**：当前每个实例只有 20 个数据库连接，连接耗尽时请求会排队等待。

**立即执行**：

```bash
# 1. 进入项目目录
cd /root/caigou/caigou/apps/api

# 2. 备份配置文件
cp .env .env.backup

# 3. 修改 DATABASE_URL，增加连接池
# 如果当前配置是：
# DATABASE_URL="mysql://caigou_user:Caigou_2025_Strong!@localhost:3306/caigou"
# 修改为：
sed -i 's|DATABASE_URL="mysql://caigou_user:Caigou_2025_Strong!@localhost:3306/caigou"|DATABASE_URL="mysql://caigou_user:Caigou_2025_Strong!@localhost:3306/caigou?connection_limit=50&pool_timeout=20"|g' .env

# 4. 验证修改
grep DATABASE_URL .env

# 5. 检查 MySQL 最大连接数
mysql -u root -p -e "SHOW VARIABLES LIKE 'max_connections';"

# 6. 如果 max_connections 小于 100，增加它（临时）
mysql -u root -p -e "SET GLOBAL max_connections = 200;"

# 7. 重新构建并重启服务
cd /root/caigou/caigou
npm run build
pm2 restart caigou-api

# 8. 验证服务正常
pm2 logs caigou-api --lines 20
curl http://localhost:8081/api/health
```

**预期效果**：并发能力提升 2.5 倍，显著减少卡顿。

---

### 2. 检查并优化慢查询

**立即执行**：

```bash
# 1. 启用慢查询日志
mysql -u root -p << EOF
SET GLOBAL slow_query_log = 'ON';
SET GLOBAL long_query_time = 2;  -- 记录超过 2 秒的查询
SET GLOBAL log_queries_not_using_indexes = 'ON';
EOF

# 2. 查看当前正在运行的慢查询
mysql -u root -p -e "
SELECT 
    id,
    user,
    host,
    db,
    command,
    time,
    state,
    LEFT(info, 100) as query
FROM information_schema.processlist
WHERE time > 2
ORDER BY time DESC;
"

# 3. 查看慢查询日志位置
mysql -u root -p -e "SHOW VARIABLES LIKE 'slow_query_log_file';"
```

**如果发现慢查询**：
- 添加索引
- 优化 JOIN 查询
- 使用分页

---

### 3. 检查数据库连接数使用情况

```bash
# 查看当前连接数
mysql -u root -p -e "
SHOW STATUS LIKE 'Threads_connected';
SHOW VARIABLES LIKE 'max_connections';
"

# 如果 Threads_connected 接近 max_connections，说明连接池不足
```

---

### 4. 检查系统资源

```bash
# 检查 CPU 和内存使用
top -bn1 | head -20

# 检查 PM2 进程资源使用
pm2 monit

# 检查磁盘 I/O
iostat -x 1 3
```

---

## 🔧 中期优化方案

### 1. 增加 API 实例数

如果连接池优化后仍然卡顿，增加 API 实例：

```bash
# 编辑 PM2 配置文件
cd /root/caigou/caigou
nano ecosystem.config.js

# 找到 caigou-api 配置，修改 instances
# 从 2 改为 4
instances: 4,

# 同时需要增加数据库连接池（每个实例 50 个）
# 4 个实例 × 50 = 200 个连接
# 确保 MySQL max_connections >= 200

# 重启服务
pm2 restart all
```

---

### 2. 优化数据库索引

```bash
# 检查缺少索引的表
mysql -u root -p caigou << EOF
SELECT 
    TABLE_NAME,
    COUNT(*) as missing_indexes
FROM information_schema.STATISTICS
WHERE TABLE_SCHEMA = 'caigou'
GROUP BY TABLE_NAME
HAVING COUNT(*) < 3;  -- 假设每个表至少需要 3 个索引
EOF
```

---

### 3. 添加 Redis 缓存

对于频繁查询的数据（用户信息、门店信息等），添加 Redis 缓存可以大幅提升性能。

---

## 📊 性能监控

### 实时监控脚本

创建监控脚本 `monitor.sh`：

```bash
#!/bin/bash
while true; do
    clear
    echo "=== 系统性能监控 ==="
    echo ""
    echo "1. PM2 服务状态："
    pm2 status
    echo ""
    echo "2. 数据库连接数："
    mysql -u root -p'your_password' -e "SHOW STATUS LIKE 'Threads_connected';" 2>/dev/null
    echo ""
    echo "3. 慢查询数量："
    mysql -u root -p'your_password' -e "SHOW STATUS LIKE 'Slow_queries';" 2>/dev/null
    echo ""
    echo "4. 系统资源："
    top -bn1 | head -10
    echo ""
    echo "按 Ctrl+C 退出"
    sleep 5
done
```

运行：
```bash
chmod +x monitor.sh
./monitor.sh
```

---

## 🎯 快速优化检查清单

执行以下命令，快速诊断和优化：

```bash
#!/bin/bash
echo "=== 快速性能优化 ==="
echo ""

# 1. 检查当前配置
echo "1. 检查数据库连接池配置："
cd /root/caigou/caigou/apps/api
grep DATABASE_URL .env | grep -o 'connection_limit=[0-9]*' || echo "未配置连接池"

# 2. 检查 MySQL 最大连接数
echo ""
echo "2. MySQL 最大连接数："
mysql -u root -p'your_password' -e "SHOW VARIABLES LIKE 'max_connections';" 2>/dev/null

# 3. 检查当前连接数
echo ""
echo "3. 当前数据库连接数："
mysql -u root -p'your_password' -e "SHOW STATUS LIKE 'Threads_connected';" 2>/dev/null

# 4. 检查慢查询
echo ""
echo "4. 慢查询统计："
mysql -u root -p'your_password' -e "SHOW STATUS LIKE 'Slow_queries';" 2>/dev/null

# 5. 检查 PM2 状态
echo ""
echo "5. PM2 服务状态："
pm2 status

# 6. 检查系统资源
echo ""
echo "6. 系统资源使用："
echo "CPU 使用率："
top -bn1 | grep "Cpu(s)" | awk '{print $2}'
echo "内存使用："
free -h | grep Mem | awk '{print $3 "/" $2}'

echo ""
echo "=== 诊断完成 ==="
```

---

## 🚀 立即执行的完整优化脚本

```bash
#!/bin/bash
set -e

echo "=== 开始性能优化 ==="
echo ""

# 1. 备份配置
cd /root/caigou/caigou/apps/api
cp .env .env.backup.$(date +%Y%m%d_%H%M%S)
echo "✅ 配置文件已备份"

# 2. 修改数据库连接池
if grep -q 'connection_limit=' .env; then
    echo "⚠️  连接池已配置，更新中..."
    sed -i 's/connection_limit=[0-9]*/connection_limit=50/g' .env
    sed -i 's/pool_timeout=[0-9]*/pool_timeout=20/g' .env
else
    echo "📝 添加连接池配置..."
    sed -i 's|DATABASE_URL="mysql://caigou_user:Caigou_2025_Strong!@localhost:3306/caigou"|DATABASE_URL="mysql://caigou_user:Caigou_2025_Strong!@localhost:3306/caigou?connection_limit=50&pool_timeout=20"|g' .env
fi
echo "✅ 数据库连接池已更新为 50"

# 3. 检查 MySQL 最大连接数
echo ""
echo "检查 MySQL 配置..."
MAX_CONN=$(mysql -u root -p'your_password' -se "SHOW VARIABLES LIKE 'max_connections';" 2>/dev/null | awk '{print $2}')
if [ "$MAX_CONN" -lt 100 ]; then
    echo "⚠️  MySQL max_connections 太小 ($MAX_CONN)，建议增加到 200"
    echo "执行: mysql -u root -p -e 'SET GLOBAL max_connections = 200;'"
else
    echo "✅ MySQL max_connections: $MAX_CONN"
fi

# 4. 重新构建
echo ""
echo "重新构建项目..."
cd /root/caigou/caigou
npm run build
echo "✅ 构建完成"

# 5. 重启服务
echo ""
echo "重启服务..."
pm2 restart caigou-api
sleep 3
pm2 status
echo "✅ 服务已重启"

# 6. 验证
echo ""
echo "验证服务状态..."
sleep 2
HEALTH=$(curl -s http://localhost:8081/api/health | grep -o '"status":"[^"]*"' | cut -d'"' -f4)
if [ "$HEALTH" = "ok" ]; then
    echo "✅ 服务健康检查通过"
else
    echo "⚠️  服务健康检查失败，请查看日志: pm2 logs caigou-api"
fi

echo ""
echo "=== 优化完成 ==="
echo ""
echo "建议后续操作："
echo "1. 监控数据库连接数: mysql -u root -p -e 'SHOW STATUS LIKE \"Threads_connected\";'"
echo "2. 检查慢查询: mysql -u root -p -e 'SHOW STATUS LIKE \"Slow_queries\";'"
echo "3. 监控系统资源: pm2 monit"
```

保存为 `optimize.sh`，然后执行：
```bash
chmod +x optimize.sh
./optimize.sh
```

---

## 📈 预期效果

优化后：
- **并发能力提升 2.5 倍**（从 40 个连接增加到 100 个连接）
- **响应时间减少 50-70%**
- **卡顿现象显著减少**

---

## ⚠️ 注意事项

1. **MySQL 密码**：脚本中的 `your_password` 需要替换为实际的 MySQL root 密码
2. **备份重要**：修改前一定要备份配置文件
3. **监控连接数**：优化后监控数据库连接数，确保不会超过限制
4. **逐步优化**：如果优化后仍有问题，考虑增加 API 实例数

---

**最后更新**: 2025-12-07

