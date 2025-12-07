# 401 Unauthorized 错误分析报告

## 🔍 错误现象

从日志可以看到，系统持续出现 401 Unauthorized 错误：

```
路径: /api/notifications, /api/rfqs, /api/shipments, /api/after-sales
方法: GET
状态码: 401
消息: Unauthorized
```

**时间模式**：
- 每 5 秒出现一次（3:16:33, 3:16:38, 3:16:43...）
- 持续发生，说明有用户在尝试访问但认证失败

---

## 🎯 可能的原因

### 1. JWT Token 过期（最可能）

**原因**：
- JWT token 默认过期时间：**7 天**
- 用户 7 天前登录，token 已过期
- 前端仍在尝试使用过期的 token

**验证方法**：
```bash
# 检查 JWT 配置
grep -r "JWT_EXPIRES_IN\|expiresIn" apps/api/src
```

**解决方案**：
- 实现 token 刷新机制
- 增加 token 过期时间（不推荐，安全风险）
- 前端检测到 401 后自动跳转登录页（已实现）

---

### 2. JWT_SECRET 不一致

**原因**：
- 服务器重启后 JWT_SECRET 改变
- 不同实例使用不同的 JWT_SECRET
- 环境变量配置错误

**验证方法**：
```bash
# 检查所有实例的 JWT_SECRET 是否一致
pm2 env 0 | grep JWT_SECRET
pm2 env 1 | grep JWT_SECRET
```

**解决方案**：
- 确保所有实例使用相同的 JWT_SECRET
- 使用环境变量文件统一管理

---

### 3. 用户状态问题

**原因**：
- 用户被暂停（`status: SUSPENDED`）
- 用户被删除
- 用户状态为 `PENDING` 或 `INACTIVE`

**验证方法**：
```sql
-- 检查最近登录的用户状态
SELECT id, email, status, updatedAt 
FROM users 
WHERE updatedAt > DATE_SUB(NOW(), INTERVAL 1 DAY)
ORDER BY updatedAt DESC;
```

**解决方案**：
- 检查用户状态
- 恢复被暂停的用户

---

### 4. Token 格式错误

**原因**：
- 前端没有正确发送 Authorization header
- Token 被截断或损坏
- localStorage 中的 token 格式错误

**验证方法**：
- 检查浏览器 Network 面板，查看请求头
- 检查 localStorage 中的 token

---

## 🔧 诊断步骤

### 步骤 1：检查 JWT 配置

```bash
# 在服务器上检查
cd /root/caigou/caigou/apps/api
cat .env | grep JWT
```

**应该看到**：
```
JWT_SECRET=your-secret-key
JWT_EXPIRES_IN=7d  # 或未设置（默认 7d）
```

---

### 步骤 2：检查用户状态

```sql
-- 连接数据库
mysql -u your_user -p your_database

-- 检查最近活跃的用户
SELECT id, email, status, createdAt, updatedAt 
FROM users 
ORDER BY updatedAt DESC 
LIMIT 10;
```

---

### 步骤 3：检查前端 token

在浏览器控制台执行：
```javascript
// 检查 token 是否存在
localStorage.getItem('token')

// 检查 token 是否过期（需要解码 JWT）
// 可以使用 https://jwt.io 解码 token
```

---

### 步骤 4：检查 API 请求头

在浏览器 Network 面板中：
1. 打开开发者工具（F12）
2. 切换到 Network 标签
3. 查看失败的请求
4. 检查 Request Headers 中是否有 `Authorization: Bearer <token>`

---

## 🛠️ 解决方案

### 方案 1：优化错误处理（减少日志噪音）

**问题**：401 错误是正常的（token 过期），但日志太多

**解决**：在异常过滤器中减少 401 错误的日志级别

```typescript
// apps/api/src/common/filters/all-exceptions.filter.ts
if (exception.getStatus() === 401) {
  // 401 错误是正常的（token 过期），只记录警告，不记录错误
  this.logger.warn(`Unauthorized: ${request.url}`);
  return;
}
```

---

### 方案 2：实现 Token 刷新机制（推荐）

**问题**：用户需要每 7 天重新登录

**解决**：实现 refresh token 机制

```typescript
// 1. 登录时返回 access_token 和 refresh_token
// 2. access_token 短期有效（1 小时）
// 3. refresh_token 长期有效（30 天）
// 4. 前端检测到 401 时，自动使用 refresh_token 刷新 access_token
```

---

### 方案 3：增加 Token 过期时间（不推荐）

**问题**：用户频繁需要重新登录

**解决**：增加 JWT 过期时间

```typescript
// apps/api/src/modules/auth/auth.module.ts
expiresIn: configService.get<string>('JWT_EXPIRES_IN') || '30d', // 从 7d 改为 30d
```

**风险**：
- 安全风险：token 泄露后有效期更长
- 用户状态变更无法立即生效

---

### 方案 4：检查并修复用户状态

如果用户被错误地暂停：

```sql
-- 恢复被暂停的用户
UPDATE users 
SET status = 'ACTIVE' 
WHERE status = 'SUSPENDED' 
AND email = 'user@example.com';
```

---

## 📊 当前系统行为

### 前端处理（已实现）

```typescript
// apps/web/lib/api.ts
if (error.response?.status === 401) {
  localStorage.removeItem('token');
  window.location.href = '/login';
}
```

**行为**：
- ✅ 检测到 401 后自动清除 token
- ✅ 自动跳转到登录页
- ✅ 用户需要重新登录

### 后端处理

```typescript
// apps/api/src/modules/auth/strategies/jwt.strategy.ts
async validate(payload: any) {
  const user = await this.prisma.user.findUnique({...});
  return user; // 如果用户不存在或状态异常，返回 null，导致 401
}
```

**行为**：
- ✅ 验证 JWT token 签名
- ✅ 检查 token 是否过期
- ✅ 验证用户是否存在
- ✅ 返回用户信息或 null（null 导致 401）

---

## 🎯 推荐操作

### 立即操作

1. **检查 JWT_SECRET 一致性**
   ```bash
   # 确保所有 PM2 实例使用相同的 JWT_SECRET
   pm2 restart caigou-api --update-env
   ```

2. **优化错误日志**（减少噪音）
   - 将 401 错误从 ERROR 降级为 WARN
   - 这些错误是正常的（token 过期）

3. **检查用户状态**
   - 确认是否有用户被错误暂停
   - 恢复被暂停的用户

### 长期优化

1. **实现 Token 刷新机制**
   - 提升用户体验
   - 减少重新登录频率

2. **添加 Token 过期提醒**
   - 在 token 即将过期时提醒用户
   - 自动刷新 token

---

## 📝 总结

**这些 401 错误是正常的系统行为**：
- ✅ 用户 token 过期（7 天）
- ✅ 前端会自动处理（清除 token，跳转登录）
- ✅ 用户需要重新登录

**不需要担心**，除非：
- ❌ 错误频率异常高（可能是攻击）
- ❌ 用户无法正常登录
- ❌ JWT_SECRET 配置不一致

**建议**：
1. 优化日志级别（401 改为 WARN）
2. 实现 token 刷新机制（长期优化）

---

**最后更新**: 2025-12-07

