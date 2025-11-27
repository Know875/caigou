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
};

module.exports = nextConfig;

