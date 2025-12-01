# 验证性能优化是否生效

## 快速验证步骤

### 1. 解决 Git 冲突（必须先执行）

```bash
cd /root/caigou/caigou

# 删除冲突文件
rm -f deploy.sh
rm -f fix-rfq-1764574989800-fudai.sql

# 重新拉取代码
git pull origin main
```

### 2. 验证代码是否更新

```bash
# 检查新文件是否存在
ls -la apps/web/lib/api-cache.ts
ls -la apps/web/lib/api-wrapper.ts

# 检查 next.config.js 是否包含优化配置
grep -A 3 "compress" apps/web/next.config.js
# 应该看到：compress: true,

# 检查 quotes/page.tsx 是否包含批量获取逻辑
grep -n "批量获取询价单详情" apps/web/app/quotes/page.tsx
# 应该看到相关注释
```

### 3. 验证构建产物

```bash
cd apps/web

# 检查构建时间
ls -l .next
# 修改时间应该是刚才构建的时间

# 检查构建产物中是否包含新代码
grep -r "api-cache" .next/server 2>/dev/null | head -5
# 应该能找到相关引用
```

### 4. 在浏览器中验证

#### 方法1：检查 Network 请求数量

1. 打开浏览器开发者工具（F12）
2. 切换到 **Network** 标签
3. **清除缓存**（Ctrl+Shift+Delete，或右键刷新按钮选择"清空缓存并硬性重新加载"）
4. 访问报价页面（`/quotes`）
5. 观察请求：
   - **优化前**：每个报价都会单独请求询价单详情（10个报价 = 10+个请求）
   - **优化后**：批量获取询价单详情（10个报价 = 2-3个请求）

#### 方法2：检查控制台

在浏览器控制台中输入：

```javascript
// 检查 API 缓存是否启用
// 如果看到缓存相关的日志，说明缓存功能已启用
console.log('检查 API 请求...');
```

然后刷新页面，观察 Network 标签：
- 相同 URL 的请求应该被缓存（第二次请求会显示 "from cache" 或 304 状态码）

#### 方法3：性能对比

**优化前**：
- 报价页面加载：10+ 个 API 请求
- 页面响应时间：较慢

**优化后**：
- 报价页面加载：2-3 个 API 请求
- 页面响应时间：明显更快

### 5. 检查 PM2 日志

```bash
# 查看最近的日志
pm2 logs caigou-web --lines 50

# 应该没有错误信息
# 如果看到错误，说明有问题
```

### 6. 验证 Next.js 配置优化

```bash
cd apps/web

# 检查 next.config.js
cat next.config.js | grep -A 10 "compress"
# 应该看到：
# compress: true,
# poweredByHeader: false,
# images: { ... }
```

## 如果性能优化不生效

### 检查清单

- [ ] Git 代码已更新（`git log -1` 显示最新提交）
- [ ] 新文件存在（`api-cache.ts`, `api-wrapper.ts`）
- [ ] Next.js 配置已更新（`next.config.js` 包含优化配置）
- [ ] 前端已重新构建（`.next` 目录时间是最新的）
- [ ] PM2 已重启（`pm2 status` 显示重启次数增加）
- [ ] 浏览器缓存已清除（强制刷新 Ctrl+F5）

### 如果仍然不生效

1. **完全清除并重建**：

```bash
cd /root/caigou/caigou/apps/web

# 完全清除
rm -rf .next
rm -rf node_modules/.cache
rm -rf .next/cache

# 重新构建
npm run build

# 重启
cd ../..
pm2 restart all
```

2. **检查是否有错误**：

```bash
pm2 logs caigou-web --err --lines 100
```

3. **验证文件内容**：

```bash
# 检查 api-cache.ts 内容
head -20 apps/web/lib/api-cache.ts

# 检查 api.ts 是否导入缓存
grep "api-cache" apps/web/lib/api.ts
```

## 预期效果

优化成功后，你应该看到：

1. **API 请求数量减少 40-60%**
2. **页面加载速度提升 30-50%**
3. **相同请求会被缓存**（Network 标签显示 "from cache"）
4. **用户体验明显改善**（减少卡顿）

## 测试场景

### 场景1：报价页面

1. 访问 `/quotes` 页面
2. 打开 Network 标签
3. 刷新页面
4. 观察请求数量：应该只有 2-3 个主要请求（而不是 10+ 个）

### 场景2：询价单详情页

1. 访问 `/rfqs/[id]` 页面
2. 打开 Network 标签
3. 刷新页面
4. 再次刷新页面（不关闭标签）
5. 第二次刷新时，部分请求应该显示 "from cache"

### 场景3：多次访问相同页面

1. 访问任意页面
2. 关闭标签
3. 重新打开相同页面
4. 部分静态资源应该从缓存加载

