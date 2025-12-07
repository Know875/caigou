module.exports = {
  apps: [
    {
      name: 'caigou-api',
      script: 'apps/api/dist/main.js',
      cwd: '/root/caigou/caigou',
      instances: 1, // 减少到 1 个实例（减少内存占用）
      exec_mode: 'cluster',
      env: {
        NODE_ENV: 'production',
      },
      error_file: './logs/api-error.log',
      out_file: './logs/api-out.log',
      log_date_format: 'YYYY-MM-DD HH:mm:ss Z',
      merge_logs: true,
      autorestart: true,
      max_memory_restart: '800M', // 减少内存限制
      min_uptime: '10s',
      max_restarts: 10,
      watch: false,
    },
    {
      name: 'caigou-worker',
      script: 'apps/api/dist/worker.js',
      cwd: '/root/caigou/caigou',
      instances: 1,
      exec_mode: 'fork',
      env: {
        NODE_ENV: 'production',
      },
      error_file: './logs/worker-error.log',
      out_file: './logs/worker-out.log',
      log_date_format: 'YYYY-MM-DD HH:mm:ss Z',
      merge_logs: true,
      autorestart: true,
      max_memory_restart: '800M', // 减少内存限制
      watch: false,
    },
    {
      name: 'caigou-web',
      script: 'node_modules/.bin/next',
      args: 'start -p 3000',
      cwd: '/root/caigou/caigou/apps/web',
      instances: 1, // 减少到 1 个实例（减少内存占用）
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
      max_memory_restart: '800M', // 减少内存限制
      watch: false,
    },
  ],
};

