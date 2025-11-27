'use client';

import { useEffect, useState, useRef, useCallback } from 'react';
import { useRouter, useParams, useSearchParams } from 'next/navigation';
import { authApi } from '@/lib/auth';
import api from '@/lib/api';
import { getProxiedImageUrl } from '@/lib/utils/image-proxy';
import { handleImageError, handleVideoError } from '@/lib/utils/image-placeholder';
import TrackingNumberLink from '@/components/TrackingNumberLink';
import type { Rfq, Quote, Award, RfqItem, QuoteItem } from '@/types';

// API 错误类型
interface ApiError extends Error {
  response?: {
    status?: number;
    statusText?: string;
    data?: {
      message?: string;
    };
  };
}

function isApiError(err: unknown): err is ApiError {
  return err instanceof Error && 'response' in err;
}

function getErrorMessage(err: unknown): string {
  if (err instanceof Error) {
    return err.message;
  }
  if (typeof err === 'string') {
    return err;
  }
  return '发生未知错误';
}

export default function RfqDetailPage() {
  const router = useRouter();
  const params = useParams();
  const searchParams = useSearchParams();
  const rfqId = params.id as string;
  const [rfq, setRfq] = useState<Rfq | null>(null);
  const [quotes, setQuotes] = useState<Quote[]>([]);
  const [awards, setAwards] = useState<Award[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedQuoteId, setSelectedQuoteId] = useState<string | null>(null);
  const [previewImage, setPreviewImage] = useState<{ url: string; isVideo: boolean } | null>(null);
  const [editingMaxPrice, setEditingMaxPrice] = useState<{ itemId: string; value: string; instantPrice?: string; applyToAll?: boolean } | null>(null);
  const [publishing, setPublishing] = useState(false);
  const itemsSectionRef = useRef<HTMLDivElement>(null);

  // 点击商品名称跳转到拼多多搜索
  const handleProductNameClick = (productName: string, e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    
    // 对商品名称进行URL编码，确保特殊字符正确传递
    const encodedName = encodeURIComponent(productName);
    
    // 检测是否在移动设备上
    const isMobile = /iPhone|iPad|iPod|Android/i.test(navigator.userAgent);
    
    // 拼多多搜索URL - 使用正确的域名和参数格式
    const searchUrl = `https://mobile.yangkeduo.com/search_result.html?search_key=${encodedName}`;
    
    if (isMobile) {
      // 移动端：直接打开网页搜索
      // 如果用户安装了拼多多APP，网页会自动提示在APP中打开
      window.location.href = searchUrl;
    } else {
      // 桌面端：在新标签页打开网页搜索
      window.open(searchUrl, '_blank');
    }
  };

  useEffect(() => {
    const user = authApi.getCurrentUser();
    if (!user) {
      router.push('/login');
      return;
    }

    // 允许管理员、采购员、门店用户和供应商访问询价单详情页面
    if (user.role !== 'ADMIN' && user.role !== 'BUYER' && user.role !== 'STORE' && user.role !== 'SUPPLIER') {
      router.push('/dashboard');
      return;
    }

    fetchData();
  }, [router, rfqId]);

  // 如果是从文件导入创建的，自动滚动到商品列表并打开第一个未设置最高限价的商品
  useEffect(() => {
    const fromFile = searchParams.get('fromFile');
    if (fromFile === 'true' && rfq && rfq.items && rfq.items.length > 0) {
      // 延迟执行，确保页面已渲染
      setTimeout(() => {
        // 滚动到商品列表区域
        if (itemsSectionRef.current) {
          itemsSectionRef.current.scrollIntoView({ behavior: 'smooth', block: 'start' });
        }
        
        // 找到第一个未设置最高限价的商品，自动打开编辑状态
        const firstItemWithoutMaxPrice = rfq.items?.find((item) => !item.maxPrice);
        if (firstItemWithoutMaxPrice) {
          setEditingMaxPrice({ 
            itemId: firstItemWithoutMaxPrice.id, 
            value: '',
            instantPrice: firstItemWithoutMaxPrice.instantPrice ? String(Number(firstItemWithoutMaxPrice.instantPrice)) : ''
          });
        }
        
        // 移除 URL 参数，避免刷新时重复执行
        router.replace(`/rfqs/${rfqId}`, { scroll: false });
      }, 300);
    }
  }, [rfq, searchParams, rfqId, router]);

  // 当输入框打开时，滚动到对应的商品卡片，确保商品名称可见
  useEffect(() => {
    if (editingMaxPrice?.itemId && itemsSectionRef.current) {
      setTimeout(() => {
        const cardElement = itemsSectionRef.current?.querySelector(`[data-item-id="${editingMaxPrice.itemId}"]`);
        if (cardElement && itemsSectionRef.current) {
          // 计算卡片相对于滚动容器的位置
          const cardOffsetTop = (cardElement as HTMLElement).offsetTop;
          // 向上留更多空间（60px），确保商品名称完全可见
          const targetScrollTop = cardOffsetTop - 60;
          
          // 平滑滚动到目标位置
          itemsSectionRef.current.scrollTo({
            top: Math.max(0, targetScrollTop),
            behavior: 'smooth'
          });
        }
      }, 200);
    }
  }, [editingMaxPrice?.itemId]);

  // 处理 ESC 键关闭预览
  useEffect(() => {
    if (typeof window === 'undefined') return;
    
    const handleEscape = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && previewImage) {
        setPreviewImage(null);
      }
    };
    window.addEventListener('keydown', handleEscape);
    return () => window.removeEventListener('keydown', handleEscape);
  }, [previewImage]);

  const fetchData = async () => {
    try {
      await Promise.all([fetchRfq(), fetchQuotes(), fetchAwards()]);
    } finally {
      setLoading(false);
    }
  };

  const fetchAwards = async () => {
    try {
      const response = await api.get('/awards');
      const awardsData = response.data.data || response.data || [];
      // 只显示当前询价单的中标订单
      const rfqAwards = Array.isArray(awardsData) 
        ? awardsData.filter((award): award is Award => award.rfqId === rfqId)
        : [];
      setAwards(rfqAwards);
    } catch (error: unknown) {
      console.error('获取中标订单失败:', error);
      setAwards([]);
    }
  };

  const fetchRfq = useCallback(async () => {
    try {
      const response = await api.get(`/rfqs/${rfqId}`);
      const rfqData = response.data.data || response.data;
      setRfq(rfqData);
    } catch (error: unknown) {
      console.error('获取询价单详情失败:', error);
    }
  }, [rfqId]);

  const fetchQuotes = useCallback(async () => {
    try {
      const response = await api.get(`/quotes?rfqId=${rfqId}`);
      const quotesData = response.data.data || response.data || [];
      setQuotes(Array.isArray(quotesData) ? quotesData : []);
    } catch (error: unknown) {
      console.error('获取报价列表失败:', error);
      setQuotes([]);
    }
  }, [rfqId]);

  // 实时刷新报价数据：当询价单已发布且未关闭时，每30秒自动刷新报价
  useEffect(() => {
    // 只在询价单已发布且未关闭时进行轮询
    if (!rfq || rfq.status !== 'PUBLISHED') {
      return;
    }

    // 供应商不需要轮询（他们提交报价后不需要实时查看其他供应商的报价）
    const user = authApi.getCurrentUser();
    if (user?.role === 'SUPPLIER') {
      return;
    }

    // 设置定时刷新
    const interval = setInterval(() => {
      // 只在页面可见时刷新（使用 Page Visibility API）
      if (document.visibilityState === 'visible') {
        // 刷新报价和询价单数据
        fetchQuotes().catch(err => console.error('刷新报价失败:', err));
        fetchRfq().catch(err => console.error('刷新询价单失败:', err));
      }
    }, 30000); // 每30秒刷新一次

    // 清理定时器
    return () => {
      clearInterval(interval);
    };
  }, [rfq?.id, rfq?.status, fetchQuotes, fetchRfq]);

  /**
   * 按商品级别选商（选择某个供应商的某个商品报价）
   */
  const handleAwardItem = async (rfqItemId: string, quoteItemId: string, quoteId: string, supplierName: string, price: number, skipConfirm = false) => {
    if (!skipConfirm && !confirm(`确定选择供应商 ${supplierName} 的报价 ¥${price.toFixed(2)} 中标此商品吗？`)) {
      return false;
    }

    try {
      await api.post(`/rfqs/${rfqId}/award-item`, {
        rfqItemId,
        quoteItemId,
        quoteId,
        reason: '手动选商（按商品级别）',
      });
      return true;
    } catch (error: unknown) {
      console.error('选商失败:', error);
      throw error;
    }
  };

  /**
   * 一键全选最低价中标
   */
  const handleAwardAllLowestPrice = async () => {
    if (!rfq || !rfq.items || rfq.status !== 'CLOSED') {
      alert('询价单未截标，无法选商');
      return;
    }

    // 统计需要选商的商品
    const itemsToAward: Array<{
      rfqItem: RfqItem;
      quoteItem: QuoteItem & { quoteId: string; supplier?: Quote['supplier']; supplierId?: string; quoteStatus?: Quote['status'] };
      quoteId: string;
      supplierName: string;
      price: number;
    }> = [];

    rfq.items.forEach((rfqItem) => {
      // 跳过已中标的商品
      if (rfqItem.itemStatus === 'AWARDED') {
        return;
      }

      // 找到所有报价了此商品的报价项
      const itemQuotes = quotes
        .flatMap((quote) =>
          quote.items
            ?.filter((quoteItem): quoteItem is QuoteItem => quoteItem.rfqItemId === rfqItem.id)
            .map((quoteItem) => ({
              ...quoteItem,
              quoteId: quote.id,
              supplier: quote.supplier,
              supplierId: quote.supplierId,
              quoteStatus: quote.status,
            })) || []
        )
        .filter((item) => Number(item.price) > 0)
        .sort((a, b) => parseFloat(String(a.price)) - parseFloat(String(b.price))); // 按价格排序

      // 如果有报价，选择最低价的
      if (itemQuotes.length > 0) {
        const lowestQuote = itemQuotes[0];
        itemsToAward.push({
          rfqItem,
          quoteItem: lowestQuote,
          quoteId: String(lowestQuote.quoteId),
          supplierName: lowestQuote.supplier?.username || '供应商',
          price: parseFloat(String(lowestQuote.price)),
        });
      }
    });

    if (itemsToAward.length === 0) {
      alert('没有需要选商的商品（所有商品都已中标或没有报价）');
      return;
    }

    // 确认对话框
    const itemList = itemsToAward
      .map((item) => `${item.rfqItem.productName}: ${item.supplierName} - ¥${item.price.toFixed(2)}`)
      .join('\n');
    
    if (!confirm(`确定要为以下 ${itemsToAward.length} 个商品选择最低价中标吗？\n\n${itemList}\n\n点击确定后开始批量选商...`)) {
      return;
    }

    // 批量选商
    let successCount = 0;
    let failCount = 0;
    const errors: string[] = [];

    for (const item of itemsToAward) {
      try {
        const success = await handleAwardItem(
          item.rfqItem.id,
          item.quoteItem.id,
          item.quoteId,
          item.supplierName,
          item.price,
          true // 跳过确认
        );
        if (success) {
          successCount++;
        }
        // 添加小延迟，避免请求过快
        await new Promise(resolve => setTimeout(resolve, 100));
      } catch (error: unknown) {
        failCount++;
        const errorMessage = isApiError(error) 
          ? error.response?.data?.message || getErrorMessage(error)
          : getErrorMessage(error);
        errors.push(`${item.rfqItem.productName}: ${errorMessage || '选商失败'}`);
        console.error(`选商失败 [${item.rfqItem.productName}]:`, error);
      }
    }

    // 刷新数据
    await fetchData();

    // 显示结果
    if (failCount === 0) {
      alert(`✅ 成功为 ${successCount} 个商品选择最低价中标！`);
    } else {
      alert(`⚠️ 选商完成：成功 ${successCount} 个，失败 ${failCount} 个\n\n失败详情：\n${errors.join('\n')}`);
    }
  };

  /**
   * 按整个报价单选商（保留兼容性）
   */
  const handleAwardQuote = async (quoteId: string) => {
    if (!confirm('确定选择此供应商的所有商品报价中标吗？\n\n注意：建议使用按商品级别选商，可以为每个商品选择不同的供应商。')) {
      return;
    }

    try {
      await api.patch(`/quotes/${rfqId}/award/${quoteId}`, {
        reason: '手动选商（整个报价单）',
      });
      alert('选商成功！');
      await fetchData();
    } catch (error: unknown) {
      console.error('选商失败:', error);
      const message = isApiError(error) 
        ? error.response?.data?.message || getErrorMessage(error)
        : getErrorMessage(error);
      alert(message || '选商失败');
    }
  };

  const getStatusColor = (status: string) => {
    const statusMap: Record<string, { bg: string; text: string; border: string }> = {
      // 询价单状态
      DRAFT: { bg: 'bg-gray-100', text: 'text-gray-800', border: 'border-gray-300' },
      PUBLISHED: { bg: 'bg-blue-100', text: 'text-blue-800', border: 'border-blue-300' },
      CLOSED: { bg: 'bg-yellow-100', text: 'text-yellow-800', border: 'border-yellow-300' },
      AWARDED: { bg: 'bg-green-100', text: 'text-green-800', border: 'border-green-300' },
      CANCELLED: { bg: 'bg-red-100', text: 'text-red-800', border: 'border-red-300' },
      // 报价单状态
      PENDING: { bg: 'bg-yellow-100', text: 'text-yellow-800', border: 'border-yellow-300' },
      SUBMITTED: { bg: 'bg-blue-100', text: 'text-blue-800', border: 'border-blue-300' },
      REJECTED: { bg: 'bg-red-100', text: 'text-red-800', border: 'border-red-300' },
    };
    return statusMap[status] || { bg: 'bg-gray-100', text: 'text-gray-800', border: 'border-gray-300' };
  };

  const getStatusText = (status: string) => {
    const statusMap: Record<string, string> = {
      // 询价单状态
      DRAFT: '草稿',
      PUBLISHED: '已发布',
      CLOSED: '已关闭',
      AWARDED: '已选商',
      CANCELLED: '已取消',
      // 报价单状态
      PENDING: '待提交',
      SUBMITTED: '已提交',
      REJECTED: '已拒绝',
    };
    return statusMap[status] || status;
  };

  if (loading) {
    return (
      <div className="flex h-screen items-center justify-center">
        <div className="text-gray-600">加载中...</div>
      </div>
    );
  }

  if (!rfq) {
    return (
      <div className="flex h-screen items-center justify-center">
        <div className="text-gray-600">询价单不存在</div>
      </div>
    );
  }

  // 分析未报价的商品
  const rfqItemIds = rfq.items?.map((item) => item.id) || [];
  const quotedItemIds = new Set(
    quotes.flatMap((quote) => quote.items?.map((item) => item.rfqItemId) || [])
  );
  const unquotedItems = rfq.items?.filter((item) => !quotedItemIds.has(item.id)) || [];

  return (
    <div className="min-h-screen bg-gray-50 p-6">
      <div className="mx-auto max-w-7xl">
        {/* 头部 */}
        <div className="mb-6">
          <button
            onClick={() => router.back()}
            className="mb-4 flex items-center gap-2 text-sm text-gray-600 hover:text-gray-900 transition-colors"
          >
            <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
            </svg>
            返回
          </button>
          
          <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-4">
            <div className="flex-1">
              <div className="flex items-center gap-3 mb-2">
                <h1 className="text-2xl sm:text-3xl font-bold text-gray-900">{rfq.rfqNo}</h1>
                <span className={`inline-flex items-center rounded-full border px-3 py-1 text-xs font-semibold ${getStatusColor(rfq.status).bg} ${getStatusColor(rfq.status).text} ${getStatusColor(rfq.status).border}`}>
                  {getStatusText(rfq.status)}
                </span>
              </div>
              <p className="text-gray-600 text-sm sm:text-base">{rfq.title}</p>
              {rfq.store && (
                <div className="mt-2 flex items-center gap-2 text-sm text-gray-500">
                  <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 21V5a2 2 0 00-2-2H7a2 2 0 00-2 2v16m14 0h2m-2 0h-5m-9 0H3m2 0h5M9 7h1m-1 4h1m4-4h1m-1 4h1m-5 10v-5a1 1 0 011-1h2a1 1 0 011 1v5m-4 0h4" />
                  </svg>
                  <span>{rfq.store.name} ({rfq.store.code})</span>
                </div>
              )}
            </div>
          <div className="flex gap-2">
            {rfq.status === 'DRAFT' && (
              <>
                <button
                  onClick={async () => {
                    if (!confirm('确定要发布此询价单吗？发布后供应商将可以看到并报价。')) {
                      return;
                    }
                    setPublishing(true);
                    try {
                      await api.patch(`/rfqs/${rfq.id}/publish`);
                      await fetchRfq();
                      alert('询价单发布成功！');
                    } catch (error: unknown) {
                      const message = isApiError(error) 
                        ? error.response?.data?.message || getErrorMessage(error)
                        : getErrorMessage(error);
                      alert(message || '发布询价单失败');
                    } finally {
                      setPublishing(false);
                    }
                  }}
                  disabled={publishing}
                  className="rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-50"
                >
                  {publishing ? '发布中...' : '发布询价单'}
                </button>
                <button
                  onClick={async () => {
                    if (!confirm(`确定要删除询价单 ${rfq.rfqNo} 吗？此操作不可恢复！`)) {
                      return;
                    }
                    try {
                      await api.delete(`/rfqs/${rfq.id}`);
                      alert('询价单已删除');
                      router.push('/rfqs');
                    } catch (error: unknown) {
                      const message = isApiError(error) 
                        ? error.response?.data?.message || getErrorMessage(error)
                        : getErrorMessage(error);
                      alert(message || '删除询价单失败');
                    }
                  }}
                  className="rounded-lg border border-red-300 bg-white px-4 py-2 text-sm font-medium text-red-600 hover:bg-red-50 transition-colors flex items-center gap-2"
                >
                  <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                  </svg>
                  删除询价单
                </button>
              </>
            )}
          </div>
        </div>

        <div className="grid gap-6 lg:grid-cols-3">
          {/* 左侧：询价单信息 */}
          <div className="lg:col-span-1">
            <div className="rounded-xl bg-white p-6 shadow-sm border border-gray-200">
              <div className="flex items-center justify-between mb-4">
                <h2 className="text-lg font-semibold text-gray-900">询价单信息</h2>
                <svg className="h-5 w-5 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                </svg>
              </div>
              <div className="space-y-4">
                <div className="flex items-center justify-between pb-3 border-b border-gray-100">
                  <span className="text-sm text-gray-600 flex items-center gap-2">
                    <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
                    </svg>
                    状态
                  </span>
                  <span className={`inline-flex items-center rounded-full border px-2.5 py-0.5 text-xs font-semibold ${getStatusColor(rfq.status).bg} ${getStatusColor(rfq.status).text} ${getStatusColor(rfq.status).border}`}>
                    {getStatusText(rfq.status)}
                  </span>
                </div>
                <div className="flex items-center justify-between pb-3 border-b border-gray-100">
                  <span className="text-sm text-gray-600 flex items-center gap-2">
                    <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
                    </svg>
                    截止时间
                  </span>
                  <span className="text-sm font-medium text-gray-900">
                    {new Date(rfq.deadline).toLocaleString('zh-CN', { 
                      year: 'numeric', 
                      month: '2-digit', 
                      day: '2-digit',
                      hour: '2-digit',
                      minute: '2-digit'
                    })}
                  </span>
                </div>
                <div className="flex items-center justify-between pb-3 border-b border-gray-100">
                  <span className="text-sm text-gray-600 flex items-center gap-2">
                    <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M20 7l-8-4-8 4m16 0l-8 4m8-4v10l-8 4m0-10L4 7m8 4v10M4 7v10l8 4" />
                    </svg>
                    商品数量
                  </span>
                  <span className="text-sm font-semibold text-blue-600">{rfq.items?.length || 0} 个</span>
                </div>
                <div className="flex items-center justify-between pb-3 border-b border-gray-100">
                  <span className="text-sm text-gray-600 flex items-center gap-2">
                    <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 9V7a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2m2 4h10a2 2 0 002-2v-6a2 2 0 00-2-2H9a2 2 0 00-2 2v6a2 2 0 002 2zm7-5a2 2 0 11-4 0 2 2 0 014 0z" />
                    </svg>
                    报价数量
                  </span>
                  <span className="text-sm font-semibold text-green-600">{quotes.length} 个</span>
                </div>
                {rfq.createdAt && (
                  <div className="flex items-center justify-between">
                    <span className="text-sm text-gray-600 flex items-center gap-2">
                      <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z" />
                      </svg>
                      创建时间
                    </span>
                    <span className="text-sm text-gray-500">
                      {new Date(rfq.createdAt).toLocaleDateString('zh-CN')}
                    </span>
                  </div>
                )}
              </div>
            </div>

            {/* 商品列表和最高限价设置 */}
            {rfq.items && rfq.items.length > 0 && (
              <div ref={itemsSectionRef} className="mt-6 rounded-xl bg-white p-6 shadow-sm border border-gray-200">
                <div className="flex items-center justify-between mb-4">
                  <h2 className="text-lg font-semibold text-gray-900">商品明细</h2>
                  <div className="flex items-center gap-3">
                    {/* 统计相同商品数量 */}
                    {(() => {
                      const productCounts = rfq.items.reduce((acc, item) => {
                        acc[item.productName] = (acc[item.productName] || 0) + 1;
                        return acc;
                      }, {} as Record<string, number>);
                      const duplicateProducts = Object.entries(productCounts).filter(([_, count]) => count > 1);
                      return duplicateProducts.length > 0 && (
                        <span className="text-xs text-gray-500">
                          有 {duplicateProducts.length} 种商品存在多个订单
                        </span>
                      );
                    })()}
                    <span className="text-sm text-gray-500">共 {rfq.items?.length || 0} 个商品</span>
                  </div>
                </div>
                <div className="space-y-3 max-h-[500px] overflow-y-auto pr-2" ref={itemsSectionRef}>
                  {(rfq.items || []).map((item, index: number) => {
                    // 统计相同商品的数量
                    const sameProductCount = (rfq.items || []).filter(i => i.productName === item.productName).length;
                    const sameProductItems = (rfq.items || []).filter(i => i.productName === item.productName);
                    const hasSameProduct = sameProductCount > 1;
                    
                    return (
                    <div 
                      key={item.id} 
                      data-item-id={item.id}
                      className="rounded-lg border border-gray-200 p-4 hover:border-blue-300 hover:shadow-sm transition-all bg-white"
                    >
                      {/* 编辑状态下使用垂直布局，避免遮挡 */}
                      {editingMaxPrice?.itemId === item.id ? (
                        <div className="flex flex-col gap-3">
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2 mb-2">
                            <span className="flex-shrink-0 inline-flex items-center justify-center w-6 h-6 rounded-full bg-blue-100 text-blue-700 text-xs font-semibold">
                              {index + 1}
                            </span>
                            <button
                              onClick={(e) => handleProductNameClick(item.productName, e)}
                              className="font-medium text-blue-600 hover:text-blue-800 hover:underline truncate text-left"
                              title="点击在拼多多搜索此商品"
                            >
                              {item.productName}
                            </button>
                              {hasSameProduct && (
                                <span className="inline-flex items-center px-2 py-0.5 rounded text-xs font-medium bg-purple-100 text-purple-800">
                                  相同商品 ×{sameProductCount}
                                </span>
                              )}
                          </div>
                          <div className="ml-8 space-y-1">
                            <div className="text-sm text-gray-600">
                              <span className="font-medium">数量:</span> {item.quantity} {item.unit || '件'}
                            </div>
                            {item.description && (
                              <div className="text-xs text-gray-500 line-clamp-2">
                                {item.description}
                              </div>
                            )}
                          </div>
                        </div>
                          <div className="flex flex-col gap-3 w-full">
                              {/* 最高限价 */}
                              <div>
                                <label className="mb-1 block text-xs font-medium text-gray-700">
                                  最高限价 <span className="text-red-500">*</span>
                                </label>
                                <div className="relative">
                                  <span className="absolute left-3 top-1/2 -translate-y-1/2 text-xs text-gray-500">¥</span>
                                  <input
                                    type="number"
                                    step="0.01"
                                    min="0.01"
                                    value={editingMaxPrice.value}
                                    onChange={(e) => setEditingMaxPrice({ ...editingMaxPrice, value: e.target.value })}
                                    className="w-full rounded-lg border-2 border-blue-300 pl-8 pr-3 py-2.5 text-base font-semibold text-gray-900 bg-white focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-200 relative z-10"
                                    placeholder="最高限价"
                                    autoFocus
                                  />
                                </div>
                              </div>
                              {/* 一口价（可选） */}
                              <div className="mt-2">
                                <label className="mb-1 block text-xs font-medium text-gray-700">
                                  <span className="flex items-center gap-1">
                                    <span className="text-blue-600 font-semibold">一口价（可选）</span>
                                    <span className="relative group">
                                      <svg className="h-3.5 w-3.5 text-blue-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                                      </svg>
                                      <span className="absolute left-1/2 -translate-x-1/2 bottom-full mb-2 hidden w-max rounded-md bg-gray-800 px-2 py-1 text-xs text-white opacity-0 transition-opacity group-hover:opacity-100 group-hover:block z-50">
                                        报价≤此价格时自动中标
                                      </span>
                                    </span>
                                  </span>
                                  <span className="text-xs text-gray-500 font-normal block mt-0.5">（报价≤此价格时自动中标）</span>
                                </label>
                                <div className="relative">
                                  <span className="absolute left-3 top-1/2 -translate-y-1/2 text-xs text-gray-500">¥</span>
                                  <input
                                    type="number"
                                    step="0.01"
                                    min="0.01"
                                    value={editingMaxPrice.instantPrice || ''}
                                    onChange={(e) => setEditingMaxPrice({ ...editingMaxPrice, instantPrice: e.target.value })}
                                    className="w-full rounded-lg border-2 border-blue-300 bg-blue-50 pl-8 pr-3 py-2.5 text-sm font-medium text-gray-900 focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-200"
                                    placeholder="可选：设置一口价自动中标"
                                  />
                                </div>
                              </div>
                                {hasSameProduct && (
                                  <label className="flex items-center gap-2 text-xs text-gray-700 cursor-pointer w-full sm:w-auto">
                                    <input
                                      type="checkbox"
                                      checked={editingMaxPrice.applyToAll || false}
                                      onChange={(e) => setEditingMaxPrice({ ...editingMaxPrice, applyToAll: e.target.checked })}
                                      className="rounded border-gray-300 text-blue-600 focus:ring-blue-500"
                                    />
                                    <span>应用到所有相同商品（{sameProductCount}个）</span>
                                  </label>
                                )}
                                <div className="flex items-center gap-2 w-full sm:w-auto">
                                <button
                                  onClick={async () => {
                                    const maxPrice = parseFloat(editingMaxPrice.value);
                                    if (isNaN(maxPrice) || maxPrice <= 0) {
                                      alert('请输入有效的最高限价（大于0）');
                                      return;
                                    }
                                    const instantPrice = editingMaxPrice.instantPrice 
                                      ? (editingMaxPrice.instantPrice.trim() === '' ? null : parseFloat(editingMaxPrice.instantPrice))
                                      : null;
                                    
                                    // 验证一口价
                                    if (instantPrice !== null && !isNaN(instantPrice)) {
                                      if (instantPrice <= 0) {
                                        alert('一口价必须大于0');
                                        return;
                                      }
                                      if (instantPrice > maxPrice) {
                                        alert('一口价不能大于最高限价');
                                        return;
                                      }
                                    }
                                    
                                    try {
                                        // 如果选择了应用到所有相同商品，批量设置
                                        if (editingMaxPrice.applyToAll && hasSameProduct) {
                                          const promises = sameProductItems.map(sameItem =>
                                            api.patch(`/rfqs/items/${sameItem.id}/max-price`, { 
                                              maxPrice,
                                              instantPrice: instantPrice !== null && !isNaN(instantPrice) ? instantPrice : null
                                            })
                                          );
                                          await Promise.all(promises);
                                        } else {
                                          // 只设置当前商品
                                      await api.patch(`/rfqs/items/${item.id}/max-price`, { 
                                        maxPrice,
                                        instantPrice: instantPrice !== null && !isNaN(instantPrice) ? instantPrice : null
                                      });
                                        }
                                      await fetchRfq();
                                      setEditingMaxPrice(null);
                                        if (editingMaxPrice.applyToAll && hasSameProduct) {
                                          const instantPriceText = instantPrice !== null && !isNaN(instantPrice) 
                                            ? `，一口价 ¥${instantPrice.toFixed(2)}` 
                                            : '';
                                          alert(`已为 ${sameProductCount} 个相同商品设置最高限价 ¥${maxPrice.toFixed(2)}${instantPriceText}`);
                                        }
                                    } catch (error: unknown) {
                                      const message = isApiError(error) 
                                        ? error.response?.data?.message || getErrorMessage(error)
                                        : getErrorMessage(error);
                                      alert(message || '设置失败');
                                    }
                                  }}
                                    className="flex-1 rounded-lg bg-green-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-green-700 transition-colors flex items-center justify-center gap-1"
                                >
                                  <svg className="h-3 w-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                                  </svg>
                                    保存{editingMaxPrice.applyToAll && hasSameProduct ? `(${sameProductCount}个)` : ''}
                                </button>
                                <button
                                  onClick={() => setEditingMaxPrice(null)}
                                  className="rounded-lg bg-gray-200 px-3 py-1.5 text-xs font-semibold text-gray-700 hover:bg-gray-300 transition-colors"
                                >
                                  取消
                                </button>
                              </div>
                              </div>
                            </div>
                          ) : (
                            <>
                              {/* 非编辑状态：使用水平布局 */}
                              <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-3">
                                <div className="flex-1 min-w-0">
                                  <div className="flex items-center gap-2 mb-2">
                                    <span className="flex-shrink-0 inline-flex items-center justify-center w-6 h-6 rounded-full bg-blue-100 text-blue-700 text-xs font-semibold">
                                      {index + 1}
                                    </span>
                                    <button
                                      onClick={(e) => handleProductNameClick(item.productName, e)}
                                      className="font-medium text-blue-600 hover:text-blue-800 hover:underline truncate text-left"
                                      title="点击在拼多多搜索此商品"
                                    >
                                      {item.productName}
                                    </button>
                                      {hasSameProduct && (
                                        <span className="inline-flex items-center px-2 py-0.5 rounded text-xs font-medium bg-purple-100 text-purple-800">
                                          相同商品 ×{sameProductCount}
                                        </span>
                                      )}
                                  </div>
                                  <div className="ml-8 space-y-1">
                                    <div className="text-sm text-gray-600">
                                      <span className="font-medium">数量:</span> {item.quantity} {item.unit || '件'}
                                    </div>
                                    {item.description && (
                                      <div className="text-xs text-gray-500 line-clamp-2">
                                        {item.description}
                                      </div>
                                    )}
                                  </div>
                                </div>
                                <div className="sm:ml-4 flex flex-col sm:items-end gap-2 flex-shrink-0 w-full sm:w-auto">
                                  <div className="text-left sm:text-right w-full sm:w-auto">
                                {item.maxPrice ? (
                                      <div className="bg-green-50 border border-green-200 rounded-lg px-3 py-2 inline-block sm:block">
                                    <div className="text-xs text-green-600 font-medium mb-0.5">最高限价</div>
                                    <div className="text-base font-bold text-green-700">¥{Number(item.maxPrice).toFixed(2)}</div>
                                  </div>
                                ) : (
                                      <div className="bg-yellow-50 border border-yellow-200 rounded-lg px-3 py-2 inline-block sm:block">
                                    <div className="text-xs text-yellow-600 font-medium">未设置</div>
                                  </div>
                                )}
                                {item.instantPrice && (
                                  <div className="bg-blue-50 border border-blue-200 rounded-lg px-3 py-2 inline-block sm:block mt-2">
                                    <div className="text-xs text-blue-600 font-medium mb-0.5">一口价（自动中标）</div>
                                    <div className="text-base font-bold text-blue-700">¥{Number(item.instantPrice).toFixed(2)}</div>
                                    <div className="text-xs text-blue-500 mt-0.5">报价≤此价格时自动中标</div>
                                  </div>
                                )}
                              </div>
                              {(rfq.status === 'DRAFT' || rfq.status === 'PUBLISHED') && (
                                <button
                                    onClick={() => setEditingMaxPrice({ 
                                      itemId: item.id, 
                                      value: item.maxPrice ? String(Number(item.maxPrice)) : '', 
                                      instantPrice: item.instantPrice ? String(Number(item.instantPrice)) : '',
                                      applyToAll: false 
                                    })}
                                      className="w-full sm:w-auto rounded-lg bg-blue-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-blue-700 transition-colors flex items-center justify-center gap-1"
                                >
                                  <svg className="h-3 w-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" />
                                  </svg>
                                  {item.maxPrice ? '修改' : '设置'}
                                </button>
                              )}
                                </div>
                              </div>
                            </>
                          )}
                    </div>
                    );
                  })}
                </div>
                {rfq.items.some((item) => !item.maxPrice) && rfq.status === 'DRAFT' && (
                  <div className="mt-4 rounded-md bg-red-50 border border-red-200 p-3 text-sm text-red-800">
                    ⚠️ 请为所有商品设置最高限价后才能发布询价单。供应商报价不能超过此价格。
                  </div>
                )}
                {rfq.items.every((item) => item.maxPrice && Number(item.maxPrice) > 0) && rfq.status === 'DRAFT' && (
                  <div className="mt-4 rounded-md bg-green-50 border border-green-200 p-3 text-sm text-green-800">
                    ✅ 所有商品都已设置最高限价，可以发布询价单了
                  </div>
                )}
              </div>
            )}

            {/* 未报价商品 */}
            {unquotedItems.length > 0 && (
              <div className="mt-6 rounded-xl bg-yellow-50 border border-yellow-200 p-6 shadow-sm">
                <h2 className="mb-4 text-lg font-semibold text-yellow-900">⚠️ 未报价商品</h2>
                <p className="mb-3 text-sm text-yellow-800">
                  以下 {unquotedItems.length} 个商品没有供应商报价，需要在拼多多/淘宝采购：
                </p>
                <div className="space-y-2 max-h-64 overflow-y-auto">
                  {unquotedItems.map((item) => (
                    <div key={item.id} className="rounded bg-white p-3 text-sm">
                      <div className="font-medium text-gray-900">{item.productName}</div>
                      <div className="mt-1 text-gray-600">
                        数量: {item.quantity} {item.unit || '件'}
                      </div>
                    </div>
                  ))}
                </div>
                <button
                  onClick={() => {
                    // TODO: 实现导出到拼多多/淘宝的功能
                    const itemsText = unquotedItems
                      .map((item) => `${item.productName} × ${item.quantity}${item.unit || '件'}`)
                      .join('\n');
                    navigator.clipboard.writeText(itemsText);
                    alert('未报价商品列表已复制到剪贴板');
                  }}
                  className="mt-4 w-full rounded-lg bg-yellow-600 px-4 py-2 text-sm font-medium text-white hover:bg-yellow-700"
                >
                  复制商品列表
                </button>
              </div>
            )}
          </div>

          {/* 右侧：按商品级别显示报价和选商 */}
          <div className="lg:col-span-2">
            {/* 统计信息卡片 */}
            {(rfq.status === 'CLOSED' || rfq.status === 'AWARDED' || rfq.status === 'PUBLISHED') && (
              <div className="mb-6 grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
                <div className="rounded-xl bg-gradient-to-br from-blue-50 to-blue-100 p-5 border border-blue-200 shadow-sm hover:shadow-md transition-shadow">
                  <div className="flex items-center justify-between">
                    <div>
                      <div className="text-xs font-medium text-blue-600 uppercase tracking-wide">报价统计</div>
                      <div className="mt-2 text-3xl font-bold text-blue-900">{quotes.length}</div>
                      <div className="text-xs text-blue-600 mt-1">个供应商报价</div>
                    </div>
                    <div className="rounded-full bg-blue-200 p-3">
                      <svg className="h-6 w-6 text-blue-700" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 9V7a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2m2 4h10a2 2 0 002-2v-6a2 2 0 00-2-2H9a2 2 0 00-2 2v6a2 2 0 002 2zm7-5a2 2 0 11-4 0 2 2 0 014 0z" />
                      </svg>
                    </div>
                  </div>
                </div>
                <div className="rounded-xl bg-gradient-to-br from-green-50 to-green-100 p-5 border border-green-200 shadow-sm hover:shadow-md transition-shadow">
                  <div className="flex items-center justify-between">
                    <div>
                      <div className="text-xs font-medium text-green-600 uppercase tracking-wide">中标统计</div>
                      <div className="mt-2 text-3xl font-bold text-green-900">
                        {rfq.items?.filter((item) => item.itemStatus === 'AWARDED').length || 0}
                      </div>
                      <div className="text-xs text-green-600 mt-1">个商品已中标</div>
                    </div>
                    <div className="rounded-full bg-green-200 p-3">
                      <svg className="h-6 w-6 text-green-700" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
                      </svg>
                    </div>
                  </div>
                </div>
                <div className="rounded-xl bg-gradient-to-br from-yellow-50 to-yellow-100 p-5 border border-yellow-200 shadow-sm hover:shadow-md transition-shadow">
                  <div className="flex items-center justify-between">
                    <div>
                      <div className="text-xs font-medium text-yellow-600 uppercase tracking-wide">未报价</div>
                      <div className="mt-2 text-3xl font-bold text-yellow-900">{unquotedItems.length}</div>
                      <div className="text-xs text-yellow-600 mt-1">个商品未报价</div>
                    </div>
                    <div className="rounded-full bg-yellow-200 p-3">
                      <svg className="h-6 w-6 text-yellow-700" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
                      </svg>
                    </div>
                  </div>
                </div>
                <div className="rounded-xl bg-gradient-to-br from-purple-50 to-purple-100 p-5 border border-purple-200 shadow-sm hover:shadow-md transition-shadow">
                  <div className="flex items-center justify-between">
                    <div>
                      <div className="text-xs font-medium text-purple-600 uppercase tracking-wide">总商品数</div>
                      <div className="mt-2 text-3xl font-bold text-purple-900">{rfq.items?.length || 0}</div>
                      <div className="text-xs text-purple-600 mt-1">个商品</div>
                    </div>
                    <div className="rounded-full bg-purple-200 p-3">
                      <svg className="h-6 w-6 text-purple-700" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M20 7l-8-4-8 4m16 0l-8 4m8-4v10l-8 4m0-10L4 7m8 4v10M4 7v10l8 4" />
                      </svg>
                    </div>
                  </div>
                </div>
              </div>
            )}
            
            <div className="rounded-xl bg-white p-6 shadow-sm border border-gray-200">
              <div className="mb-6 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
                <div>
                  <h2 className="text-lg font-semibold text-gray-900">
                    按商品选商
                  </h2>
                  <p className="text-xs text-gray-500 mt-1">每个商品可选择不同供应商</p>
                </div>
                {(() => {
                  const user = authApi.getCurrentUser();
                  const canAward = user && (user.role === 'ADMIN' || user.role === 'BUYER');
                  return rfq.status === 'CLOSED' && canAward && (
                    <button
                      onClick={handleAwardAllLowestPrice}
                      className="rounded-lg bg-green-600 px-4 py-2 text-sm font-medium text-white hover:bg-green-700 transition-colors flex items-center gap-2"
                      title="为所有未中标的商品自动选择最低价报价"
                    >
                      <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                      </svg>
                      一键全选最低价中标
                    </button>
                  );
                })()}
              </div>
              
              {!rfq.items || rfq.items.length === 0 ? (
                <div className="py-12 text-center text-gray-500">
                  暂无商品
                </div>
              ) : (
                <div className="space-y-6">
                  {rfq.items.map((rfqItem) => {
                    // 找到所有报价了此商品的报价项
                    const itemQuotes = quotes
                      .flatMap((quote) =>
                        quote.items
                          ?.filter((quoteItem): quoteItem is QuoteItem => quoteItem.rfqItemId === rfqItem.id)
                          .map((quoteItem) => ({
                            ...quoteItem,
                            quoteId: quote.id,
                            supplier: quote.supplier,
                            supplierId: quote.supplierId,
                            quoteStatus: quote.status,
                            submittedAt: quote.submittedAt,
                            notes: quote.notes,
                          })) || []
                      )
                      .filter((item) => Number(item.price) > 0)
                      .sort((a, b) => parseFloat(String(a.price)) - parseFloat(String(b.price))); // 按价格排序

                    const isAwarded = rfqItem.itemStatus === 'AWARDED';
                    const awardedQuoteItem = isAwarded 
                      ? itemQuotes.find((item) => item.quoteStatus === 'AWARDED')
                      : null;

                    return (
                      <div
                        key={rfqItem.id}
                        className={`rounded-lg border-2 p-5 transition-all ${
                          isAwarded 
                            ? 'border-green-300 bg-gradient-to-br from-green-50 to-green-100 shadow-sm' 
                            : 'border-gray-200 bg-white hover:border-blue-300 hover:shadow-md'
                        }`}
                      >
                        <div className="mb-4 flex items-start justify-between gap-3">
                          <div className="flex-1 min-w-0">
                            <div className="flex items-center gap-2 mb-2">
                              <h3 className="font-semibold text-gray-900 text-base">
                                {rfqItem.productName}
                              </h3>
                              {isAwarded && (
                                <span className="inline-flex items-center rounded-full bg-green-200 border border-green-300 px-2.5 py-0.5 text-xs font-semibold text-green-800">
                                  <svg className="h-3 w-3 mr-1" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                                  </svg>
                                  已中标
                                </span>
                              )}
                            </div>
                            <div className="space-y-1">
                              <p className="text-sm text-gray-600">
                                <span className="font-medium">数量:</span> {rfqItem.quantity} {rfqItem.unit || '件'}
                              </p>
                              {rfqItem.maxPrice && (
                                <p className="text-xs text-green-700 flex items-center gap-1">
                                  <svg className="h-3 w-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8c-1.657 0-3 .895-3 2s1.343 2 3 2 3 .895 3 2-1.343 2-3 2m0-8c1.11 0 2.08.402 2.599 1M12 8V7m0 1v8m0 0v1m0-1c-1.11 0-2.08-.402-2.599-1M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                                  </svg>
                                  最高限价: ¥{Number(rfqItem.maxPrice).toFixed(2)}
                                </p>
                              )}
                              {rfqItem.instantPrice && (
                                <p className="text-xs text-blue-700 flex items-center gap-1 mt-1">
                                  <svg className="h-3 w-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 10V3L4 14h7v7l9-11h-7z" />
                                  </svg>
                                  一口价: ¥{Number(rfqItem.instantPrice).toFixed(2)}（报价≤此价格时自动中标）
                                </p>
                              )}
                              {awardedQuoteItem && (
                                <p className="text-sm text-green-700 font-medium flex items-center gap-1 mt-2">
                                  <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                                  </svg>
                                  已选择: {awardedQuoteItem.supplier?.username} - ¥{parseFloat(String(awardedQuoteItem.price)).toFixed(2)}/件
                                </p>
                              )}
                            </div>
                          </div>
                        </div>

                        {itemQuotes.length === 0 ? (
                          <div className="rounded-lg bg-yellow-50 border-2 border-yellow-200 p-4 text-sm text-yellow-800 flex items-center gap-2">
                            <svg className="h-5 w-5 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
                            </svg>
                            <span>没有供应商报价此商品，需要在电商平台采购</span>
                          </div>
                        ) : (
                          <div className="space-y-3">
                            <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2 p-3 bg-gray-50 rounded-lg border border-gray-200">
                              <div className="text-sm font-medium text-gray-700">
                                供应商报价（共 <span className="text-blue-600">{itemQuotes.length}</span> 个，按价格从低到高）
                              </div>
                              {itemQuotes.length > 0 && (
                                <div className="flex items-center gap-3 text-xs">
                                  <div className="flex items-center gap-1">
                                    <span className="text-gray-500">最低:</span>
                                    <span className="font-bold text-blue-600">¥{parseFloat(String(itemQuotes[0].price)).toFixed(2)}</span>
                                  </div>
                                  {itemQuotes.length > 1 && (
                                    <>
                                      <span className="text-gray-300">|</span>
                                      <div className="flex items-center gap-1">
                                        <span className="text-gray-500">最高:</span>
                                        <span className="font-bold text-red-600">¥{parseFloat(String(itemQuotes[itemQuotes.length - 1].price)).toFixed(2)}</span>
                                      </div>
                                      <span className="text-gray-300">|</span>
                                      <div className="flex items-center gap-1">
                                        <span className="text-gray-500">差价:</span>
                                        <span className="font-bold text-orange-600">¥{(parseFloat(String(itemQuotes[itemQuotes.length - 1].price)) - parseFloat(String(itemQuotes[0].price))).toFixed(2)}</span>
                                      </div>
                                    </>
                                  )}
                                </div>
                              )}
                            </div>
                            {itemQuotes.map((itemQuote, index: number) => {
                              const isSelected = isAwarded && itemQuote.quoteId === awardedQuoteItem?.quoteId;
                              const isLowest = index === 0;
                              
                              return (
                                <div
                                  key={itemQuote.id}
                                  className={`flex items-center justify-between rounded-lg border-2 p-4 transition-all ${
                                    isSelected
                                      ? 'border-green-500 bg-gradient-to-r from-green-50 to-green-100 shadow-md'
                                      : isLowest
                                      ? 'border-blue-400 bg-gradient-to-r from-blue-50 to-blue-100 hover:border-blue-500 hover:shadow-md'
                                      : 'border-gray-200 bg-white hover:border-gray-300 hover:shadow-sm'
                                  }`}
                                >
                                  <div className="flex-1 min-w-0">
                                    <div className="flex items-center gap-2 mb-2">
                                      <span className="font-semibold text-gray-900 text-base">
                                        {itemQuote.supplier?.username || '供应商'}
                                      </span>
                                      {isLowest && !isAwarded && (
                                        <span className="inline-flex items-center rounded-full bg-blue-200 border border-blue-300 px-2 py-0.5 text-xs font-semibold text-blue-800">
                                          <svg className="h-3 w-3 mr-1" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 7h8m0 0v8m0-8l-8 8-4-4-6 6" />
                                          </svg>
                                          最低价
                                        </span>
                                      )}
                                      {isSelected && (
                                        <span className="inline-flex items-center rounded-full bg-green-200 border border-green-300 px-2 py-0.5 text-xs font-semibold text-green-800">
                                          <svg className="h-3 w-3 mr-1" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                                          </svg>
                                          已选择
                                        </span>
                                      )}
                                    </div>
                                    <div className="space-y-1">
                                      <div className="text-sm text-gray-700">
                                        <span className="text-gray-500">单价:</span> 
                                        <span className="ml-1 font-bold text-blue-600 text-base">¥{parseFloat(String(itemQuote.price)).toFixed(2)}</span>
                                        <span className="text-gray-400">/件</span>
                                        <span className="ml-3 text-gray-500">
                                          小计: <span className="font-semibold text-gray-700">¥{(parseFloat(String(itemQuote.price)) * (rfqItem.quantity || 1)).toFixed(2)}</span>
                                        </span>
                                      </div>
                                      {itemQuote.deliveryDays !== undefined && itemQuote.deliveryDays > 0 && (
                                        <div className="text-xs text-gray-500 flex items-center gap-1">
                                          <svg className="h-3 w-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
                                          </svg>
                                          交货期: {itemQuote.deliveryDays} 天
                                        </div>
                                      )}
                                      {itemQuote.notes && (
                                        <div className="text-xs text-gray-500 bg-gray-50 rounded px-2 py-1 mt-1 line-clamp-2">
                                          <span className="font-medium">备注:</span> {itemQuote.notes}
                                        </div>
                                      )}
                                    </div>
                                  </div>
                                  {(() => {
                                    const user = authApi.getCurrentUser();
                                    const canAward = user && (user.role === 'ADMIN' || user.role === 'BUYER');
                                    return !isAwarded && rfq.status === 'CLOSED' && canAward && (
                                      <button
                                        onClick={async () => {
                                          try {
                                            await handleAwardItem(
                                              rfqItem.id,
                                              itemQuote.id,
                                              String(itemQuote.quoteId),
                                              itemQuote.supplier?.username || '供应商',
                                              parseFloat(String(itemQuote.price))
                                            );
                                            await fetchData();
                                          } catch (error: unknown) {
                                            const message = isApiError(error) 
                                              ? error.response?.data?.message || getErrorMessage(error)
                                              : getErrorMessage(error);
                                            alert(message || '选商失败');
                                          }
                                        }}
                                        className={`ml-4 flex-shrink-0 rounded-lg px-4 py-2.5 text-sm font-semibold text-white transition-all shadow-sm hover:shadow-md ${
                                          isLowest
                                            ? 'bg-gradient-to-r from-green-600 to-green-700 hover:from-green-700 hover:to-green-800'
                                            : 'bg-gradient-to-r from-blue-600 to-blue-700 hover:from-blue-700 hover:to-blue-800'
                                        }`}
                                      >
                                        {isLowest ? (
                                          <span className="flex items-center gap-1">
                                            <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                                            </svg>
                                            选择（最低价）
                                          </span>
                                        ) : (
                                          '选择'
                                        )}
                                      </button>
                                    );
                                  })()}
                                </div>
                              );
                            })}
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              )}

              {/* 保留按整个报价单选商的选项（兼容性） */}
              {(() => {
                const user = authApi.getCurrentUser();
                const canAward = user && (user.role === 'ADMIN' || user.role === 'BUYER');
                return rfq.status === 'CLOSED' && quotes.length > 0 && canAward && (
                  <div className="mt-6 rounded-xl border border-gray-200 bg-gray-50 p-4">
                    <h3 className="mb-3 text-sm font-semibold text-gray-700">
                      按整个报价单选商（不推荐，建议使用上面的按商品选商）
                    </h3>
                    <div className="space-y-2">
                      {quotes
                        .filter((quote) => quote.status !== 'AWARDED')
                        .map((quote) => (
                          <button
                            key={quote.id}
                            onClick={() => handleAwardQuote(quote.id)}
                            className="w-full rounded-lg border border-gray-300 bg-white px-4 py-2 text-left text-sm hover:bg-gray-50"
                          >
                            <div className="flex items-center justify-between">
                              <span className="font-medium text-gray-900">
                                {quote.supplier?.username || '供应商'}
                              </span>
                              <span className="text-blue-600">
                                总价: ¥{parseFloat(String(quote.price)).toFixed(2)}
                              </span>
                            </div>
                          </button>
                        ))}
                    </div>
                  </div>
                );
              })()}
            </div>

            {/* 中标订单物流信息 */}
            {awards.length > 0 && (
              <div className="mt-6 rounded-xl bg-white p-6 shadow-sm border border-gray-200">
                <h2 className="mb-4 text-lg font-semibold text-gray-900">中标订单物流信息</h2>
                <div className="space-y-4">
                  {awards.map((award) => (
                    <div key={award.id} className="rounded-lg border border-green-200 bg-green-50 p-4">
                      <div className="mb-3 flex items-center justify-between">
                        <div>
                          <h3 className="font-semibold text-gray-900">
                          供应商: {award.supplier?.username}
                        </h3>
                        <p className="mt-1 text-sm text-gray-600">
                          中标金额: ¥{Number(award.finalPrice || award.quote?.price || 0).toFixed(2)}
                        </p>
                        <p className="mt-1 text-sm text-gray-600">
                          中标时间: {new Date(award.awardedAt).toLocaleString('zh-CN')}
                        </p>
                      </div>
                      {award.paymentQrCodeUrl && (
                        <div>
                          <img
                            src={getProxiedImageUrl(award.paymentQrCodeUrl)}
                            alt="收款二维码"
                            className="h-20 w-20 rounded border border-green-200 cursor-pointer hover:opacity-80 transition-opacity"
                            onClick={() => award.paymentQrCodeUrl && setPreviewImage({ url: getProxiedImageUrl(award.paymentQrCodeUrl), isVideo: false })}
                            title="点击查看大图"
                            loading="lazy"
                            onError={handleImageError}
                          />
                        </div>
                      )}
                      </div>

                      {/* 商品物流信息 */}
                      <div className="space-y-2 mt-3">
                        {award.quote?.items?.map((quoteItem: QuoteItem) => {
                          // 通过 rfqItemId 查找对应的 rfqItem
                          const rfqItem = rfq?.items?.find(item => item.id === quoteItem.rfqItemId);
                          const shipment = award.shipments?.find((s) => 
                            s.rfqItemId === quoteItem.rfqItemId
                          );
                          const packages = shipment?.packages || [];
                          const shipmentPhotos = packages.flatMap((pkg) => pkg.photos || []);

                          return (
                            <div key={quoteItem.id} className="rounded bg-white p-3 text-sm">
                              <div className="font-medium text-gray-900">
                                {rfqItem?.productName} × {rfqItem?.quantity} {rfqItem?.unit || '件'}
                              </div>
                              {shipment?.trackingNo ? (
                                <div className="mt-2 text-gray-600">
                                  <span>物流单号: </span>
                                  <TrackingNumberLink
                                    trackingNo={shipment.trackingNo}
                                    carrier={shipment.carrier}
                                  />
                                  {shipment.carrier && (
                                    <span className="ml-2 text-gray-500">({shipment.carrier})</span>
                                  )}
                                </div>
                              ) : (
                                <div className="mt-2 text-gray-500">供应商尚未上传物流单号</div>
                              )}
                              {shipmentPhotos.length > 0 && (
                                <div className="mt-2 grid grid-cols-4 gap-2">
                                  {shipmentPhotos.map((photoUrl: string, index: number) => {
                                    const isVideo = photoUrl.match(/\.(mp4|avi|mov|wmv)$/i);
                                    return (
                                      <div
                                        key={index}
                                        className="relative group cursor-pointer"
                                        onClick={() => setPreviewImage({ url: getProxiedImageUrl(photoUrl), isVideo: !!isVideo })}
                                      >
                                        {isVideo ? (
                                          <video
                                            src={photoUrl}
                                            className="h-16 w-full rounded border object-cover"
                                            controls
                                            onError={handleVideoError}
                                          />
                                        ) : (
                                          <img
                                            src={getProxiedImageUrl(photoUrl)}
                                            alt={`发货照片 ${index + 1}`}
                                            className="h-16 w-full rounded border object-cover hover:opacity-80 transition-opacity"
                                            loading="lazy"
                                            onError={handleImageError}
                                          />
                                        )}
                                      </div>
                                    );
                                  })}
                                </div>
                              )}
                            </div>
                          );
                        })}
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        </div>
      </div>
      </div>

      {/* 图片预览模态框 */}
      {previewImage && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black bg-opacity-75"
          onClick={() => setPreviewImage(null)}
        >
          <div className="relative max-h-[90vh] max-w-[90vw]">
            <div
              className="relative max-h-[90vh] max-w-[90vw]"
              onClick={(e) => e.stopPropagation()}
            >
              <button
                onClick={() => setPreviewImage(null)}
                className="absolute right-2 top-2 z-10 rounded-full bg-black bg-opacity-50 p-2 text-white shadow-lg hover:bg-opacity-70 transition-all"
                aria-label="关闭"
              >
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
                    d="M6 18L18 6M6 6l12 12"
                  />
                </svg>
              </button>
              {previewImage.isVideo ? (
                <video
                  src={previewImage.url}
                  controls
                  className="max-h-[90vh] max-w-[90vw] rounded-lg"
                  autoPlay
                  onError={handleVideoError}
                />
              ) : (
                <img
                  src={getProxiedImageUrl(previewImage.url)}
                  alt="预览"
                  className="max-h-[90vh] max-w-[90vw] rounded-lg object-contain"
                  onError={handleImageError}
                />
              )}
            </div>
            <div className="absolute bottom-4 left-1/2 -translate-x-1/2 rounded bg-black bg-opacity-50 px-4 py-2 text-sm text-white">
              按 ESC 键或点击背景关闭
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

