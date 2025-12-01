import axios from 'axios';
import http from 'http';
import https from 'https';
import { apiCache, ApiCache } from './api-cache';

// 创建 HTTP Agent 以支持 keep-alive（保持连接活跃）
const httpAgent = new http.Agent({
  keepAlive: true,
  keepAliveMsecs: 30000, // 30秒
  maxSockets: 50,
  maxFreeSockets: 10,
  timeout: 60000, // 60秒超时
});

const httpsAgent = new https.Agent({
  keepAlive: true,
  keepAliveMsecs: 30000, // 30秒
  maxSockets: 50,
  maxFreeSockets: 10,
  timeout: 60000, // 60秒超时
});

// 动态获取 API URL
// 1. 优先使用环境变量
// 2. 如果是在浏览器环境，尝试从 localStorage 获取 API 地址（由启动脚本设置）
// 3. 根据当前域名自动推断 API 地址
// 4. 默认使用 localhost
function getApiUrl(): string {
  // 在客户端运行时，优先根据当前 hostname 推断（避免 CORS 问题）
  if (typeof window !== 'undefined') {
    const hostname = window.location.hostname;
    const protocol = window.location.protocol;
    
    // 如果是 localhost 或 127.0.0.1，使用 localhost
    if (hostname === 'localhost' || hostname === '127.0.0.1') {
      // 检查环境变量，但如果是 localhost 环境变量，也使用它
      if (process.env.NEXT_PUBLIC_API_URL && !process.env.NEXT_PUBLIC_API_URL.includes('localhost')) {
        return process.env.NEXT_PUBLIC_API_URL;
      }
      return 'http://localhost:8081';
    }
    
    // 否则使用相同的 hostname，端口 8081（避免 CORS 问题）
    // 确保使用 http:// 而不是 https://（开发环境）
    const apiProtocol = protocol === 'https:' ? 'https:' : 'http:';
    const inferredUrl = `${apiProtocol}//${hostname}:8081`;
    
    // 检查环境变量，但如果环境变量包含 localhost，而当前是 IP 地址，则忽略环境变量
    if (process.env.NEXT_PUBLIC_API_URL) {
      const envUrl = process.env.NEXT_PUBLIC_API_URL;
      // 如果环境变量包含 localhost，但当前访问地址是 IP，则使用推断的地址
      if (envUrl.includes('localhost') && !hostname.includes('localhost')) {
        console.warn('[API] 环境变量包含 localhost，但当前访问地址是 IP，使用推断的地址:', inferredUrl);
        localStorage.setItem('API_URL', inferredUrl);
        return inferredUrl;
      }
      // 如果环境变量与推断的地址匹配，使用环境变量
      if (envUrl.includes(hostname)) {
        // console.log('[API] 使用环境变量 API 地址:', envUrl);
        localStorage.setItem('API_URL', envUrl);
        return envUrl;
      }
    }
    
    // 检查 localStorage 中保存的地址
    const savedApiUrl = localStorage.getItem('API_URL');
    if (savedApiUrl) {
      // 如果保存的地址包含 localhost，但当前访问地址是 IP，则使用推断的地址
      if (savedApiUrl.includes('localhost') && !hostname.includes('localhost')) {
        console.warn('[API] 检测到保存的 API 地址包含 localhost，但当前访问地址是 IP，自动切换到:', inferredUrl);
        localStorage.setItem('API_URL', inferredUrl);
        return inferredUrl;
      }
      // 如果保存的地址与推断的地址匹配，使用保存的地址
      if (savedApiUrl.includes(hostname)) {
        // console.log('[API] 使用保存的 API 地址:', savedApiUrl);
        return savedApiUrl;
      }
      // 如果不匹配，使用推断的地址并更新 localStorage
      console.warn('[API] 保存的 API 地址与当前 hostname 不匹配，自动切换到', inferredUrl);
      localStorage.setItem('API_URL', inferredUrl);
      return inferredUrl;
    }
    
    // console.log('[API] 推断的 API 地址:', inferredUrl);
    // console.log('[API] 当前 hostname:', hostname);
    // 自动保存推断的地址到 localStorage
    localStorage.setItem('API_URL', inferredUrl);
    
    return inferredUrl;
  }
  
  // 服务端渲染时使用环境变量或默认值
  if (process.env.NEXT_PUBLIC_API_URL) {
    return process.env.NEXT_PUBLIC_API_URL;
  }
  return 'http://localhost:8081';
}

// 创建 axios 实例，baseURL 会在请求时动态获取
export const api = axios.create({
  baseURL: '/api', // 临时值，会在拦截器中动态设置
  headers: {
    'Content-Type': 'application/json',
    'Accept': 'application/json',
    // 注意：不能手动设置 'Connection' 头，浏览器会自动管理
    // HTTP Agent 已经配置了 keep-alive，浏览器会自动使用
  },
  timeout: 30000, // 30秒超时
  httpAgent: httpAgent, // 使用 keep-alive agent（浏览器环境会自动忽略，但 Node.js 环境会使用）
  httpsAgent: httpsAgent, // 使用 keep-alive agent（浏览器环境会自动忽略，但 Node.js 环境会使用）
});

// 在请求拦截器中动态设置 baseURL
api.interceptors.request.use((config) => {
  // 动态获取 API URL
  const apiUrl = getApiUrl();
  config.baseURL = `${apiUrl}/api`;
  
  // 设置默认超时时间（如果未设置）
  if (!config.timeout) {
    config.timeout = 30000; // 30秒超时
  }
  
  // 注意：请求去重和缓存检查在响应拦截器中处理，这里只标记
  // 因为 axios 拦截器不能直接返回 Promise 来中断请求
  
  // 始终输出调试信息（包括手机端）
  if (typeof window !== 'undefined') {
    const hostname = window.location.hostname;
    // console.log('=== API 请求 ===');
    // console.log(`[API] 方法: ${config.method?.toUpperCase()}`);
    // console.log(`[API] 路径: ${config.url}`);
    // console.log(`[API] BaseURL: ${config.baseURL}`);
    // console.log(`[API] 完整 URL: ${config.baseURL}${config.url}`);
    
    // 解析并打印查询参数（如果有）
    if (config.url && config.url.includes('?')) {
      const urlParts = config.url.split('?');
      const queryString = urlParts[1];
      const params = new URLSearchParams(queryString);
      // console.log(`[API] 查询参数:`, Object.fromEntries(params.entries()));
    }
    
    // console.log(`[API] 当前域名: ${hostname}`);
    // console.log(`[API] API 地址: ${apiUrl}`);
    // console.log(`[API] 环境变量 NEXT_PUBLIC_API_URL: ${process.env.NEXT_PUBLIC_API_URL || '未设置'}`);
    // console.log(`[API] localStorage API_URL: ${localStorage.getItem('API_URL') || '未设置'}`);
    
    // 如果检测到使用 localhost 但当前是 IP 地址，强制修复
    if (apiUrl.includes('localhost') && !hostname.includes('localhost') && hostname !== '127.0.0.1') {
      const fixedUrl = `http://${hostname}:8081`;
      console.error(`[API] ⚠️ 检测到 CORS 问题！当前使用 localhost，但访问地址是 IP，强制切换到: ${fixedUrl}`);
      config.baseURL = `${fixedUrl}/api`;
      localStorage.setItem('API_URL', fixedUrl);
      // console.log(`[API] 修复后的 BaseURL: ${config.baseURL}`);
      // console.log(`[API] 修复后的完整 URL: ${config.baseURL}${config.url}`);
    }
    
    if (config.data) {
      // console.log(`[API] 请求数据:`, config.data);
    }
    // console.log(`[API] 请求头:`, config.headers);
    // console.log('===============');
  }
  
  if (typeof window !== 'undefined') {
    const token = localStorage.getItem('token');
    if (token) {
      config.headers.Authorization = `Bearer ${token}`;
    }
  }
  // 如果是 FormData，让 axios 自动设置 Content-Type（包括 boundary）
  if (config.data instanceof FormData) {
    delete config.headers['Content-Type'];
  }
  
  return config;
});


// 响应拦截器：处理错误和缓存
api.interceptors.response.use(
  (response) => {
    // 缓存 GET 请求的响应
    if (response.config.method === 'get' && typeof window !== 'undefined') {
      const cacheKey = ApiCache.generateKey(
        response.config.method || 'get',
        response.config.url || '',
        response.config.params
      );
      // 缓存 30 秒
      apiCache.set(cacheKey, response.data, 30000);
    }
    return response;
  },
  (error) => {
    // 处理请求去重和缓存
    if (error.isDuplicate && error.promise) {
      return error.promise;
    }
    if (error.isCached && error.data) {
      return Promise.resolve({ data: error.data, config: error.config });
    }
    // 始终输出错误详情（包括手机端）
    if (typeof window !== 'undefined') {
      console.error('=== API 请求失败 ===');
      console.error('[API] URL:', error.config?.url);
      console.error('[API] BaseURL:', error.config?.baseURL);
      console.error('[API] 完整 URL:', error.config ? `${error.config.baseURL}${error.config.url}` : 'unknown');
      console.error('[API] 方法:', error.config?.method);
      console.error('[API] 状态码:', error.response?.status);
      console.error('[API] 状态文本:', error.response?.statusText);
      console.error('[API] 错误消息:', error.message);
      console.error('[API] 错误代码:', error.code);
      console.error('[API] 响应数据:', error.response?.data);
      console.error('[API] 请求数据:', error.config?.data);
      console.error('[API] 完整错误对象:', error);
      console.error('==================');
      
      // 如果是网络错误，输出更多信息
      if (error.code === 'ERR_NETWORK' || error.message?.includes('Network Error')) {
        console.error('[API] 网络错误详情:', {
          message: error.message,
          code: error.code,
          config: error.config,
          request: error.request,
          attemptedUrl: error.config ? `${error.config.baseURL}${error.config.url}` : 'unknown',
        });
      }
    }
    
    if (error.response?.status === 401) {
      // 未授权，清除 token 并跳转到登录页
      // 但是注册接口的 401 错误不应该跳转，应该让前端处理错误消息
      const url = error.config?.url || '';
      const isRegisterEndpoint = url.includes('/auth/register-store') || url.includes('/auth/register-supplier');
      
      if (!isRegisterEndpoint && typeof window !== 'undefined') {
        localStorage.removeItem('token');
        window.location.href = '/login';
      }
    }
    
    return Promise.reject(error);
  },
);

// 心跳机制：定期发送请求保持连接活跃（仅在浏览器环境）
if (typeof window !== 'undefined') {
  let heartbeatInterval: NodeJS.Timeout | null = null;
  let lastActivityTime = Date.now();
  const HEARTBEAT_INTERVAL = 60000; // 60秒发送一次心跳
  const INACTIVITY_THRESHOLD = 300000; // 5分钟无活动后开始心跳

  // 监听用户活动
  const activityEvents = ['mousedown', 'mousemove', 'keypress', 'scroll', 'touchstart', 'click'];
  const handleActivity = () => {
    lastActivityTime = Date.now();
  };

  activityEvents.forEach(event => {
    window.addEventListener(event, handleActivity, { passive: true });
  });

  // 心跳函数
  const sendHeartbeat = async () => {
    try {
      // 检查是否有 token（用户已登录）
      const token = localStorage.getItem('token');
      if (!token) {
        return; // 未登录，不需要心跳
      }

      // 检查是否长时间无活动
      const timeSinceLastActivity = Date.now() - lastActivityTime;
      if (timeSinceLastActivity < INACTIVITY_THRESHOLD) {
        return; // 用户活跃，不需要心跳
      }

      // 发送轻量级请求保持连接（使用健康检查端点）
      await api.get('/health', { timeout: 5000 }).catch(() => {
        // 忽略错误，心跳失败不影响用户体验
      });
    } catch (error) {
      // 静默失败，不影响用户体验
    }
  };

  // 启动心跳（延迟启动，避免影响初始加载）
  setTimeout(() => {
    heartbeatInterval = setInterval(sendHeartbeat, HEARTBEAT_INTERVAL);
  }, 30000); // 30秒后开始心跳

  // 页面卸载时清理
  window.addEventListener('beforeunload', () => {
    if (heartbeatInterval) {
      clearInterval(heartbeatInterval);
    }
    activityEvents.forEach(event => {
      window.removeEventListener(event, handleActivity);
    });
  });
}

export default api;

