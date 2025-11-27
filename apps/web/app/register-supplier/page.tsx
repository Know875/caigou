'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { authApi } from '@/lib/auth';
import Link from 'next/link';

export default function RegisterSupplierPage() {
  const router = useRouter();
  const [formData, setFormData] = useState({
    email: '',
    username: '',
    password: '',
    confirmPassword: '',
    companyName: '',
    contact: '',
    address: '',
  });
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');

    // 校验必填字段
    if (!formData.email || !formData.username || !formData.password) {
      setError('请填写所有必填字段');
      return;
    }

    // 校验密码长度
    if (formData.password.length < 6) {
      setError('密码长度至少 6 位');
      return;
    }

    // 校验密码确认
    if (formData.password !== formData.confirmPassword) {
      setError('两次输入的密码不一致');
      return;
    }

    setLoading(true);

    try {
      const result = await authApi.registerSupplier({
        email: formData.email,
        username: formData.username,
        password: formData.password,
        companyName: formData.companyName || undefined,
        contact: formData.contact || undefined,
        address: formData.address || undefined,
      });

      // console.log('[注册] 注册成功:', result);

      // 检查是否需要审核
      if (result.requiresApproval || result.message) {
        // 显示成功提示，然后跳转登录页
        alert(
          result.message ||
            '注册成功，您的账号正在审核中，审核通过后即可登录使用。'
        );
        router.push('/login');
      } else {
        router.push('/dashboard');
      }
    } catch (err: any) {
      console.error('[注册] 注册失败:', err);
      console.error('[注册] 错误详情:', {
        message: err.message,
        response: err.response,
        responseData: err.response?.data,
        status: err.response?.status,
      });
      
      // 处理错误消息，可能是字符串或数组
      let errorMessage = '注册失败，请稍后重试';
      
      // 优先从响应数据中提取错误消息
      if (err.response?.data) {
        const responseData = err.response.data;
        // 支持多种响应格式：
        // 1. { success: false, message: "错误消息" }
        // 2. { message: "错误消息" }
        // 3. { message: ["错误消息1", "错误消息2"] }
        if (responseData.message) {
          const msg = responseData.message;
          errorMessage = Array.isArray(msg) ? msg[0] : msg;
        } else if (responseData.error) {
          errorMessage = Array.isArray(responseData.error) ? responseData.error[0] : responseData.error;
        }
      } else if (err.message) {
        errorMessage = err.message;
      }
      
      // 确保错误消息不为空
      if (!errorMessage || errorMessage.trim() === '') {
        errorMessage = '注册失败，请稍后重试';
      }
      
      setError(errorMessage);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="flex min-h-screen items-center justify-center bg-gradient-to-br from-green-50 via-white to-teal-50 py-12 px-4">
      <div className="w-full max-w-lg space-y-8 rounded-xl bg-white p-8 shadow-lg">
        <div className="text-center">
          <div className="mx-auto mb-4 flex h-16 w-16 items-center justify-center rounded-full bg-gradient-to-br from-green-500 to-teal-600">
            <svg
              className="h-8 w-8 text-white"
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M21 13.255A23.931 23.931 0 0112 15c-3.183 0-6.22-.62-9-1.745M16 6V4a2 2 0 00-2-2h-4a2 2 0 00-2 2v2m4 6h.01M5 20h14a2 2 0 002-2V8a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z"
              />
            </svg>
          </div>
          <h2 className="text-3xl font-bold text-gray-900">新供应商注册</h2>
          <p className="mt-2 text-sm text-gray-600">
            加入我们的采购合作伙伴，共建高效稳定供应链。
          </p>
          <div className="mt-4 rounded-lg border border-green-200 bg-green-50 p-3 text-xs text-green-800">
            <div className="flex items-start gap-2">
              <svg
                className="h-4 w-4 flex-shrink-0 text-green-600"
                fill="none"
                stroke="currentColor"
                viewBox="0 0 24 24"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2}
                  d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z"
                />
              </svg>
              <div>
                <p className="font-semibold">注册须知：</p>
                <p className="mt-1">
                  注册成功后，您的账号将进入审核流程。审核通过后即可登录系统使用。
                </p>
                <p className="mt-1">
                  如有疑问，请联系管理员：
                  <a
                    href="tel:17267287629"
                    className="font-semibold text-green-600 hover:underline"
                  >
                    17267287629
                  </a>
                </p>
              </div>
            </div>
          </div>
        </div>

        <form className="mt-8 space-y-6" onSubmit={handleSubmit}>
          {error && (
            <div className="rounded-lg border border-red-200 bg-red-50 p-4 text-sm text-red-800">
              <div className="flex items-start gap-2">
                <svg
                  className="h-5 w-5 flex-shrink-0 text-red-600"
                  fill="none"
                  stroke="currentColor"
                  viewBox="0 0 24 24"
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth={2}
                    d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z"
                  />
                </svg>
                <span>{error}</span>
              </div>
            </div>
          )}

          <div className="space-y-5">
            <div>
              <label
                htmlFor="email"
                className="block text-sm font-semibold text-gray-700"
              >
                邮箱 <span className="text-red-500">*</span>
              </label>
              <input
                id="email"
                name="email"
                type="email"
                required
                value={formData.email}
                onChange={(e) =>
                  setFormData({ ...formData, email: e.target.value })
                }
                className="mt-1 block w-full rounded-lg border border-gray-300 px-4 py-2.5 shadow-sm transition-colors focus:border-green-500 focus:outline-none focus:ring-2 focus:ring-green-500 focus:ring-offset-0"
                placeholder="xx@xx.com"
              />
            </div>

            <div>
              <label
                htmlFor="username"
                className="block text-sm font-semibold text-gray-700"
              >
                用户名 <span className="text-red-500">*</span>
              </label>
              <input
                id="username"
                name="username"
                type="text"
                required
                value={formData.username}
                onChange={(e) =>
                  setFormData({ ...formData, username: e.target.value })
                }
                className="mt-1 block w-full rounded-lg border border-gray-300 px-4 py-2.5 shadow-sm transition-colors focus:border-green-500 focus:outline-none focus:ring-2 focus:ring-green-500 focus:ring-offset-0"
                placeholder="供应商登录账号 / 联系人名称"
              />
            </div>

            <div>
              <label
                htmlFor="password"
                className="block text-sm font-semibold text-gray-700"
              >
                密码 <span className="text-red-500">*</span>
              </label>
              <input
                id="password"
                name="password"
                type="password"
                required
                minLength={6}
                value={formData.password}
                onChange={(e) =>
                  setFormData({ ...formData, password: e.target.value })
                }
                className="mt-1 block w-full rounded-lg border border-gray-300 px-4 py-2.5 shadow-sm transition-colors focus:border-green-500 focus:outline-none focus:ring-2 focus:ring-green-500 focus:ring-offset-0"
                placeholder="至少 6 位"
              />
            </div>

            <div>
              <label
                htmlFor="confirmPassword"
                className="block text-sm font-semibold text-gray-700"
              >
                确认密码 <span className="text-red-500">*</span>
              </label>
              <input
                id="confirmPassword"
                name="confirmPassword"
                type="password"
                required
                value={formData.confirmPassword}
                onChange={(e) =>
                  setFormData({
                    ...formData,
                    confirmPassword: e.target.value,
                  })
                }
                className="mt-1 block w-full rounded-lg border border-gray-300 px-4 py-2.5 shadow-sm transition-colors focus:border-green-500 focus:outline-none focus:ring-2 focus:ring-green-500 focus:ring-offset-0"
                placeholder="再次输入密码"
              />
            </div>

            <div>
              <label
                htmlFor="companyName"
                className="block text-sm font-semibold text-gray-700"
              >
                公司名称
              </label>
              <input
                id="companyName"
                name="companyName"
                type="text"
                value={formData.companyName}
                onChange={(e) =>
                  setFormData({ ...formData, companyName: e.target.value })
                }
                className="mt-1 block w-full rounded-lg border border-gray-300 px-4 py-2.5 shadow-sm transition-colors focus:border-green-500 focus:outline-none focus:ring-2 focus:ring-green-500 focus:ring-offset-0"
                placeholder="例如：XX供应链有限公司"
              />
            </div>

            <div>
              <label
                htmlFor="contact"
                className="block text-sm font-semibold text-gray-700"
              >
                联系电话
              </label>
              <input
                id="contact"
                name="contact"
                type="tel"
                value={formData.contact}
                onChange={(e) =>
                  setFormData({ ...formData, contact: e.target.value })
                }
                className="mt-1 block w-full rounded-lg border border-gray-300 px-4 py-2.5 shadow-sm transition-colors focus:border-green-500 focus:outline-none focus:ring-2 focus:ring-green-500 focus:ring-offset-0"
                placeholder="13800138000"
              />
            </div>

            <div>
              <label
                htmlFor="address"
                className="block text-sm font-semibold text-gray-700"
              >
                公司地址
              </label>
              <input
                id="address"
                name="address"
                type="text"
                value={formData.address}
                onChange={(e) =>
                  setFormData({ ...formData, address: e.target.value })
                }
                className="mt-1 block w-full rounded-lg border border-gray-300 px-4 py-2.5 shadow-sm transition-colors focus:border-green-500 focus:outline-none focus:ring-2 focus:ring-green-500 focus:ring-offset-0"
                placeholder="例如：湖南省株洲市荷塘区 XXX 路 XXX 号"
              />
            </div>
          </div>

          <div className="space-y-4">
            <button
              type="submit"
              disabled={loading}
              className="w-full rounded-lg bg-gradient-to-r from-green-600 to-teal-600 px-4 py-3 text-base font-semibold text-white shadow-md transition-all hover:from-green-700 hover:to-teal-700 hover:shadow-lg focus:outline-none focus:ring-2 focus:ring-green-500 focus:ring-offset-2 disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {loading ? (
                <span className="flex items-center justify-center gap-2">
                  <svg
                    className="h-5 w-5 animate-spin"
                    fill="none"
                    viewBox="0 0 24 24"
                  >
                    <circle
                      className="opacity-25"
                      cx="12"
                      cy="12"
                      r="10"
                      stroke="currentColor"
                      strokeWidth="4"
                    ></circle>
                    <path
                      className="opacity-75"
                      fill="currentColor"
                      d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"
                    ></path>
                  </svg>
                  注册中...
                </span>
              ) : (
                <span className="flex items-center justify-center gap-2">
                  <svg
                    className="h-5 w-5"
                    fill="none"
                    stroke="currentColor"
                    viewBox="0 0 24 24"
                  >
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      strokeWidth={2}
                      d="M18 9v3m0 0v3m0-3h3m-3 0h-3m-2-5a4 4 0 11-8 0 4 4 0 018 0zM3 20a6 6 0 0112 0v1H3v-1z"
                    />
                  </svg>
                  立即注册
                </span>
              )}
            </button>
            <div className="text-center">
              <Link
                href="/login"
                className="inline-flex items-center gap-1 text-sm font-medium text-gray-600 transition-colors hover:text-green-600"
              >
                <svg
                  className="h-4 w-4"
                  fill="none"
                  stroke="currentColor"
                  viewBox="0 0 24 24"
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth={2}
                    d="M10 19l-7-7m0 0l7-7m-7 7h18"
                  />
                </svg>
                已有账号？返回登录
              </Link>
            </div>
          </div>
        </form>
      </div>
    </div>
  );
}
