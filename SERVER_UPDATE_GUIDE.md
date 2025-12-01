# 服务器更新指南 - 返回首页按钮

## 问题说明

返回首页按钮在服务器上没有生效，通常是因为：
1. 服务器代码没有更新
2. 前端没有重新构建
3. Next.js 缓存问题
4. 浏览器缓存

## 解决方案

### 方法1：使用部署脚本（推荐）

在服务器上执行：

```bash
cd /root/caigou/caigou  # 或你的项目目录
bash deploy.sh
```

这个脚本会自动：
1. 拉取最新代码
2. 安装依赖
3. 重新生成 Prisma Client
4. **构建前端项目**
5. 重启 PM2 服务

### 方法2：手动更新

如果部署脚本不可用，手动执行以下步骤：

```bash
# 1. 进入项目目录
cd /root/caigou/caigou  # 或你的项目目录

# 2. 拉取最新代码
git pull origin main

# 3. 安装依赖（如果需要）
npm install

# 4. 重新生成 Prisma Client
cd apps/api
npx prisma generate
cd ../..

# 5. ⚠️ 重要：重新构建前端项目
cd apps/web
npm run build
cd ../..

# 6. 重启 PM2 服务
pm2 restart caigou-web
# 或者如果 PM2 应用名称不同
pm2 restart all
```

### 方法3：清除 Next.js 缓存后重新构建

如果上述方法仍然无效，尝试清除缓存：

```bash
cd /root/caigou/caigou/apps/web

# 清除 Next.js 缓存
rm -rf .next

# 重新构建
npm run build

# 重启服务
cd ../..
pm2 restart caigou-web
```

## 验证更新是否成功

### 1. 检查代码是否更新

```bash
cd /root/caigou/caigou
git log -1 --oneline
# 应该看到最新的提交，包含 "返回首页按钮" 相关的提交
```

### 2. 检查文件是否存在

```bash
ls -la apps/web/components/HomeButton.tsx
# 文件应该存在

# 检查 layout.tsx 是否包含 HomeButton
grep -n "HomeButton" apps/web/app/layout.tsx
# 应该看到导入语句
```

### 3. 检查构建是否成功

```bash
cd apps/web
ls -la .next
# .next 目录应该存在且最近更新
```

### 4. 检查 PM2 服务状态

```bash
pm2 status
pm2 logs caigou-web --lines 50
# 查看日志，确认没有错误
```

### 5. 清除浏览器缓存

在浏览器中：
- 按 `Ctrl + Shift + R` (Windows/Linux) 或 `Cmd + Shift + R` (Mac) 强制刷新
- 或者按 `F12` 打开开发者工具，右键刷新按钮，选择"清空缓存并硬性重新加载"

## 常见问题

### Q1: 构建失败

**错误信息**：`Error: Cannot find module '@/components/HomeButton'`

**解决方案**：
```bash
cd apps/web
# 检查文件是否存在
ls -la components/HomeButton.tsx

# 如果不存在，检查 git pull 是否成功
cd ../..
git status
git pull origin main
```

### Q2: PM2 重启后仍然没有按钮

**可能原因**：
1. 浏览器缓存
2. Next.js 缓存

**解决方案**：
```bash
# 清除 Next.js 缓存
cd apps/web
rm -rf .next
npm run build

# 完全重启 PM2
pm2 delete caigou-web
pm2 start ecosystem.config.js
# 或根据你的 PM2 配置启动
```

### Q3: 按钮显示但点击无效

**可能原因**：JavaScript 错误

**解决方案**：
1. 打开浏览器开发者工具（F12）
2. 查看 Console 标签页是否有错误
3. 检查 Network 标签页，确认资源加载正常

## 快速检查清单

- [ ] 执行 `git pull origin main` 拉取最新代码
- [ ] 执行 `cd apps/web && npm run build` 重新构建前端
- [ ] 执行 `pm2 restart caigou-web` 重启服务
- [ ] 清除浏览器缓存（Ctrl+Shift+R）
- [ ] 检查浏览器控制台是否有错误

## 联系支持

如果以上方法都无法解决问题，请提供：
1. `git log -1` 的输出
2. `pm2 logs caigou-web --lines 50` 的输出
3. 浏览器控制台的错误信息（如果有）

