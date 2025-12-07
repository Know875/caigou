module.exports = {
  apps: [
    {
      name: 'caigou-api',
      script: 'apps/api/dist/main.js',
      cwd: '/root/caigou/caigou',
      instances: 2, // 2 个实例（cluster 模式）
      exec_mode: 'cluster',
      env: {
        NODE_ENV: 'production',
      },
      error_file: './logs/api-error.log',
      out_file: './logs/api-out.log',
      log_date_format: 'YYYY-MM-DD HH:mm:ss Z',
      merge_logs: true,
      autorestart: true,
      max_memory_restart: '1G',
      // 自动重启配置
      min_uptime: '10s',
      max_restarts: 10,
      // 监听文件变化（开发环境）
      watch: false,
    },
    {
      name: 'caigou-worker',
      script: 'apps/api/dist/worker.js',
      cwd: '/root/caigou/caigou',
      instances: 1, // Worker 只需要 1 个实例
      exec_mode: 'fork',
      env: {
        NODE_ENV: 'production',
      },
      error_file: './logs/worker-error.log',
      out_file: './logs/worker-out.log',
      log_date_format: 'YYYY-MM-DD HH:mm:ss Z',
      merge_logs: true,
      autorestart: true,
      max_memory_restart: '1G',
      watch: false,
    },
    {
      name: 'caigou-web',
      script: 'node_modules/.bin/next',
      args: 'start -p 3000',
      cwd: '/root/caigou/caigou/apps/web',
      instances: 2, // 2 个实例（cluster 模式）
      exec_mode: 'cluster',
      env: {
        NODE_ENV: 'production',
        PORT: 3000,
      },
      error_file: '../logs/web-error.log',
      out_file: '../logs/web-out.log',
      log_date_format: 'YYYY-MM-DD HH:mm:ss Z',
      merge_logs: true,
      autorestart: true,
      max_memory_restart: '1G',
      watch: false,
    },
  ],
};

