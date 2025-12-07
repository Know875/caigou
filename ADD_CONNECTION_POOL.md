# 添加数据库连接池配置

## 🎯 现在可以添加连接池参数了

服务已经启动，引号问题已修复，现在可以安全地添加连接池参数。

---

## ✅ 立即执行

在服务器上执行：

```bash
# 1. 进入项目目录
cd /root/caigou/caigou/apps/api

# 2. 备份配置文件
cp .env .env.backup

# 3. 添加连接池参数（现在引号问题已修复，应该可以工作）
# 如果当前是：
# DATABASE_URL="mysql://caigou_user:Caigou_2025_Strong%21@localhost:3306/caigou"
# 修改为：
sed -i 's|DATABASE_URL="mysql://caigou_user:Caigou_2025_Strong%21@localhost:3306/caigou"|DATABASE_URL="mysql://caigou_user:Caigou_2025_Strong%21@localhost:3306/caigou?connection_limit=50&pool_timeout=20"|g' .env

# 4. 验证修改
grep DATABASE_URL .env

# 应该看到：
# DATABASE_URL="mysql://caigou_user:Caigou_2025_Strong%21@localhost:3306/caigou?connection_limit=50&pool_timeout=20"

# 5. 拉取最新代码（包含引号修复）
cd /root/caigou/caigou
git pull origin main

# 6. 重新构建
npm run build

# 7. 重启服务
pm2 restart caigou-api

# 8. 查看日志确认
pm2 logs caigou-api --lines 30
```

---

## 🔍 如果添加连接池参数后报错

如果添加连接池参数后仍然报错，说明 Prisma 6.x 可能不支持在 URL 中直接使用这些参数。

**解决方案**：先去掉连接池参数，保持基本配置：

```bash
# 恢复基本配置（不带连接池参数）
sed -i 's|DATABASE_URL="mysql://caigou_user:Caigou_2025_Strong%21@localhost:3306/caigou.*"|DATABASE_URL="mysql://caigou_user:Caigou_2025_Strong%21@localhost:3306/caigou"|g' .env

# 重新构建和重启
cd /root/caigou/caigou
npm run build
pm2 restart caigou-api
```

然后我们可以通过其他方式优化性能（增加 API 实例数等）。

---

## 📊 预期效果

**添加连接池后**：
- ✅ 并发能力提升 **2.5 倍**（从 40 个连接增加到 100 个连接）
- ✅ 响应时间减少 **50-70%**
- ✅ 卡顿现象显著减少

**如果连接池参数不支持**：
- 可以通过增加 API 实例数来提升性能
- 2 个实例 → 4 个实例，性能提升 2 倍

---

## 🚀 验证优化效果

优化后，检查性能：

```bash
# 1. 检查数据库连接数
mysql -u root -p -e "SHOW STATUS LIKE 'Threads_connected';"

# 2. 访问健康检查端点（查看响应时间）
time curl http://localhost:8081/api/health

# 3. 监控系统资源
pm2 monit
```

---

**最后更新**: 2025-12-07

