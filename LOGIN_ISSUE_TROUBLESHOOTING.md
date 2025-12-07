# 登录问题排查指南

## 🔍 快速诊断步骤

### 步骤 1：检查服务状态

```bash
# 检查 PM2 服务状态
pm2 status

# 查看所有服务的详细状态
pm2 list
```

**如果服务状态不是 `online`，说明服务有问题。**

---

### 步骤 2：查看错误日志

```bash
# 查看 API 服务的错误日志
pm2 logs caigou-api --err --lines 50

# 或查看所有日志
pm2 logs caigou-api --lines 100
```

**常见错误：**
- 数据库连接失败
- 配置文件格式错误
- 端口被占用
- 环境变量缺失

---

### 步骤 3：检查数据库连接

```bash
# 测试数据库连接
mysql -u caigou_user -p'Caigou_2025_Strong!' -h localhost -e "SELECT 1;"

# 如果上面的命令失败，尝试：
mysql -u root -p -e "SELECT 1;"
```

---

### 步骤 4：检查配置文件

```bash
# 进入项目目录
cd /root/caigou/caigou/apps/api

# 检查 DATABASE_URL 配置是否正确
grep DATABASE_URL .env

# 检查是否有语法错误（引号不匹配等）
cat .env | grep -E 'DATABASE_URL|JWT_SECRET'
```

---

## 🛠️ 常见问题和解决方案

### 问题 1：服务未启动

**症状**：`pm2 status` 显示服务状态为 `stopped` 或 `errored`

**解决方案**：
```bash
# 查看错误日志
pm2 logs caigou-api --err --lines 50

# 如果是因为配置错误，先修复配置，然后重启
pm2 restart caigou-api

# 如果重启失败，删除后重新启动
pm2 delete caigou-api
cd /root/caigou/caigou
pm2 start ecosystem.config.js
```

---

### 问题 2：数据库连接失败

**症状**：日志显示 `Can't reach database server` 或 `Connection refused`

**解决方案**：
```bash
# 检查 MySQL 服务是否运行
systemctl status mysql
# 或
service mysql status

# 如果 MySQL 未运行，启动它
systemctl start mysql
# 或
service mysql start

# 检查数据库用户和权限
mysql -u root -p -e "SELECT User, Host FROM mysql.user WHERE User='caigou_user';"

# 如果用户不存在，创建用户
mysql -u root -p << EOF
CREATE USER IF NOT EXISTS 'caigou_user'@'localhost' IDENTIFIED BY 'Caigou_2025_Strong!';
GRANT ALL PRIVILEGES ON caigou.* TO 'caigou_user'@'localhost';
FLUSH PRIVILEGES;
EOF
```

---

### 问题 3：配置文件格式错误

**症状**：日志显示 `Invalid DATABASE_URL` 或配置解析错误

**可能的原因**：
- 引号不匹配
- 特殊字符未转义
- URL 格式错误

**解决方案**：
```bash
# 检查配置文件
cd /root/caigou/caigou/apps/api

# 查看 DATABASE_URL 行
grep DATABASE_URL .env

# 正确的格式应该是：
# DATABASE_URL="mysql://caigou_user:Caigou_2025_Strong!@localhost:3306/caigou?connection_limit=50&pool_timeout=20"

# 如果格式错误，修复它
nano .env
# 或使用 sed 修复
```

---

### 问题 4：端口被占用

**症状**：日志显示 `EADDRINUSE: address already in use :::8081`

**解决方案**：
```bash
# 查找占用 8081 端口的进程
lsof -i :8081
# 或
netstat -tulpn | grep 8081

# 杀死占用端口的进程
kill -9 <PID>

# 重启服务
pm2 restart caigou-api
```

---

### 问题 5：JWT_SECRET 配置错误

**症状**：登录时返回 500 错误或 JWT 相关错误

**解决方案**：
```bash
# 检查 JWT_SECRET 是否配置
cd /root/caigou/caigou/apps/api
grep JWT_SECRET .env

# 如果未配置或太短，添加或修改
# JWT_SECRET 必须至少 32 个字符
nano .env
# 添加或修改：
# JWT_SECRET=your-super-secret-jwt-key-change-in-production-min-32-chars

# 重启服务
pm2 restart caigou-api
```

---

## 🚨 紧急恢复步骤

如果服务完全无法启动，按以下步骤恢复：

### 步骤 1：恢复配置文件

```bash
# 如果有备份，恢复备份
cd /root/caigou/caigou/apps/api
cp .env.backup .env

# 如果没有备份，检查是否有 .env.local
ls -la .env*
```

### 步骤 2：检查并修复配置

```bash
# 确保 DATABASE_URL 格式正确（先去掉连接池参数，恢复基本配置）
cd /root/caigou/caigou/apps/api
nano .env

# 修改为基本配置（不带连接池参数）：
# DATABASE_URL="mysql://caigou_user:Caigou_2025_Strong!@localhost:3306/caigou"
```

### 步骤 3：重启服务

```bash
# 重新构建
cd /root/caigou/caigou
npm run build

# 重启服务
pm2 restart caigou-api

# 查看日志
pm2 logs caigou-api --lines 50
```

---

## 📋 检查清单

在联系支持之前，请先检查：

- [ ] PM2 服务状态：`pm2 status`
- [ ] 错误日志：`pm2 logs caigou-api --err --lines 50`
- [ ] 数据库服务：`systemctl status mysql`
- [ ] 数据库连接：`mysql -u caigou_user -p -e "SELECT 1;"`
- [ ] 配置文件格式：`grep DATABASE_URL .env`
- [ ] 端口占用：`lsof -i :8081`
- [ ] 服务日志：`pm2 logs caigou-api --lines 100`

---

## 🔧 快速修复脚本

如果问题仍然存在，运行这个诊断脚本：

```bash
#!/bin/bash
echo "=== 系统诊断 ==="
echo ""
echo "1. PM2 服务状态："
pm2 status
echo ""
echo "2. 最近错误日志："
pm2 logs caigou-api --err --lines 20 --nostream
echo ""
echo "3. MySQL 服务状态："
systemctl status mysql --no-pager | head -5
echo ""
echo "4. 数据库连接测试："
mysql -u caigou_user -p'Caigou_2025_Strong!' -h localhost -e "SELECT 1;" 2>&1
echo ""
echo "5. 配置文件检查："
cd /root/caigou/caigou/apps/api
grep -E 'DATABASE_URL|JWT_SECRET' .env | head -2
echo ""
echo "6. 端口占用检查："
lsof -i :8081 2>/dev/null || echo "端口 8081 未被占用"
echo ""
echo "=== 诊断完成 ==="
```

保存为 `diagnose.sh`，然后运行：
```bash
chmod +x diagnose.sh
./diagnose.sh
```

---

**最后更新**: 2025-12-07

