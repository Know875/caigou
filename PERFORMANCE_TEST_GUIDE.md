# 性能测试指南

## 🎯 测试目标

验证性能优化的效果，确保：
1. 页面加载速度提升
2. 数据传输量减少
3. API 响应时间缩短

---

## 📊 测试方法

### 方法 1：浏览器开发者工具（推荐）

#### 步骤：

1. **打开浏览器开发者工具**
   - Chrome/Edge: `F12` 或 `Ctrl+Shift+I`
   - 切换到 `Network` 标签

2. **清除缓存**
   - 点击 `Network` 标签中的清除按钮
   - 或使用 `Ctrl+Shift+Delete` 清除浏览器缓存

3. **测试 Dashboard 页面**
   - 访问 Dashboard 页面
   - 查看 `/api/rfqs/stats` 请求：
     - **响应时间**：应该 < 200ms
     - **响应大小**：应该 < 1KB（之前可能是几 MB）
     - **Content-Encoding**：应该显示 `gzip`

4. **测试询价单列表页**
   - 访问询价单列表页
   - 查看 `/api/rfqs` 请求：
     - **响应时间**：应该 < 500ms（之前可能是 1-3 秒）
     - **响应大小**：应该减少 70-90%
     - **Content-Encoding**：应该显示 `gzip`

5. **对比优化前后**
   - 记录优化前的数据
   - 记录优化后的数据
   - 计算提升百分比

---

### 方法 2：使用 curl 命令

```bash
# 测试健康检查
curl -w "\n响应时间: %{time_total}s\n响应大小: %{size_download} bytes\n" \
  -H "Accept-Encoding: gzip, deflate" \
  http://your-server:8081/api/health

# 测试统计接口（需要认证）
curl -w "\n响应时间: %{time_total}s\n响应大小: %{size_download} bytes\n" \
  -H "Authorization: Bearer YOUR_TOKEN" \
  -H "Accept-Encoding: gzip, deflate" \
  http://your-server:8081/api/rfqs/stats

# 检查响应压缩
curl -I -H "Accept-Encoding: gzip, deflate" \
  http://your-server:8081/api/health | grep -i "content-encoding"
```

---

### 方法 3：使用测试脚本

```bash
# 在服务器上运行
cd /root/caigou/caigou
bash test-performance.sh
```

---

## 📈 预期结果

### Dashboard 页面

| 指标 | 优化前 | 优化后 | 提升 |
|------|--------|--------|------|
| 响应时间 | 2-5 秒 | < 200ms | **10-25 倍** |
| 响应大小 | 2-5 MB | < 1 KB | **99%+** |
| 数据传输 | 完整列表 | 仅统计 | **95%+** |

### 询价单列表页

| 指标 | 优化前 | 优化后 | 提升 |
|------|--------|--------|------|
| 响应时间 | 1-3 秒 | < 500ms | **3-6 倍** |
| 响应大小 | 1-3 MB | 100-300 KB | **70-90%** |
| 查询字段 | 全部字段 | 必要字段 | **优化** |

### 响应压缩

| 指标 | 优化前 | 优化后 | 提升 |
|------|--------|--------|------|
| 压缩率 | 无压缩 | 60-80% | **显著** |
| 传输时间 | 100% | 30-50% | **50-70%** |

---

## 🔍 详细检查项

### 1. 检查响应压缩

在浏览器开发者工具的 Network 标签中：
- 查看请求的 `Response Headers`
- 确认 `Content-Encoding: gzip` 存在

### 2. 检查查询优化

在服务器上检查数据库查询：
```bash
# 查看慢查询日志
mysql -u root -p -e "SHOW VARIABLES LIKE 'slow_query_log%';"

# 查看当前查询
mysql -u root -p -e "SHOW PROCESSLIST;"
```

### 3. 检查分页

确认列表查询只返回 100 条记录（默认）：
- 在浏览器中查看 `/api/rfqs` 响应
- 确认返回的数据量合理

---

## ⚠️ 注意事项

1. **清除缓存**：测试前清除浏览器缓存
2. **网络环境**：确保网络环境一致
3. **数据量**：数据量越大，优化效果越明显
4. **认证**：某些接口需要认证才能测试

---

## 📝 测试记录模板

```
测试时间: 2025-12-07
测试环境: 生产环境

Dashboard 页面:
- 优化前响应时间: ___ 秒
- 优化后响应时间: ___ 秒
- 提升: ___ %

询价单列表页:
- 优化前响应时间: ___ 秒
- 优化后响应时间: ___ 秒
- 提升: ___ %

响应大小:
- 优化前: ___ KB
- 优化后: ___ KB
- 减少: ___ %
```

---

## 🎉 成功标准

如果满足以下条件，说明优化成功：

1. ✅ Dashboard 加载时间 < 500ms
2. ✅ 询价单列表加载时间 < 1 秒
3. ✅ 响应大小减少 > 50%
4. ✅ 响应压缩已启用
5. ✅ 用户体验明显改善

