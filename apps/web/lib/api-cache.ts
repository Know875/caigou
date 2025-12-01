/**
 * 简单的内存缓存实现，用于减少重复的 API 请求
 */

interface CacheEntry<T> {
  data: T;
  timestamp: number;
  expiresAt: number;
}

class ApiCache {
  private cache = new Map<string, CacheEntry<any>>();
  private pendingRequests = new Map<string, Promise<any>>();
  private defaultTTL = 30000; // 30秒默认缓存时间

  /**
   * 获取缓存数据
   */
  get<T>(key: string): T | null {
    const entry = this.cache.get(key);
    if (!entry) {
      return null;
    }

    // 检查是否过期
    if (Date.now() > entry.expiresAt) {
      this.cache.delete(key);
      return null;
    }

    return entry.data as T;
  }

  /**
   * 设置缓存数据
   */
  set<T>(key: string, data: T, ttl?: number): void {
    const expiresAt = Date.now() + (ttl || this.defaultTTL);
    this.cache.set(key, {
      data,
      timestamp: Date.now(),
      expiresAt,
    });
  }

  /**
   * 删除缓存
   */
  delete(key: string): void {
    this.cache.delete(key);
  }

  /**
   * 清空所有缓存
   */
  clear(): void {
    this.cache.clear();
  }

  /**
   * 检查是否有正在进行的相同请求（请求去重）
   */
  getPendingRequest<T>(key: string): Promise<T> | null {
    return this.pendingRequests.get(key) || null;
  }

  /**
   * 设置正在进行的请求
   */
  setPendingRequest<T>(key: string, promise: Promise<T>): void {
    this.pendingRequests.set(key, promise);
    promise.finally(() => {
      this.pendingRequests.delete(key);
    });
  }

  /**
   * 生成缓存键
   */
  static generateKey(method: string, url: string, params?: any): string {
    const paramsStr = params ? JSON.stringify(params) : '';
    return `${method}:${url}:${paramsStr}`;
  }
}

export const apiCache = new ApiCache();

