# 在服务器上修改数据库连接池配置

## 📍 文件位置

在服务器上，`.env` 文件通常位于：
```
/root/caigou/caigou/apps/api/.env
```
或
```
/root/caigou/caigou/apps/api/.env.local
```

---

## 🔧 修改步骤

### 步骤 1：连接到服务器

```bash
ssh root@your-server-ip
```

---

### 步骤 2：找到并编辑 .env 文件

```bash
# 进入项目目录
cd /root/caigou/caigou/apps/api

# 查看当前 DATABASE_URL 配置
grep DATABASE_URL .env .env.local 2>/dev/null

# 或者直接查看文件
cat .env
# 或
cat .env.local
```

---

### 步骤 3：修改 DATABASE_URL

**方法 1：使用 nano 编辑器（推荐）**

```bash
# 编辑 .env 文件
nano .env

# 或编辑 .env.local 文件
nano .env.local
```

**找到 DATABASE_URL 这一行，修改为：**

```bash
# 原来的配置（示例）
DATABASE_URL=mysql://username:password@localhost:3306/database_name?connection_limit=20&pool_timeout=10

# 修改后的配置（增加连接池大小）
DATABASE_URL=mysql://username:password@localhost:3306/database_name?connection_limit=50&pool_timeout=20
```

**保存并退出：**
- 按 `Ctrl + O` 保存
- 按 `Enter` 确认
- 按 `Ctrl + X` 退出

---

**方法 2：使用 sed 命令（快速修改）**

```bash
# 备份原文件
cp .env .env.backup

# 修改 connection_limit 从 20 改为 50
sed -i 's/connection_limit=20/connection_limit=50/g' .env

# 修改 pool_timeout 从 10 改为 20
sed -i 's/pool_timeout=10/pool_timeout=20/g' .env

# 验证修改
grep DATABASE_URL .env
```

---

**方法 3：使用 vi/vim 编辑器**

```bash
# 编辑文件
vi .env

# 按 `i` 进入编辑模式
# 找到 DATABASE_URL 行并修改
# 按 `Esc` 退出编辑模式
# 输入 `:wq` 保存并退出
```

---

### 步骤 4：验证修改

```bash
# 检查修改后的配置
grep DATABASE_URL .env

# 应该看到类似这样的输出：
# DATABASE_URL=mysql://...?connection_limit=50&pool_timeout=20
```

---

### 步骤 5：检查 MySQL 最大连接数

在修改连接池之前，确保 MySQL 的最大连接数足够大：

```bash
# 连接 MySQL
mysql -u root -p

# 查看当前最大连接数
SHOW VARIABLES LIKE 'max_connections';

# 如果小于 100，建议增加（需要重启 MySQL）
SET GLOBAL max_connections = 200;

# 退出 MySQL
exit;
```

**注意**：如果使用 `SET GLOBAL`，重启 MySQL 后会恢复默认值。要永久修改，需要编辑 MySQL 配置文件：

```bash
# 编辑 MySQL 配置文件
sudo nano /etc/mysql/mysql.conf.d/mysqld.cnf

# 添加或修改：
max_connections = 200

# 重启 MySQL
sudo systemctl restart mysql
```

---

### 步骤 6：重启服务

```bash
# 重新构建项目（如果需要）
cd /root/caigou/caigou
npm run build

# 重启 API 服务
pm2 restart caigou-api

# 或重启所有服务
pm2 restart all

# 查看服务状态
pm2 status

# 查看日志确认启动成功
pm2 logs caigou-api --lines 50
```

---

### 步骤 7：验证配置生效

```bash
# 方法 1：访问健康检查端点
curl http://localhost:8081/api/health

# 方法 2：检查数据库连接数
mysql -u root -p -e "SHOW STATUS LIKE 'Threads_connected';"

# 方法 3：查看 PM2 日志，确认没有连接错误
pm2 logs caigou-api --lines 20
```

---

## 📝 完整示例

假设你的原始配置是：
```bash
DATABASE_URL=mysql://egg_purchase_user:your_password@localhost:3306/egg_purchase?connection_limit=20&pool_timeout=10
```

修改后的配置应该是：
```bash
DATABASE_URL=mysql://egg_purchase_user:your_password@localhost:3306/egg_purchase?connection_limit=50&pool_timeout=20
```

**一键修改命令**：
```bash
cd /root/caigou/caigou/apps/api
cp .env .env.backup
sed -i 's/connection_limit=20/connection_limit=50/g' .env
sed -i 's/pool_timeout=10/pool_timeout=20/g' .env
grep DATABASE_URL .env
cd /root/caigou/caigou
npm run build
pm2 restart caigou-api
```

---

## ⚠️ 注意事项

1. **备份文件**：修改前一定要备份原文件
   ```bash
   cp .env .env.backup
   ```

2. **检查 MySQL 最大连接数**：确保 MySQL 的 `max_connections` 足够大
   - 如果 2 个 API 实例，每个 50 个连接 = 100 个连接
   - 建议 MySQL `max_connections` 至少设置为 200

3. **测试环境先验证**：如果有测试环境，先在测试环境验证

4. **监控连接数**：修改后监控数据库连接数，确保不会超过限制

---

## 🔍 故障排查

### 如果修改后服务无法启动

```bash
# 查看错误日志
pm2 logs caigou-api --err --lines 50

# 检查 .env 文件格式
cat .env | grep DATABASE_URL

# 恢复备份
cp .env.backup .env
pm2 restart caigou-api
```

### 如果连接数仍然不足

```bash
# 检查实际使用的连接数
mysql -u root -p -e "SHOW STATUS LIKE 'Threads_connected';"

# 检查 MySQL 最大连接数
mysql -u root -p -e "SHOW VARIABLES LIKE 'max_connections';"

# 如果连接数接近最大值，需要增加 MySQL 的 max_connections
```

---

## 📊 推荐配置

### 当前配置（2 个 API 实例）
```bash
# 每个实例 50 个连接
DATABASE_URL=mysql://...?connection_limit=50&pool_timeout=20

# MySQL 最大连接数
max_connections = 200
```

### 如果增加到 4 个 API 实例
```bash
# 每个实例 50 个连接
DATABASE_URL=mysql://...?connection_limit=50&pool_timeout=20

# MySQL 最大连接数（4 × 50 = 200，加上其他连接，建议 300）
max_connections = 300
```

---

**最后更新**: 2025-12-07

