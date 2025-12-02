# 如何在服务器上执行 SQL 修复脚本

## 前提条件

1. 已连接到服务器（SSH）
2. 已安装 MySQL 客户端工具
3. 知道数据库连接信息（主机、端口、用户名、密码、数据库名）

## 方法一：使用 MySQL 命令行客户端（推荐）

### 1. 连接到服务器

```bash
# 通过 SSH 连接到服务器
ssh username@server_ip
```

### 2. 上传 SQL 脚本到服务器

```bash
# 方法1：使用 scp 从本地上传
scp fix-rfq-1764574989800-award-supplier.sql username@server_ip:/path/to/scripts/

# 方法2：直接在服务器上创建文件（使用 vi 或 nano）
vi fix-rfq-1764574989800-award-supplier.sql
# 然后粘贴脚本内容，保存退出（:wq）
```

### 3. 连接到 MySQL 数据库

```bash
# 方式1：直接连接（会提示输入密码）
mysql -h localhost -u root -p database_name

# 方式2：使用环境变量（更安全）
export MYSQL_PWD="your_password"
mysql -h localhost -u root database_name

# 方式3：从配置文件中读取（最安全）
mysql --defaults-file=/path/to/.my.cnf database_name
```

**创建配置文件 `.my.cnf`（可选，更安全）：**
```bash
vi ~/.my.cnf
```

内容：
```ini
[client]
host=localhost
user=root
password=your_password
database=your_database_name
```

然后设置权限：
```bash
chmod 600 ~/.my.cnf
```

### 4. 执行 SQL 脚本

#### 方式1：在 MySQL 命令行中执行

```bash
# 连接到数据库
mysql -h localhost -u root -p database_name

# 在 MySQL 提示符下执行
mysql> source /path/to/fix-rfq-1764574989800-award-supplier.sql;

# 或者使用 \. 命令
mysql> \. /path/to/fix-rfq-1764574989800-award-supplier.sql
```

#### 方式2：直接从命令行执行（推荐）

```bash
# 执行整个脚本
mysql -h localhost -u root -p database_name < fix-rfq-1764574989800-award-supplier.sql

# 或者使用环境变量
export MYSQL_PWD="your_password"
mysql -h localhost -u root database_name < fix-rfq-1764574989800-award-supplier.sql
```

#### 方式3：只执行查询部分（不修改数据）

```bash
# 创建一个只包含查询部分的脚本
# 或者手动编辑脚本，注释掉修复部分（START TRANSACTION 之后的内容）

# 执行查询
mysql -h localhost -u root -p database_name < fix-rfq-1764574989800-award-supplier.sql
```

### 5. 执行修复（需要确认后）

```bash
# 1. 先备份数据库（重要！）
mysqldump -h localhost -u root -p database_name > backup_$(date +%Y%m%d_%H%M%S).sql

# 2. 执行修复脚本
mysql -h localhost -u root -p database_name < fix-rfq-1764574989800-award-supplier.sql

# 3. 如果发现问题，可以恢复备份
mysql -h localhost -u root -p database_name < backup_20240101_120000.sql
```

## 方法二：分步执行（更安全）

### 步骤1：查看当前数据

```bash
# 创建一个只包含查询部分的脚本
cat > check_data.sql << 'EOF'
SET @rfq_no = 'RFQ-1764574989800';
SET @rfq_id = (SELECT id FROM rfqs WHERE rfqNo = @rfq_no);

-- 查看 RFQ 基本信息
SELECT 
    r.rfqNo,
    r.title,
    COUNT(DISTINCT a.id) as award_count,
    COUNT(DISTINCT CASE WHEN ri.item_status = 'AWARDED' THEN ri.id END) as awarded_items
FROM rfqs r
LEFT JOIN awards a ON a.rfqId = r.id AND a.status != 'CANCELLED'
LEFT JOIN rfq_items ri ON ri.rfqId = r.id
WHERE r.id = @rfq_id
GROUP BY r.id, r.rfqNo, r.title;
EOF

# 执行查询
mysql -h localhost -u root -p database_name < check_data.sql
```

### 步骤2：确认需要修复的数据

```bash
# 查看详细的中标情况
mysql -h localhost -u root -p database_name << 'EOF'
SET @rfq_no = 'RFQ-1764574989800';
SET @rfq_id = (SELECT id FROM rfqs WHERE rfqNo = @rfq_no);

SELECT 
    ri.id as rfq_item_id,
    ri.productName,
    u.username as supplier_name,
    qi.price,
    a.id as award_id,
    a.quoteId,
    CASE 
        WHEN a.id IS NOT NULL AND a.quoteId = qi.quoteId THEN '✅ 正确'
        ELSE '❌ 需要修复'
    END as status
FROM rfq_items ri
INNER JOIN quote_items qi ON ri.id = qi.rfqItemId
INNER JOIN quotes q ON qi.quoteId = q.id
INNER JOIN users u ON q.supplierId = u.id
LEFT JOIN awards a ON a.rfqId = ri.rfqId AND a.supplierId = q.supplierId AND a.status != 'CANCELLED'
WHERE ri.rfqId = @rfq_id
  AND ri.item_status = 'AWARDED'
ORDER BY ri.productName;
EOF
```

### 步骤3：执行修复（在事务中）

```bash
# 执行修复脚本（包含 START TRANSACTION 和 COMMIT）
mysql -h localhost -u root -p database_name < fix-rfq-1764574989800-award-supplier.sql
```

### 步骤4：验证修复结果

```bash
# 再次执行查询，确认修复结果
mysql -h localhost -u root -p database_name << 'EOF'
SET @rfq_no = 'RFQ-1764574989800';
SET @rfq_id = (SELECT id FROM rfqs WHERE rfqNo = @rfq_no);

SELECT 
    ri.id as rfq_item_id,
    ri.productName,
    u.username as supplier_name,
    qi.price,
    a.id as award_id,
    CASE 
        WHEN a.id IS NOT NULL AND a.quoteId = qi.quoteId THEN '✅ 正确'
        ELSE '❌ 仍有问题'
    END as validation
FROM rfq_items ri
INNER JOIN quote_items qi ON ri.id = qi.rfqItemId
INNER JOIN quotes q ON qi.quoteId = q.id
INNER JOIN users u ON q.supplierId = u.id
INNER JOIN awards a ON a.rfqId = ri.rfqId AND a.supplierId = q.supplierId AND a.status != 'CANCELLED'
WHERE ri.rfqId = @rfq_id
  AND ri.item_status = 'AWARDED'
ORDER BY ri.productName;
EOF
```

## 方法三：使用交互式 MySQL 会话

```bash
# 连接到数据库
mysql -h localhost -u root -p database_name

# 在 MySQL 提示符下逐步执行
mysql> SET @rfq_no = 'RFQ-1764574989800';
mysql> SET @rfq_id = (SELECT id FROM rfqs WHERE rfqNo = @rfq_no);

# 查看数据
mysql> SELECT * FROM rfqs WHERE id = @rfq_id;

# 如果需要修复，先开启事务
mysql> START TRANSACTION;

# 执行修复语句（从脚本中复制）
mysql> -- 复制修复部分的 SQL 语句到这里执行

# 验证结果
mysql> -- 执行验证查询

# 如果验证通过，提交
mysql> COMMIT;

# 如果发现问题，回滚
mysql> ROLLBACK;
```

## 重要提示

### 1. 备份数据库（必须！）

```bash
# 备份整个数据库
mysqldump -h localhost -u root -p database_name > backup_$(date +%Y%m%d_%H%M%S).sql

# 只备份相关表
mysqldump -h localhost -u root -p database_name awards quotes quote_items rfq_items rfqs > backup_awards_$(date +%Y%m%d_%H%M%S).sql
```

### 2. 测试环境先验证

```bash
# 如果有测试环境，先在测试环境执行
mysql -h test_server -u root -p test_database < fix-rfq-1764574989800-award-supplier.sql
```

### 3. 查看执行结果

```bash
# 执行脚本并查看输出
mysql -h localhost -u root -p database_name < fix-rfq-1764574989800-award-supplier.sql 2>&1 | tee execution_log.txt

# 或者保存到文件
mysql -h localhost -u root -p database_name < fix-rfq-1764574989800-award-supplier.sql > result.txt 2>&1
```

### 4. 如果执行出错

```bash
# 查看错误信息
mysql -h localhost -u root -p database_name < fix-rfq-1764574989800-award-supplier.sql 2>&1

# 如果事务已开启，可以回滚
mysql -h localhost -u root -p database_name << 'EOF'
ROLLBACK;
EOF

# 或者恢复备份
mysql -h localhost -u root -p database_name < backup_20240101_120000.sql
```

## 快速执行命令（一键执行）

创建一个执行脚本 `execute_fix.sh`：

```bash
#!/bin/bash

# 配置数据库连接信息
DB_HOST="localhost"
DB_USER="root"
DB_NAME="your_database_name"
SQL_FILE="fix-rfq-1764574989800-award-supplier.sql"
BACKUP_FILE="backup_$(date +%Y%m%d_%H%M%S).sql"

echo "=== 开始执行修复脚本 ==="
echo ""

# 1. 备份数据库
echo "1. 备份数据库..."
mysqldump -h $DB_HOST -u $DB_USER -p $DB_NAME > $BACKUP_FILE
if [ $? -eq 0 ]; then
    echo "   ✅ 备份成功: $BACKUP_FILE"
else
    echo "   ❌ 备份失败，退出"
    exit 1
fi

# 2. 执行修复脚本
echo ""
echo "2. 执行修复脚本..."
mysql -h $DB_HOST -u $DB_USER -p $DB_NAME < $SQL_FILE
if [ $? -eq 0 ]; then
    echo "   ✅ 脚本执行成功"
else
    echo "   ❌ 脚本执行失败"
    echo "   可以恢复备份: mysql -h $DB_HOST -u $DB_USER -p $DB_NAME < $BACKUP_FILE"
    exit 1
fi

# 3. 验证结果
echo ""
echo "3. 验证修复结果..."
mysql -h $DB_HOST -u $DB_USER -p $DB_NAME << 'EOF'
SET @rfq_no = 'RFQ-1764574989800';
SET @rfq_id = (SELECT id FROM rfqs WHERE rfqNo = @rfq_no);

SELECT 
    ri.productName,
    u.username as supplier_name,
    CASE 
        WHEN a.id IS NOT NULL AND a.quoteId = qi.quoteId THEN '✅ 正确'
        ELSE '❌ 仍有问题'
    END as validation
FROM rfq_items ri
INNER JOIN quote_items qi ON ri.id = qi.rfqItemId
INNER JOIN quotes q ON qi.quoteId = q.id
INNER JOIN users u ON q.supplierId = u.id
INNER JOIN awards a ON a.rfqId = ri.rfqId AND a.supplierId = q.supplierId AND a.status != 'CANCELLED'
WHERE ri.rfqId = @rfq_id
  AND ri.item_status = 'AWARDED'
ORDER BY ri.productName;
EOF

echo ""
echo "=== 执行完成 ==="
```

使用方法：
```bash
chmod +x execute_fix.sh
./execute_fix.sh
```

## 常见问题

### 1. 找不到 mysql 命令

```bash
# 检查是否安装
which mysql

# 如果没有，需要安装 MySQL 客户端
# Ubuntu/Debian:
sudo apt-get install mysql-client

# CentOS/RHEL:
sudo yum install mysql
```

### 2. 连接被拒绝

```bash
# 检查 MySQL 服务是否运行
sudo systemctl status mysql

# 检查端口是否开放
netstat -tlnp | grep 3306

# 检查防火墙
sudo ufw status
```

### 3. 权限不足

```bash
# 确保用户有足够权限
mysql -h localhost -u root -p << 'EOF'
GRANT ALL PRIVILEGES ON database_name.* TO 'username'@'localhost';
FLUSH PRIVILEGES;
EOF
```

### 4. 脚本执行时间过长

```bash
# 增加超时时间
mysql -h localhost -u root -p --connect-timeout=60 database_name < script.sql

# 或者使用 nohup 后台执行
nohup mysql -h localhost -u root -p database_name < script.sql > log.txt 2>&1 &
```

## 安全建议

1. **使用配置文件**：不要直接在命令行输入密码
2. **限制权限**：使用专门的数据库用户，只授予必要权限
3. **备份数据**：执行任何修改前都要备份
4. **测试环境验证**：先在测试环境验证脚本
5. **事务保护**：使用事务，验证后再提交

