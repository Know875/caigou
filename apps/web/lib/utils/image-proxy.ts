/**
 * 图片代理工具函数
 * 用于解决 MinIO 图片的 CORS 问题
 */

/**
 * 检查 URL 是否是 MinIO URL
 */
export function isMinIOUrl(url: string): boolean {
  if (!url) return false;
  return /:\/\/.*:9000\//.test(url) || /\/eggpurchase\//.test(url);
}

/**
 * 将 MinIO URL 转换为代理 URL
 * 如果 URL 不是 MinIO URL，则返回原 URL
 */
export function getProxiedImageUrl(url: string): string {
  if (!url) return url;
  
  // 如果不是 MinIO URL，直接返回
  if (!isMinIOUrl(url)) {
    return url;
  }
  
  // 使用 API 代理路由
  return `/api/proxy-image?url=${encodeURIComponent(url)}`;
}

