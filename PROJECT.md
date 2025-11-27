# 模型玩具采购协同系统

## 📋 项目简介

模型玩具采购协同系统是一个基于 Monorepo 架构的多门店采购协同平台，支持询价、报价、中标、发货、财务等完整的采购业务流程。

## 🏗️ 技术架构

### 技术栈

**后端 (API)**
- **框架**: NestJS 10.x
- **数据库**: PostgreSQL (Prisma ORM)
- **消息队列**: BullMQ + Redis
- **存储**: MinIO (S3兼容)
- **认证**: JWT + Passport
- **定时任务**: @nestjs/schedule
- **OCR**: 讯飞OCR (快递单识别)

**前端 (Web)**
- **框架**: Next.js 15.x (App Router)
- **UI**: React 18 + Tailwind CSS
- **状态管理**: Zustand
- **HTTP客户端**: Axios
- **表单**: React Hook Form + Zod

**基础设施**
- **Monorepo**: Turborepo

## 📁 项目结构

```
caigou/
├── apps/
│   ├── api/                    # 后端 API 服务
│   │   ├── src/
│   │   │   ├── modules/        # 业务模块
│   │   │   │   ├── auth/       # 认证模块
│   │   │   │   ├── user/       # 用户管理
│   │   │   │   ├── store/      # 门店管理
│   │   │   │   ├── rfq/        # 询价单管理
│   │   │   │   ├── quote/      # 报价管理
│   │   │   │   ├── award/      # 中标管理
│   │   │   │   ├── shipment/   # 发货管理
│   │   │   │   ├── order/      # 订单管理
│   │   │   │   ├── after-sales/# 售后管理
│   │   │   │   ├── report/     # 报表统计
│   │   │   │   ├── notification/# 通知管理
│   │   │   │   ├── ocr/        # OCR识别
│   │   │   │   ├── tracking/   # 物流追踪
│   │   │   │   ├── dingtalk/   # 钉钉集成
│   │   │   │   └── admin/      # 系统管理
│   │   │   ├── queues/         # 消息队列
│   │   │   ├── cron/           # 定时任务
│   │   │   └── worker.ts       # Worker进程入口
│   │   └── prisma/             # 数据库Schema和迁移
│   │
│   └── web/                    # 前端 Web 应用
│       ├── app/                # Next.js App Router页面
│       │   ├── dashboard/      # 仪表盘
│       │   ├── rfqs/           # 询价单页面
│       │   ├── quotes/         # 报价页面
│       │   ├── shipments/      # 发货页面
│       │   ├── orders/          # 订单页面
│       │   ├── after-sales/     # 售后页面
│       │   ├── reports/         # 报表页面
│       │   ├── notifications/   # 通知页面
│       │   └── admin/           # 管理页面
│       └── lib/                # 工具库
│           ├── api.ts          # API客户端
│           ├── auth.ts         # 认证工具
│           └── hooks/          # React Hooks
│
└── scripts/                    # 脚本文件
```

## 🔑 核心功能

### 1. 询价单管理 (RFQ)
- ✅ 创建询价单（手动/Excel导入）
- ✅ 询价单发布和关闭
- ✅ 按门店分组管理
- ✅ 询价单商品明细管理
- ✅ 询价单状态跟踪

### 2. 报价管理 (Quote)
- ✅ 供应商报价
- ✅ 报价审核
- ✅ 报价对比
- ✅ 报价有效期管理

### 3. 中标管理 (Award)
- ✅ 中标选择
- ✅ 中标通知
- ✅ 缺货处理（重新询价/转电商采购）
- ✅ 中标价格管理

### 4. 发货管理 (Shipment)
- ✅ 发货单创建
- ✅ 快递单号录入
- ✅ OCR识别快递单号
- ✅ 物流追踪
- ✅ 发货状态管理

### 5. 订单管理 (Order)
- ✅ 订单创建和管理
- ✅ 订单关联询价单
- ✅ 订单状态跟踪

### 6. 售后管理 (AfterSales)
- ✅ 售后案例创建
- ✅ 售后处理流程
- ✅ 售后状态跟踪

### 7. 报表统计 (Report)
- ✅ 采购概览
- ✅ 供应商付款统计
- ✅ 电商平台采购统计
- ✅ 门店数据统计

### 8. 通知系统 (Notification)
- ✅ 站内通知
- ✅ 声音提醒
- ✅ 图标闪动提醒
- ✅ 钉钉机器人集成
- ✅ 通知类型：
  - 询价单未报价商品提醒
  - 询价单无报价提醒
  - 报价中标通知
  - 询价单关闭通知
  - 报价提醒

### 9. 系统管理 (Admin)
- ✅ 用户管理
- ✅ 门店管理
- ✅ 系统配置
- ✅ 钉钉机器人配置
- ✅ 数据导入历史

## 👥 用户角色

### ADMIN (管理员)
- 所有功能权限
- 用户管理
- 系统配置
- 数据统计

### BUYER (采购员)
- 创建和管理询价单
- 查看报价
- 选择中标
- 管理发货
- 查看报表

### SUPPLIER (供应商)
- 查看可报价询价单
- 提交报价
- 查看中标信息
- 录入发货信息
- 管理售后

## 🚀 快速开始

### 环境要求

- Node.js >= 18.0.0
- PostgreSQL >= 14
- Redis >= 6
- MinIO (可选，用于文件存储)

### 安装依赖

```bash
npm install
```

### 配置环境变量

复制 `env.local.example` 为 `apps/api/.env.local` 并配置：

```env
# 数据库
DATABASE_URL="postgresql://user:password@localhost:5432/caigou"

# JWT
JWT_SECRET="your-secret-key"
JWT_EXPIRES_IN="7d"

# Redis
REDIS_HOST="localhost"
REDIS_PORT=6379

# MinIO
MINIO_ENDPOINT="localhost"
MINIO_PORT=9000
MINIO_ACCESS_KEY="minioadmin"
MINIO_SECRET_KEY="minioadmin"
MINIO_BUCKET="caigou"

# 钉钉机器人
DINGTALK_WEBHOOK_URL="https://oapi.dingtalk.com/robot/send?access_token=xxx"

# API端口
API_PORT=8081
```

### 数据库初始化

```bash
# 生成 Prisma Client
npm run db:generate

# 运行数据库迁移
npm run db:migrate

# 初始化种子数据（可选）
npm run db:seed
```

### 启动服务

**方式1: 使用 PowerShell 脚本（推荐）**

```powershell
# 启动所有服务（API + Worker + Web）
.\start-all.ps1

# 或分别启动
.\start-api.ps1      # 启动 API 服务
.\start-web.ps1      # 启动 Web 服务
```

**方式2: 使用 npm 脚本**

```bash
# 启动所有服务
npm run dev

# 或分别启动
cd apps/api && npm run dev          # API 服务
cd apps/api && npm run worker:dev   # Worker 服务
cd apps/web && npm run dev          # Web 服务
```

### 访问地址

- **前端**: http://localhost:8080
- **API**: http://localhost:8081
- **API文档**: http://localhost:8081/api/docs (Swagger)
- **MinIO控制台**: http://localhost:9001 (默认账号: minioadmin/minioadmin)

## 📝 API 文档

启动 API 服务后，访问 http://localhost:8081/api/docs 查看 Swagger API 文档。

## 🔧 开发指南

### 后端开发

```bash
cd apps/api

# 开发模式（热重载）
npm run dev

# Worker进程（处理队列任务）
npm run worker:dev

# 类型检查
npm run typecheck

# 代码检查
npm run lint
```

### 前端开发

```bash
cd apps/web

# 开发模式
npm run dev

# 类型检查
npm run typecheck

# 代码检查
npm run lint
```

### 数据库操作

```bash
# 创建迁移
cd apps/api
npx prisma migrate dev --name migration_name

# 查看数据库
npx prisma studio

# 重置数据库（开发环境）
npx prisma migrate reset
```

## 🗄️ 数据库模型

主要数据模型：

- **User**: 用户（管理员、采购员、供应商）
- **Store**: 门店
- **Order**: 订单
- **Rfq**: 询价单
- **RfqItem**: 询价单商品
- **Quote**: 报价
- **QuoteItem**: 报价商品
- **Award**: 中标
- **Shipment**: 发货单
- **AfterSalesCase**: 售后案例
- **Notification**: 通知

详细模型定义请查看 `apps/api/prisma/schema.prisma`。

## 🔔 通知系统

### 站内通知
- 实时轮询检查新通知（30秒间隔）
- 声音提醒（800Hz + 1000Hz 双音提示）
- 图标闪动动画（10秒）
- 页面标题闪烁提醒
- 未读数量徽章显示

### 钉钉通知
- 询价单发布通知
- 报价提醒
- 中标通知
- 系统通知

## 📊 消息队列

使用 BullMQ 处理异步任务：

- **OCR队列**: 快递单号OCR识别
- **通知队列**: 发送通知
- **售后队列**: 售后处理
- **拍卖队列**: 询价单关闭处理

## ⏰ 定时任务

使用 @nestjs/schedule 实现：

- 询价单关闭检查
- 报价提醒
- 数据统计更新

## 🔐 安全特性

- JWT 认证
- 角色权限控制（RBAC）
- 数据脱敏（供应商未中标时隐藏敏感信息）
- 输入验证（class-validator）
- SQL注入防护（Prisma ORM）

## 📦 部署

### 生产环境配置

1. 设置环境变量
2. 配置数据库连接
3. 配置 Redis 连接
4. 配置 MinIO 存储
5. 配置钉钉机器人
6. 设置 HTTPS（推荐）

## 🐛 故障排查

### 常见问题

1. **Worker 启动失败**
   - 检查 Redis 连接
   - 检查环境变量配置
   - 查看日志：`npm run worker:dev`

2. **数据库连接失败**
   - 检查 DATABASE_URL 配置
   - 确认 PostgreSQL 服务运行
   - 检查数据库权限

3. **文件上传失败**
   - 检查 MinIO 配置
   - 确认存储桶存在
   - 检查文件大小限制

4. **通知不工作**
   - 检查钉钉 Webhook URL
   - 确认用户已配置 sendDingTalk
   - 查看通知服务日志

## 📚 相关文档

- [Prisma 文档](https://www.prisma.io/docs)
- [NestJS 文档](https://docs.nestjs.com)
- [Next.js 文档](https://nextjs.org/docs)
- [BullMQ 文档](https://docs.bullmq.io)

## 📄 许可证

私有项目，未经授权不得使用。

## 👨‍💻 维护

如有问题或建议，请联系开发团队。

---

**最后更新**: 2025-11-18

