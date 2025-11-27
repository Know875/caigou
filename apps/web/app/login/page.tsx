'use client';

import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { authApi } from '@/lib/auth';
import api from '@/lib/api';

// 错误类型定义
interface NetworkError extends Error {
  name: 'AbortError' | 'TimeoutError' | 'NetworkError';
  code?: string;
}

interface ApiError extends Error {
  response?: {
    status?: number;
    statusText?: string;
    data?: {
      message?: string;
    };
  };
  code?: string;
}

// 类型守卫函数
function isNetworkError(err: unknown): err is NetworkError {
  if (err instanceof Error) {
    return (
      err.name === 'AbortError' ||
      err.name === 'TimeoutError' ||
      err.name === 'NetworkError' ||
      (err as NetworkError).code === 'ERR_NETWORK' ||
      (err as NetworkError).code === 'ECONNABORTED' ||
      err.message?.includes('Network Error') ||
      err.message?.includes('timeout') ||
      err.message?.includes('Failed to fetch')
    );
  }
  return false;
}

function isApiError(err: unknown): err is ApiError {
  return err instanceof Error && 'response' in err;
}

// 获取错误消息的辅助函数
function getErrorMessage(err: unknown): string {
  if (err instanceof Error) {
    return err.message;
  }
  if (typeof err === 'string') {
    return err;
  }
  return '发生未知错误';
}

export default function LoginPage() {
  const router = useRouter();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [apiStatus, setApiStatus] = useState<'checking' | 'online' | 'offline'>('checking');
  const [mounted, setMounted] = useState(false);

  // 确保只在客户端执行
  useEffect(() => {
    setMounted(true);
  }, []);

  // 检查 API 连接状态（只在客户端挂载后执行）
  useEffect(() => {
    if (!mounted) return;
    const checkApiConnection = async () => {
      try {
        // 直接使用 fetch 来避免 axios 的拦截器可能的问题
        // 优先使用 localStorage 中保存的 API 地址
        let apiUrl = 'http://localhost:8081';
        if (typeof window !== 'undefined') {
          const savedApiUrl = localStorage.getItem('API_URL');
          if (savedApiUrl) {
            apiUrl = savedApiUrl;
          } else {
            const currentHost = window.location.hostname;
            apiUrl = currentHost === 'localhost' || currentHost === '127.0.0.1'
              ? 'http://localhost:8081'
              : `http://${currentHost}:8081`;
          }
        }
        
        // console.log('[连接检查] 尝试连接:', `${apiUrl}/api/auth/health`);
        
        const response = await fetch(`${apiUrl}/api/auth/health`, {
          method: 'GET',
          headers: {
            'Content-Type': 'application/json',
          },
          signal: AbortSignal.timeout(5000), // 5秒超时
        });
        
        if (response.ok) {
          const data = await response.json();
          if (data?.status === 'ok' || data?.data?.status === 'ok') {
            // console.log('[连接检查] 服务器在线');
            setApiStatus('online');
          } else {
            console.warn('[连接检查] 服务器响应异常', data);
            setApiStatus('offline');
          }
        } else {
          console.warn('[连接检查] 服务器响应错误', response.status, response.statusText);
          // 即使状态码不是200，也说明服务器是可访问的
          setApiStatus('online');
        }
      } catch (err: unknown) {
        console.error('[连接检查] 错误:', err);
        // 如果是网络错误或超时，说明 API 不可访问
        if (isNetworkError(err)) {
          console.error('[连接检查] 无法连接到服务器');
          setApiStatus('offline');
        } else {
          // 其他错误可能说明服务器是可访问的
          console.warn('[连接检查] 其他错误，但服务器可能可访问:', err);
          setApiStatus('online');
        }
      }
    };

    // 立即检查一次
    checkApiConnection();
    // 每5秒检查一次连接状态
    const interval = setInterval(checkApiConnection, 5000);
    return () => clearInterval(interval);
  }, [mounted]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    
    // 基础验证
    if (!email || !password) {
      setError('请输入邮箱和密码');
      return;
    }
    
    // console.log('=== 登录开始 ===');
    // console.log('[登录] 表单提交，邮箱', email);
    // console.log('[登录] 密码长度:', password.length);
    // console.log('[登录] 当前 URL:', typeof window !== 'undefined' ? window.location.href : 'unknown');
    
    setLoading(true);
    setError('');

    try {
      // 先测试 API 连接
      const apiUrl = localStorage.getItem('API_URL') || (typeof window !== 'undefined' 
        ? (window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1'
            ? 'http://localhost:8081'
            : `http://${window.location.hostname}:8081`)
        : 'http://localhost:8081');
      
      // console.log('[登录] 使用的 API 地址:', apiUrl);
      // console.log('[登录] 调用 authApi.login...');
      
      const result = await authApi.login({ email, password });
      // console.log('[登录] 登录成功，准备跳转', result);
      router.push('/dashboard');
    } catch (err: unknown) {
      const apiErr = isApiError(err) ? err : null;
      const networkErr = isNetworkError(err) ? err : null;
      
      console.error('[登录] 登录错误详情:', {
        message: err instanceof Error ? err.message : String(err),
        code: apiErr?.code || networkErr?.code,
        status: apiErr?.response?.status,
        statusText: apiErr?.response?.statusText,
        responseData: apiErr?.response?.data,
      });
      
      // 详细错误处理
      let errorMessage = apiErr?.response?.data?.message || getErrorMessage(err);
      
      if (apiErr?.response) {
        // 有响应，说明服务器可访问
        const responseData = apiErr.response.data;
        // console.log('[登录] 服务器响应数据', responseData);
        
        if (apiErr.response.status === 401) {
          errorMessage = '邮箱或密码错误，请检查后重试';
        } else if (apiErr.response.status === 400) {
          // 验证错误
          if (Array.isArray(responseData?.message)) {
            errorMessage = responseData.message.join(', ');
          } else {
            errorMessage = responseData?.message || '请求参数错误';
          }
        } else if (apiErr.response.status === 500) {
          errorMessage = '服务器内部错误，请稍后重试';
        } else if (apiErr.response.status) {
          errorMessage = (responseData?.message as string) || `服务器错误 ${apiErr.response.status} ${apiErr.response.statusText || ''}`;
        }
      } else if (networkErr) {
        errorMessage = '无法连接到服务器，请检查网络连接';
      } else if (err instanceof Error && err.message?.includes('access_token')) {
        errorMessage = '登录响应格式错误，请联系管理员';
      } else {
        errorMessage = getErrorMessage(err);
      }
      
      console.error('[登录] 最终错误消息', errorMessage);
      setError(errorMessage);
      
      // 如果是网络错误，显示更详细的提示
      if (networkErr || (apiErr?.response?.status === 0) || (apiErr?.code === 'ECONNABORTED')) {
        const currentHost = typeof window !== 'undefined' ? window.location.hostname : 'unknown';
        const apiUrl = typeof window !== 'undefined' 
          ? (currentHost === 'localhost' || currentHost === '127.0.0.1' 
              ? 'http://localhost:8081' 
              : `http://${currentHost}:8081`)
          : 'http://localhost:8081';
        
        setError(`无法连接到服务器 (${apiUrl})\n\n可能的原因：\n1. API 服务未运行或未监听 0.0.0.0\n2. 手机和电脑不在同一 WiFi 网络\n3. 路由器阻止了设备间通信\n4. API 服务崩溃或端口被占用\n\n排查步骤：\n1. 在电脑浏览器访问: ${apiUrl}/api/auth/health\n2. 在手机浏览器访问: ${apiUrl}/api/auth/health\n3. 检查 API 服务控制台是否有错误\n4. 确认 API 服务显示: "监听 0.0.0.0:8081"`);
      }
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="flex min-h-screen items-center justify-center bg-gray-50">
      <div className="w-full max-w-md space-y-8 rounded-lg bg-white p-8 shadow-md">
        <div>
          <h2 className="mt-6 text-center text-3xl font-bold text-gray-900">
            登录
          </h2>
          <p className="mt-2 text-center text-sm text-gray-600">
            多门店模式玩具采购协同系统
          </p>
        </div>
        <form className="mt-8 space-y-6" onSubmit={handleSubmit}>
          {/* API 连接状态提示 */}
          {apiStatus === 'checking' && (
            <div className="rounded-md bg-blue-50 p-3 text-sm text-blue-800">
              🔍 正在检查服务器连接...
            </div>
          )}
          {apiStatus === 'offline' && (
            <div className="rounded-md bg-yellow-50 p-3 text-sm text-yellow-800">
              ⚠️ 无法连接到服务器，请检查 API 服务是否运行
              <div className="mt-2 text-xs">
                {mounted && typeof window !== 'undefined' && (
                  <>
                    当前访问: {window.location.hostname}
                    <br />
                    尝试连接: http://{window.location.hostname}:8081/api/auth/health
                  </>
                )}
              </div>
            </div>
          )}
          {apiStatus === 'online' && (
            <div className="rounded-md bg-green-50 p-3 text-sm text-green-800">
              ✅ 服务器连接正常
            </div>
          )}
          
          {error && (
            <div className="rounded-md bg-red-50 p-4 text-sm text-red-800 whitespace-pre-line">
              {error}
            </div>
          )}
          <div className="space-y-4">
            <div>
              <label htmlFor="email" className="block text-sm font-medium text-gray-700">
                邮箱
              </label>
              <input
                id="email"
                name="email"
                type="email"
                required
                autoComplete="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                className="mt-1 block w-full rounded-md border border-gray-300 px-3 py-2 shadow-sm focus:border-blue-500 focus:outline-none focus:ring-blue-500"
                placeholder="xx@xx.com"
              />
            </div>
            <div>
              <label htmlFor="password" className="block text-sm font-medium text-gray-700">
                密码
              </label>
              <input
                id="password"
                name="password"
                type="password"
                required
                autoComplete="current-password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                className="mt-1 block w-full rounded-md border border-gray-300 px-3 py-2 shadow-sm focus:border-blue-500 focus:outline-none focus:ring-blue-500"
                placeholder="••••••••"
              />
            </div>
          </div>

          <div className="space-y-2">
            <button
              type="submit"
              disabled={loading}
              onClick={() => {
                // console.log('[登录] 按钮被点击');
                // console.log('[登录] 当前状态- email:', email, 'password:', password ? '***' : 'empty', 'loading:', loading);
              }}
              className="w-full rounded-md bg-blue-600 px-4 py-2 text-white hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2 disabled:opacity-50"
            >
              {loading ? '登录中...' : '登录'}
            </button>
            <div className="flex flex-col gap-3 pt-2">
              <div className="text-center">
                <a 
                  href="/register-store" 
                  className="inline-flex items-center gap-2 rounded-lg border border-blue-600 bg-white px-4 py-2 text-sm font-medium text-blue-600 transition-all hover:bg-blue-50 hover:text-blue-700 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2"
                >
                  <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 21V5a2 2 0 00-2-2H7a2 2 0 00-2 2v16m14 0h2m-2 0h-5m-9 0H3m2 0h5M9 7h1m-1 4h1m4-4h1m-1 4h1m-5 10v-5a1 1 0 011-1h2a1 1 0 011 1v5m-4 0h4" />
                  </svg>
                  新门店注册
                </a>
              </div>
              <div className="text-center">
                <a 
                  href="/register-supplier" 
                  className="inline-flex items-center gap-2 rounded-lg border border-green-600 bg-white px-4 py-2 text-sm font-medium text-green-600 transition-all hover:bg-green-50 hover:text-green-700 focus:outline-none focus:ring-2 focus:ring-green-500 focus:ring-offset-2"
                >
                  <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 13.255A23.931 23.931 0 0112 15c-3.183 0-6.22-.62-9-1.745M16 6V4a2 2 0 00-2-2h-4a2 2 0 00-2 2v2m4 6h.01M5 20h14a2 2 0 002-2V8a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z" />
                  </svg>
                  新供应商注册
                </a>
              </div>
            </div>
          </div>
        </form>
      </div>
    </div>
  );
}
