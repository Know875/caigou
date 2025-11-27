'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { authApi } from '@/lib/auth';
import api from '@/lib/api';
import { getProxiedImageUrl } from '@/lib/utils/image-proxy';
import { handleImageError, handleVideoError } from '@/lib/utils/image-placeholder';

interface FinancialReport {
  date: string;
  period?: 'day' | 'week' | 'month';
  periodLabel?: string;
  startDate?: string;
  endDate?: string;
  suppliers: Array<{
    supplierId: string;
    supplierName: string;
    totalAmount: number;
    awardCount: number;
    rfqGroups: Array<{
      rfqId: string;
      rfqNo: string;
      rfqTitle?: string;
      totalAmount: number;
      storeId?: string;
      storeName?: string;
      storeCode?: string;
      shipmentIds: string[]; // 该RFQ+供应商+门店下的所有发货单ID
      settlementId?: string; // 结算记录ID（如果有）
      hasPaymentScreenshot: boolean; // 是否已有付款截图
      paymentScreenshotUrl?: string; // 付款截图URL（如果有）
      items: Array<{
        rfqItemId: string;
        productName: string;
        quantity: number;
        price: number;
        trackingNo?: string;
        carrier?: string;
        shipmentId?: string;
      }>;
    }>;
  }>;
  ecommerce: {
    totalAmount: number;
    itemCount: number;
    items?: Array<{
      rfqNo: string;
      rfqItemId: string;
      productName: string;
      quantity: number;
      price: number;
      trackingNo?: string;
      carrier?: string;
      storeId?: string;
      storeName?: string;
      storeCode?: string;
    }>;
  };
  summary: {
    supplierTotal: number;
    ecommerceTotal: number;
    totalAmount: number;
    supplierCount: number;
    payable: {
      count: number;
      amount: number;
    };
    pendingPayment: {
      count: number;
      amount: number;
    };
    paid: {
      count: number;
      amount: number;
    };
  };
}

export default function ReportsPage() {
  const router = useRouter();
  const [user, setUser] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [report, setReport] = useState<FinancialReport | null>(null);
  const [selectedDate, setSelectedDate] = useState<string>(
    new Date().toISOString().split('T')[0]
  );
  const [storeFilter, setStoreFilter] = useState<string>(''); // 门店筛选
  const [stores, setStores] = useState<any[]>([]); // 门店列表
  const [expandedSuppliers, setExpandedSuppliers] = useState<Set<string>>(new Set());
  const [reportPeriod, setReportPeriod] = useState<'day' | 'week' | 'month'>('day'); // 报表周期
  const [uploadingScreenshot, setUploadingScreenshot] = useState<string | null>(null);
  const [previewImage, setPreviewImage] = useState<{ url: string; isVideo: boolean } | null>(null);

  useEffect(() => {
    const currentUser = authApi.getCurrentUser();
    if (!currentUser) {
      router.push('/login');
      return;
    }

    // 允许管理员、采购员和门店用户访问报表页面
    if (currentUser.role !== 'ADMIN' && currentUser.role !== 'BUYER' && currentUser.role !== 'STORE') {
      router.push('/dashboard');
      return;
    }

    setUser(currentUser);
    
    // 门店用户自动设置为自己店铺
    if (currentUser.role === 'STORE' && currentUser.storeId) {
      setStoreFilter(currentUser.storeId);
    }
    
    fetchStores();
    fetchFinancialReport();
  }, [router, selectedDate, storeFilter, reportPeriod]);

  const fetchStores = async () => {
    try {
      const response = await api.get('/stores');
      const storesData = response.data.data || response.data || [];
      setStores(Array.isArray(storesData) ? storesData : []);
    } catch (error: any) {
      console.error('获取门店列表失败:', error);
      setStores([]);
    }
  };

  const fetchFinancialReport = async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams();
      params.append('date', selectedDate);
      params.append('period', reportPeriod);
      if (storeFilter && storeFilter.trim() !== '') {
        params.append('storeId', storeFilter.trim());
        console.log('[ReportsPage] 请求财务报表，门店ID:', storeFilter, '周期:', reportPeriod);
      } else {
        console.log('[ReportsPage] 请求财务报表，全部门店，周期:', reportPeriod);
      }
      const response = await api.get(`/reports/financial?${params.toString()}`);
      const reportData = response.data.data || response.data;
      console.log('[ReportsPage] 收到财务报表数据:', {
        date: reportData?.date,
        supplierCount: reportData?.summary?.supplierCount,
        supplierTotal: reportData?.summary?.supplierTotal,
        ecommerceTotal: reportData?.summary?.ecommerceTotal,
        firstSupplierStore: reportData?.suppliers?.[0]?.items?.[0]?.storeName,
      });
      setReport(reportData);
    } catch (error: any) {
      console.error('获取财务报表失败:', error);
      setReport(null);
    } finally {
      setLoading(false);
    }
  };

  const toggleSupplierExpanded = (supplierId: string) => {
    const newExpanded = new Set(expandedSuppliers);
    if (newExpanded.has(supplierId)) {
      newExpanded.delete(supplierId);
    } else {
      newExpanded.add(supplierId);
    }
    setExpandedSuppliers(newExpanded);
  };

  const formatCurrency = (amount: number | undefined | null) => {
    if (amount === undefined || amount === null || isNaN(amount)) {
      return '¥0.00';
    }
    return `¥${amount.toLocaleString('zh-CN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
  };

  const handleUploadPaymentScreenshot = async (rfqGroup: any, event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;

    if (!file.type.startsWith('image/')) {
      alert('请选择图片文件');
      return;
    }

    const uploadKey = `${rfqGroup.rfqId}-${rfqGroup.shipmentIds[0]}`;
    setUploadingScreenshot(uploadKey);
    try {
      const formData = new FormData();
      formData.append('file', file);
      formData.append('rfqId', rfqGroup.rfqId);
      formData.append('shipmentIds', JSON.stringify(rfqGroup.shipmentIds));

      // 使用第一个shipmentId作为主要ID，但传递所有shipmentIds（该RFQ+供应商+门店的所有发货单）
      await api.post(`/shipments/${rfqGroup.shipmentIds[0]}/payment-screenshot-batch`, formData, {
        headers: {
          'Content-Type': 'multipart/form-data',
        },
      });

      alert('付款截图上传成功！');
      // 刷新报表数据
      fetchFinancialReport();
    } catch (error: any) {
      console.error('上传付款截图失败:', error);
      alert('上传失败: ' + (error.response?.data?.message || error.message));
    } finally {
      setUploadingScreenshot(null);
      // 清空文件输入，以便可以重新选择同一文件
      event.target.value = '';
    }
  };

  const handleExport = () => {
    if (!report) return;

    const csvRows: string[] = [];
    
    // 标题行
    csvRows.push('财务报表');
    csvRows.push(`周期: ${report.periodLabel || report.date}`);
    if (report.startDate && report.endDate && report.startDate !== report.endDate) {
      csvRows.push(`时间范围: ${report.startDate} 至 ${report.endDate}`);
    } else {
      csvRows.push(`日期: ${report.date}`);
    }
    csvRows.push('');

    // 供应商付款
    csvRows.push('供应商付款明细');
    csvRows.push('供应商名称,询价单号,商品名称,数量,单价,总价,物流单号,快递公司');
    report.suppliers.forEach(supplier => {
      supplier.rfqGroups?.forEach((rfqGroup: any) => {
        rfqGroup.items.forEach((item: any) => {
          csvRows.push(
            `"${supplier.supplierName}","${rfqGroup.rfqNo}","${item.productName}",${item.quantity},${(item.price / item.quantity).toFixed(2)},${item.price.toFixed(2)},"${item.trackingNo || ''}","${item.carrier || ''}"`
          );
        });
      });
    });
    csvRows.push('');

    // 电商平台采购
    csvRows.push('电商平台采购明细');
    csvRows.push('询价单号,商品名称,数量,单价,总价,物流单号,快递公司');
    (report.ecommerce.items || []).forEach(item => {
      csvRows.push(
        `"${item.rfqNo}","${item.productName}",${item.quantity},${(item.price / item.quantity).toFixed(2)},${item.price.toFixed(2)},"${item.trackingNo || ''}","${item.carrier || ''}"`
      );
    });
    csvRows.push('');

    // 汇总
    csvRows.push('汇总');
    csvRows.push(`供应商付款总额,${report.summary.supplierTotal.toFixed(2)}`);
    csvRows.push(`电商平台采购总额,${report.summary.ecommerceTotal.toFixed(2)}`);
    csvRows.push(`总计,${report.summary.totalAmount.toFixed(2)}`);

    const csvContent = csvRows.join('\n');
    const blob = new Blob(['\ufeff' + csvContent], { type: 'text/csv;charset=utf-8;' });
    const link = document.createElement('a');
    const url = URL.createObjectURL(blob);
    link.setAttribute('href', url);
    const periodSuffix = reportPeriod === 'day' ? '日报' : reportPeriod === 'week' ? '周报' : '月报';
    link.setAttribute('download', `财务报表_${periodSuffix}_${report.periodLabel || report.date}.csv`);
    link.style.visibility = 'hidden';
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  if (loading) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-gray-50">
        <div className="text-center">
          <div className="mx-auto h-12 w-12 animate-spin rounded-full border-4 border-blue-600 border-t-transparent"></div>
          <p className="mt-4 text-gray-600">加载中...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-blue-50 via-white to-purple-50 p-6">
      <div className="mx-auto max-w-7xl">
        {/* 头部 */}
        <div className="mb-6">
          <div className="mb-4">
            <h1 className="text-3xl font-bold text-gray-900">
              财务报表
              {report && report.periodLabel && (
                <span className="ml-2 text-lg font-normal text-gray-600">
                  ({report.periodLabel})
                </span>
              )}
            </h1>
            <p className="mt-1 text-sm text-gray-600">
              {storeFilter 
                ? `查看 ${stores.find(s => s.id === storeFilter)?.name || '选中门店'} 的${reportPeriod === 'day' ? '日' : reportPeriod === 'week' ? '周' : '月'}报表`
                : `查看所有门店的${reportPeriod === 'day' ? '日' : reportPeriod === 'week' ? '周' : '月'}报表`}
            </p>
          </div>
          <div className="rounded-xl bg-white p-4 shadow-sm">
            <div className="flex flex-wrap items-center gap-4">
              <div className="flex items-center gap-2">
                <label className="text-sm font-medium text-gray-700">报表周期：</label>
                <select
                  value={reportPeriod}
                  onChange={(e) => setReportPeriod(e.target.value as 'day' | 'week' | 'month')}
                  className="rounded-lg border border-gray-300 px-3 py-2 text-sm shadow-sm focus:border-blue-500 focus:outline-none focus:ring-blue-500"
                >
                  <option value="day">日报</option>
                  <option value="week">周报</option>
                  <option value="month">月报</option>
                </select>
              </div>
              <div className="flex items-center gap-2">
                <label className="text-sm font-medium text-gray-700">
                  {reportPeriod === 'day' ? '选择日期：' : reportPeriod === 'week' ? '选择日期（将显示该周）：' : '选择日期（将显示该月）：'}
                </label>
                <input
                  type="date"
                  value={selectedDate}
                  onChange={(e) => setSelectedDate(e.target.value)}
                  className="rounded-lg border border-gray-300 px-3 py-2 text-sm shadow-sm focus:border-blue-500 focus:outline-none focus:ring-blue-500"
                />
              </div>
              <div className="flex items-center gap-2">
                <label className="text-sm font-medium text-gray-700">选择门店：</label>
                {/* 门店筛选 - 门店用户不显示 */}
                {user?.role !== 'STORE' ? (
                  <select
                    value={storeFilter}
                    onChange={(e) => setStoreFilter(e.target.value)}
                    className="rounded-lg border border-gray-300 px-3 py-2 text-sm shadow-sm focus:border-blue-500 focus:outline-none focus:ring-blue-500"
                  >
                    <option value="">全部门店</option>
                    {stores.map((store) => (
                      <option key={store.id} value={store.id}>
                        {store.name} ({store.code})
                      </option>
                    ))}
                  </select>
                ) : stores.length > 0 && (
                  <div className="flex items-center gap-2 rounded-lg bg-blue-50 px-3 py-2 border border-blue-200">
                    <svg className="h-4 w-4 text-blue-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 21V5a2 2 0 00-2-2H7a2 2 0 00-2 2v16m14 0h2m-2 0h-5m-9 0H3m2 0h5M9 7h1m-1 4h1m4-4h1m-1 4h1m-5 10v-5a1 1 0 011-1h2a1 1 0 011 1v5m-4 0h4" />
                    </svg>
                    <span className="text-sm font-medium text-blue-900">
                      {stores[0]?.name} ({stores[0]?.code})
                    </span>
                  </div>
                )}
              </div>
              {report && (
                <button
                  onClick={handleExport}
                  className="ml-auto flex items-center gap-2 rounded-lg bg-green-600 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-green-700"
                >
                  <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 10v6m0 0l-3-3m3 3l3-3m2 8H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
                  </svg>
                  导出CSV
                </button>
              )}
            </div>
          </div>
        </div>

        {/* 统计卡片 */}
        {report && (
          <div className="mb-6 grid grid-cols-1 gap-4 md:grid-cols-5">
            {/* 应付款 */}
            <div className="rounded-xl bg-white p-6 shadow-sm">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-sm font-medium text-gray-600">应付款</p>
                  <p className="mt-2 text-2xl font-bold text-yellow-600">
                    {formatCurrency(report.summary.payable.amount)}
                  </p>
                  <p className="mt-1 text-xs text-gray-500">
                    {report.summary.payable.count} 个付款项
                  </p>
                </div>
                <div className="flex h-12 w-12 items-center justify-center rounded-full bg-yellow-100">
                  <svg className="h-6 w-6 text-yellow-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
                  </svg>
                </div>
              </div>
            </div>

            {/* 待付款 */}
            <div className="rounded-xl bg-white p-6 shadow-sm">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-sm font-medium text-gray-600">待付款</p>
                  <p className="mt-2 text-2xl font-bold text-orange-600">
                    {formatCurrency(report.summary.pendingPayment.amount)}
                  </p>
                  <p className="mt-1 text-xs text-gray-500">
                    {report.summary.pendingPayment.count} 个付款项
                  </p>
                </div>
                <div className="flex h-12 w-12 items-center justify-center rounded-full bg-orange-100">
                  <svg className="h-6 w-6 text-orange-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8c-1.657 0-3 .895-3 2s1.343 2 3 2 3 .895 3 2-1.343 2-3 2m0-8c1.11 0 2.08.402 2.599 1M12 8V7m0 1v8m0 0v1m0-1c-1.11 0-2.08-.402-2.599-1M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                  </svg>
                </div>
              </div>
            </div>

            {/* 已付款 */}
            <div className="rounded-xl bg-white p-6 shadow-sm">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-sm font-medium text-gray-600">已付款</p>
                  <p className="mt-2 text-2xl font-bold text-green-600">
                    {formatCurrency(report.summary.paid.amount)}
                  </p>
                  <p className="mt-1 text-xs text-gray-500">
                    {report.summary.paid.count} 个付款项
                  </p>
                </div>
                <div className="flex h-12 w-12 items-center justify-center rounded-full bg-green-100">
                  <svg className="h-6 w-6 text-green-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
                  </svg>
                </div>
              </div>
            </div>

            {/* 供应商付款总额 */}
            <div className="rounded-xl bg-white p-6 shadow-sm">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-sm font-medium text-gray-600">供应商付款总额</p>
                  <p className="mt-2 text-2xl font-bold text-blue-600">
                    {formatCurrency(report.summary.supplierTotal)}
                  </p>
                  <p className="mt-1 text-xs text-gray-500">
                    {report.summary.supplierCount} 个供应商
                  </p>
                </div>
                <div className="flex h-12 w-12 items-center justify-center rounded-full bg-blue-100">
                  <svg className="h-6 w-6 text-blue-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 9V7a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2m2 4h10a2 2 0 002-2v-6a2 2 0 00-2-2H9a2 2 0 00-2 2v6a2 2 0 002 2zm7-5a2 2 0 11-4 0 2 2 0 014 0z" />
                  </svg>
                </div>
              </div>
            </div>

            {/* 总计 */}
            <div className="rounded-xl bg-white p-6 shadow-sm">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-sm font-medium text-gray-600">总计</p>
                  <p className="mt-2 text-2xl font-bold text-gray-900">
                    {formatCurrency(report.summary.totalAmount)}
                  </p>
                  <p className="mt-1 text-xs text-gray-500">
                    包含供应商和电商采购
                  </p>
                </div>
                <div className="flex h-12 w-12 items-center justify-center rounded-full bg-gray-100">
                  <svg className="h-6 w-6 text-gray-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z" />
                  </svg>
                </div>
              </div>
            </div>
          </div>
        )}

        {!report ? (
          <div className="rounded-xl bg-white p-12 text-center shadow-sm">
            <div className="mx-auto mb-4 flex h-16 w-16 items-center justify-center rounded-full bg-gray-100">
              <svg className="h-8 w-8 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
              </svg>
            </div>
            <h3 className="mb-2 text-lg font-semibold text-gray-900">暂无数据</h3>
            <p className="text-sm text-gray-500">所选日期没有财务数据</p>
          </div>
        ) : (
          <>
            {/* 统计卡片 */}
            <div className="mb-6 grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
              <div className="group relative overflow-hidden rounded-xl bg-gradient-to-br from-blue-500 to-blue-600 p-6 text-white shadow-lg transition-transform hover:scale-105">
                <div className="absolute right-0 top-0 -mr-4 -mt-4 h-24 w-24 rounded-full bg-white/20"></div>
                <div className="relative">
                  <div className="text-sm font-medium opacity-90">
                    供应商付款总额
                    {storeFilter && (
                      <span className="ml-2 text-xs opacity-75">
                        ({stores.find(s => s.id === storeFilter)?.name || '选中门店'})
                      </span>
                    )}
                  </div>
                  <div className="mt-2 text-3xl font-bold">{formatCurrency(report.summary.supplierTotal)}</div>
                  <div className="mt-2 text-sm opacity-75">{report.summary.supplierCount} 个供应商</div>
                </div>
              </div>

              <div className="group relative overflow-hidden rounded-xl bg-gradient-to-br from-purple-500 to-purple-600 p-6 text-white shadow-lg transition-transform hover:scale-105">
                <div className="absolute right-0 top-0 -mr-4 -mt-4 h-24 w-24 rounded-full bg-white/20"></div>
                <div className="relative">
                  <div className="text-sm font-medium opacity-90">
                    电商平台采购
                    {storeFilter && (
                      <span className="ml-2 text-xs opacity-75">
                        ({stores.find(s => s.id === storeFilter)?.name || '选中门店'})
                      </span>
                    )}
                  </div>
                  <div className="mt-2 text-3xl font-bold">{formatCurrency(report.summary.ecommerceTotal)}</div>
                  <div className="mt-2 text-sm opacity-75">{report.ecommerce.itemCount} 个订单</div>
                </div>
              </div>

              <div className="group relative overflow-hidden rounded-xl bg-gradient-to-br from-green-500 to-green-600 p-6 text-white shadow-lg transition-transform hover:scale-105">
                <div className="absolute right-0 top-0 -mr-4 -mt-4 h-24 w-24 rounded-full bg-white/20"></div>
                <div className="relative">
                  <div className="text-sm font-medium opacity-90">总支出</div>
                  <div className="mt-2 text-3xl font-bold">{formatCurrency(report.summary.totalAmount)}</div>
                  <div className="mt-2 text-sm opacity-75">当日总支出</div>
                </div>
              </div>

              <div className="group relative overflow-hidden rounded-xl bg-gradient-to-br from-amber-500 to-amber-600 p-6 text-white shadow-lg transition-transform hover:scale-105">
                <div className="absolute right-0 top-0 -mr-4 -mt-4 h-24 w-24 rounded-full bg-white/20"></div>
                <div className="relative">
                  <div className="text-sm font-medium opacity-90">报表日期</div>
                  <div className="mt-2 text-2xl font-bold">{report.date}</div>
                  <div className="mt-2 text-sm opacity-75">{new Date(report.date).toLocaleDateString('zh-CN', { weekday: 'long' })}</div>
                </div>
              </div>
            </div>

            {/* 供应商付款明细 */}
            <div className="mb-6 rounded-xl bg-white shadow-sm">
              <div className="border-b border-gray-200 px-6 py-4">
                <h2 className="text-lg font-semibold text-gray-900">供应商付款明细</h2>
                <p className="mt-1 text-sm text-gray-600">查看每个供应商的付款金额和商品明细</p>
              </div>
              <div className="p-6">
                {report.suppliers.length === 0 ? (
                  <div className="py-8 text-center text-gray-500">暂无供应商付款记录</div>
                ) : (
                  <div className="space-y-4">
                    {report.suppliers.map((supplier) => (
                      <div key={supplier.supplierId} className="rounded-lg border border-gray-200 bg-gray-50">
                        <div
                          className="flex cursor-pointer items-center justify-between p-4 transition-colors hover:bg-gray-100"
                          onClick={() => toggleSupplierExpanded(supplier.supplierId)}
                        >
                          <div className="flex items-center gap-4">
                            <div className="flex h-10 w-10 items-center justify-center rounded-full bg-blue-100 text-blue-600">
                              <span className="text-sm font-semibold">{supplier.supplierName.charAt(0)}</span>
                            </div>
                            <div>
                              <div className="font-semibold text-gray-900">{supplier.supplierName}</div>
                              <div className="text-sm text-gray-600">
                                {supplier.awardCount} 个中标单
                              </div>
                            </div>
                          </div>
                          <div className="flex items-center gap-4">
                            <div className="text-right">
                              <div className="text-lg font-bold text-gray-900">{formatCurrency(supplier.totalAmount)}</div>
                              <div className="text-xs text-gray-500">应付金额</div>
                            </div>
                            <svg
                              className={`h-5 w-5 text-gray-400 transition-transform ${
                                expandedSuppliers.has(supplier.supplierId) ? 'rotate-180' : ''
                              }`}
                              fill="none"
                              stroke="currentColor"
                              viewBox="0 0 24 24"
                            >
                              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                            </svg>
                          </div>
                        </div>
                        {expandedSuppliers.has(supplier.supplierId) && (
                          <div className="border-t border-gray-200 bg-white">
                            <div className="space-y-4 p-4">
                              {supplier.rfqGroups?.map((rfqGroup: any) => (
                                <div key={`${rfqGroup.rfqId}-${rfqGroup.storeId || ''}`} className="rounded-lg border border-gray-200 bg-gray-50">
                                  {/* RFQ分组头部 */}
                                  <div className="flex items-center justify-between border-b border-gray-200 bg-white p-3">
                                    <div className="flex items-center gap-3">
                                      <div className="font-semibold text-gray-900">{rfqGroup.rfqNo}</div>
                                      {rfqGroup.rfqTitle && (
                                        <span className="text-sm text-gray-600">({rfqGroup.rfqTitle})</span>
                                      )}
                                      {!storeFilter && rfqGroup.storeName && (
                                        <span className="inline-flex items-center rounded-full bg-blue-100 px-2.5 py-0.5 text-xs font-medium text-blue-800">
                                          {rfqGroup.storeName}
                                          {rfqGroup.storeCode && <span className="ml-1 text-blue-600">({rfqGroup.storeCode})</span>}
                                        </span>
                                      )}
                                    </div>
                                    <div className="flex items-center gap-4">
                                      <div className="text-right">
                                        <div className="text-sm font-bold text-gray-900">{formatCurrency(rfqGroup.totalAmount)}</div>
                                        <div className="text-xs text-gray-500">合计金额</div>
                                      </div>
                                      {(user?.role === 'ADMIN' || user?.role === 'BUYER') && rfqGroup.shipmentIds.length > 0 && (
                                        <div className="flex items-center gap-2" onClick={(e) => e.stopPropagation()}>
                                          {rfqGroup.hasPaymentScreenshot && rfqGroup.paymentScreenshotUrl && (
                                            <img
                                              src={getProxiedImageUrl(rfqGroup.paymentScreenshotUrl)}
                                              alt="付款截图"
                                              className="h-10 w-10 rounded border border-gray-300 cursor-pointer hover:opacity-80 transition-opacity object-cover"
                                              onClick={() => setPreviewImage({ url: getProxiedImageUrl(rfqGroup.paymentScreenshotUrl!), isVideo: false })}
                                              onError={handleImageError}
                                              loading="lazy"
                                            />
                                          )}
                                          <label className="inline-flex items-center gap-2 cursor-pointer">
                                            <input
                                              type="file"
                                              accept="image/*"
                                              onChange={(e) => {
                                                e.stopPropagation();
                                                handleUploadPaymentScreenshot(rfqGroup, e);
                                              }}
                                              disabled={uploadingScreenshot === `${rfqGroup.rfqId}-${rfqGroup.shipmentIds[0]}`}
                                              className="hidden"
                                              id={`payment-screenshot-${rfqGroup.rfqId}-${rfqGroup.storeId || ''}`}
                                            />
                                            <span
                                              className={`text-xs px-3 py-1.5 rounded ${
                                                uploadingScreenshot === `${rfqGroup.rfqId}-${rfqGroup.shipmentIds[0]}`
                                                  ? 'bg-gray-300 text-gray-600 cursor-not-allowed'
                                                  : rfqGroup.hasPaymentScreenshot
                                                  ? 'bg-green-100 text-green-700 hover:bg-green-200'
                                                  : 'bg-blue-100 text-blue-700 hover:bg-blue-200'
                                              } transition-colors font-medium`}
                                              onClick={(e) => {
                                                e.stopPropagation();
                                                if (uploadingScreenshot !== `${rfqGroup.rfqId}-${rfqGroup.shipmentIds[0]}`) {
                                                  document.getElementById(`payment-screenshot-${rfqGroup.rfqId}-${rfqGroup.storeId || ''}`)?.click();
                                                }
                                              }}
                                            >
                                              {uploadingScreenshot === `${rfqGroup.rfqId}-${rfqGroup.shipmentIds[0]}`
                                                ? '上传中...'
                                                : rfqGroup.hasPaymentScreenshot
                                                ? '重新上传'
                                                : '上传付款截图'}
                                            </span>
                                          </label>
                                        </div>
                                      )}
                                    </div>
                                  </div>
                                  {/* 商品明细 */}
                                  <div className="overflow-x-auto">
                                    <table className="min-w-full divide-y divide-gray-200">
                                      <thead className="bg-gray-50">
                                        <tr>
                                          <th className="px-4 py-2 text-left text-xs font-medium uppercase tracking-wider text-gray-700">商品名称</th>
                                          <th className="px-4 py-2 text-left text-xs font-medium uppercase tracking-wider text-gray-700">数量</th>
                                          <th className="px-4 py-2 text-right text-xs font-medium uppercase tracking-wider text-gray-700">单价</th>
                                          <th className="px-4 py-2 text-right text-xs font-medium uppercase tracking-wider text-gray-700">总价</th>
                                          <th className="px-4 py-2 text-left text-xs font-medium uppercase tracking-wider text-gray-700">物流单号</th>
                                          <th className="px-4 py-2 text-left text-xs font-medium uppercase tracking-wider text-gray-700">快递公司</th>
                                        </tr>
                                      </thead>
                                      <tbody className="divide-y divide-gray-200 bg-white">
                                        {rfqGroup.items.map((item: any, index: number) => (
                                          <tr key={index} className="hover:bg-gray-50">
                                            <td className="px-4 py-2 text-sm text-gray-900">{item.productName}</td>
                                            <td className="whitespace-nowrap px-4 py-2 text-sm text-gray-600">{item.quantity}</td>
                                            <td className="whitespace-nowrap px-4 py-2 text-right text-sm text-gray-600">
                                              {formatCurrency(item.price / item.quantity)}
                                            </td>
                                            <td className="whitespace-nowrap px-4 py-2 text-right text-sm font-semibold text-gray-900">
                                              {formatCurrency(item.price)}
                                            </td>
                                            <td className="whitespace-nowrap px-4 py-2 text-sm font-mono text-xs text-gray-600">
                                              {item.trackingNo || '-'}
                                            </td>
                                            <td className="whitespace-nowrap px-4 py-2 text-sm text-gray-600">{item.carrier || '-'}</td>
                                          </tr>
                                        ))}
                                      </tbody>
                                    </table>
                                  </div>
                                </div>
                              ))}
                            </div>
                          </div>
                        )}
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>

            {/* 电商平台采购明细 */}
            <div className="rounded-xl bg-white shadow-sm">
              <div className="border-b border-gray-200 px-6 py-4">
                <h2 className="text-lg font-semibold text-gray-900">电商平台采购明细</h2>
                <p className="mt-1 text-sm text-gray-600">查看从拼多多/淘宝采购的商品和金额</p>
              </div>
              <div className="p-6">
                {!report.ecommerce.items || report.ecommerce.items.length === 0 ? (
                  <div className="py-8 text-center text-gray-500">暂无电商平台采购记录</div>
                ) : (
                  <div className="overflow-x-auto">
                    <table className="min-w-full divide-y divide-gray-200">
                      <thead className="bg-gray-50">
                        <tr>
                          <th className="px-4 py-3 text-left text-xs font-medium uppercase tracking-wider text-gray-700">询价单号</th>
                          {!storeFilter && (
                            <th className="px-4 py-3 text-left text-xs font-medium uppercase tracking-wider text-gray-700">门店</th>
                          )}
                          <th className="px-4 py-3 text-left text-xs font-medium uppercase tracking-wider text-gray-700">商品名称</th>
                          <th className="px-4 py-3 text-left text-xs font-medium uppercase tracking-wider text-gray-700">数量</th>
                          <th className="px-4 py-3 text-right text-xs font-medium uppercase tracking-wider text-gray-700">单价</th>
                          <th className="px-4 py-3 text-right text-xs font-medium uppercase tracking-wider text-gray-700">总价</th>
                          <th className="px-4 py-3 text-left text-xs font-medium uppercase tracking-wider text-gray-700">物流单号</th>
                          <th className="px-4 py-3 text-left text-xs font-medium uppercase tracking-wider text-gray-700">快递公司</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-gray-200 bg-white">
                        {report.ecommerce.items.map((item, index) => (
                          <tr key={index} className="hover:bg-gray-50">
                            <td className="whitespace-nowrap px-4 py-3 text-sm text-gray-900">{item.rfqNo}</td>
                            {!storeFilter && (
                              <td className="whitespace-nowrap px-4 py-3 text-sm text-gray-600">
                                {item.storeName ? (
                                  <span className="inline-flex items-center rounded-full bg-purple-100 px-2.5 py-0.5 text-xs font-medium text-purple-800">
                                    {item.storeName}
                                    {item.storeCode && <span className="ml-1 text-purple-600">({item.storeCode})</span>}
                                  </span>
                                ) : (
                                  <span className="text-gray-400">-</span>
                                )}
                              </td>
                            )}
                            <td className="px-4 py-3 text-sm text-gray-900">{item.productName}</td>
                            <td className="whitespace-nowrap px-4 py-3 text-sm text-gray-600">{item.quantity}</td>
                            <td className="whitespace-nowrap px-4 py-3 text-right text-sm text-gray-600">
                              {formatCurrency(item.price / item.quantity)}
                            </td>
                            <td className="whitespace-nowrap px-4 py-3 text-right text-sm font-semibold text-gray-900">
                              {formatCurrency(item.price)}
                            </td>
                            <td className="whitespace-nowrap px-4 py-3 text-sm font-mono text-xs text-gray-600">
                              {item.trackingNo || '-'}
                            </td>
                            <td className="whitespace-nowrap px-4 py-3 text-sm text-gray-600">{item.carrier || '-'}</td>
                          </tr>
                        ))}
                      </tbody>
                      <tfoot className="bg-gray-50">
                        <tr>
                          <td colSpan={storeFilter ? 4 : 5} className="px-4 py-3 text-right text-sm font-semibold text-gray-900">
                            电商平台采购总额：
                          </td>
                          <td className="whitespace-nowrap px-4 py-3 text-right text-lg font-bold text-gray-900">
                            {formatCurrency(report.ecommerce.totalAmount)}
                          </td>
                          <td colSpan={2}></td>
                        </tr>
                      </tfoot>
                    </table>
                  </div>
                )}
              </div>
            </div>
          </>
        )}

        {/* 图片预览模态框 */}
        {previewImage && (
          <div
            className="fixed inset-0 z-50 flex items-center justify-center bg-black bg-opacity-75 p-4"
            onClick={() => setPreviewImage(null)}
          >
            <div className="relative max-h-full max-w-full">
              {previewImage.isVideo ? (
                <video
                  src={previewImage.url}
                  controls
                  className="max-h-[90vh] max-w-full rounded-lg"
                  onClick={(e) => e.stopPropagation()}
                  onError={handleVideoError}
                />
              ) : (
                <img
                  src={previewImage.url}
                  alt="预览"
                  className="max-h-[90vh] max-w-full rounded-lg"
                  onClick={(e) => e.stopPropagation()}
                  onError={handleImageError}
                />
              )}
              <button
                onClick={() => setPreviewImage(null)}
                className="absolute right-2 top-2 rounded-full bg-black bg-opacity-50 p-2 text-white hover:bg-opacity-75"
              >
                <svg className="h-6 w-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

