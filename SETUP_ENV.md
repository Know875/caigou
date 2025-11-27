# 🔧 环境变量配置指南

## 📋 快速开始

### 1. 创建 `.env.local` 文件

在 `apps/api/` 目录下创建 `.env.local` 文件，复制以下内容并根据实际情况修改：

```bash
# 本地开发环境配置
# 注意：此文件包含敏感信息，不要提交到代码仓库

# 数据库 (密码中的 @ 需要编码为 %40，端口使用 5432)
DATABASE_URL=postgresql://postgres:YOUR_PASSWORD%40@localhost:5432/egg_purchase?schema=public&connection_limit=20&pool_timeout=10

# Redis
REDIS_URL=redis://localhost:6379
REDIS_HOST=localhost
REDIS_PORT=6379
REDIS_PASSWORD=

# JWT (生产环境必须使用强密钥，至少32个字符)
JWT_SECRET=your-super-secret-jwt-key-change-in-production-min-32-chars

# API
API_PORT=8081
NODE_ENV=development
TZ=Asia/Shanghai
CRON_TZ=Asia/Shanghai

# Web
NEXT_PUBLIC_API_URL=http://localhost:8081
WEB_URL=http://localhost:8080

# MinIO (可选，如果不需要文件存储可以暂时不配置)
MINIO_ENDPOINT=localhost
MINIO_PORT=9000
MINIO_ACCESS_KEY=minioadmin
MINIO_SECRET_KEY=minioadmin
S3_ENDPOINT=http://localhost:9000
MINIO_PUBLIC_ENDPOINT=http://localhost:9000
MINIO_BUCKET=eggpurchase

# 钉钉机器人（可选）
DINGTALK_WEBHOOK_URL=https://oapi.dingtalk.com/robot/send?access_token=YOUR_TOKEN

# OCR配置（可选）
OCR_SPACE_API_KEY=your-ocr-space-api-key
XFYUN_APP_ID=your-xfyun-app-id
XFYUN_API_KEY=your-xfyun-api-key
XFYUN_API_SECRET=your-xfyun-api-secret
```

### 2. 修改配置

**必需修改的配置**：

1. **DATABASE_URL**: 替换 `YOUR_PASSWORD` 为你的 PostgreSQL 密码
   - 如果密码包含 `@` 符号，需要编码为 `%40`
   - 例如：密码是 `Qq123456@`，则写为 `Qq123456%40`

2. **JWT_SECRET**: 替换为至少 32 个字符的强密钥
   - 开发环境可以使用：`dev-secret-key-change-in-production-min-32-chars`
   - 生产环境必须使用强密钥

**可选配置**（如果不需要可以删除或留空）：

- `REDIS_PASSWORD`: Redis 密码（如果 Redis 设置了密码）
- `DINGTALK_WEBHOOK_URL`: 钉钉机器人 Webhook URL
- `OCR_SPACE_API_KEY`: OCR Space API 密钥
- `XFYUN_*`: 讯飞 OCR 配置

### 3. 保存文件

保存文件为：`apps/api/.env.local`

**注意**：
- 文件名必须是 `.env.local`（注意前面的点）
- 文件位置必须在 `apps/api/` 目录下
- 此文件已被 `.gitignore` 忽略，不会提交到代码仓库

---

## 🚀 使用启动脚本

配置完成后，使用以下命令启动服务：

```powershell
# 启动所有服务
.\start-all.ps1

# 或只启动 API 服务
.\start-api.ps1
```

启动脚本会自动：
1. 从 `apps/api/.env.local` 加载环境变量
2. 验证必需的环境变量是否存在
3. 如果缺少必需变量，会显示错误并退出
4. 如果缺少可选变量，会显示警告但继续启动

---

## ✅ 验证配置

启动脚本会显示环境变量加载状态：

```
[OK] 已从 apps/api/.env.local 加载环境变量
[OK] DATABASE_URL: 已设置
[OK] JWT_SECRET: 已设置
[OK] OCR_SPACE_API_KEY: 已设置
[WARN] DINGTALK_WEBHOOK_URL 未设置，钉钉通知功能可能不可用
```

如果看到错误：

```
[ERROR] 缺少必需的环境变量: DATABASE_URL, JWT_SECRET
   请创建 apps/api/.env.local 文件并配置这些变量
```

说明配置文件有问题，请检查：
1. 文件路径是否正确：`apps/api/.env.local`
2. 文件格式是否正确：`KEY=VALUE` 格式
3. 必需变量是否已配置

---

## 📝 配置说明

### 必需配置

| 变量名 | 说明 | 示例 |
|--------|------|------|
| `DATABASE_URL` | PostgreSQL 连接字符串 | `postgresql://postgres:password@localhost:5432/egg_purchase` |
| `JWT_SECRET` | JWT 密钥（至少32字符） | `your-super-secret-jwt-key-change-in-production-min-32-chars` |

### 常用配置

| 变量名 | 说明 | 默认值 |
|--------|------|--------|
| `API_PORT` | API 服务端口 | `8081` |
| `NODE_ENV` | 环境模式 | `development` |
| `REDIS_URL` | Redis 连接 URL | `redis://localhost:6379` |
| `REDIS_HOST` | Redis 主机 | `localhost` |
| `REDIS_PORT` | Redis 端口 | `6379` |
| `REDIS_PASSWORD` | Redis 密码 | 无 |
| `S3_ENDPOINT` | MinIO 内部地址 | `http://localhost:9000` |
| `MINIO_PUBLIC_ENDPOINT` | MinIO 公共地址 | `http://localhost:9000` |
| `MINIO_ACCESS_KEY` | MinIO 访问密钥 | `minioadmin` |
| `MINIO_SECRET_KEY` | MinIO 密钥 | `minioadmin` |
| `WEB_URL` | Web 前端地址 | `http://localhost:8080` |
| `NEXT_PUBLIC_API_URL` | 前端 API 地址 | `http://localhost:8081` |

### 可选配置

| 变量名 | 说明 |
|--------|------|
| `DINGTALK_WEBHOOK_URL` | 钉钉机器人 Webhook URL |
| `OCR_SPACE_API_KEY` | OCR Space API 密钥 |
| `XFYUN_APP_ID` | 讯飞 OCR App ID |
| `XFYUN_API_KEY` | 讯飞 OCR API Key |
| `XFYUN_API_SECRET` | 讯飞 OCR API Secret |

---

## 🔒 安全提示

1. ✅ **不要提交 `.env.local` 文件到代码仓库**
   - 此文件已被 `.gitignore` 忽略
   - 如果意外提交，请立即更改所有密码和密钥

2. ✅ **生产环境使用强密码**
   - JWT_SECRET 至少 32 个字符
   - 使用随机生成的强密码
   - 不要使用默认值

3. ✅ **定期更换密钥**
   - 定期更换 JWT_SECRET
   - 定期更换数据库密码
   - 定期更换 Redis 密码

4. ✅ **限制文件权限**
   - Linux/Mac: `chmod 600 apps/api/.env.local`
   - Windows: 确保只有当前用户可访问

---

## 🆘 常见问题

### Q: 启动脚本提示找不到 `.env.local` 文件？

A: 检查文件路径和文件名：
- 文件必须在 `apps/api/.env.local`
- 文件名必须是 `.env.local`（注意前面的点）
- 确保文件已保存

### Q: 启动脚本提示缺少必需的环境变量？

A: 检查 `.env.local` 文件：
- 确保 `DATABASE_URL` 和 `JWT_SECRET` 已配置
- 检查格式是否正确：`KEY=VALUE`（等号两边不要有空格）
- 确保没有注释掉这些行

### Q: 数据库连接失败？

A: 检查 `DATABASE_URL`：
- 确保密码中的 `@` 已编码为 `%40`
- 确保数据库服务正在运行
- 确保数据库名称和用户正确

### Q: Redis 连接失败？

A: 检查 Redis 配置：
- 如果 Redis 设置了密码，需要配置 `REDIS_PASSWORD`
- 确保 Redis 服务正在运行
- 检查 `REDIS_HOST` 和 `REDIS_PORT` 是否正确

---

## 📚 参考

- [env.local.example](../env.local.example) - 环境变量示例文件
- [CODE_AUDIT_REPORT.md](../CODE_AUDIT_REPORT.md) - 代码审计报告
- [SECURITY_FIX_GUIDE.md](../SECURITY_FIX_GUIDE.md) - 安全修复指南

---

**最后更新**: 2025-01-21

