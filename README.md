# 模型玩具采购协同系统

**版本**: 1.0.0  
**发布日期**: 2025-01-21

## 📋 简介

多门店模型玩具采购协同系统，支持询价、报价、中标、发货、财务等完整的采购业务流程。

## 🚀 快速开始

### 环境要求

- Node.js >= 18.0.0
- MySQL >= 8.0
- Redis >= 6
- MinIO (可选，用于文件存储)

### 安装和启动

```bash
# 1. 安装依赖
npm install

# 2. 配置环境变量
# 复制 env.local.example 为 apps/api/.env.local 并配置

# 3. 初始化数据库
npm run db:generate
npm run db:migrate

# 4. 启动服务（Windows PowerShell）
.\start-all.ps1

# 或使用 npm
npm run dev
```

### 访问地址

- **前端**: http://localhost:8080
- **API**: http://localhost:8081
- **API文档**: http://localhost:8081/api/docs

## 📚 详细文档

- **[PROJECT.md](./PROJECT.md)** - 项目文档（项目结构、核心功能、开发指南）
- **[DEPLOYMENT.md](./DEPLOYMENT.md)** - 服务器部署指南（完整部署步骤、环境配置、Nginx、PM2）
- **[CHANGELOG.md](./CHANGELOG.md)** - 版本更新日志

### 部署文档包含：

- 服务器环境配置（Node.js、MySQL、Redis、Nginx、MinIO）
- 数据库和 Redis 密码配置
- 代码部署步骤
- 环境变量配置（包含 Redis 密码配置）
- PM2 进程管理
- Nginx 反向代理配置
- SSL 证书配置（Let's Encrypt）
- 监控和日志管理
- 备份和恢复方案
- 常见问题排查
- 安全建议和性能优化


## 🔑 默认账号

系统初始化后会创建以下测试账号：

- **管理员**: admin@example.com / admin123
- **采购员**: buyer@example.com / buyer123
- **供应商**: supplier@example.com / supplier123

## ⚙️ 技术栈

- **前端**: Next.js 15 + React + TypeScript + Tailwind CSS
- **后端**: NestJS + TypeScript + Prisma + MySQL
- **队列**: BullMQ + Redis
- **存储**: MinIO (S3兼容)
- **认证**: JWT + RBAC

## 📝 许可证

私有项目，未经授权不得使用。

---

## 📦 版本信息

- **当前版本**: 1.0.0
- **发布日期**: 2025-01-21
- **查看更新日志**: [CHANGELOG.md](./CHANGELOG.md)

---

**最后更新**: 2025-01-21
