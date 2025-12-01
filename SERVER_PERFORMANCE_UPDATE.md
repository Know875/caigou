# 服务器端性能优化更新指南

## 问题说明

性能优化代码在本地生效，但服务器端不生效，通常是因为：

1. **服务器代码没有更新**（没有 git pull）
2. **前端没有重新构建**（Next.js 需要重新 build）
3. **Next.js 缓存问题**（.next 目录使用了旧的构建）
4. **PM2 没有重启**（还在运行旧代码）
5. **浏览器缓存**（客户端缓存了旧的 JavaScript 文件）

## 完整更新步骤

### 方法1：使用部署脚本（推荐）

```bash
cd /root/caigou/caigou  # 或你的项目目录
bash deploy.sh
```

### 方法2：手动完整更新（确保所有步骤都执行）

```bash
# 1. 进入项目目录
cd /root/caigou/caigou  # 或你的项目目录

# 2. 拉取最新代码
git pull origin main

# 3. 检查代码是否更新成功
git log -1 --oneline
# 应该看到 "性能优化" 相关的提交

# 4. 检查新文件是否存在
ls -la apps/web/lib/api-cache.ts
ls -la apps/web/lib/api-wrapper.ts
# 这两个文件应该存在

# 5. 检查 next.config.js 是否更新
grep -n "compress" apps/web/next.config.js
# 应该看到 compress: true

# 6. 检查 quotes/page.tsx 是否更新
grep -n "批量获取询价单详情" apps/web/app/quotes/page.tsx
# 应该看到相关注释

# 7. ⚠️ 重要：清除 Next.js 缓存
cd apps/web
rm -rf .next
rm -rf node_modules/.cache

# 8. 重新安装依赖（如果需要）
cd ../..
npm install

# 9. ⚠️ 重要：重新构建前端项目
cd apps/web
npm run build
# 等待构建完成，应该看到 "Compiled successfully"

# 10. 检查构建是否成功
ls -la .next
# .next 目录应该存在且最近更新

# 11. 检查构建产物
ls -la .next/static/chunks
# 应该看到最新的 JavaScript 文件

# 12. 重启 PM2 服务
cd ../..
pm2 restart caigou-web
# 或者如果 PM2 应用名称不同
pm2 restart all

# 13. 检查 PM2 状态
pm2 status
pm2 logs caigou-web --lines 50
# 查看是否有错误
```

### 方法3：强制完全重建（如果上述方法无效）

```bash
cd /root/caigou/caigou

# 1. 停止所有服务
pm2 stop all

# 2. 清除所有缓存和构建产物
cd apps/web
rm -rf .next
rm -rf node_modules/.cache
rm -rf .next/cache
cd ../..

# 3. 拉取最新代码
git pull origin main

# 4. 重新安装依赖
npm install

# 5. 重新构建
cd apps/web
npm run build
cd ../..

# 6. 重启服务
pm2 restart all
pm2 save
```

## 验证更新是否成功

### 1. 检查代码版本

```bash
cd /root/caigou/caigou
git log -1 --oneline
# 应该看到最新的提交，包含 "性能优化"
```

### 2. 检查文件是否存在

```bash
# 检查新创建的文件
ls -la apps/web/lib/api-cache.ts
ls -la apps/web/lib/api-wrapper.ts

# 检查 next.config.js 是否包含优化配置
grep -A 5 "compress" apps/web/next.config.js
# 应该看到：
# compress: true,
# poweredByHeader: false,
# images: { ... }
```

### 3. 检查构建时间

```bash
cd apps/web
ls -l .next
# 检查 .next 目录的修改时间，应该是最近的时间
```

### 4. 检查 PM2 进程

```bash
pm2 status
# 检查 caigou-web 进程的状态和重启次数
pm2 info caigou-web
# 查看详细信息
```

### 5. 检查浏览器控制台

在浏览器中：
1. 打开开发者工具（F12）
2. 切换到 Network 标签
3. 刷新页面（Ctrl+F5 强制刷新，清除缓存）
4. 查看请求：
   - 应该看到请求数量减少
   - 应该看到响应时间更快
   - 应该看到有缓存命中（如果多次访问相同页面）

### 6. 检查 API 请求

在浏览器控制台中：
```javascript
// 检查是否有缓存功能
console.log(window.__apiCache || '缓存未启用');
```

## 常见问题排查

### 问题1：构建失败

```bash
cd apps/web
npm run build
# 查看错误信息
```

**可能原因**：
- 依赖未安装：运行 `npm install`
- TypeScript 错误：检查代码语法
- 内存不足：增加服务器内存或使用 `NODE_OPTIONS=--max-old-space-size=4096 npm run build`

### 问题2：PM2 重启失败

```bash
pm2 logs caigou-web --lines 100
# 查看错误日志
```

**可能原因**：
- 端口被占用：检查端口 8080
- 权限问题：检查文件权限
- 环境变量缺失：检查 .env 文件

### 问题3：浏览器仍然显示旧版本

**解决方法**：
1. **强制刷新**：Ctrl+F5（Windows）或 Cmd+Shift+R（Mac）
2. **清除浏览器缓存**：
   - Chrome: 设置 > 隐私和安全 > 清除浏览数据
   - 选择"缓存的图片和文件"
3. **使用无痕模式**：测试是否生效
4. **检查 Service Worker**：如果有，需要清除

### 问题4：性能优化不生效

**检查清单**：
1. ✅ 代码已更新（git pull）
2. ✅ 前端已重新构建（npm run build）
3. ✅ .next 目录已清除并重建
4. ✅ PM2 已重启
5. ✅ 浏览器缓存已清除
6. ✅ 检查 Network 标签，看请求数量是否减少

## 性能优化验证

### 1. 检查 API 请求数量

**优化前**：
- 报价页面：10+ 个请求（每个报价单独请求询价单详情）

**优化后**：
- 报价页面：2-3 个请求（批量获取询价单详情）

### 2. 检查响应时间

在浏览器 Network 标签中：
- 应该看到请求响应时间更快
- 应该看到有缓存命中（304 状态码或从缓存加载）

### 3. 检查页面加载速度

使用浏览器开发者工具的 Performance 标签：
- 首屏加载时间应该减少 30-50%
- 页面响应速度应该提升 50-70%

## 如果仍然不生效

### 1. 检查服务器时间

```bash
date
# 确保服务器时间正确
```

### 2. 检查文件权限

```bash
ls -la apps/web/lib/
# 确保文件权限正确
chmod 644 apps/web/lib/*.ts
```

### 3. 检查环境变量

```bash
cd apps/web
cat .env.local  # 如果有
# 确保 NODE_ENV=production
```

### 4. 完全重新部署

```bash
# 备份当前版本
cd /root/caigou
mv caigou caigou.backup.$(date +%Y%m%d)

# 重新克隆
git clone <your-repo-url> caigou
cd caigou

# 按照部署文档重新部署
bash deploy.sh
```

## 联系支持

如果以上方法都无法解决问题，请提供以下信息：

1. `git log -1 --oneline` 的输出
2. `pm2 status` 的输出
3. `pm2 logs caigou-web --lines 50` 的输出
4. `ls -la apps/web/.next` 的输出
5. 浏览器控制台的错误信息（如果有）

