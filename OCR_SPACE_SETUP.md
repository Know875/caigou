# OCR.space API 配置指南

## 当前状态

- ❌ 环境变量 `OCR_SPACE_API_KEY` 未设置
- ⚠️ 使用默认值 `K84724218688957`（可能无效或已过期）
- ⚠️ 导致 OCR 识别超时（30秒超时）

## 配置步骤

### 1. 获取 API 密钥

1. 访问 OCR.space 官网：https://ocr.space/ocrapi
2. 点击 "Free OCR API" 菜单
3. 点击 "Register here for your free OCR API key" 链接
4. 填写注册信息并提交
5. 在确认邮件中获取您的 API 密钥

### 2. 配置环境变量

在项目根目录的 `.env.local` 文件中添加：

```bash
# OCR.space API 密钥
OCR_SPACE_API_KEY=your-actual-api-key-here
```

**注意**：
- 将 `your-actual-api-key-here` 替换为您从邮件中获取的实际 API 密钥
- 如果 `.env.local` 文件不存在，请从 `env.local.example` 复制并重命名

### 3. 重启服务

配置完成后，需要重启 API 服务才能生效：

```powershell
# 停止当前服务（Ctrl+C）
# 然后重新启动
cd apps/api
npm run start:dev
```

## 免费版限制

OCR.space 免费版有以下限制：
- ✅ 每月 25,000 次请求
- ✅ 单个文件大小限制：1 MB
- ✅ PDF 文件页数限制：3 页
- ⚠️ 可能有速率限制（可能导致超时）

如果您的使用量超出免费版限制，可以考虑：
- 升级到 PRO 版本（付费）
- 使用备用方案（讯飞 OCR）
- 或者仅使用手动输入功能

## 验证配置

配置完成后，查看日志应该看到：

```
[OcrService] OCR.space API Key { isSet: true }
```

而不是：

```
[OcrService] OCR.space API Key { isSet: false }
```

## 故障排除

### 问题：仍然超时

**可能原因**：
1. API 密钥无效或已过期
2. 网络连接问题
3. 免费版速率限制

**解决方案**：
1. 验证 API 密钥是否正确
2. 检查网络连接
3. 等待一段时间后重试（如果触发了速率限制）
4. 使用备用方案（讯飞 OCR）或手动输入

### 问题：403 错误

**可能原因**：
- API 密钥无效或已过期

**解决方案**：
- 重新注册并获取新的 API 密钥
- 确保环境变量配置正确

## 备用方案

如果 OCR.space 不可用，系统会自动尝试：
1. 讯飞 OCR（需要配置 XFYUN_APP_ID、XFYUN_API_KEY、XFYUN_API_SECRET）
2. 手动输入快递单号（推荐，最可靠）

