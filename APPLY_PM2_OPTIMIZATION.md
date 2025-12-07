# 应用 PM2 优化配置

## 🎯 优化目标

当前问题：
- ✅ 连接池已配置（50 个连接）
- ✅ 长时间运行的连接已消失
- ❌ 只有 1 个 API 实例（fork 模式）
- ❌ 服务频繁重启（168 次）

**优化后：**
- 2 个 API 实例（cluster 模式）
- 更好的负载均衡
- 并发能力提升 2 倍

---

## 🚀 立即执行

### 步骤 1：拉取最新代码

```bash
cd /root/caigou/caigou
git pull origin main
```

---

### 步骤 2：创建日志目录

```bash
mkdir -p /root/caigou/caigou/logs
```

---

### 步骤 3：检查 MySQL 最大连接数

```bash
# 查看当前最大连接数
mysql -u root -p -e "SHOW VARIABLES LIKE 'max_connections';"

# 如果小于 100，增加它（2 个实例 × 50 连接 = 100 连接）
mysql -u root -p -e "SET GLOBAL max_connections = 200;"
```

---

### 步骤 4：停止旧服务并启动新配置

```bash
cd /root/caigou/caigou

# 停止所有服务
pm2 stop all

# 删除旧配置
pm2 delete all

# 使用新配置启动
pm2 start ecosystem.config.js

# 保存配置
pm2 save

# 查看状态
pm2 status

# 查看日志
pm2 logs caigou-api --lines 20
```

---

### 步骤 5：验证优化效果

```bash
# 1. 检查服务状态（应该看到 2 个 caigou-api 实例）
pm2 status

# 2. 检查数据库连接数（应该可以支持更多并发）
mysql -u root -p -e "SHOW STATUS LIKE 'Threads_connected';"

# 3. 测试响应时间
time curl http://localhost:8081/api/health

# 4. 监控系统资源
pm2 monit
```

---

## 📊 预期效果

**优化前**：
- 1 个 API 实例
- 50 个数据库连接
- 并发能力：~200-500 用户

**优化后**：
- 2 个 API 实例
- 100 个数据库连接（2 × 50）
- 并发能力：~400-1000 用户
- **性能提升 2 倍**

---

## ⚠️ 注意事项

1. **MySQL 最大连接数**：确保 `max_connections >= 200`
2. **内存使用**：2 个实例会使用更多内存（约 2GB）
3. **监控重启次数**：如果重启次数继续增加，说明有其他问题

---

## 🔍 如果启动失败

```bash
# 查看错误日志
pm2 logs caigou-api --err --lines 50

# 检查构建文件是否存在
ls -la /root/caigou/caigou/apps/api/dist/main.js

# 如果不存在，重新构建
cd /root/caigou/caigou
npm run build
```

---

**最后更新**: 2025-12-07

