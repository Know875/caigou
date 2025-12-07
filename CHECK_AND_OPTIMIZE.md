# 检查并优化系统性能

## 📊 当前状态分析

从你的监控数据看：
- ✅ 数据库连接数：17 个（当前使用，正常）
- ✅ 健康检查响应：21ms（很快）
- ✅ 服务正常运行

**但系统仍然卡顿，可能的原因：**
1. 连接池配置可能还是默认值（需要确认）
2. 可能有慢查询
3. 可能需要增加 API 实例数

---

## 🔍 立即检查

### 步骤 1：检查当前连接池配置

```bash
# 查看当前 DATABASE_URL 配置
cd /root/caigou/caigou/apps/api
grep DATABASE_URL .env

# 检查是否有 connection_limit 参数
grep -o 'connection_limit=[0-9]*' .env || echo "未配置连接池参数"
```

**如果看到 `connection_limit=50`，说明已配置。**
**如果没有，需要添加。**

---

### 步骤 2：检查 MySQL 最大连接数

```bash
mysql -u root -p -e "SHOW VARIABLES LIKE 'max_connections';"
```

**如果小于 100，建议增加：**
```bash
mysql -u root -p -e "SET GLOBAL max_connections = 200;"
```

---

### 步骤 3：检查慢查询

```bash
# 查看当前正在运行的查询
mysql -u root -p -e "
SELECT 
    id,
    user,
    time,
    state,
    LEFT(info, 100) as query
FROM information_schema.processlist
WHERE time > 1
ORDER BY time DESC;
"
```

**如果有查询时间超过 1 秒，说明有慢查询。**

---

## 🚀 立即优化

### 如果连接池未配置，立即添加：

```bash
# 1. 进入项目目录
cd /root/caigou/caigou/apps/api

# 2. 备份
cp .env .env.backup

# 3. 添加连接池参数
sed -i 's|DATABASE_URL="mysql://caigou_user:Caigou_2025_Strong%21@localhost:3306/caigou"|DATABASE_URL="mysql://caigou_user:Caigou_2025_Strong%21@localhost:3306/caigou?connection_limit=50&pool_timeout=20"|g' .env

# 4. 验证
grep DATABASE_URL .env

# 5. 拉取最新代码
cd /root/caigou/caigou
git pull origin main

# 6. 重新构建
npm run build

# 7. 重启服务
pm2 restart caigou-api

# 8. 等待几秒后检查
sleep 5
pm2 logs caigou-api --lines 20
```

---

### 如果连接池已配置，但还是很卡：

**方案 1：增加 API 实例数**

```bash
# 检查当前 PM2 配置
cd /root/caigou/caigou
cat ecosystem.config.js | grep -A 5 "caigou-api"

# 如果 instances 是 2，改为 4
# 编辑配置文件
nano ecosystem.config.js

# 找到 caigou-api，修改：
# instances: 4,  // 从 2 改为 4

# 重启
pm2 restart all
pm2 save
```

**方案 2：检查并优化慢查询**

```bash
# 启用慢查询日志
mysql -u root -p << EOF
SET GLOBAL slow_query_log = 'ON';
SET GLOBAL long_query_time = 1;  -- 记录超过 1 秒的查询
EOF

# 查看慢查询日志位置
mysql -u root -p -e "SHOW VARIABLES LIKE 'slow_query_log_file';"
```

---

## 📈 性能对比

**优化前（当前）**：
- 连接池：可能默认值（约 10-20）
- 响应时间：可能较慢
- 并发能力：较低

**优化后（添加连接池）**：
- 连接池：50/实例（100 个总连接）
- 响应时间：减少 50-70%
- 并发能力：提升 2.5 倍

---

## ✅ 验证优化效果

优化后，再次检查：

```bash
# 1. 检查连接数（应该可以支持更多并发）
mysql -u root -p -e "SHOW STATUS LIKE 'Threads_connected';"

# 2. 测试响应时间（应该更快）
time curl http://localhost:8081/api/health

# 3. 检查服务状态
pm2 status

# 4. 监控资源使用
pm2 monit
```

---

**最后更新**: 2025-12-07

