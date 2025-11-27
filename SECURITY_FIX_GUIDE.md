# 🔒 安全修复指南

根据代码审计报告，以下是需要立即修复的安全问题。

---

## 🔴 P0 - 立即修复：移除硬编码敏感信息

### 问题描述

启动脚本（`start-all.ps1`, `start-api.ps1`）中包含硬编码的敏感信息：
- 数据库密码
- JWT 密钥
- OCR API 密钥
- 钉钉机器人 Token

### 修复步骤

#### 1. 创建 `.env.local` 文件（如果不存在）

在项目根目录创建 `apps/api/.env.local` 文件：

```bash
# 数据库 (密码中的 @ 需要编码为 %40)
DATABASE_URL=postgresql://postgres:YOUR_PASSWORD%40@localhost:5432/egg_purchase?schema=public&connection_limit=20&pool_timeout=10

# Redis
REDIS_URL=redis://localhost:6379
REDIS_HOST=localhost
REDIS_PORT=6379
REDIS_PASSWORD=your_redis_password

# JWT (生产环境必须使用强密钥，至少32个字符)
JWT_SECRET=your-super-secret-jwt-key-change-in-production-min-32-chars

# API
API_PORT=8081
NODE_ENV=development

# Web
NEXT_PUBLIC_API_URL=http://localhost:8081
WEB_URL=http://localhost:8080

# MinIO
S3_ENDPOINT=http://localhost:9000
MINIO_PUBLIC_ENDPOINT=http://localhost:9000
MINIO_ACCESS_KEY=minioadmin
MINIO_SECRET_KEY=minioadmin
MINIO_BUCKET=eggpurchase

# 钉钉机器人（可选）
DINGTALK_WEBHOOK_URL=https://oapi.dingtalk.com/robot/send?access_token=YOUR_TOKEN

# OCR配置（可选）
OCR_SPACE_API_KEY=your-ocr-space-api-key
XFYUN_APP_ID=your-xfyun-app-id
XFYUN_API_KEY=your-xfyun-api-key
XFYUN_API_SECRET=your-xfyun-api-secret
```

#### 2. 修改启动脚本使用环境变量

**修改 `start-all.ps1`**:

```powershell
# 在脚本开头添加：从 .env.local 加载环境变量
$envLocalPath = Join-Path $PSScriptRoot "apps\api\.env.local"
if (Test-Path $envLocalPath) {
    Get-Content $envLocalPath | ForEach-Object {
        if ($_ -match '^\s*([^#][^=]+)=(.*)$') {
            $key = $matches[1].Trim()
            $value = $matches[2].Trim()
            if ($key -and $value) {
                Set-Item -Path "env:$key" -Value $value
            }
        }
    }
    Write-Host "[OK] 已从 .env.local 加载环境变量" -ForegroundColor Green
} else {
    Write-Host "[WARN] 未找到 .env.local 文件，请创建并配置" -ForegroundColor Yellow
}

# 移除硬编码的环境变量设置
# ❌ 删除这些行：
# $env:DATABASE_URL = "postgresql://postgres:Qq123456%40@..."
# $env:JWT_SECRET = "dev-secret-key-change-in-production"
# $env:DINGTALK_WEBHOOK_URL = "https://oapi.dingtalk.com/robot/send?access_token=..."
# $env:OCR_SPACE_API_KEY = "K84724218688957"
# 等等...

# ✅ 改为从环境变量读取（如果未设置则使用默认值）
if (-not $env:DATABASE_URL) {
    Write-Host "[ERROR] DATABASE_URL 未设置，请配置 .env.local" -ForegroundColor Red
    exit 1
}

if (-not $env:JWT_SECRET) {
    Write-Host "[ERROR] JWT_SECRET 未设置，请配置 .env.local" -ForegroundColor Red
    exit 1
}

# 对于可选配置，使用默认值或警告
if (-not $env:OCR_SPACE_API_KEY) {
    Write-Host "[WARN] OCR_SPACE_API_KEY 未设置，OCR功能可能不可用" -ForegroundColor Yellow
}
```

**修改 `start-api.ps1`**:

类似地，移除硬编码的环境变量，改为从 `.env.local` 读取。

#### 3. 确保 `.env.local` 不被提交到仓库

检查 `.gitignore` 文件，确保包含：

```
# 环境变量文件
.env.local
.env
*.env.local
*.env
```

#### 4. 生产环境配置

**生产环境不要使用启动脚本**，应该：

1. 创建 `apps/api/.env` 文件（生产环境）
2. 使用 PM2 或 systemd 管理进程
3. 通过环境变量或配置文件传递敏感信息

---

## 🟡 P1 - 建议修复：生产环境日志配置

### 问题描述

代码中存在大量 `console.log` 调用，生产环境应该使用 NestJS Logger。

### 修复步骤

#### 1. 创建日志替换脚本（可选）

可以创建一个脚本批量替换 `console.log` 为 Logger，但建议手动替换关键部分。

#### 2. 关键文件优先修复

优先修复以下文件中的日志：
- `apps/api/src/main.ts` - 应用入口
- `apps/api/src/modules/auth/auth.service.ts` - 认证服务
- `apps/api/src/modules/rfq/rfq.service.ts` - 核心业务逻辑

**示例修复**:

```typescript
// ❌ 修复前
console.log('[AuthService] 用户验证成功:', { userId: user.id });

// ✅ 修复后
private readonly logger = new Logger(AuthService.name);
this.logger.log('用户验证成功', { userId: user.id });
```

#### 3. 配置生产环境日志

在 `main.ts` 中配置日志级别：

```typescript
const app = await NestFactory.create(AppModule, {
  logger: process.env.NODE_ENV === 'production' 
    ? ['error', 'warn']  // 生产环境只记录错误和警告
    : ['log', 'error', 'warn', 'debug', 'verbose'],  // 开发环境记录所有
});
```

#### 4. 配置 PM2 日志（生产环境）

在 `ecosystem.config.js` 中配置：

```javascript
module.exports = {
  apps: [{
    name: 'api',
    script: './dist/main.js',
    error_file: './logs/error.log',
    out_file: './logs/out.log',
    log_date_format: 'YYYY-MM-DD HH:mm:ss Z',
    merge_logs: true,
    // 生产环境日志级别
    log_type: 'json',
  }]
};
```

---

## 🟡 P1 - 建议修复：环境变量验证

### 问题描述

环境变量验证允许未知变量，生产环境应该严格验证。

### 修复步骤

修改 `apps/api/src/app.module.ts`:

```typescript
ConfigModule.forRoot({
  isGlobal: true,
  envFilePath: ['.env.local', '.env'],
  ignoreEnvFile: false,
  expandVariables: true,
  validate,
  validationOptions: {
    // ✅ 生产环境不允许未知变量
    allowUnknown: process.env.NODE_ENV !== 'production',
    abortEarly: false,
  },
}),
```

---

## 🟡 P2 - 可选优化：CORS 配置检查

### 问题描述

生产环境 CORS 配置依赖 `WEB_URL`，如果未配置会拒绝所有请求。

### 修复步骤

修改 `apps/api/src/main.ts`:

```typescript
if (isProduction) {
  const allowedOrigins = process.env.WEB_URL 
    ? [process.env.WEB_URL]
    : [];
  
  // ✅ 生产环境强制检查 WEB_URL
  if (allowedOrigins.length === 0) {
    throw new Error('生产环境必须配置 WEB_URL 环境变量');
  }
  
  app.enableCors({
    origin: (origin, callback) => {
      // ... 现有代码
    },
    // ... 其他配置
  });
}
```

---

## ✅ 验证修复

### 1. 检查敏感信息

```bash
# 搜索硬编码的敏感信息
grep -r "Qq123456" .
grep -r "dev-secret-key-change-in-production" .
grep -r "K84724218688957" .
grep -r "ba1429aadd54e57f50e22b2c6bb3a9569a82c7d1a8a59f62082bafbd63c08d50" .
```

如果找到，说明还有硬编码的敏感信息。

### 2. 检查环境变量

```bash
# 确保 .env.local 存在
ls -la apps/api/.env.local

# 确保 .gitignore 包含 .env.local
grep "\.env" .gitignore
```

### 3. 测试启动

```bash
# 测试启动脚本
.\start-all.ps1

# 检查环境变量是否正确加载
# 应该看到从 .env.local 加载的提示
```

---

## 📋 修复检查清单

- [ ] ✅ 创建 `.env.local` 文件
- [ ] ✅ 移除 `start-all.ps1` 中的硬编码敏感信息
- [ ] ✅ 移除 `start-api.ps1` 中的硬编码敏感信息
- [ ] ✅ 修改启动脚本从 `.env.local` 读取环境变量
- [ ] ✅ 确保 `.gitignore` 包含 `.env.local`
- [ ] ✅ 验证没有敏感信息提交到仓库
- [ ] ⚠️ （可选）替换关键文件的 `console.log` 为 Logger
- [ ] ⚠️ （可选）配置生产环境日志级别
- [ ] ⚠️ （可选）修改环境变量验证配置
- [ ] ⚠️ （可选）添加 CORS 配置检查

---

## 🚀 生产环境部署

### 1. 创建生产环境配置文件

在服务器上创建 `apps/api/.env`:

```bash
# 生产环境配置
DATABASE_URL=postgresql://user:password@localhost:5432/egg_purchase?schema=public
REDIS_HOST=localhost
REDIS_PORT=6379
REDIS_PASSWORD=strong_redis_password
JWT_SECRET=your-production-jwt-secret-min-32-chars
NODE_ENV=production
API_PORT=8081
WEB_URL=https://your-domain.com
NEXT_PUBLIC_API_URL=https://your-domain.com/api
# ... 其他配置
```

### 2. 设置文件权限

```bash
chmod 600 apps/api/.env
```

### 3. 使用 PM2 启动

```bash
pm2 start ecosystem.config.js
```

---

## 📚 参考

- [CODE_AUDIT_REPORT.md](./CODE_AUDIT_REPORT.md) - 完整审计报告
- [DEPLOYMENT_CHECKLIST.md](./DEPLOYMENT_CHECKLIST.md) - 部署检查清单
- [env.local.example](./env.local.example) - 环境变量示例

---

**最后更新**: 2025-01-21

