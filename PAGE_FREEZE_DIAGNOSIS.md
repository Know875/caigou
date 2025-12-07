# 页面卡住问题诊断和解决方案

## 🔍 问题描述

页面有时候会卡住不动，需要重启服务器才能恢复。

---

## 🎯 可能的原因

### 1. 数据库连接池耗尽（最可能）

**症状**：
- 所有请求挂起，无响应
- 数据库连接数达到上限
- 新请求无法获取数据库连接

**原因**：
- 连接池配置过小（当前：20/实例）
- 长时间运行的查询占用连接
- 连接泄漏（未正确释放）

**验证方法**：
```sql
-- 检查当前数据库连接数
SHOW STATUS LIKE 'Threads_connected';
SHOW VARIABLES LIKE 'max_connections';

-- 检查正在运行的查询
SHOW PROCESSLIST;

-- 检查长时间运行的查询
SELECT * FROM information_schema.processlist 
WHERE TIME > 10 
ORDER BY TIME DESC;
```

---

### 2. 长时间运行的查询阻塞

**症状**：
- 特定页面卡住
- 数据库 CPU 使用率高
- 其他请求变慢

**可能的原因**：
- 复杂 JOIN 查询
- 缺少索引
- 大量数据查询
- 死锁

**验证方法**：
```sql
-- 查看慢查询日志
SHOW VARIABLES LIKE 'slow_query_log';
SHOW VARIABLES LIKE 'long_query_time';

-- 查看当前运行的查询
SHOW FULL PROCESSLIST;

-- 检查是否有锁等待
SELECT * FROM information_schema.innodb_locks;
SELECT * FROM information_schema.innodb_lock_waits;
```

---

### 3. 内存泄漏

**症状**：
- 服务器内存持续增长
- 最终导致 OOM（Out of Memory）
- 需要重启才能恢复

**验证方法**：
```bash
# 检查内存使用
pm2 monit

# 检查 Node.js 内存
node --max-old-space-size=4096 # 如果设置了内存限制

# 查看 PM2 日志
pm2 logs caigou-api --lines 100 | grep -i "memory\|heap"
```

---

### 4. 队列任务阻塞

**症状**：
- 队列任务堆积
- Worker 进程无响应
- 相关功能无法使用

**验证方法**：
```bash
# 检查 Redis 队列长度
redis-cli LLEN bull:auction:wait
redis-cli LLEN bull:ocr:wait
redis-cli LLEN bull:notification:wait

# 检查 PM2 Worker 状态
pm2 status caigou-worker
pm2 logs caigou-worker --lines 50
```

---

### 5. 网络连接问题

**症状**：
- 外部 API 调用超时
- 请求挂起
- 连接数达到上限

**可能的原因**：
- HTTP Agent 连接未正确关闭
- 外部服务响应慢
- 连接池配置问题

---

### 6. 事件循环阻塞

**症状**：
- 所有请求无响应
- CPU 使用率正常
- 日志无输出

**可能的原因**：
- 同步阻塞操作
- 无限循环
- 大量同步计算

---

## 🔧 诊断步骤

### 步骤 1：检查数据库连接

```bash
# 在服务器上执行
mysql -u your_user -p your_database

# 检查连接数
SHOW STATUS LIKE 'Threads_connected';
SHOW VARIABLES LIKE 'max_connections';

# 检查长时间运行的查询
SELECT 
    id,
    user,
    host,
    db,
    command,
    time,
    state,
    info
FROM information_schema.processlist
WHERE time > 5
ORDER BY time DESC;
```

---

### 步骤 2：检查 PM2 状态

```bash
# 查看所有进程状态
pm2 status

# 查看详细状态
pm2 describe caigou-api

# 查看内存和 CPU 使用
pm2 monit

# 查看日志
pm2 logs caigou-api --lines 100
```

---

### 步骤 3：检查 Redis 队列

```bash
# 连接 Redis
redis-cli

# 检查队列长度
LLEN bull:auction:wait
LLEN bull:ocr:wait
LLEN bull:notification:wait

# 检查失败的任务
LLEN bull:auction:failed
```

---

### 步骤 4：检查系统资源

```bash
# 检查内存使用
free -h

# 检查 CPU 使用
top

# 检查磁盘 I/O
iostat -x 1

# 检查网络连接
netstat -an | grep :8081 | wc -l
```

---

## 🛠️ 解决方案

### 方案 1：增加数据库连接池（推荐）

**当前配置**：
```bash
connection_limit=20&pool_timeout=10
```

**优化配置**：
```bash
# 修改 .env 文件
DATABASE_URL=mysql://...?connection_limit=50&pool_timeout=20
```

**同时检查 MySQL 配置**：
```sql
-- 检查最大连接数
SHOW VARIABLES LIKE 'max_connections';

-- 如果需要，增加最大连接数（需要重启 MySQL）
SET GLOBAL max_connections = 200;
```

---

### 方案 2：添加查询超时

**问题**：长时间运行的查询可能阻塞连接池

**解决**：为关键查询添加超时

```typescript
// 使用 Prisma 的 query timeout
const result = await this.prisma.$queryRaw`
  SELECT * FROM large_table
` as any;

// 或使用事务超时
await this.prisma.$transaction(async (tx) => {
  // ...
}, {
  timeout: 30000, // 30秒超时
});
```

---

### 方案 3：优化慢查询

**识别慢查询**：
```sql
-- 启用慢查询日志
SET GLOBAL slow_query_log = 'ON';
SET GLOBAL long_query_time = 2; -- 2秒以上的查询

-- 查看慢查询
SELECT * FROM mysql.slow_log ORDER BY start_time DESC LIMIT 10;
```

**优化方法**：
- 添加索引
- 优化 JOIN 查询
- 使用分页
- 添加缓存

---

### 方案 4：添加健康检查端点

**目的**：快速诊断系统状态

```typescript
// apps/api/src/modules/health/health.controller.ts
@Controller('health')
export class HealthController {
  @Get()
  async check() {
    // 检查数据库连接
    try {
      await this.prisma.$queryRaw`SELECT 1`;
    } catch (error) {
      return { status: 'unhealthy', database: 'disconnected' };
    }
    
    // 检查 Redis 连接
    // ...
    
    return { status: 'healthy' };
  }
}
```

---

### 方案 5：添加请求超时中间件

**目的**：防止请求无限挂起

```typescript
// apps/api/src/common/middleware/request-timeout.middleware.ts
@Injectable()
export class RequestTimeoutMiddleware implements NestMiddleware {
  use(req: Request, res: Response, next: NextFunction) {
    const timeout = 30000; // 30秒超时
    const timer = setTimeout(() => {
      if (!res.headersSent) {
        res.status(408).json({
          success: false,
          message: 'Request timeout',
        });
      }
    }, timeout);
    
    res.on('finish', () => {
      clearTimeout(timer);
    });
    
    next();
  }
}
```

---

### 方案 6：监控和告警

**目的**：提前发现问题

```bash
# 使用 PM2 监控
pm2 install pm2-logrotate
pm2 set pm2-logrotate:max_size 10M
pm2 set pm2-logrotate:retain 7

# 设置内存限制和自动重启
pm2 start ecosystem.config.js --max-memory-restart 1G
```

---

## 📊 预防措施

### 1. 定期监控

- 数据库连接数
- 慢查询日志
- 内存使用
- 队列长度

### 2. 设置合理的超时

- API 请求超时：30秒
- 数据库查询超时：10秒
- 外部 API 调用超时：5秒

### 3. 优化查询

- 添加索引
- 使用分页
- 避免 N+1 查询
- 使用缓存

### 4. 资源限制

- 数据库连接池：50/实例
- 内存限制：1GB/实例
- 队列并发：根据实际情况调整

---

## 🚨 紧急处理

如果页面已经卡住：

### 1. 检查数据库连接

```sql
-- 查看所有连接
SHOW PROCESSLIST;

-- 如果有长时间运行的查询，可以终止
KILL <process_id>;
```

### 2. 重启服务

```bash
# 优雅重启
pm2 restart caigou-api

# 如果无法重启，强制重启
pm2 delete caigou-api
pm2 start ecosystem.config.js
```

### 3. 清理队列

```bash
# 如果队列堆积，可以清理
redis-cli DEL bull:auction:wait
redis-cli DEL bull:ocr:wait
```

---

## 📝 总结

**最可能的原因**：
1. 数据库连接池耗尽（优先级最高）
2. 长时间运行的查询
3. 内存泄漏

**推荐操作**：
1. ✅ 增加数据库连接池（50/实例）
2. ✅ 添加查询超时
3. ✅ 优化慢查询
4. ✅ 添加健康检查端点
5. ✅ 设置监控和告警

---

**最后更新**: 2025-12-07

