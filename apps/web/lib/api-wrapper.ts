/**
 * API 请求包装器，提供缓存和请求去重功能
 */
import { api } from './api';
import { apiCache, ApiCache } from './api-cache';

/**
 * 带缓存的 GET 请求
 */
export async function cachedGet<T = any>(
  url: string,
  config?: any
): Promise<{ data: T }> {
  if (typeof window === 'undefined') {
    // 服务端直接请求
    return api.get(url, config);
  }

  const cacheKey = ApiCache.generateKey('get', url, config?.params);
  
  // 检查缓存
  const cachedData = apiCache.get<T>(cacheKey);
  if (cachedData) {
    return Promise.resolve({ data: cachedData });
  }
  
  // 检查是否有正在进行的相同请求
  const pendingRequest = apiCache.getPendingRequest<{ data: T }>(cacheKey);
  if (pendingRequest) {
    return pendingRequest;
  }
  
  // 发起新请求
  const requestPromise = api.get<T>(url, config);
  apiCache.setPendingRequest(cacheKey, requestPromise);
  
  // 请求成功后缓存
  requestPromise.then((response) => {
    apiCache.set(cacheKey, response.data, 30000);
  });
  
  return requestPromise;
}

/**
 * 清除指定 URL 的缓存
 */
export function clearCache(url: string, params?: any): void {
  const cacheKey = ApiCache.generateKey('get', url, params);
  apiCache.delete(cacheKey);
}

/**
 * 清除所有缓存
 */
export function clearAllCache(): void {
  apiCache.clear();
}

