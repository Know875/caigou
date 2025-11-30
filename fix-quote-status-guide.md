# 修复报价状态操作指南

## 步骤1：查找数据库连接信息

在服务器上执行以下命令来查找数据库连接信息：

```bash
# 方法1：从环境变量中查找
cd /root/caigou/caigou
cat apps/api/.env.local | grep DATABASE_URL

# 方法2：从PM2进程中查找
pm2 env caigou-api | grep DATABASE_URL

# 方法3：查看应用日志（如果应用正在运行）
pm2 logs caigou-api --lines 20 | grep DATABASE_URL
```

DATABASE_URL 格式通常是：`mysql://用户名:密码@主机:端口/数据库名`

例如：`mysql://root:your_password@localhost:3306/caigou`

## 步骤2：找到SQL脚本

SQL脚本应该在项目根目录：

```bash
cd /root/caigou/caigou
ls -la fix-kele-quote-status*.sql
```

如果文件不存在，需要先拉取最新代码：

```bash
cd /root/caigou/caigou
git pull origin main
ls -la fix-kele-quote-status*.sql
```

## 步骤3：执行SQL修复

### 方法A：直接使用mysql命令行（推荐）

假设数据库信息是：
- 用户名：`root`
- 密码：`your_password`
- 数据库名：`caigou`

```bash
cd /root/caigou/caigou

# 执行SQL脚本
mysql -u root -p caigou < fix-kele-quote-status-safe.sql
```

### 方法B：交互式执行（更安全）

```bash
cd /root/caigou/caigou

# 连接到数据库
mysql -u root -p caigou

# 然后在mysql命令行中执行：
source fix-kele-quote-status-safe.sql;

# 或者直接复制SQL内容粘贴执行
```

### 方法C：手动执行SQL（如果脚本路径有问题）

```bash
mysql -u root -p caigou
```

然后在mysql命令行中执行以下SQL：

```sql
START TRANSACTION;

-- 1. 查看需要修复的报价
SELECT 
    q.id,
    q.rfqId,
    u.username,
    u.email,
    q.status,
    q.price,
    rfq.rfqNo,
    rfq.title,
    COUNT(DISTINCT a.id) as award_count
FROM quotes q
INNER JOIN users u ON q.supplierId = u.id
INNER JOIN rfqs rfq ON q.rfqId = rfq.id
LEFT JOIN awards a ON a.quoteId = q.id AND a.status != 'CANCELLED'
WHERE u.username = '可乐' 
  AND q.status = 'AWARDED'
GROUP BY q.id, q.rfqId, u.username, u.email, q.status, q.price, rfq.rfqNo, rfq.title
ORDER BY q.submittedAt DESC;

-- 2. 更新报价状态
UPDATE quotes q
INNER JOIN users u ON q.supplierId = u.id
LEFT JOIN awards a ON a.quoteId = q.id AND a.status != 'CANCELLED'
SET q.status = 'SUBMITTED',
    q.updatedAt = NOW()
WHERE u.username = '可乐' 
  AND q.status = 'AWARDED'
  AND a.id IS NULL;

-- 3. 查看更新结果
SELECT ROW_COUNT() as updated_rows;

-- 4. 验证
SELECT 
    q.id,
    u.username,
    q.status,
    rfq.rfqNo,
    CASE WHEN a.id IS NOT NULL THEN '有Award记录' ELSE '无Award记录' END as award_status
FROM quotes q
INNER JOIN users u ON q.supplierId = u.id
INNER JOIN rfqs rfq ON q.rfqId = rfq.id
LEFT JOIN awards a ON a.quoteId = q.id AND a.status != 'CANCELLED'
WHERE u.username = '可乐'
ORDER BY q.submittedAt DESC;

-- 如果确认无误，执行：
COMMIT;

-- 如果需要回滚，执行：
-- ROLLBACK;
```

## 快速执行命令（一键修复）

如果数据库用户名是 `root`，数据库名是 `caigou`，可以直接执行：

```bash
cd /root/caigou/caigou

# 先查看需要修复的数据
mysql -u root -p caigou -e "
SELECT 
    q.id,
    u.username,
    q.status,
    rfq.rfqNo,
    COUNT(DISTINCT a.id) as award_count
FROM quotes q
INNER JOIN users u ON q.supplierId = u.id
INNER JOIN rfqs rfq ON q.rfqId = rfq.id
LEFT JOIN awards a ON a.quoteId = q.id AND a.status != 'CANCELLED'
WHERE u.username = '可乐' 
  AND q.status = 'AWARDED'
GROUP BY q.id, u.username, q.status, rfq.rfqNo;
"

# 执行修复
mysql -u root -p caigou -e "
START TRANSACTION;
UPDATE quotes q
INNER JOIN users u ON q.supplierId = u.id
LEFT JOIN awards a ON a.quoteId = q.id AND a.status != 'CANCELLED'
SET q.status = 'SUBMITTED', q.updatedAt = NOW()
WHERE u.username = '可乐' 
  AND q.status = 'AWARDED'
  AND a.id IS NULL;
SELECT ROW_COUNT() as updated_rows;
COMMIT;
"
```

