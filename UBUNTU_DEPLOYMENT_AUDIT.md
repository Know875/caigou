# 🔍 Ubuntu 服务器部署代码审查报告

**项目名称**: 模型玩具采购协同系统  
**审查日期**: 2025-01-21  
**审查范围**: 全项目代码审查  
**目标平台**: Ubuntu 20.04+ / Debian 10+  
**审查状态**: ✅ 已完成

---

## 📋 执行摘要

本次审查针对 Ubuntu 服务器部署进行了全面的代码检查，修复了关键问题，并创建了必要的部署脚本和配置文件。项目已准备好部署到 Ubuntu 服务器。

### 总体评分
- **安全性**: ✅ 良好（已修复关键安全问题）
- **代码质量**: ✅ 良好（已优化日志和错误处理）
- **配置管理**: ✅ 良好（环境变量配置完善）
- **部署准备**: ✅ 优秀（已创建完整部署脚本和配置）

---

## ✅ 已修复的问题

### 1. 环境变量验证配置 ✅

**问题**: 生产环境允许未知环境变量，存在安全风险

**修复**: 
- 修改 `apps/api/src/app.module.ts`
- 生产环境 `allowUnknown: false`，开发环境 `allowUnknown: true`

**代码变更**:
```typescript
validationOptions: {
  allowUnknown: process.env.NODE_ENV !== 'production', // 生产环境不允许未知变量
  abortEarly: false,
}
```

---

### 2. CORS 配置强制检查 ✅

**问题**: 生产环境未配置 `WEB_URL` 时只警告，不阻止启动

**修复**:
- 修改 `apps/api/src/main.ts`
- 生产环境未配置 `WEB_URL` 时抛出错误，阻止启动

**代码变更**:
```typescript
if (allowedOrigins.length === 0) {
  const error = new Error('生产环境必须配置 WEB_URL 环境变量');
  logger.error(error.message);
  throw error;
}
```

---

### 3. 日志系统优化 ✅

**问题**: 使用 `console.log` 而非 NestJS Logger，生产环境日志不规范

**修复**:
- 修改 `apps/api/src/main.ts`
- 使用 NestJS Logger 替代 `console.log`
- 生产环境仅记录关键日志，开发环境记录详细日志
- 请求日志中间件仅在开发环境启用

**代码变更**:
```typescript
const logger = new Logger('Bootstrap');
// 使用 logger.log(), logger.error(), logger.warn() 替代 console.log()
```

---

### 4. 环境变量示例文件修复 ✅

**问题**: `env.local.example` 中数据库配置为 PostgreSQL，实际使用 MySQL

**修复**:
- 修改 `env.local.example`
- 更新为 MySQL 连接字符串格式

**变更前**:
```
DATABASE_URL=postgresql://postgres:YOUR_PASSWORD%40@localhost:5432/egg_purchase?schema=public
```

**变更后**:
```
DATABASE_URL=mysql://egg_purchase_user:YOUR_PASSWORD@localhost:3306/egg_purchase?connection_limit=20&pool_timeout=10
```

---

### 5. PM2 配置文件创建 ✅

**问题**: 缺少 PM2 配置文件

**修复**:
- 创建 `ecosystem.config.js`
- 配置 API、Worker、Web 三个服务
- 配置日志、自动重启、内存限制等

**配置内容**:
- API 服务: 2 个实例，集群模式
- Worker 服务: 1 个实例，fork 模式
- Web 服务: 2 个实例，集群模式
- 日志目录: `./logs/`
- 内存限制: 1GB

---

### 6. Ubuntu 部署脚本创建 ✅

**问题**: 只有 Windows PowerShell 脚本，缺少 Linux 部署脚本

**修复**:
- 创建 `scripts/deploy-ubuntu.sh`
- 包含完整的部署流程：
  - 环境检查（Node.js, MySQL, Redis, PM2）
  - 环境变量验证
  - 依赖安装
  - Prisma Client 生成
  - 数据库迁移
  - 项目构建
  - PM2 启动

---

## 📊 代码统计

- **总文件数**: ~200+ 文件
- **TypeScript 文件**: ~150+ 文件
- **console.log 调用**: 53 处（已优化关键部分）
- **Logger 使用**: 主要模块已使用
- **环境变量**: 15+ 个配置项
- **API 端点**: 50+ 个端点

---

## 🔒 安全检查清单

### ✅ 已修复的安全问题

- [x] **环境变量验证**: 生产环境不允许未知变量
- [x] **CORS 配置**: 生产环境强制检查 WEB_URL
- [x] **日志系统**: 使用 NestJS Logger，生产环境不记录敏感信息
- [x] **敏感信息**: 已从代码中移除，使用环境变量

### ✅ 安全最佳实践

- [x] **SQL 注入防护**: 使用 Prisma ORM，参数化查询
- [x] **认证授权**: JWT + Passport，RBAC 权限控制
- [x] **输入验证**: class-validator 进行 DTO 验证
- [x] **错误处理**: 全局异常过滤器，生产环境不暴露详细错误
- [x] **Swagger 文档**: 生产环境已禁用

---

## 🚀 部署前检查清单

### 环境要求

- [x] Node.js >= 18.0.0
- [x] MySQL >= 8.0
- [x] Redis >= 6.0
- [x] PM2 (自动安装)
- [x] Nginx (可选，用于反向代理)

### 必需配置

#### 环境变量 (`apps/api/.env`)

```bash
# 数据库 (MySQL)
DATABASE_URL=mysql://egg_purchase_user:YOUR_PASSWORD@localhost:3306/egg_purchase?connection_limit=20&pool_timeout=10

# Redis
REDIS_HOST=localhost
REDIS_PORT=6379
REDIS_PASSWORD=your_redis_password
# 或使用 REDIS_URL
# REDIS_URL=redis://:your_redis_password@localhost:6379

# JWT (必须至少32个字符)
JWT_SECRET=your-super-secret-jwt-key-change-in-production-min-32-chars-random-string

# API
API_PORT=8081
NODE_ENV=production
TZ=Asia/Shanghai
CRON_TZ=Asia/Shanghai

# Web 前端 (生产环境必需)
WEB_URL=https://your-domain.com
NEXT_PUBLIC_API_URL=https://your-domain.com/api
```

#### 数据库配置

```sql
CREATE DATABASE egg_purchase CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
CREATE USER 'egg_purchase_user'@'localhost' IDENTIFIED BY 'your_strong_password';
GRANT ALL PRIVILEGES ON egg_purchase.* TO 'egg_purchase_user'@'localhost';
FLUSH PRIVILEGES;
```

#### Redis 配置

编辑 `/etc/redis/redis.conf`:
```conf
requirepass your_redis_password
bind 127.0.0.1
protected-mode yes
```

### 部署步骤

1. **上传代码到服务器**
   ```bash
   # 使用 Git
   git clone <your-repo-url> /var/www/egg-purchase
   cd /var/www/egg-purchase
   
   # 或使用 scp
   # scp -r /path/to/local/code user@server:/var/www/egg-purchase/
   ```

2. **配置环境变量**
   ```bash
   cp env.local.example apps/api/.env
   nano apps/api/.env  # 编辑配置
   chmod 600 apps/api/.env  # 设置权限
   ```

3. **运行部署脚本**
   ```bash
   bash scripts/deploy-ubuntu.sh
   ```

4. **或手动部署**
   ```bash
   # 安装依赖
   npm install
   
   # 生成 Prisma Client
   npm run db:generate
   
   # 运行数据库迁移
   npm run db:migrate
   
   # 构建项目
   npm run build
   
   # 启动服务
   pm2 start ecosystem.config.js
   pm2 save
   pm2 startup  # 设置开机自启
   ```

5. **配置 Nginx (可选)**
   ```bash
   sudo nano /etc/nginx/sites-available/egg-purchase
   # 参考 DEPLOYMENT.md 中的 Nginx 配置
   sudo ln -s /etc/nginx/sites-available/egg-purchase /etc/nginx/sites-enabled/
   sudo nginx -t
   sudo systemctl reload nginx
   ```

---

## 📝 部署后验证

### 1. 检查服务状态

```bash
pm2 status
pm2 logs
```

### 2. 检查 API 健康状态

```bash
curl http://localhost:8081/api/health
```

### 3. 检查 Web 前端

```bash
curl http://localhost:8080
```

### 4. 检查数据库连接

```bash
mysql -u egg_purchase_user -p egg_purchase -e "SHOW TABLES;"
```

### 5. 检查 Redis 连接

```bash
redis-cli -a your_redis_password ping
# 应返回 PONG
```

---

## ⚠️ 已知问题和注意事项

### 1. console.log 使用

**状态**: 部分修复

**说明**: 
- 主要入口文件 (`main.ts`) 已使用 Logger
- 其他模块中仍有 53 处 `console.log` 调用
- 建议逐步替换为 Logger（非阻塞性问题）

**优先级**: 🟡 P2 - 可选优化

### 2. 数据库迁移

**注意**: 
- 首次部署需要运行 `npm run db:migrate`
- 确保数据库用户有足够权限
- 建议先备份数据库

### 3. 文件权限

**注意**:
- `.env` 文件权限应设置为 `600` (仅所有者可读写)
- 日志目录需要写入权限
- 确保 PM2 有权限访问项目目录

### 4. 防火墙配置

**建议**:
```bash
sudo ufw allow 22/tcp   # SSH
sudo ufw allow 80/tcp   # HTTP
sudo ufw allow 443/tcp  # HTTPS
sudo ufw enable
```

### 5. SSL 证书

**建议**: 
- 使用 Let's Encrypt 配置 HTTPS
- 参考 `DEPLOYMENT.md` 中的 SSL 配置部分

---

## 🔧 故障排查

### 问题 1: 服务启动失败

**检查**:
```bash
pm2 logs
pm2 logs egg-purchase-api --lines 100
```

**常见原因**:
- 环境变量未配置
- 数据库连接失败
- Redis 连接失败
- 端口被占用

### 问题 2: 数据库连接失败

**检查**:
```bash
mysql -u egg_purchase_user -p -h localhost
```

**常见原因**:
- 数据库用户不存在或密码错误
- 数据库未创建
- MySQL 服务未运行
- 防火墙阻止连接

### 问题 3: Redis 连接失败

**检查**:
```bash
redis-cli -a your_password ping
sudo systemctl status redis
```

**常见原因**:
- Redis 密码配置错误
- Redis 服务未运行
- Redis 绑定地址配置错误

### 问题 4: CORS 错误

**检查**:
- 确认 `WEB_URL` 环境变量已设置
- 确认 `NEXT_PUBLIC_API_URL` 配置正确
- 检查浏览器控制台错误信息

---

## 📚 相关文档

- [DEPLOYMENT.md](./DEPLOYMENT.md) - 详细部署指南
- [CODE_AUDIT_REPORT.md](./CODE_AUDIT_REPORT.md) - 代码审计报告
- [env.local.example](./env.local.example) - 环境变量示例
- [README.md](./README.md) - 项目说明

---

## 🎯 总结

### ✅ 优点

1. **安全性良好**: 已修复关键安全问题，使用环境变量管理敏感信息
2. **代码质量高**: TypeScript 类型安全，模块化设计
3. **部署准备完善**: 已创建部署脚本和配置文件
4. **文档齐全**: 提供详细的部署指南和故障排查

### ⚠️ 建议

1. **逐步替换 console.log**: 将剩余的 `console.log` 替换为 Logger
2. **配置监控**: 建议配置 PM2 Plus 或类似监控服务
3. **定期备份**: 设置数据库和文件的定期备份策略
4. **性能优化**: 根据实际负载调整 PM2 实例数和 MySQL 配置

### 🚀 部署建议

**可以部署，建议按以下顺序进行**:

1. ✅ 修复关键安全问题（已完成）
2. ✅ 创建部署脚本和配置（已完成）
3. ⏭️ 在测试环境验证部署流程
4. ⏭️ 配置监控和日志
5. ⏭️ 设置备份策略
6. ⏭️ 部署到生产环境

---

**审查完成时间**: 2025-01-21  
**审查状态**: ✅ 完成  
**建议**: 可以部署到 Ubuntu 服务器

---

## 📞 支持

如遇到问题，请检查：

1. **日志文件**: `./logs/` 目录
2. **PM2 日志**: `pm2 logs`
3. **系统日志**: `journalctl -u nginx`, `journalctl -u mysql`
4. **部署文档**: `DEPLOYMENT.md`

