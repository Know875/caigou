# 解决服务器 Git Pull 冲突问题

## 问题
Git pull 失败，提示：
```
error: The following untracked working tree files would be overwritten by merge:
	deploy.sh
	fix-rfq-1764574989800-fudai.sql
Please move or remove them before you merge.
```

## 解决方案

### 方法1：备份并删除冲突文件（推荐）

```bash
cd /root/caigou/caigou

# 1. 备份冲突文件（如果需要保留）
mkdir -p ~/backup
mv deploy.sh ~/backup/deploy.sh.backup 2>/dev/null || true
mv fix-rfq-1764574989800-fudai.sql ~/backup/ 2>/dev/null || true

# 2. 删除冲突文件
rm -f deploy.sh
rm -f fix-rfq-1764574989800-fudai.sql

# 3. 重新拉取代码
git pull origin main

# 4. 如果需要恢复备份的文件
# cp ~/backup/deploy.sh.backup deploy.sh
```

### 方法2：使用 git stash（如果文件有修改）

```bash
cd /root/caigou/caigou

# 1. 暂存当前更改
git stash

# 2. 拉取代码
git pull origin main

# 3. 恢复暂存的更改（如果需要）
git stash pop
```

### 方法3：强制覆盖（如果确定不需要本地文件）

```bash
cd /root/caigou/caigou

# 1. 删除冲突文件
rm -f deploy.sh
rm -f fix-rfq-1764574989800-fudai.sql

# 2. 拉取代码
git pull origin main
```

## 执行后继续更新

```bash
# 清除缓存并重新构建
cd apps/web
rm -rf .next
rm -rf node_modules/.cache
npm run build

# 重启服务
cd ../..
pm2 restart all
```

