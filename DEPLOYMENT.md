# 🚀 服务器部署指南

**版本**: 1.0.0  
**最后更新**: 2025-11-23

## 📋 目录

- [环境要求](#环境要求)
- [服务器环境配置](#服务器环境配置)
- [数据库配置](#数据库配置)
- [Redis 配置](#redis-配置)
- [代码部署](#代码部署)
- [环境变量配置](#环境变量配置)
- [构建和启动](#构建和启动)
- [Nginx 配置](#nginx-配置)
- [SSL 证书配置](#ssl-证书配置)
- [PM2 进程管理](#pm2-进程管理)
- [监控和日志](#监控和日志)
- [备份策略](#备份策略)
- [常见问题](#常见问题)

---

## 环境要求

### 必需软件

- **Node.js**: >= 18.0.0
- **MySQL**: >= 8.0 (推荐 8.0+)
- **Redis**: >= 6.0
- **Nginx**: >= 1.18
- **PM2**: 最新版本

### 可选软件

- **MinIO**: 用于文件存储（S3 兼容）
- **Certbot**: 用于 SSL 证书（Let's Encrypt）

### 系统要求

- **操作系统**: Ubuntu 20.04+ / CentOS 7+ / Debian 10+
- **内存**: 最低 2GB，推荐 4GB+
- **磁盘**: 最低 20GB，推荐 50GB+
- **CPU**: 最低 2 核，推荐 4 核+

---

## 服务器环境配置

### 1. 更新系统

```bash
# Ubuntu/Debian
sudo apt update && sudo apt upgrade -y

# CentOS/RHEL
sudo yum update -y
```

### 2. 安装 Node.js

```bash
# 使用 NodeSource 安装 Node.js 18.x
curl -fsSL https://deb.nodesource.com/setup_18.x | sudo -E bash -
sudo apt-get install -y nodejs

# 验证安装
node --version  # 应显示 v18.x.x 或更高
npm --version
```

### 3. 安装 MySQL

```bash
# Ubuntu/Debian
sudo apt install mysql-server -y

# CentOS/RHEL
sudo yum install mysql-server -y

# 启动 MySQL
sudo systemctl start mysql
sudo systemctl enable mysql

# 安全配置（设置 root 密码）
sudo mysql_secure_installation
```

### 4. 安装 Redis

```bash
# Ubuntu/Debian
sudo apt install redis-server -y

# CentOS/RHEL
sudo yum install redis -y

# 启动 Redis
sudo systemctl start redis
sudo systemctl enable redis
```

### 5. 安装 Nginx

```bash
# Ubuntu/Debian
sudo apt install nginx -y

# CentOS/RHEL
sudo yum install nginx -y

# 启动 Nginx
sudo systemctl start nginx
sudo systemctl enable nginx
```

### 6. 安装 PM2

```bash
sudo npm install -g pm2
```

---

## 数据库配置

### 1. 创建数据库和用户

```bash
# 登录 MySQL
sudo mysql -u root -p

# 在 MySQL 中执行以下命令
CREATE DATABASE egg_purchase CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
CREATE USER 'egg_purchase_user'@'localhost' IDENTIFIED BY 'your_strong_password_here';
GRANT ALL PRIVILEGES ON egg_purchase.* TO 'egg_purchase_user'@'localhost';
FLUSH PRIVILEGES;
EXIT;
```

### 2. 配置 MySQL（可选，性能优化）

编辑 `/etc/mysql/mysql.conf.d/mysqld.cnf`（Ubuntu）或 `/etc/my.cnf`（CentOS）：

```ini
[mysqld]
# 字符集
character-set-server=utf8mb4
collation-server=utf8mb4_unicode_ci

# 连接数
max_connections=200

# 缓冲池大小（根据服务器内存调整）
innodb_buffer_pool_size=1G

# 日志
slow_query_log=1
slow_query_log_file=/var/log/mysql/slow-query.log
long_query_time=2
```

重启 MySQL：

```bash
sudo systemctl restart mysql
```

---

## Redis 配置

### 1. 设置 Redis 密码

编辑 `/etc/redis/redis.conf`：

```conf
# 设置密码（取消注释并修改）
requirepass your_redis_password_here

# 绑定地址（生产环境建议只绑定 localhost）
bind 127.0.0.1

# 保护模式
protected-mode yes
```

### 2. 重启 Redis

```bash
sudo systemctl restart redis
```

### 3. 测试 Redis 连接

```bash
redis-cli -a your_redis_password_here ping
# 应返回 PONG
```

---

## 代码部署

### 1. 创建项目目录

```bash
sudo mkdir -p /var/www/egg-purchase
sudo chown -R $USER:$USER /var/www/egg-purchase
cd /var/www/egg-purchase
```

### 2. 克隆或上传代码

```bash
# 如果使用 Git
git clone <your-repo-url> .

# 或使用 scp 上传代码
# scp -r /path/to/local/code user@server:/var/www/egg-purchase/
```

### 3. 安装依赖

```bash
# 安装所有依赖（包括开发依赖，用于构建）
npm install

# 或仅安装生产依赖（如果已经构建好）
npm install --production
```

---

## 环境变量配置

### 1. 创建环境变量文件

```bash
cd /var/www/egg-purchase
cp env.local.example apps/api/.env
nano apps/api/.env
```

### 2. 配置环境变量

编辑 `apps/api/.env`，填入以下配置：

```env
# 数据库（MySQL）
DATABASE_URL=mysql://egg_purchase_user:your_strong_password_here@localhost:3306/egg_purchase?connection_limit=20&pool_timeout=10

# Redis
REDIS_HOST=localhost
REDIS_PORT=6379
REDIS_PASSWORD=your_redis_password_here
# 或使用 REDIS_URL（如果设置了密码）
# REDIS_URL=redis://:your_redis_password_here@localhost:6379

# JWT（生产环境必须使用强密钥，至少32个字符）
JWT_SECRET=your-super-secret-jwt-key-change-in-production-min-32-chars-random-string

# API
API_PORT=8081
NODE_ENV=production
TZ=Asia/Shanghai
CRON_TZ=Asia/Shanghai

# Web 前端
NEXT_PUBLIC_API_URL=https://your-domain.com/api
WEB_URL=https://your-domain.com

# MinIO（可选，如果使用文件存储）
MINIO_ENDPOINT=localhost
MINIO_PORT=9000
MINIO_ACCESS_KEY=minioadmin
MINIO_SECRET_KEY=minioadmin
S3_ENDPOINT=http://localhost:9000
MINIO_PUBLIC_ENDPOINT=https://your-domain.com/storage

# 钉钉机器人（可选）
# DINGTALK_WEBHOOK_URL=https://oapi.dingtalk.com/robot/send?access_token=YOUR_TOKEN

# OCR配置（可选）
# OCR_SPACE_API_KEY=your-ocr-space-api-key
# XFYUN_APP_ID=your-xfyun-app-id
# XFYUN_API_KEY=your-xfyun-api-key
# XFYUN_API_SECRET=your-xfyun-api-secret
```

### 3. 设置文件权限

```bash
# 保护环境变量文件
chmod 600 apps/api/.env
```

---

## 构建和启动

### 1. 生成 Prisma Client

```bash
cd /var/www/egg-purchase
npm run db:generate
```

### 2. 运行数据库迁移

```bash
npm run db:migrate
```

### 3. 初始化种子数据（可选）

```bash
npm run db:seed
```

这将创建默认测试账号：
- **管理员**: admin@example.com / admin123
- **采购员**: buyer@example.com / buyer123
- **供应商**: supplier@example.com / supplier123

**⚠️ 生产环境请务必修改默认密码！**

### 4. 构建项目

```bash
npm run build
```

### 5. 创建 PM2 配置文件

创建 `ecosystem.config.js`：

```javascript
module.exports = {
  apps: [
    {
      name: 'egg-purchase-api',
      script: 'apps/api/dist/main.js',
      cwd: '/var/www/egg-purchase',
      instances: 2,
      exec_mode: 'cluster',
      env: {
        NODE_ENV: 'production',
        PORT: 8081,
      },
      error_file: './logs/api-error.log',
      out_file: './logs/api-out.log',
      log_date_format: 'YYYY-MM-DD HH:mm:ss Z',
      merge_logs: true,
      autorestart: true,
      max_memory_restart: '1G',
    },
    {
      name: 'egg-purchase-worker',
      script: 'apps/api/dist/worker.js',
      cwd: '/var/www/egg-purchase',
      instances: 1,
      env: {
        NODE_ENV: 'production',
      },
      error_file: './logs/worker-error.log',
      out_file: './logs/worker-out.log',
      log_date_format: 'YYYY-MM-DD HH:mm:ss Z',
      merge_logs: true,
      autorestart: true,
      max_memory_restart: '1G',
    },
    {
      name: 'egg-purchase-web',
      script: 'node_modules/.bin/next',
      args: 'start -p 8080',
      cwd: '/var/www/egg-purchase/apps/web',
      instances: 2,
      exec_mode: 'cluster',
      env: {
        NODE_ENV: 'production',
        PORT: 8080,
      },
      error_file: '../logs/web-error.log',
      out_file: '../logs/web-out.log',
      log_date_format: 'YYYY-MM-DD HH:mm:ss Z',
      merge_logs: true,
      autorestart: true,
      max_memory_restart: '1G',
    },
  ],
};
```

### 6. 创建日志目录

```bash
mkdir -p /var/www/egg-purchase/logs
```

### 7. 启动服务

```bash
cd /var/www/egg-purchase
pm2 start ecosystem.config.js
pm2 save
pm2 startup
```

### 8. 验证服务状态

```bash
pm2 status
pm2 logs
```

---

## Nginx 配置

### 1. 创建 Nginx 配置文件

```bash
sudo nano /etc/nginx/sites-available/egg-purchase
```

### 2. 配置内容

```nginx
# HTTP 重定向到 HTTPS（如果使用 SSL）
server {
    listen 80;
    server_name your-domain.com www.your-domain.com;
    
    # 如果使用 Let's Encrypt，保留此配置用于证书验证
    location /.well-known/acme-challenge/ {
        root /var/www/html;
    }
    
    # 其他请求重定向到 HTTPS
    location / {
        return 301 https://$server_name$request_uri;
    }
}

# HTTPS 配置
server {
    listen 443 ssl http2;
    server_name your-domain.com www.your-domain.com;
    
    # SSL 证书（使用 Let's Encrypt 后会自动配置）
    ssl_certificate /etc/letsencrypt/live/your-domain.com/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/your-domain.com/privkey.pem;
    ssl_protocols TLSv1.2 TLSv1.3;
    ssl_ciphers HIGH:!aNULL:!MD5;
    ssl_prefer_server_ciphers on;
    
    # 日志
    access_log /var/log/nginx/egg-purchase-access.log;
    error_log /var/log/nginx/egg-purchase-error.log;
    
    # 客户端最大上传大小（用于文件上传）
    client_max_body_size 100M;
    
    # API 代理
    location /api {
        proxy_pass http://localhost:8081;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection 'upgrade';
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_cache_bypass $http_upgrade;
        proxy_read_timeout 300s;
        proxy_connect_timeout 75s;
    }
    
    # Web 前端
    location / {
        proxy_pass http://localhost:8080;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection 'upgrade';
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_cache_bypass $http_upgrade;
    }
    
    # 静态文件缓存（如果 Next.js 有静态文件）
    location /_next/static {
        proxy_pass http://localhost:8080;
        proxy_cache_valid 200 60m;
        add_header Cache-Control "public, immutable";
    }
}
```

### 3. 启用配置

```bash
sudo ln -s /etc/nginx/sites-available/egg-purchase /etc/nginx/sites-enabled/
sudo nginx -t
sudo systemctl reload nginx
```

---

## SSL 证书配置

### 1. 安装 Certbot

```bash
# Ubuntu/Debian
sudo apt install certbot python3-certbot-nginx -y

# CentOS/RHEL
sudo yum install certbot python3-certbot-nginx -y
```

### 2. 获取 SSL 证书

```bash
sudo certbot --nginx -d your-domain.com -d www.your-domain.com
```

### 3. 测试自动续期

```bash
sudo certbot renew --dry-run
```

### 4. 设置自动续期（通常已自动配置）

Certbot 会自动创建定时任务，无需手动配置。

---

## PM2 进程管理

### 常用命令

```bash
# 查看状态
pm2 status

# 查看日志
pm2 logs
pm2 logs egg-purchase-api
pm2 logs egg-purchase-worker
pm2 logs egg-purchase-web

# 重启服务
pm2 restart all
pm2 restart egg-purchase-api

# 停止服务
pm2 stop all
pm2 stop egg-purchase-api

# 删除服务
pm2 delete egg-purchase-api

# 监控
pm2 monit

# 保存当前配置
pm2 save

# 设置开机自启
pm2 startup
```

### 更新部署

```bash
cd /var/www/egg-purchase

# 1. 拉取最新代码（如果使用 Git）
git pull

# 2. 安装依赖
npm install

# 3. 生成 Prisma Client
npm run db:generate

# 4. 运行数据库迁移（如果有新迁移）
npm run db:migrate

# 5. 重新构建
npm run build

# 6. 重启服务
pm2 restart all
```

---

## 监控和日志

### 1. PM2 日志轮转

创建 `/etc/logrotate.d/egg-purchase`：

```
/var/www/egg-purchase/logs/*.log {
    daily
    missingok
    rotate 14
    compress
    delaycompress
    notifempty
    create 0640 www-data www-data
    sharedscripts
    postrotate
        pm2 reloadLogs
    endscript
}
```

### 2. Nginx 日志轮转

Nginx 默认已配置日志轮转，无需额外配置。

### 3. MySQL 慢查询日志

已在 MySQL 配置中启用，日志位置：`/var/log/mysql/slow-query.log`

### 4. 系统监控

```bash
# 安装系统监控工具
sudo apt install htop iotop -y

# 查看系统资源
htop
df -h
free -h
```

---

## 备份策略

### 1. 数据库备份脚本

创建 `/var/www/egg-purchase/scripts/backup-db.sh`：

```bash
#!/bin/bash

# 配置
DB_USER="egg_purchase_user"
DB_PASS="your_strong_password_here"
DB_NAME="egg_purchase"
BACKUP_DIR="/var/backups/egg-purchase"
DATE=$(date +%Y%m%d_%H%M%S)

# 创建备份目录
mkdir -p $BACKUP_DIR

# 备份数据库
mysqldump -u $DB_USER -p$DB_PASS $DB_NAME | gzip > $BACKUP_DIR/db_$DATE.sql.gz

# 删除 30 天前的备份
find $BACKUP_DIR -name "db_*.sql.gz" -mtime +30 -delete

echo "Database backup completed: db_$DATE.sql.gz"
```

设置执行权限：

```bash
chmod +x /var/www/egg-purchase/scripts/backup-db.sh
```

### 2. 设置定时任务

```bash
crontab -e
```

添加以下行（每天凌晨 2 点备份）：

```
0 2 * * * /var/www/egg-purchase/scripts/backup-db.sh >> /var/log/backup.log 2>&1
```

### 3. MinIO 备份（如果使用）

MinIO 支持自动备份，参考 MinIO 官方文档配置。

---

## 常见问题

### 1. 数据库连接失败

**问题**: `PrismaClientInitializationError`

**解决方案**:
- 检查 `DATABASE_URL` 是否正确
- 确认 MySQL 服务正在运行：`sudo systemctl status mysql`
- 检查数据库用户权限
- 确认防火墙未阻止 3306 端口

### 2. Redis 连接失败

**问题**: `ECONNREFUSED` 或 `NOAUTH`

**解决方案**:
- 检查 Redis 服务：`sudo systemctl status redis`
- 确认 `REDIS_PASSWORD` 配置正确
- 测试连接：`redis-cli -a your_password ping`

### 3. PM2 服务无法启动

**问题**: 服务启动后立即退出

**解决方案**:
- 查看日志：`pm2 logs`
- 检查环境变量文件是否存在：`ls -la apps/api/.env`
- 确认构建成功：`ls -la apps/api/dist/`
- 检查端口是否被占用：`netstat -tulpn | grep 8081`

### 4. Nginx 502 Bad Gateway

**问题**: 前端显示 502 错误

**解决方案**:
- 检查后端服务是否运行：`pm2 status`
- 查看 Nginx 错误日志：`sudo tail -f /var/log/nginx/error.log`
- 确认代理地址正确（localhost:8081 和 localhost:8080）
- 检查防火墙：`sudo ufw status`

### 5. 文件上传失败

**问题**: MinIO 连接失败或文件上传错误

**解决方案**:
- 确认 MinIO 服务运行：`pm2 status` 或 `systemctl status minio`
- 检查 MinIO 配置：`MINIO_ENDPOINT`, `MINIO_ACCESS_KEY`, `MINIO_SECRET_KEY`
- 确认存储桶已创建
- 检查网络连接和防火墙

### 6. 内存不足

**问题**: 服务频繁重启或系统卡顿

**解决方案**:
- 检查内存使用：`free -h`
- 减少 PM2 实例数（在 `ecosystem.config.js` 中）
- 优化 MySQL 配置（减少 `innodb_buffer_pool_size`）
- 考虑升级服务器配置

### 7. 时区问题

**问题**: 时间显示不正确

**解决方案**:
- 设置系统时区：`sudo timedatectl set-timezone Asia/Shanghai`
- 确认环境变量：`TZ=Asia/Shanghai` 和 `CRON_TZ=Asia/Shanghai`

---

## 安全建议

### 1. 防火墙配置

```bash
# 只开放必要端口
sudo ufw allow 22/tcp   # SSH
sudo ufw allow 80/tcp   # HTTP
sudo ufw allow 443/tcp # HTTPS
sudo ufw enable
```

### 2. SSH 安全

- 禁用 root 登录
- 使用 SSH 密钥认证
- 更改默认 SSH 端口（可选）

### 3. 数据库安全

- 使用强密码
- 限制数据库用户权限
- 定期备份
- 启用 SSL 连接（生产环境推荐）

### 4. Redis 安全

- 设置强密码
- 只绑定 localhost（生产环境）
- 禁用危险命令（如 FLUSHALL）

### 5. 环境变量安全

- 使用 `.env` 文件存储敏感信息
- 设置文件权限：`chmod 600 apps/api/.env`
- 不要将 `.env` 文件提交到 Git

### 6. 定期更新

```bash
# 更新系统
sudo apt update && sudo apt upgrade -y

# 更新 Node.js 依赖
npm audit fix
npm update
```

---

## 性能优化

### 1. MySQL 优化

根据服务器配置调整 `/etc/mysql/mysql.conf.d/mysqld.cnf`：

```ini
[mysqld]
# 根据内存调整（推荐为总内存的 50-70%）
innodb_buffer_pool_size=2G

# 连接数
max_connections=200

# 查询缓存（MySQL 8.0 已移除，使用其他缓存方案）
```

### 2. Redis 优化

编辑 `/etc/redis/redis.conf`：

```conf
# 最大内存（根据服务器内存调整）
maxmemory 1gb
maxmemory-policy allkeys-lru
```

### 3. Nginx 优化

在 Nginx 配置中添加：

```nginx
# 启用 gzip 压缩
gzip on;
gzip_vary on;
gzip_min_length 1024;
gzip_types text/plain text/css text/xml text/javascript application/javascript application/json;

# 缓存静态文件
proxy_cache_path /var/cache/nginx levels=1:2 keys_zone=my_cache:10m max_size=1g inactive=60m;
```

### 4. PM2 集群模式

已在 `ecosystem.config.js` 中配置集群模式，充分利用多核 CPU。

---

## 联系和支持

如遇到问题，请检查：

1. **日志文件**:
   - PM2 日志：`pm2 logs`
   - Nginx 日志：`/var/log/nginx/`
   - 系统日志：`journalctl -u nginx`, `journalctl -u mysql`

2. **服务状态**:
   - `pm2 status`
   - `sudo systemctl status nginx`
   - `sudo systemctl status mysql`
   - `sudo systemctl status redis`

3. **网络连接**:
   - `netstat -tulpn`
   - `curl http://localhost:8081/health`
   - `curl http://localhost:8080`

---

## 更新日志

- **2025-11-23**: 初始版本，基于 MySQL、Redis、Next.js、NestJS 技术栈

---

**祝部署顺利！** 🎉

