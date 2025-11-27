'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { authApi } from '@/lib/auth';
import api from '@/lib/api';

interface FinancialDashboard {
  summary: {
    totalAmount: number;
    pendingAmount: number;
    paidAmount: number;
    shippedCount: number;
    pendingShipmentCount: number;
    totalItems: number;
  };
  items: Array<{
    awardId: string;
    rfqNo: string;
    rfqTitle: string;
    productName: string;
    quantity: number;
    price: number;
    amount: number;
    trackingNo?: string;
    carrier?: string;
    shipmentStatus?: string;
    settlementStatus?: string;
    settlementAmount?: number;
    paidAt?: Date;
    createdAt: Date;
    shipmentId?: string;
    settlementId?: string;
  }>;
  dailyStats: Array<{
    date: string;
    amount: number;
    count: number;
  }>;
  period: {
    start: string;
    end: string;
  };
}

export default function FinancialPage() {
  const router = useRouter();
  const [user, setUser] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [dashboard, setDashboard] = useState<FinancialDashboard | null>(null);
  const [startDate, setStartDate] = useState<string>(
    new Date(new Date().setMonth(new Date().getMonth() - 1)).toISOString().split('T')[0]
  );
  const [endDate, setEndDate] = useState<string>(
    new Date().toISOString().split('T')[0]
  );
  const [activeTab, setActiveTab] = useState<'summary' | 'details' | 'chart'>('summary');
  const [paymentFilter, setPaymentFilter] = useState<'all' | 'paid' | 'pending'>('all');
  const [uploadingScreenshot, setUploadingScreenshot] = useState<string | null>(null);

  useEffect(() => {
    const currentUser = authApi.getCurrentUser();
    if (!currentUser) {
      router.push('/login');
      return;
    }

    // 供应商、管理员和采购员都可以访问财务板块
    if (currentUser.role !== 'SUPPLIER' && currentUser.role !== 'ADMIN' && currentUser.role !== 'BUYER') {
      router.push('/dashboard');
      return;
    }

    setUser(currentUser);
    // 注意：fetchDashboard 依赖 user，但 user 在 useEffect 中设置，所以需要确保 user 设置后再调用
  }, [router, startDate, endDate]);

  useEffect(() => {
    if (user) {
      fetchDashboard();
    }
  }, [user, startDate, endDate]);

  const fetchDashboard = async () => {
    if (!user) return;
    setLoading(true);
    try {
      const response = await api.get(
        `/reports/supplier-financial?startDate=${startDate}&endDate=${endDate}`
      );
      setDashboard(response.data.data || response.data);
    } catch (error: any) {
      console.error('获取财务看板失败:', error);
      setDashboard(null);
    } finally {
      setLoading(false);
    }
  };

  const formatCurrency = (amount: number) => {
    return `¥${amount.toLocaleString('zh-CN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
  };

  const handleUploadPaymentScreenshot = async (shipmentId: string, event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;

    // 验证文件类型
    if (!file.type.startsWith('image/')) {
      alert('请上传图片文件');
      return;
    }

    setUploadingScreenshot(shipmentId);
    try {
      const formData = new FormData();
      formData.append('file', file);

      await api.post(`/shipments/${shipmentId}/payment-screenshot`, formData, {
        headers: {
          'Content-Type': 'multipart/form-data',
        },
      });

      alert('付款截图上传成功');
      await fetchDashboard();
    } catch (error: any) {
      console.error('上传付款截图失败:', error);
      alert('上传失败：' + (error.response?.data?.message || error.message));
    } finally {
      setUploadingScreenshot(null);
      // 清空input值，以便可以重复上传同一文件
      event.target.value = '';
    }
  };

  const getStatusBadge = (status?: string) => {
    if (!status) return null;
    const statusMap: Record<string, { label: string; className: string }> = {
      PENDING: { label: '待发货', className: 'bg-orange-100 text-orange-800' },
      SHIPPED: { label: '已发货', className: 'bg-blue-100 text-blue-800' },
      IN_TRANSIT: { label: '运输中', className: 'bg-blue-100 text-blue-800' },
      DELIVERED: { label: '已送达', className: 'bg-green-100 text-green-800' },
      RECEIVED: { label: '已签收', className: 'bg-green-100 text-green-800' },
    };
    const statusInfo = statusMap[status] || { label: status, className: 'bg-gray-100 text-gray-800' };
    return (
      <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${statusInfo.className}`}>
        {statusInfo.label}
      </span>
    );
  };

  const getSettlementStatusBadge = (status?: string) => {
    if (!status) return null;
    const statusMap: Record<string, { label: string; className: string }> = {
      PENDING: { label: '待结算', className: 'bg-yellow-100 text-yellow-800' },
      PAID: { label: '已收款', className: 'bg-green-100 text-green-800' },
      CANCELLED: { label: '已取消', className: 'bg-red-100 text-red-800' },
    };
    const statusInfo = statusMap[status] || { label: status, className: 'bg-gray-100 text-gray-800' };
    return (
      <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${statusInfo.className}`}>
        {statusInfo.label}
      </span>
    );
  };

  if (loading) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-gray-50">
        <div className="text-center">
          <div className="mb-4 inline-block h-8 w-8 animate-spin rounded-full border-4 border-solid border-blue-600 border-r-transparent"></div>
          <p className="text-gray-600">加载中...</p>
        </div>
      </div>
    );
  }

  if (!dashboard) {
    return (
      <div className="min-h-screen bg-gray-50 p-6">
        <div className="mx-auto max-w-7xl">
          <div className="rounded-lg bg-white p-12 text-center shadow-sm">
            <p className="text-gray-500">无法加载财务数据</p>
            <button
              onClick={fetchDashboard}
              className="mt-4 rounded-lg bg-blue-600 px-4 py-2 text-white hover:bg-blue-700"
            >
              重试
            </button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gray-50 pb-20 sm:pb-8">
      <div className="mx-auto max-w-7xl px-3 py-4 sm:px-4 sm:py-6 lg:px-8 lg:py-8">
        {/* 头部 */}
        <div className="mb-6 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <h1 className="text-2xl font-bold text-gray-900 sm:text-3xl">财务看板</h1>
            <p className="mt-1 text-sm text-gray-600">查看您的收款情况和财务统计</p>
          </div>
          <div className="flex flex-col gap-2 sm:flex-row">
            <input
              type="date"
              value={startDate}
              onChange={(e) => setStartDate(e.target.value)}
              className="rounded-lg border border-gray-300 px-3 py-2 text-sm !text-gray-900 !bg-white"
            />
            <span className="self-center text-gray-500 sm:px-2">至</span>
            <input
              type="date"
              value={endDate}
              onChange={(e) => setEndDate(e.target.value)}
              className="rounded-lg border border-gray-300 px-3 py-2 text-sm !text-gray-900 !bg-white"
            />
            <button
              onClick={fetchDashboard}
              className="h-11 min-w-[44px] rounded-lg bg-blue-600 px-4 text-sm font-medium text-white hover:bg-blue-700 active:bg-blue-800 sm:h-10"
            >
              查询
            </button>
          </div>
        </div>

        {/* 统计卡片 */}
        <div className="mb-6 grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6 sm:gap-4">
          <div className="rounded-lg bg-white p-4 shadow-sm">
            <div className="text-sm text-gray-600">总中标金额</div>
            <div className="mt-1 text-xl font-bold text-gray-900 sm:text-2xl">
              {formatCurrency(dashboard.summary.totalAmount)}
            </div>
          </div>
          <div className="rounded-lg bg-white p-4 shadow-sm border-l-4 border-orange-500">
            <div className="flex items-center justify-between">
              <div className="text-sm text-gray-600">待收款</div>
              <svg className="h-5 w-5 text-orange-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8c-1.657 0-3 .895-3 2s1.343 2 3 2 3 .895 3 2-1.343 2-3 2m0-8c1.11 0 2.08.402 2.599 1M12 8V7m0 1v8m0 0v1m0-1c-1.11 0-2.08-.402-2.599-1M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
              </svg>
            </div>
            <div className="mt-1 text-xl font-bold text-orange-600 sm:text-2xl">
              {formatCurrency(dashboard.summary.pendingAmount)}
            </div>
            <div className="mt-1 text-xs text-gray-500">
              {dashboard.summary.totalAmount > 0 
                ? `${((dashboard.summary.pendingAmount / dashboard.summary.totalAmount) * 100).toFixed(1)}%`
                : '0%'}
            </div>
          </div>
          <div className="rounded-lg bg-white p-4 shadow-sm border-l-4 border-green-500">
            <div className="flex items-center justify-between">
              <div className="text-sm text-gray-600">已收款</div>
              <svg className="h-5 w-5 text-green-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
              </svg>
            </div>
            <div className="mt-1 text-xl font-bold text-green-600 sm:text-2xl">
              {formatCurrency(dashboard.summary.paidAmount)}
            </div>
            <div className="mt-1 text-xs text-gray-500">
              {dashboard.summary.totalAmount > 0 
                ? `${((dashboard.summary.paidAmount / dashboard.summary.totalAmount) * 100).toFixed(1)}%`
                : '0%'}
            </div>
          </div>
          <div className="rounded-lg bg-white p-4 shadow-sm">
            <div className="text-sm text-gray-600">已发货</div>
            <div className="mt-1 text-xl font-bold text-blue-600 sm:text-2xl">
              {dashboard.summary.shippedCount}
            </div>
          </div>
          <div className="rounded-lg bg-white p-4 shadow-sm">
            <div className="text-sm text-gray-600">待发货</div>
            <div className="mt-1 text-xl font-bold text-yellow-600 sm:text-2xl">
              {dashboard.summary.pendingShipmentCount}
            </div>
          </div>
          <div className="rounded-lg bg-white p-4 shadow-sm">
            <div className="text-sm text-gray-600">订单数</div>
            <div className="mt-1 text-xl font-bold text-gray-900 sm:text-2xl">
              {dashboard.summary.totalItems}
            </div>
          </div>
        </div>

        {/* 标签页 */}
        <div className="mb-6 border-b border-gray-200">
          <nav className="-mb-px flex space-x-4 sm:space-x-8" aria-label="Tabs">
            {[
              { id: 'summary', label: '概览' },
              { id: 'details', label: '明细' },
              { id: 'chart', label: '趋势' },
            ].map((tab) => (
              <button
                key={tab.id}
                onClick={() => setActiveTab(tab.id as any)}
                className={`min-h-[44px] flex-1 whitespace-nowrap border-b-2 px-2 py-3 text-sm font-medium sm:flex-none sm:px-1 sm:py-4 ${
                  activeTab === tab.id
                    ? 'border-blue-500 text-blue-600'
                    : 'border-transparent text-gray-500 hover:border-gray-300 hover:text-gray-700 active:text-gray-700'
                }`}
              >
                {tab.label}
              </button>
            ))}
          </nav>
        </div>

        {/* 内容区域 */}
        {activeTab === 'summary' && (
          <div className="space-y-4">
            <div className="rounded-xl bg-white p-4 shadow-sm sm:p-6">
              <h2 className="mb-4 text-lg font-semibold text-gray-900">财务概览</h2>
              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
                <div className="rounded-lg border border-gray-200 p-4">
                  <div className="text-sm text-gray-600">收款率</div>
                  <div className="mt-2 text-2xl font-bold text-green-600">
                    {dashboard.summary.totalAmount > 0
                      ? ((dashboard.summary.paidAmount / dashboard.summary.totalAmount) * 100).toFixed(1)
                      : 0}%
                  </div>
                </div>
                <div className="rounded-lg border border-gray-200 p-4">
                  <div className="text-sm text-gray-600">发货率</div>
                  <div className="mt-2 text-2xl font-bold text-blue-600">
                    {dashboard.summary.totalItems > 0
                      ? ((dashboard.summary.shippedCount / dashboard.summary.totalItems) * 100).toFixed(1)
                      : 0}%
                  </div>
                </div>
                <div className="rounded-lg border border-gray-200 p-4">
                  <div className="text-sm text-gray-600">平均订单金额</div>
                  <div className="mt-2 text-2xl font-bold text-gray-900">
                    {dashboard.summary.totalItems > 0
                      ? formatCurrency(dashboard.summary.totalAmount / dashboard.summary.totalItems)
                      : formatCurrency(0)}
                  </div>
                </div>
              </div>
            </div>
          </div>
        )}

        {activeTab === 'details' && (
          <div className="rounded-xl bg-white shadow-sm">
            <div className="border-b border-gray-200 px-4 py-3 sm:px-6 sm:py-4">
              <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                <h2 className="text-lg font-semibold text-gray-900">订单明细</h2>
                {/* 付款状态筛选 */}
                <div className="flex gap-2">
                  <button
                    onClick={() => setPaymentFilter('all')}
                    className={`rounded-lg px-3 py-1.5 text-xs font-medium transition-colors ${
                      paymentFilter === 'all'
                        ? 'bg-blue-600 text-white'
                        : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
                    }`}
                  >
                    全部
                  </button>
                  <button
                    onClick={() => setPaymentFilter('pending')}
                    className={`rounded-lg px-3 py-1.5 text-xs font-medium transition-colors ${
                      paymentFilter === 'pending'
                        ? 'bg-orange-600 text-white'
                        : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
                    }`}
                  >
                    待付款
                  </button>
                  <button
                    onClick={() => setPaymentFilter('paid')}
                    className={`rounded-lg px-3 py-1.5 text-xs font-medium transition-colors ${
                      paymentFilter === 'paid'
                        ? 'bg-green-600 text-white'
                        : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
                    }`}
                  >
                    已付款
                  </button>
                </div>
              </div>
            </div>
            <div className="overflow-x-auto">
              <table className="min-w-full divide-y divide-gray-200">
                <thead className="bg-gray-50">
                  <tr>
                    <th className="px-4 py-3 text-left text-xs font-medium uppercase tracking-wider text-gray-500 sm:px-6">
                      询价单号
                    </th>
                    <th className="px-4 py-3 text-left text-xs font-medium uppercase tracking-wider text-gray-500 sm:px-6">
                      商品名称
                    </th>
                    <th className="px-4 py-3 text-left text-xs font-medium uppercase tracking-wider text-gray-500 sm:px-6">
                      数量
                    </th>
                    <th className="px-4 py-3 text-left text-xs font-medium uppercase tracking-wider text-gray-500 sm:px-6">
                      单价
                    </th>
                    <th className="px-4 py-3 text-left text-xs font-medium uppercase tracking-wider text-gray-500 sm:px-6">
                      金额
                    </th>
                    <th className="px-4 py-3 text-left text-xs font-medium uppercase tracking-wider text-gray-500 sm:px-6">
                      发货状态
                    </th>
                    <th className="px-4 py-3 text-left text-xs font-medium uppercase tracking-wider text-gray-500 sm:px-6">
                      结算状态
                    </th>
                    <th className="px-4 py-3 text-left text-xs font-medium uppercase tracking-wider text-gray-500 sm:px-6">
                      付款时间
                    </th>
                    <th className="px-4 py-3 text-left text-xs font-medium uppercase tracking-wider text-gray-500 sm:px-6">
                      创建时间
                    </th>
                    <th className="px-4 py-3 text-left text-xs font-medium uppercase tracking-wider text-gray-500 sm:px-6">
                      操作
                    </th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-200 bg-white">
                  {(() => {
                    // 根据付款状态筛选
                    const filteredItems = dashboard.items.filter((item) => {
                      if (paymentFilter === 'all') return true;
                      if (paymentFilter === 'paid') return item.settlementStatus === 'PAID';
                      if (paymentFilter === 'pending') return item.settlementStatus !== 'PAID';
                      return true;
                    });

                    if (filteredItems.length === 0) {
                      return (
                        <tr>
                          <td colSpan={10} className="px-4 py-8 text-center text-sm text-gray-500 sm:px-6">
                            {paymentFilter === 'all' ? '暂无数据' : `暂无${paymentFilter === 'paid' ? '已付款' : '待付款'}的数据`}
                          </td>
                        </tr>
                      );
                    }

                    return filteredItems.map((item, index) => (
                      <tr key={index} className="hover:bg-gray-50">
                        <td className="whitespace-nowrap px-4 py-3 text-sm text-gray-900 sm:px-6">
                          {item.rfqNo}
                        </td>
                        <td className="px-4 py-3 text-sm text-gray-900 sm:px-6">
                          <div className="max-w-xs truncate">{item.productName}</div>
                        </td>
                        <td className="whitespace-nowrap px-4 py-3 text-sm text-gray-600 sm:px-6">
                          {item.quantity}
                        </td>
                        <td className="whitespace-nowrap px-4 py-3 text-sm text-gray-600 sm:px-6">
                          {formatCurrency(item.price)}
                        </td>
                        <td className="whitespace-nowrap px-4 py-3 text-sm font-medium text-gray-900 sm:px-6">
                          {formatCurrency(item.amount)}
                        </td>
                        <td className="whitespace-nowrap px-4 py-3 text-sm sm:px-6">
                          {getStatusBadge(item.shipmentStatus)}
                        </td>
                        <td className="whitespace-nowrap px-4 py-3 text-sm sm:px-6">
                          {getSettlementStatusBadge(item.settlementStatus)}
                        </td>
                        <td className="whitespace-nowrap px-4 py-3 text-xs text-gray-500 sm:px-6">
                          {item.paidAt ? new Date(item.paidAt).toLocaleString('zh-CN', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' }) : '-'}
                        </td>
                        <td className="whitespace-nowrap px-4 py-3 text-xs text-gray-500 sm:px-6">
                          {new Date(item.createdAt).toLocaleDateString('zh-CN')}
                        </td>
                        <td className="whitespace-nowrap px-4 py-3 text-sm sm:px-6">
                          {item.shipmentId && (user?.role === 'ADMIN' || user?.role === 'BUYER') ? (
                            <label className="inline-flex items-center gap-2 cursor-pointer">
                              <input
                                type="file"
                                accept="image/*"
                                onChange={(e) => handleUploadPaymentScreenshot(item.shipmentId!, e)}
                                disabled={uploadingScreenshot === item.shipmentId}
                                className="hidden"
                                id={`payment-screenshot-${item.shipmentId}`}
                              />
                              <span
                                className={`text-xs px-2 py-1 rounded ${
                                  uploadingScreenshot === item.shipmentId
                                    ? 'bg-gray-300 text-gray-600 cursor-not-allowed'
                                    : item.settlementStatus === 'PAID'
                                    ? 'bg-green-100 text-green-700 hover:bg-green-200'
                                    : 'bg-blue-100 text-blue-700 hover:bg-blue-200'
                                } transition-colors`}
                                onClick={() => {
                                  if (uploadingScreenshot !== item.shipmentId) {
                                    document.getElementById(`payment-screenshot-${item.shipmentId}`)?.click();
                                  }
                                }}
                              >
                                {uploadingScreenshot === item.shipmentId
                                  ? '上传中...'
                                  : item.settlementStatus === 'PAID'
                                  ? '重新上传'
                                  : '上传付款截图'}
                              </span>
                            </label>
                          ) : (
                            <span className="text-xs text-gray-400">-</span>
                          )}
                        </td>
                      </tr>
                    ));
                  })()}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {activeTab === 'chart' && (
          <div className="rounded-xl bg-white p-4 shadow-sm sm:p-6">
            <h2 className="mb-4 text-lg font-semibold text-gray-900">每日趋势</h2>
            {dashboard.dailyStats.length === 0 ? (
              <div className="py-8 text-center text-gray-500">暂无数据</div>
            ) : (
              <div className="space-y-2">
                {dashboard.dailyStats.map((stat) => (
                  <div key={stat.date} className="flex items-center gap-4">
                    <div className="w-24 text-sm text-gray-600">
                      {new Date(stat.date).toLocaleDateString('zh-CN', { month: 'short', day: 'numeric' })}
                    </div>
                    <div className="flex-1">
                      <div className="flex items-center gap-2">
                        <div
                          className="h-6 rounded bg-blue-500"
                          style={{
                            width: `${(stat.amount / Math.max(...dashboard.dailyStats.map(s => s.amount))) * 100}%`,
                          }}
                        ></div>
                        <span className="text-sm font-medium text-gray-900">{formatCurrency(stat.amount)}</span>
                      </div>
                    </div>
                    <div className="text-xs text-gray-500">{stat.count} 单</div>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

