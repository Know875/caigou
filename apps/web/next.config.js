/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  output: 'standalone',
  // 允许开发环境下的跨域请求（用于手机访问）
  // 注意：allowedDevOrigins 只支持字符串，不支持正则表达式
  // 如果需要支持多个 IP，需要动态生成列表或使用通配符
  allowedDevOrigins: process.env.ALLOWED_DEV_ORIGINS 
    ? process.env.ALLOWED_DEV_ORIGINS.split(',')
    : [
        'http://192.168.1.25:8080',
        'http://192.168.1.25',
        'http://localhost:8080',
        'http://127.0.0.1:8080',
      ],
  
  // 性能优化配置
  compress: true, // 启用 Gzip 压缩
  poweredByHeader: false, // 移除 X-Powered-By 头
  
  // 图片优化
  images: {
    formats: ['image/avif', 'image/webp'],
    deviceSizes: [640, 750, 828, 1080, 1200, 1920, 2048, 3840],
    imageSizes: [16, 32, 48, 64, 96, 128, 256, 384],
    minimumCacheTTL: 60,
  },
  
  // 实验性功能
  experimental: {
    optimizeCss: true, // 优化 CSS
  },
  
  // 生产环境移除 console
  ...(process.env.NODE_ENV === 'production' && {
    compiler: {
      removeConsole: {
        exclude: ['error', 'warn'], // 保留 error 和 warn
      },
    },
  }),
};

module.exports = nextConfig;

