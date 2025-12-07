'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { authApi } from '@/lib/auth';
import Link from 'next/link';
import api from '@/lib/api';
import { useNotifications } from '@/lib/hooks/useNotifications';

const getApiUrl = () => {
  // 浏览器端：优先使用非 localhost 的 NEXT_PUBLIC_API_URL，否则根据当前页面地址推导
  if (typeof window !== 'undefined') {
    const envUrl = process.env.NEXT_PUBLIC_API_URL;

    // 如果环境变量存在并且不是 localhost，就用它
    if (envUrl && !envUrl.includes('localhost')) {
      return envUrl;
    }

    const { origin } = window.location;
    // 前端跑在 3000 端口，API 在 8081
    if (origin.includes(':3000')) {
      return origin.replace(':3000', ':8081');
    }

    // 其它情况：直接用当前 origin（比如将来你用 nginx 反向代理到同域名）
    return origin;
  }

  // 服务器端 / 构建时兜底
  return process.env.NEXT_PUBLIC_API_URL || 'http://localhost:8081';
};

interface DashboardStats {
  totalRfqs: number;
  pendingQuotes: number;
  totalShipments: number;
  pendingShipments: number;
  totalAfterSales: number;
  pendingAfterSales: number;
}

export default function DashboardPage() {
  const router = useRouter();
  const [user, setUser] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [stats, setStats] = useState<DashboardStats>({
    totalRfqs: 0,
    pendingQuotes: 0,
    totalShipments: 0,
    pendingShipments: 0,
    totalAfterSales: 0,
    pendingAfterSales: 0,
  });
  const [showUserMenu, setShowUserMenu] = useState(false);
  const { notifications, unreadCount, isBlinking, stopBlinking, fetchNotifications } = useNotifications();

  useEffect(() => {
    const currentUser = authApi.getCurrentUser();
    if (!currentUser) {
      router.push('/login');
      return;
    }
    setUser(currentUser);
    // 优化：先显示页面，再加载数据（提升首次渲染速度）
    setLoading(false);
    // 延迟加载统计数据，不阻塞首次渲染
    setTimeout(() => {
      fetchStats();
    }, 100);
  }, [router]);

  const fetchStats = async () => {
    try {
      // 优化：优先加载关键数据（RFQ 统计），其他数据延迟加载
      // 这样可以大幅提升首次加载速度
      const rfqsStatsRes = await api.get('/rfqs/stats').catch(() => ({ data: { data: {} } }));
      
      // 先更新 RFQ 统计数据，让用户立即看到主要内容
      if (rfqsStatsRes?.data?.data || rfqsStatsRes?.data) {
        const rfqsStats = rfqsStatsRes.data?.data || rfqsStatsRes.data || {};
        setStats(prev => ({
          ...prev,
          totalRfqs: rfqsStats.totalRfqs || 0,
          pendingQuotes: rfqsStats.pendingQuotes || 0,
        }));
      }
      
      // 延迟加载其他统计数据（不阻塞首次渲染）
      setTimeout(async () => {
        const [shipmentsRes, afterSalesRes] = await Promise.allSettled([
          api.get('/shipments'),
          api.get('/after-sales'),
        ]);

        // 更新其他统计数据
        setStats(prev => {
          const newStats = { ...prev };
          
          if (shipmentsRes.status === 'fulfilled') {
            const shipments = shipmentsRes.value.data?.data || [];
            newStats.totalShipments = shipments.length;
            newStats.pendingShipments = shipments.filter((s: any) => s.status === 'PENDING').length;
          }

          if (afterSalesRes.status === 'fulfilled') {
            const afterSales = afterSalesRes.value.data?.data || [];
            newStats.totalAfterSales = afterSales.length;
            newStats.pendingAfterSales = afterSales.filter((a: any) => a.status !== 'CLOSED').length;
          }
          
          return newStats;
        });
      }, 300);
    } catch (error) {
      console.error('获取统计数据失败:', error);
    }
  };

  const handleLogout = () => {
    authApi.logout();
    router.push('/login');
  };

  const getRoleLabel = (role: string) => {
    const roleMap: Record<string, string> = {
      ADMIN: '管理员',
      BUYER: '采购员',
      SUPPLIER: '供应商',
      USER: '用户',
    };
    return roleMap[role] || role;
  };

  const getRoleColor = (role: string) => {
    const colorMap: Record<string, string> = {
      ADMIN: 'bg-red-100 text-red-800',
      BUYER: 'bg-blue-100 text-blue-800',
      SUPPLIER: 'bg-green-100 text-green-800',
      USER: 'bg-gray-100 text-gray-800',
    };
    return colorMap[role] || 'bg-gray-100 text-gray-800';
  };

  const getNotificationTypeColor = (type: string) => {
    const typeMap: Record<string, { bg: string; text: string; icon: string }> = {
      RFQ_UNQUOTED_ITEMS: { bg: 'bg-yellow-50', text: 'text-yellow-700', icon: '⚠️' },
      RFQ_NO_QUOTES: { bg: 'bg-red-50', text: 'text-red-700', icon: '🚨' },
      QUOTE_AWARDED: { bg: 'bg-green-50', text: 'text-green-700', icon: '✅' },
      RFQ_CLOSED: { bg: 'bg-blue-50', text: 'text-blue-700', icon: '📋' },
      QUOTE_REMINDER: { bg: 'bg-orange-50', text: 'text-orange-700', icon: '⏰' },
      SHIPMENT_UPDATE: { bg: 'bg-purple-50', text: 'text-purple-700', icon: '📦' },
      SYSTEM: { bg: 'bg-gray-50', text: 'text-gray-700', icon: '🔔' },
    };
    return typeMap[type] || { bg: 'bg-gray-50', text: 'text-gray-700', icon: '📢' };
  };

  const getNotificationTypeText = (type: string) => {
    const typeMap: Record<string, string> = {
      RFQ_UNQUOTED_ITEMS: '未报价商品',
      RFQ_NO_QUOTES: '无报价',
      QUOTE_AWARDED: '报价中标',
      RFQ_CLOSED: '询价单关闭',
      QUOTE_REMINDER: '报价提醒',
      SHIPMENT_UPDATE: '发货更新',
      SYSTEM: '系统通知',
    };
    return typeMap[type] || type;
  };

  const getTimeAgo = (date: Date | string) => {
    const now = new Date();
    const notificationDate = new Date(date);
    const diffInSeconds = Math.floor((now.getTime() - notificationDate.getTime()) / 1000);

    if (diffInSeconds < 60) {
      return '刚刚';
    } else if (diffInSeconds < 3600) {
      const minutes = Math.floor(diffInSeconds / 60);
      return `${minutes}分钟前`;
    } else if (diffInSeconds < 86400) {
      const hours = Math.floor(diffInSeconds / 3600);
      return `${hours}小时前`;
    } else if (diffInSeconds < 604800) {
      const days = Math.floor(diffInSeconds / 86400);
      return `${days}天前`;
    } else {
      return notificationDate.toLocaleDateString('zh-CN', {
        month: 'short',
        day: 'numeric',
      });
    }
  };

  const handleMarkAsRead = async (id: string) => {
    try {
      await api.patch(`/notifications/${id}/read`);
      await fetchNotifications();
    } catch (error: any) {
      console.error('标记通知为已读失败:', error);
    }
  };

  // 获取最新的未读通知（最多5条）
  const recentNotifications = notifications
    .filter((n: any) => !n.read)
    .slice(0, 5);

  if (loading || !user) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-gradient-to-br from-blue-50 via-white to-purple-50">
        <div className="text-center">
          <div className="mx-auto h-12 w-12 animate-spin rounded-full border-4 border-blue-600 border-t-transparent"></div>
          <p className="mt-4 text-gray-600">加载中...</p>
        </div>
      </div>
    );
  }

  // 功能模块配置
  const modules = [
    ...(user.role === 'ADMIN' || user.role === 'BUYER' || user.role === 'STORE'
      ? [
          {
            title: '询价管理',
            description: '创建和管理询价单，支持文件导入（Excel/CSV）',
            href: '/rfqs',
            icon: (
              <svg className="h-8 w-8" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
              </svg>
            ),
            gradient: 'from-purple-500 to-purple-600',
            bgGradient: 'from-purple-50 to-purple-100',
            borderColor: 'border-purple-200',
          },
          {
            title: '供应商现货库',
            description: '查看所有供应商的现货库存，方便直接下单',
            href: '/inventory/available',
            icon: (
              <svg className="h-8 w-8" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M20 7l-8-4-8 4m16 0l-8 4m8-4v10l-8 4m0-10L4 7m8 4v10M4 7v10l8 4" />
              </svg>
            ),
            gradient: 'from-indigo-500 to-indigo-600',
            bgGradient: 'from-indigo-50 to-indigo-100',
            borderColor: 'border-indigo-200',
          },
          {
            title: '电商平台采购',
            description: '查看需要从京东、淘宝采购的商品',
            href: '/purchase',
            icon: (
              <svg className="h-8 w-8" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M16 11V7a4 4 0 00-8 0v4M5 9h14l1 12H4L5 9z" />
              </svg>
            ),
            gradient: 'from-yellow-500 to-orange-500',
            bgGradient: 'from-yellow-50 to-orange-100',
            borderColor: 'border-yellow-200',
          },
          {
            title: '发货与订单管理',
            description: '查看询价单发货和现货订单，上传付款截图',
            href: '/shipments',
            icon: (
              <svg className="h-8 w-8" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M20 7l-8-4-8 4m16 0l-8 4m8-4v10l-8 4m0-10L4 7m8 4v10M4 7v10l8 4" />
              </svg>
            ),
            gradient: 'from-indigo-500 to-indigo-600',
            bgGradient: 'from-indigo-50 to-indigo-100',
            borderColor: 'border-indigo-200',
          },
          {
            title: '发货状态总览',
            description: '查看所有商品的发货状态、物流信息和成本价格',
            href: '/shipments/overview',
            icon: (
              <svg className="h-8 w-8" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z" />
              </svg>
            ),
            gradient: 'from-pink-500 to-pink-600',
            bgGradient: 'from-pink-50 to-pink-100',
            borderColor: 'border-pink-200',
          },
        ]
      : []),
    ...(user.role === 'ADMIN'
      ? [
          {
            title: '系统管理',
            description: '管理员专用功能',
            href: '/admin',
            icon: (
              <svg className="h-8 w-8" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z" />
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
              </svg>
            ),
            gradient: 'from-red-500 to-red-600',
            bgGradient: 'from-red-50 to-red-100',
            borderColor: 'border-red-200',
          },
        ]
      : []),
    ...(user.role === 'SUPPLIER'
      ? [
          {
            title: '报价管理',
            description: '查看和提交报价',
            href: '/quotes',
            icon: (
              <svg className="h-8 w-8" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2m-3 7h3m-3 4h3m-6-4h.01M9 16h.01" />
              </svg>
            ),
            gradient: 'from-teal-500 to-teal-600',
            bgGradient: 'from-teal-50 to-teal-100',
            borderColor: 'border-teal-200',
          },
          {
            title: '库存管理',
            description: '管理供应商库存，方便门店挑选现货',
            href: '/inventory',
            icon: (
              <svg className="h-8 w-8" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M20 7l-8-4-8 4m16 0l-8 4m8-4v10l-8 4m0-10L4 7m8 4v10M4 7v10l8 4" />
              </svg>
            ),
            gradient: 'from-orange-500 to-orange-600',
            bgGradient: 'from-orange-50 to-orange-100',
            borderColor: 'border-orange-200',
          },
          {
            title: '发货管理',
            description: '管理询价单发货和库存订单',
            href: '/shipments/supplier',
            icon: (
              <svg className="h-8 w-8" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M20 7l-8-4-8 4m16 0l-8 4m8-4v10l-8 4m0-10L4 7m8 4v10M4 7v10l8 4" />
              </svg>
            ),
            gradient: 'from-cyan-500 to-cyan-600',
            bgGradient: 'from-cyan-50 to-cyan-100',
            borderColor: 'border-cyan-200',
          },
          {
            title: '财务看板',
            description: '查看收款情况和财务统计',
            href: '/financial',
            icon: (
              <svg className="h-8 w-8" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8c-1.657 0-3 .895-3 2s1.343 2 3 2 3 .895 3 2-1.343 2-3 2m0-8c1.11 0 2.08.402 2.599 1M12 8V7m0 1v8m0 0v1m0-1c-1.11 0-2.08-.402-2.599-1M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
              </svg>
            ),
            gradient: 'from-emerald-500 to-emerald-600',
            bgGradient: 'from-emerald-50 to-emerald-100',
            borderColor: 'border-emerald-200',
          },
        ]
      : []),
    {
      title: '售后管理',
      description: '处理售后工单',
      href: '/after-sales',
      icon: (
        <svg className="h-8 w-8" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M18.364 5.636l-3.536 3.536m0 5.656l3.536 3.536M9.172 9.172L5.636 5.636m3.536 9.192l-3.536 3.536M21 12a9 9 0 11-18 0 9 9 0 0118 0zm-5 0a4 4 0 11-8 0 4 4 0 018 0z" />
        </svg>
      ),
      gradient: 'from-amber-500 to-amber-600',
      bgGradient: 'from-amber-50 to-amber-100',
      borderColor: 'border-amber-200',
    },
    ...(user.role === 'ADMIN' || user.role === 'BUYER' || user.role === 'STORE'
      ? [
          {
            title: '报表看板',
            description: '查看财务报表和统计报表（供应商付款和电商平台采购金额）',
            href: '/reports',
            icon: (
              <svg className="h-8 w-8" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z" />
              </svg>
            ),
            gradient: 'from-emerald-500 to-emerald-600',
            bgGradient: 'from-emerald-50 to-emerald-100',
            borderColor: 'border-emerald-200',
          },
        ]
      : []),
    {
      title: '通知中心',
      description: '查看系统通知',
      href: '/notifications',
      icon: (
        <svg className="h-8 w-8" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 17h5l-1.405-1.405A2.032 2.032 0 0118 14.158V11a6.002 6.002 0 00-4-5.659V5a2 2 0 10-4 0v.341C7.67 6.165 6 8.388 6 11v3.159c0 .538-.214 1.055-.595 1.436L4 17h5m6 0v1a3 3 0 11-6 0v-1m6 0H9" />
      </svg>
      ),
      gradient: 'from-violet-500 to-violet-600',
      bgGradient: 'from-violet-50 to-violet-100',
      borderColor: 'border-violet-200',
    },
  ];

  return (
    <div className="min-h-screen bg-gradient-to-br from-blue-50 via-white to-purple-50">
      {/* 现代化导航栏 */}
      <nav className="sticky top-0 z-50 border-b border-gray-200 bg-white/80 backdrop-blur-lg shadow-sm">
        <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
          <div className="flex h-16 items-center justify-between">
            <div className="flex items-center gap-3">
              <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-gradient-to-br from-blue-600 to-purple-600">
                <svg className="h-6 w-6 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M20 7l-8-4-8 4m16 0l-8 4m8-4v10l-8 4m0-10L4 7m8 4v10M4 7v10l8 4" />
                </svg>
              </div>
              <div>
                <h1 className="text-lg font-bold text-gray-900">模型玩具采购协同系统</h1>
                <p className="text-xs text-gray-500">多门店协同采购平台</p>
              </div>
            </div>
            <div className="relative flex items-center gap-4">
              <Link
                href="/notifications"
                onClick={stopBlinking}
                className={`relative rounded-lg p-2 text-gray-600 transition-all hover:bg-gray-100 hover:text-gray-900 ${
                  isBlinking ? 'notification-blink' : ''
                }`}
                title={unreadCount > 0 ? `您有 ${unreadCount} 条未读通知` : '通知中心'}
              >
                <svg 
                  className={`h-6 w-6 transition-all ${isBlinking ? 'notification-icon-blink' : ''}`}
                  fill="none" 
                  stroke="currentColor" 
                  viewBox="0 0 24 24"
                  strokeWidth={isBlinking ? 2.5 : 2}
                >
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="inherit" d="M15 17h5l-1.405-1.405A2.032 2.032 0 0118 14.158V11a6.002 6.002 0 00-4-5.659V5a2 2 0 10-4 0v.341C7.67 6.165 6 8.388 6 11v3.159c0 .538-.214 1.055-.595 1.436L4 17h5m6 0v1a3 3 0 11-6 0v-1m6 0H9" />
                </svg>
                {unreadCount > 0 && (
                  <span className={`absolute -top-1 -right-1 flex min-w-[20px] h-5 items-center justify-center rounded-full bg-red-500 text-xs font-bold text-white px-1 ${
                    isBlinking ? 'notification-badge-pulse' : ''
                  }`}>
                    {unreadCount > 99 ? '99+' : unreadCount}
                  </span>
                )}
              </Link>
              <div className="relative">
                <button
                  onClick={() => setShowUserMenu(!showUserMenu)}
                  className="flex items-center gap-3 rounded-lg px-3 py-2 transition-colors hover:bg-gray-100"
                >
                  <div className="flex h-9 w-9 items-center justify-center rounded-full bg-gradient-to-br from-blue-500 to-purple-500 text-sm font-semibold text-white">
                    {user.username.charAt(0).toUpperCase()}
                  </div>
                  <div className="hidden text-left sm:block">
                    <div className="text-sm font-medium text-gray-900">{user.username}</div>
                    <div className={`text-xs ${getRoleColor(user.role)} rounded-full px-2 py-0.5 inline-block`}>
                      {getRoleLabel(user.role)}
                    </div>
                  </div>
                  <svg className="h-5 w-5 text-gray-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                  </svg>
                </button>
                {showUserMenu && (
                  <div className="absolute right-0 mt-2 w-48 rounded-lg bg-white py-1 shadow-lg ring-1 ring-black ring-opacity-5">
                    <div className="px-4 py-2 border-b border-gray-100">
                      <div className="text-sm font-medium text-gray-900">{user.username}</div>
                      <div className="text-xs text-gray-500">{user.email}</div>
                    </div>
                    <button
                      onClick={handleLogout}
                      className="w-full px-4 py-2 text-left text-sm text-red-600 transition-colors hover:bg-red-50"
                    >
                      退出登录
                    </button>
                  </div>
                )}
              </div>
            </div>
          </div>
        </div>
      </nav>

      <main className="mx-auto max-w-7xl px-4 py-8 sm:px-6 lg:px-8">
        {/* 欢迎区域 */}
        <div className="mb-8">
          <h2 className="text-3xl font-bold text-gray-900">
            欢迎回来，{user.username} 🎉
          </h2>
          <p className="mt-2 text-gray-600">今天是{new Date().toLocaleDateString('zh-CN', { year: 'numeric', month: 'long', day: 'numeric', weekday: 'long' })}</p>
        </div>

        {/* 统计卡片 */}
        {(user.role === 'ADMIN' || user.role === 'BUYER') && (
          <div className="mb-8 grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <div className="group relative overflow-hidden rounded-xl bg-gradient-to-br from-blue-500 to-blue-600 p-6 text-white shadow-lg transition-transform hover:scale-105">
              <div className="absolute right-0 top-0 -mr-4 -mt-4 h-24 w-24 rounded-full bg-white/20"></div>
              <div className="relative">
                <div className="text-sm font-medium opacity-90">询价单总数</div>
                <div className="mt-2 text-3xl font-bold">{stats.totalRfqs}</div>
                <div className="mt-2 text-sm opacity-75">待报价 {stats.pendingQuotes}</div>
              </div>
            </div>

            <div className="group relative overflow-hidden rounded-xl bg-gradient-to-br from-purple-500 to-purple-600 p-6 text-white shadow-lg transition-transform hover:scale-105">
              <div className="absolute right-0 top-0 -mr-4 -mt-4 h-24 w-24 rounded-full bg-white/20"></div>
              <div className="relative">
                <div className="text-sm font-medium opacity-90">发货单总数</div>
                <div className="mt-2 text-3xl font-bold">{stats.totalShipments}</div>
                <div className="mt-2 text-sm opacity-75">待处理 {stats.pendingShipments}</div>
              </div>
            </div>

            <div className="group relative overflow-hidden rounded-xl bg-gradient-to-br from-amber-500 to-amber-600 p-6 text-white shadow-lg transition-transform hover:scale-105">
              <div className="absolute right-0 top-0 -mr-4 -mt-4 h-24 w-24 rounded-full bg-white/20"></div>
              <div className="relative">
                <div className="text-sm font-medium opacity-90">售后工单</div>
                <div className="mt-2 text-3xl font-bold">{stats.totalAfterSales}</div>
                <div className="mt-2 text-sm opacity-75">待处理 {stats.pendingAfterSales}</div>
              </div>
            </div>

            <div className="group relative overflow-hidden rounded-xl bg-gradient-to-br from-green-500 to-green-600 p-6 text-white shadow-lg transition-transform hover:scale-105">
              <div className="absolute right-0 top-0 -mr-4 -mt-4 h-24 w-24 rounded-full bg-white/20"></div>
              <div className="relative">
                <div className="text-sm font-medium opacity-90">系统状态</div>
                <div className="mt-2 text-3xl font-bold">正常</div>
                <div className="mt-2 text-sm opacity-75">所有服务运行中</div>
              </div>
            </div>
          </div>
        )}

        {/* 实时通知卡片 */}
        {recentNotifications.length > 0 && (
          <div className="mb-8">
            <div className="mb-4 flex items-center justify-between">
              <h3 className="text-lg font-semibold text-gray-900">最新通知</h3>
              <Link
                href="/notifications"
                onClick={stopBlinking}
                className="text-sm font-medium text-blue-600 hover:text-blue-700 transition-colors"
              >
                查看全部 →
              </Link>
            </div>
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
              {recentNotifications.map((notification: any) => {
                const typeColor = getNotificationTypeColor(notification.type);
                return (
                  <div
                    key={notification.id}
                    className="group relative rounded-xl bg-white p-5 shadow-sm transition-all hover:shadow-lg border-l-4 border-blue-500 ring-2 ring-blue-100"
                  >
                    {/* 未读指示器 */}
                    <div className="absolute right-3 top-3">
                      <span className="flex h-2 w-2">
                        <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-blue-400 opacity-75"></span>
                        <span className="relative inline-flex h-2 w-2 rounded-full bg-blue-500"></span>
                      </span>
                    </div>

                    {/* 通知类型标签 */}
                    <div className="mb-3 flex items-center gap-2">
                      <span className={`flex items-center gap-1.5 rounded-full px-3 py-1 text-xs font-semibold ${typeColor.bg} ${typeColor.text}`}>
                        <span>{typeColor.icon}</span>
                        {getNotificationTypeText(notification.type)}
                      </span>
                      <span className="text-xs text-gray-400">
                        {getTimeAgo(notification.createdAt)}
                      </span>
                    </div>

                    {/* 通知标题 */}
                    <h4 className="mb-2 text-base font-semibold text-gray-900 line-clamp-1">
                      {notification.title}
                    </h4>

                    {/* 通知内容 */}
                    <p className="mb-4 line-clamp-2 text-sm text-gray-600 whitespace-pre-wrap">
                      {notification.content}
                    </p>

                    {/* 操作按钮 */}
                    <div className="flex items-center justify-between gap-2">
                      {notification.link && (
                        <Link
                          href={notification.link}
                          onClick={() => handleMarkAsRead(notification.id)}
                          className="inline-flex items-center gap-1 rounded-lg bg-blue-600 px-3 py-1.5 text-xs font-medium text-white transition-colors hover:bg-blue-700"
                        >
                          查看详情
                          <svg className="h-3 w-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
                          </svg>
                        </Link>
                      )}
                      <button
                        onClick={() => handleMarkAsRead(notification.id)}
                        className="rounded-lg bg-gray-100 px-3 py-1.5 text-xs font-medium text-gray-700 transition-colors hover:bg-gray-200"
                        title="标记为已读"
                      >
                        <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                        </svg>
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>
            {/* 实时更新提示 */}
            <div className="mt-4 flex items-center justify-center gap-2 text-xs text-gray-500">
              <div className="flex h-2 w-2 items-center justify-center">
                <span className="absolute inline-flex h-2 w-2 animate-ping rounded-full bg-green-400 opacity-75"></span>
                <span className="relative inline-flex h-2 w-2 rounded-full bg-green-500"></span>
              </div>
              <span>实时更新中（每30秒自动刷新）</span>
            </div>
          </div>
        )}

        {/* 快捷操作 */}
        <div className="mb-8">
          <h3 className="mb-4 text-lg font-semibold text-gray-900">快捷操作</h3>
          <div className="flex flex-wrap gap-3">
            {(user.role === 'ADMIN' || user.role === 'BUYER') && (
              <>
                <Link
                  href="/rfqs"
                  className="flex items-center gap-2 rounded-lg bg-white px-4 py-2 shadow-sm transition-all hover:shadow-md border border-gray-200"
                >
                  <svg className="h-5 w-5 text-purple-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
                  </svg>
                  <span className="text-sm font-medium text-gray-700">创建询价单</span>
                </Link>
                <button
                  onClick={async () => {
                    try {
                      const apiUrl = getApiUrl();
                      const token = localStorage.getItem('token');
                      const response = await fetch(`${apiUrl}/api/import/template?type=products`, {
                        headers: {
                          'Authorization': `Bearer ${token}`,
                        },
                      });
                      if (!response.ok) {
                        throw new Error('下载失败');
                      }
                      const blob = await response.blob();
                      const url = window.URL.createObjectURL(blob);
                      const link = document.createElement('a');
                      link.href = url;
                      link.setAttribute('download', '商品导入模板.xlsx');
                      document.body.appendChild(link);
                      link.click();
                      document.body.removeChild(link);
                      window.URL.revokeObjectURL(url);
                    } catch (error) {
                      console.error('下载模板失败:', error);
                      alert('下载模板失败，请稍后重试');
                    }
                  }}
                  className="flex items-center gap-2 rounded-lg bg-white px-4 py-2 shadow-sm transition-all hover:shadow-md border border-gray-200"
                >
                  <svg className="h-5 w-5 text-green-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 10v6m0 0l-3-3m3 3l3-3m2 8H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
                  </svg>
                  <span className="text-sm font-medium text-gray-700">下载商品导入模板</span>
                </button>
              </>
            )}
            {(user.role === 'ADMIN' || user.role === 'BUYER') && (
              <button
                onClick={async () => {
                  try {
                    const apiUrl = getApiUrl();
                    const token = localStorage.getItem('token');
                    const response = await fetch(`${apiUrl}/api/import/template?type=history`, {
                      headers: {
                        'Authorization': `Bearer ${token}`,
                      },
                    });
                    if (!response.ok) {
                      throw new Error('下载失败');
                    }
                    const blob = await response.blob();
                    const url = window.URL.createObjectURL(blob);
                    const link = document.createElement('a');
                    link.href = url;
                    link.setAttribute('download', '历史订单导入模板.xlsx');
                    document.body.appendChild(link);
                    link.click();
                    document.body.removeChild(link);
                    window.URL.revokeObjectURL(url);
                  } catch (error) {
                    console.error('下载模板失败:', error);
                    alert('下载模板失败，请稍后重试');
                  }
                }}
                className="flex items-center gap-2 rounded-lg bg-white px-4 py-2 shadow-sm transition-all hover:shadow-md border border-gray-200"
              >
                <svg className="h-5 w-5 text-blue-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 10v6m0 0l-3-3m3 3l3-3m2 8H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
                </svg>
                <span className="text-sm font-medium text-gray-700">下载历史订单模板</span>
              </button>
            )}
            {user.role === 'SUPPLIER' && (
              <Link
                href="/quotes"
                className="flex items-center gap-2 rounded-lg bg-white px-4 py-2 shadow-sm transition-all hover:shadow-md border border-gray-200"
              >
                <svg className="h-5 w-5 text-teal-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2" />
                </svg>
                <span className="text-sm font-medium text-gray-700">提交报价</span>
              </Link>
            )}
            <Link
              href="/shipments/overview"
              className="flex items-center gap-2 rounded-lg bg-white px-4 py-2 shadow-sm transition-all hover:shadow-md border border-gray-200"
            >
              <svg className="h-5 w-5 text-pink-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z" />
              </svg>
              <span className="text-sm font-medium text-gray-700">发货总览</span>
            </Link>
          </div>
        </div>

        {/* 功能模块 */}
        <div className="mb-8">
          <h3 className="mb-4 text-lg font-semibold text-gray-900">功能模块</h3>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {modules.map((module, index) => (
              <Link
                key={index}
                href={module.href}
                onClick={(e) => {
                  // console.log(`[Dashboard] 点击模块: ${module.title}, href: ${module.href}`);
                  // 确保导航正常工作，特别是在移动端
                  e.preventDefault();
                  router.push(module.href);
                }}
                className={`group relative overflow-hidden rounded-xl border-2 ${module.borderColor} bg-white p-6 shadow-sm transition-all hover:scale-105 hover:shadow-lg active:scale-95 touch-manipulation cursor-pointer`}
                style={{ WebkitTapHighlightColor: 'transparent', touchAction: 'manipulation' }}
              >
                <div className={`absolute right-0 top-0 h-32 w-32 rounded-bl-full bg-gradient-to-br ${module.bgGradient} opacity-50 transition-opacity group-hover:opacity-75 pointer-events-none`}></div>
                <div className="relative z-10">
                  <div className={`mb-4 inline-flex rounded-lg bg-gradient-to-br ${module.gradient} p-3 text-white shadow-md`}>
                    {module.icon}
                  </div>
                  <h4 className="text-lg font-semibold text-gray-900">{module.title}</h4>
                  <p className="mt-2 text-sm text-gray-600">{module.description}</p>
                  <div className="mt-4 flex items-center text-sm font-medium text-gray-500 transition-colors group-hover:text-gray-700">
                    <span>进入</span>
                    <svg className="ml-2 h-4 w-4 transition-transform group-hover:translate-x-1" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
                    </svg>
                  </div>
                </div>
              </Link>
            ))}
          </div>
        </div>
      </main>

      {/* 点击外部关闭用户菜单 */}
      {showUserMenu && (
        <div
          className="fixed inset-0 z-40"
          onClick={() => setShowUserMenu(false)}
        ></div>
      )}
    </div>
  );
}
