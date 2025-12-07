#!/usr/bin/env node

/**
 * GitHub Webhook 服务
 * 监听 GitHub webhook 事件，自动拉取最新代码并重启服务
 */

const http = require('http');
const crypto = require('crypto');
const { exec } = require('child_process');
const path = require('path');

// 配置
const PORT = process.env.WEBHOOK_PORT || 9001;
const SECRET = process.env.GITHUB_WEBHOOK_SECRET || ''; // GitHub webhook secret
const PROJECT_DIR = process.env.PROJECT_DIR || '/root/caigou/caigou';
const BRANCH = process.env.GITHUB_BRANCH || 'main';

// 日志函数
function log(message, data = {}) {
  const timestamp = new Date().toISOString();
  console.log(`[${timestamp}] ${message}`, Object.keys(data).length > 0 ? JSON.stringify(data, null, 2) : '');
}

// 执行命令
function execCommand(command, cwd = PROJECT_DIR) {
  return new Promise((resolve, reject) => {
    log(`执行命令: ${command}`, { cwd });
    exec(command, { cwd, maxBuffer: 10 * 1024 * 1024 }, (error, stdout, stderr) => {
      if (error) {
        log(`命令执行失败: ${error.message}`, { stderr });
        reject(error);
      } else {
        log(`命令执行成功`, { stdout: stdout.substring(0, 500) }); // 只显示前500字符
        resolve(stdout);
      }
    });
  });
}

// 验证 GitHub webhook 签名
function verifySignature(payload, signature) {
  if (!SECRET) {
    log('警告: 未设置 GITHUB_WEBHOOK_SECRET，跳过签名验证');
    return true; // 如果没有设置 secret，跳过验证（不推荐生产环境）
  }

  const hmac = crypto.createHmac('sha256', SECRET);
  const digest = 'sha256=' + hmac.update(payload).digest('hex');
  return crypto.timingSafeEqual(Buffer.from(signature), Buffer.from(digest));
}

// 处理 webhook 事件
async function handleWebhook(payload) {
  try {
    const event = JSON.parse(payload);
    
    // 只处理 push 事件
    if (event.ref !== `refs/heads/${BRANCH}`) {
      log(`忽略分支: ${event.ref}`, { expected: `refs/heads/${BRANCH}` });
      return { success: false, message: '分支不匹配' };
    }

    log('收到 GitHub push 事件', { 
      ref: event.ref, 
      commits: event.commits?.length || 0,
      repository: event.repository?.full_name 
    });

    // 拉取最新代码
    log('开始拉取最新代码...');
    await execCommand(`git pull origin ${BRANCH}`);

    // 安装依赖（如果需要）
    log('检查并安装依赖...');
    try {
      await execCommand('npm install');
    } catch (error) {
      log('npm install 失败，继续执行', { error: error.message });
    }

    // 重新生成 Prisma Client
    log('重新生成 Prisma Client...');
    try {
      await execCommand('cd apps/api && npx prisma generate && cd ../..');
    } catch (error) {
      log('Prisma generate 失败，继续执行', { error: error.message });
    }

    // 重新构建前端
    log('重新构建前端...');
    try {
      await execCommand('cd apps/web && rm -rf .next && npm run build && cd ../..');
    } catch (error) {
      log('前端构建失败', { error: error.message });
      throw error; // 构建失败时抛出错误
    }

    // 重启 PM2 服务
    log('重启 PM2 服务...');
    await execCommand('pm2 restart all');

    log('✅ 部署完成！');
    return { success: true, message: '部署成功' };

  } catch (error) {
    log('❌ 部署失败', { error: error.message, stack: error.stack });
    return { success: false, message: error.message };
  }
}

// 创建 HTTP 服务器
const server = http.createServer((req, res) => {
  // 只处理 POST 请求
  if (req.method !== 'POST') {
    res.writeHead(405, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: 'Method not allowed' }));
    return;
  }

  // 只处理 /webhook 路径
  if (req.url !== '/webhook') {
    res.writeHead(404, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: 'Not found' }));
    return;
  }

  let body = '';
  
  req.on('data', chunk => {
    body += chunk.toString();
  });

  req.on('end', async () => {
    try {
      // 验证签名
      const signature = req.headers['x-hub-signature-256'] || req.headers['x-hub-signature'];
      if (signature && !verifySignature(body, signature)) {
        log('❌ 签名验证失败');
        res.writeHead(401, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Invalid signature' }));
        return;
      }

      // 处理 webhook
      const result = await handleWebhook(body);
      
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(result));

    } catch (error) {
      log('处理 webhook 时出错', { error: error.message });
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: error.message }));
    }
  });
});

// 启动服务器
server.listen(PORT, () => {
  log(`🚀 GitHub Webhook 服务已启动`, { 
    port: PORT, 
    projectDir: PROJECT_DIR,
    branch: BRANCH,
    hasSecret: !!SECRET 
  });
  log('等待 GitHub webhook 事件...');
});

// 错误处理
server.on('error', (error) => {
  log('服务器错误', { error: error.message });
  process.exit(1);
});

// 优雅关闭
process.on('SIGTERM', () => {
  log('收到 SIGTERM，正在关闭服务器...');
  server.close(() => {
    log('服务器已关闭');
    process.exit(0);
  });
});

process.on('SIGINT', () => {
  log('收到 SIGINT，正在关闭服务器...');
  server.close(() => {
    log('服务器已关闭');
    process.exit(0);
  });
});

