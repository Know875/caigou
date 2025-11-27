'use client';

import { useEffect, useState, useMemo } from 'react';
import { useRouter } from 'next/navigation';
import { authApi } from '@/lib/auth';
import api from '@/lib/api';
import type { UnquotedItem, Store } from '@/types';

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

export default function PurchasePage() {
  const router = useRouter();
  const [unquotedItems, setUnquotedItems] = useState<UnquotedItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [editingItem, setEditingItem] = useState<string | null>(null);
  const [trackingNo, setTrackingNo] = useState('');
  const [carrier, setCarrier] = useState('');
  const [costPrice, setCostPrice] = useState('');
  const [copiedField, setCopiedField] = useState<string | null>(null);
  const [selectedStore, setSelectedStore] = useState<string>(''); // 门店筛选
  const [stores, setStores] = useState<Store[]>([]); // 门店列表
  const [currentUser, setCurrentUser] = useState<any>(null); // 当前用户信息
  const [isStoreUser, setIsStoreUser] = useState(false); // 是否是门店用户

  useEffect(() => {
    const user = authApi.getCurrentUser();
    if (!user) {
      router.push('/login');
      return;
    }

    // 允许管理员、采购员和门店用户访问电商平台采购页面
    if (user.role !== 'ADMIN' && user.role !== 'BUYER' && user.role !== 'STORE') {
      router.push('/dashboard');
      return;
    }

    setCurrentUser(user);
    const isStore = user.role === 'STORE';
    setIsStoreUser(isStore);
    
    // 如果是门店用户，自动设置为自己店铺
    if (isStore && user.storeId) {
      setSelectedStore(user.storeId);
    }

    fetchStores();
    fetchUnquotedItems();
  }, [router]);

  const fetchStores = async () => {
    try {
      // 后端会根据用户角色自动过滤：门店用户只能看到自己的店铺
      const response = await api.get('/stores');
      const storesData = response.data.data || response.data || [];
      setStores(Array.isArray(storesData) ? storesData : []);
    } catch (error: unknown) {
      console.error('获取门店列表失败:', error);
      setStores([]);
    }
  };

  const fetchUnquotedItems = async () => {
    try {
      const response = await api.get('/rfqs/unquoted-items');
      const items = response.data.data || response.data || [];
      setUnquotedItems(items);
    } catch (error: unknown) {
      console.error('获取未报价商品失败:', error);
      setUnquotedItems([]);
    } finally {
      setLoading(false);
    }
  };

  const handleEditTracking = (item: UnquotedItem) => {
    setEditingItem(item.itemId);
    setTrackingNo(item.trackingNo || '');
    setCarrier(item.carrier || '');
    setCostPrice(item.costPrice ? String(item.costPrice) : '');
  };

  const handleSaveTracking = async (itemId: string) => {
    try {
      const costPriceNum = costPrice.trim() ? parseFloat(costPrice.trim()) : undefined;
      if (costPriceNum !== undefined && (isNaN(costPriceNum) || costPriceNum < 0)) {
        return;
      }
      
      await api.patch(`/rfqs/items/${itemId}/tracking`, {
        trackingNo: trackingNo.trim() || undefined,
        carrier: carrier.trim() || undefined,
        costPrice: costPriceNum,
      });
      setEditingItem(null);
      setTrackingNo('');
      setCarrier('');
      setCostPrice('');
      await fetchUnquotedItems();
    } catch (error: unknown) {
      console.error('保存信息失败:', error);
    }
  };

  const handleCancelEdit = () => {
    setEditingItem(null);
    setTrackingNo('');
    setCarrier('');
    setCostPrice('');
  };

  const handleCopy = async (text: string, field: string) => {
    if (!text || text === '-') {
      return;
    }
    
    // 使用 Clipboard API（如果可用）
    if (navigator.clipboard && navigator.clipboard.writeText) {
      try {
        await navigator.clipboard.writeText(text);
        setCopiedField(field);
        setTimeout(() => setCopiedField(null), 2000);
        return;
      } catch (error) {
        console.warn('Clipboard API 失败，尝试降级方案:', error);
      }
    }
    
    // 降级方案：使用传统的 execCommand 方法
    try {
      const textArea = document.createElement('textarea');
      textArea.value = text;
      textArea.style.position = 'fixed';
      textArea.style.left = '-999999px';
      textArea.style.top = '-999999px';
      document.body.appendChild(textArea);
      textArea.focus();
      textArea.select();
      
      const successful = document.execCommand('copy');
      document.body.removeChild(textArea);
      
      if (successful) {
        setCopiedField(field);
        setTimeout(() => setCopiedField(null), 2000);
      } else {
        throw new Error('execCommand 复制失败');
      }
    } catch (error) {
      console.error('复制失败:', error);
      alert('复制失败，请手动复制');
    }
  };

  const handleCopyAll = async (item: UnquotedItem) => {
    const address = item.modifiedAddress || item.address || '';
    const recipient = item.recipient || '';
    const phone = item.phone || '';
    
    if (!address && !recipient && !phone) {
      alert('没有可复制的信息');
      return;
    }

    const text = `${recipient} ${phone}\n${address}`.trim();
    
    // 使用 Clipboard API（如果可用）
    if (navigator.clipboard && navigator.clipboard.writeText) {
      try {
        await navigator.clipboard.writeText(text);
        setCopiedField(`all-${item.itemId}`);
        setTimeout(() => setCopiedField(null), 2000);
        return;
      } catch (error) {
        console.warn('Clipboard API 失败，尝试降级方案:', error);
      }
    }
    
    // 降级方案：使用传统的 execCommand 方法
    try {
      const textArea = document.createElement('textarea');
      textArea.value = text;
      textArea.style.position = 'fixed';
      textArea.style.left = '-999999px';
      textArea.style.top = '-999999px';
      document.body.appendChild(textArea);
      textArea.focus();
      textArea.select();
      
      const successful = document.execCommand('copy');
      document.body.removeChild(textArea);
      
      if (successful) {
        setCopiedField(`all-${item.itemId}`);
        setTimeout(() => setCopiedField(null), 2000);
      } else {
        throw new Error('execCommand 复制失败');
      }
    } catch (error) {
      console.error('复制失败:', error);
      // 最后的降级方案：显示文本让用户手动复制
      const userConfirmed = confirm(`复制失败，请手动复制以下内容：\n\n${text}\n\n点击确定后，文本将显示在控制台`);
      if (userConfirmed) {
        console.log('待复制内容:', text);
        alert('内容已输出到控制台，请手动复制');
      }
    }
  };

  const getStatusText = (status?: string) => {
    if (!status) return '未知状态';
    const statusMap: Record<string, string> = {
      PENDING: '待处理',
      RFQ_CREATED: '已创建询价',
      QUOTED: '已报价',
      AWARDED: '已中标',
      SHIPPED: '已发货',
      DELIVERED: '已送达',
      COMPLETED: '已完成',
      CANCELLED: '已取消',
    };
    return statusMap[status] || status;
  };

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

  // 按门店分组数据
  const groupedByStore = useMemo(() => {
    return unquotedItems.reduce((acc, item) => {
      const storeName = item.storeName || '未分配门店';
      const storeId = item.storeId || 'no-store';
      
      if (!acc[storeId]) {
        acc[storeId] = {
          storeId,
          storeName,
          items: [],
        };
      }
      acc[storeId].items.push(item);
      return acc;
    }, {} as Record<string, { storeId: string; storeName: string; items: UnquotedItem[] }>);
  }, [unquotedItems]);

  // 过滤后的门店数据
  // 如果是门店用户，只显示自己店铺的数据
  const filteredStores = useMemo(() => {
    if (isStoreUser && currentUser?.storeId) {
      return Object.values(groupedByStore).filter(store => store.storeId === currentUser.storeId);
    }
    return selectedStore
      ? Object.values(groupedByStore).filter(store => store.storeId === selectedStore)
      : Object.values(groupedByStore);
  }, [groupedByStore, selectedStore, isStoreUser, currentUser]);

  // 过滤后的商品列表（用于统计）
  // 如果是门店用户，只显示自己店铺的商品
  const filteredItems = useMemo(() => {
    if (isStoreUser && currentUser?.storeId) {
      return unquotedItems.filter(item => (item.storeId || 'no-store') === currentUser.storeId);
    }
    return selectedStore
      ? unquotedItems.filter(item => (item.storeId || 'no-store') === selectedStore)
      : unquotedItems;
  }, [unquotedItems, selectedStore, isStoreUser, currentUser]);

  if (loading) {
    return (
      <div className="flex h-screen items-center justify-center">
        <div className="text-gray-600">加载中...</div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gray-50 p-3 sm:p-6">
      <div className="mx-auto max-w-[2000px]">
        {/* 头部 */}
        <div className="mb-4 sm:mb-6 flex flex-col gap-4">
          <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2">
            <div>
              <h1 className="text-xl sm:text-2xl font-bold text-gray-900">电商平台采购清单</h1>
              <p className="mt-1 text-xs sm:text-sm text-gray-600">
                所有供应商未报价的商品，需要在拼多多/淘宝采购
              </p>
            </div>
            <div className="text-sm text-gray-600">
              共 {filteredItems.length} 个商品
            </div>
          </div>

          {/* 门店筛选 - 门店用户不显示筛选器 */}
          {!isStoreUser && (
            <div className="flex items-center gap-3">
              <label className="text-sm font-medium text-gray-700 whitespace-nowrap">门店筛选：</label>
              <select
                value={selectedStore}
                onChange={(e) => setSelectedStore(e.target.value)}
                className="rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm text-gray-900 focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
              >
                <option value="">全部门店</option>
                {stores.map((store) => (
                  <option key={store.id} value={store.id}>
                    {store.name} ({store.code})
                  </option>
                ))}
              </select>
              {selectedStore && (
                <button
                  onClick={() => setSelectedStore('')}
                  className="text-sm text-blue-600 hover:text-blue-800 underline"
                >
                  清除筛选
                </button>
              )}
            </div>
          )}
          {/* 门店用户显示当前店铺信息 */}
          {isStoreUser && stores.length > 0 && (
            <div className="flex items-center gap-2 rounded-lg bg-blue-50 px-4 py-2 border border-blue-200">
              <svg className="h-5 w-5 text-blue-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 21V5a2 2 0 00-2-2H7a2 2 0 00-2 2v16m14 0h2m-2 0h-5m-9 0H3m2 0h5M9 7h1m-1 4h1m4-4h1m-1 4h1m-5 10v-5a1 1 0 011-1h2a1 1 0 011 1v5m-4 0h4" />
              </svg>
              <span className="text-sm font-medium text-blue-900">
                当前店铺：{stores[0]?.name} ({stores[0]?.code})
              </span>
            </div>
          )}
        </div>

        {/* 商品表格 */}
        {filteredItems.length === 0 ? (
          <div className="rounded-xl bg-white p-12 text-center shadow-sm">
            <div className="mx-auto mb-4 flex h-16 w-16 items-center justify-center rounded-full bg-green-100">
              <svg className="h-8 w-8 text-green-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
              </svg>
            </div>
            <h3 className="mb-2 text-lg font-semibold text-gray-900">太好了！</h3>
            <p className="text-sm text-gray-500">
              {selectedStore ? '该门店当前没有需要从电商平台采购的商品。' : '当前没有需要从电商平台采购的商品，所有商品都有供应商报价。'}
            </p>
          </div>
        ) : (
          <>
            {/* 移动端卡片视图 */}
            <div className="block md:hidden space-y-4">
              {filteredStores.map((store) => (
                <div key={store.storeId} className="space-y-3">
                  {/* 门店标题 */}
                  <div className="flex items-center justify-between rounded-lg bg-blue-50 px-4 py-2 border border-blue-200">
                    <div className="flex items-center gap-2">
                      <svg className="h-5 w-5 text-blue-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 21V5a2 2 0 00-2-2H7a2 2 0 00-2 2v16m14 0h2m-2 0h-5m-9 0H3m2 0h5M9 7h1m-1 4h1m4-4h1m-1 4h1m-5 10v-5a1 1 0 011-1h2a1 1 0 011 1v5m-4 0h4" />
                      </svg>
                      <span className="font-semibold text-blue-900">{store.storeName}</span>
                    </div>
                    <span className="text-sm text-blue-700">{store.items.length} 个商品</span>
                  </div>
                  
                  {/* 门店下的商品 */}
                  {store.items.map((item) => (
                <div key={item.itemId} className="bg-white rounded-lg shadow-sm p-4 border border-gray-200">
                  {/* 订单号和状态 */}
                  <div className="flex items-start justify-between mb-3">
                    <div className="flex-1">
                      <div className="text-sm font-semibold text-gray-900 mb-1">
                        {item.orderNo || '无订单号'}
                      </div>
                      {item.productName ? (
                        <button
                          onClick={(e) => handleProductNameClick(item.productName, e)}
                          className="text-sm font-semibold text-blue-600 hover:text-blue-800 underline mb-1 text-left"
                        >
                          {item.productName}
                        </button>
                      ) : (
                        <div className="text-sm font-semibold text-gray-900 mb-1">-</div>
                      )}
                      {item.orderPrice && (
                        <div className="text-sm font-bold text-blue-600">
                          ¥{Number(item.orderPrice).toFixed(2)}
                        </div>
                      )}
                    </div>
                    <span className={`px-2 py-1 text-xs font-medium rounded-full ${
                      item.status === 'COMPLETED' ? 'bg-green-100 text-green-800' :
                      item.status === 'SHIPPED' ? 'bg-blue-100 text-blue-800' :
                      item.status === 'AWARDED' ? 'bg-purple-100 text-purple-800' :
                      'bg-gray-100 text-gray-800'
                    }`}>
                      {getStatusText(item.status)}
                    </span>
                  </div>

                  {/* 收件信息 - 移动端重点展示 */}
                  <div className="space-y-2 mb-3 pb-3 border-b border-gray-100">
                    <div className="flex items-center justify-between">
                      <span className="text-xs text-gray-500">收件人</span>
                      <div className="flex items-center gap-2">
                        <span className="text-sm font-medium text-gray-900">{item.recipient || '-'}</span>
                        {item.recipient && item.recipient !== '-' && (
                          <button
                            onClick={() => handleCopy(item.recipient || '', `recipient-${item.itemId}`)}
                            className="p-1.5 rounded text-gray-400 hover:bg-gray-100 hover:text-blue-600 active:bg-gray-200"
                            title="复制收件人"
                          >
                            {copiedField === `recipient-${item.itemId}` ? (
                              <svg className="h-4 w-4 text-green-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                              </svg>
                            ) : (
                              <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z" />
                              </svg>
                            )}
                          </button>
                        )}
                      </div>
                    </div>
                    <div className="flex items-center justify-between">
                      <span className="text-xs text-gray-500">手机</span>
                      <div className="flex items-center gap-2">
                        <span className="text-sm font-medium text-gray-900">{item.phone || '-'}</span>
                        {item.phone && item.phone !== '-' && (
                          <button
                                  onClick={() => handleCopy(item.phone || '', `phone-${item.itemId}`)}
                            className="p-1.5 rounded text-gray-400 hover:bg-gray-100 hover:text-blue-600 active:bg-gray-200"
                            title="复制手机号"
                          >
                            {copiedField === `phone-${item.itemId}` ? (
                              <svg className="h-4 w-4 text-green-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                              </svg>
                            ) : (
                              <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z" />
                              </svg>
                            )}
                          </button>
                        )}
                      </div>
                    </div>
                    <div className="flex items-start justify-between">
                      <span className="text-xs text-gray-500 flex-shrink-0 mr-2">地址</span>
                      <div className="flex items-start gap-2 flex-1 min-w-0">
                        <span className="text-sm text-gray-900 break-words flex-1">{item.modifiedAddress || item.address || '-'}</span>
                        {(item.modifiedAddress || item.address) && (item.modifiedAddress || item.address) !== '-' && (
                          <button
                            onClick={() => handleCopy((item.modifiedAddress || item.address) || '', `address-${item.itemId}`)}
                            className="p-1.5 rounded text-gray-400 hover:bg-gray-100 hover:text-blue-600 active:bg-gray-200 flex-shrink-0"
                            title="复制地址"
                          >
                            {copiedField === `address-${item.itemId}` ? (
                              <svg className="h-4 w-4 text-green-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                              </svg>
                            ) : (
                              <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z" />
                              </svg>
                            )}
                          </button>
                        )}
                      </div>
                    </div>
                  </div>

                  {/* 一键复制按钮 - 移动端大按钮 */}
                  <button
                    onClick={() => handleCopyAll(item)}
                    className="w-full mb-3 flex items-center justify-center gap-2 rounded-lg bg-blue-600 px-4 py-3 text-sm font-medium text-white transition-colors hover:bg-blue-700 active:bg-blue-800"
                    title="一键复制全部信息（收件人、手机、地址）"
                  >
                    {copiedField === `all-${item.itemId}` ? (
                      <>
                        <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                        </svg>
                        <span>已复制</span>
                      </>
                    ) : (
                      <>
                        <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z" />
                        </svg>
                        <span>一键复制全部</span>
                      </>
                    )}
                  </button>

                  {/* 其他信息 - 可折叠 */}
                  <details className="text-xs text-gray-600">
                    <summary className="cursor-pointer font-medium text-gray-700 mb-2">更多信息</summary>
                    <div className="space-y-1 pt-2">
                      <div className="flex justify-between">
                        <span className="text-gray-500">数量:</span>
                        <span>{item.quantity || '-'}</span>
                      </div>
                      <div className="flex justify-between">
                        <span className="text-gray-500">价值:</span>
                        <span>{item.value ? `¥${item.value}` : '-'}</span>
                      </div>
                      <div className="flex justify-between">
                        <span className="text-gray-500">积分:</span>
                        <span>{item.points || '-'}</span>
                      </div>
                      {item.trackingNo && (
                        <div className="flex justify-between">
                          <span className="text-gray-500">快递单号:</span>
                          <span className="font-mono">{item.trackingNo}</span>
                        </div>
                      )}
                      {item.carrier && (
                        <div className="flex justify-between">
                          <span className="text-gray-500">快递公司:</span>
                          <span>{item.carrier}</span>
                        </div>
                      )}
                    </div>
                  </details>

                  {/* 操作按钮 */}
                  {editingItem === item.itemId ? (
                    <div className="mt-3 pt-3 border-t border-gray-100 space-y-3">
                      <div>
                        <label className="block text-xs font-medium text-gray-700 mb-1.5">快递单号</label>
                        <input
                          type="text"
                          placeholder="请输入快递单号"
                          value={trackingNo}
                          onChange={(e) => setTrackingNo(e.target.value)}
                          className="w-full rounded-lg border-2 border-gray-300 px-4 py-3 text-base text-gray-900 bg-white focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-0 transition-colors"
                          autoFocus
                        />
                      </div>
                      <div>
                        <label className="block text-xs font-medium text-gray-700 mb-1.5">快递公司（可选）</label>
                        <input
                          type="text"
                          placeholder="如：顺丰、圆通、中通等"
                          value={carrier}
                          onChange={(e) => setCarrier(e.target.value)}
                          className="w-full rounded-lg border-2 border-gray-300 px-4 py-3 text-base text-gray-900 bg-white focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-0 transition-colors"
                        />
                      </div>
                      <div>
                        <label className="block text-xs font-medium text-gray-700 mb-1.5">成本价（元）</label>
                        <input
                          type="number"
                          step="0.01"
                          min="0"
                          placeholder="请输入成本价"
                          value={costPrice}
                          onChange={(e) => setCostPrice(e.target.value)}
                          className="w-full rounded-lg border-2 border-gray-300 px-4 py-3 text-base text-gray-900 bg-white focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-0 transition-colors"
                          inputMode="decimal"
                        />
                      </div>
                      <div className="flex gap-2 pt-1">
                        <button
                          onClick={() => handleSaveTracking(item.itemId)}
                          className="flex-1 rounded-lg bg-green-600 px-4 py-3 text-base font-medium text-white hover:bg-green-700 active:bg-green-800 transition-colors shadow-sm"
                        >
                          保存
                        </button>
                        <button
                          onClick={handleCancelEdit}
                          className="flex-1 rounded-lg bg-gray-200 px-4 py-3 text-base font-medium text-gray-700 hover:bg-gray-300 active:bg-gray-400 transition-colors"
                        >
                          取消
                        </button>
                      </div>
                    </div>
                  ) : (
                    <button
                      onClick={() => handleEditTracking(item)}
                      className="w-full mt-3 rounded-lg bg-blue-600 px-4 py-3 text-base font-medium text-white hover:bg-blue-700 active:bg-blue-800 transition-colors shadow-sm"
                    >
                      编辑物流信息
                    </button>
                  )}
                </div>
                  ))}
                </div>
              ))}
            </div>

            {/* 桌面端表格视图 */}
            <div className="hidden md:block space-y-4">
              {filteredStores.map((store) => (
                <div key={store.storeId} className="rounded-xl bg-white shadow-sm overflow-hidden">
                  {/* 门店标题 */}
                  <div className="bg-blue-50 border-b border-blue-200 px-6 py-3">
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-2">
                        <svg className="h-5 w-5 text-blue-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 21V5a2 2 0 00-2-2H7a2 2 0 00-2 2v16m14 0h2m-2 0h-5m-9 0H3m2 0h5M9 7h1m-1 4h1m4-4h1m-1 4h1m-5 10v-5a1 1 0 011-1h2a1 1 0 011 1v5m-4 0h4" />
                        </svg>
                        <span className="font-semibold text-blue-900">{store.storeName}</span>
                      </div>
                      <span className="text-sm text-blue-700 font-medium">{store.items.length} 个商品</span>
                    </div>
                  </div>
                  
                  {/* 门店下的商品表格 */}
                  <div className="overflow-x-auto">
                    <table className="min-w-full divide-y divide-gray-200">
                      <thead className="bg-gray-50">
                        <tr>
                          <th className="px-3 py-3 text-left text-xs font-medium uppercase tracking-wider text-gray-700 sticky left-0 bg-gray-50 z-10">订单号</th>
                  <th className="px-3 py-3 text-left text-xs font-medium uppercase tracking-wider text-gray-700">用户昵称</th>
                  <th className="px-3 py-3 text-left text-xs font-medium uppercase tracking-wider text-gray-700">open_id</th>
                  <th className="px-3 py-3 text-left text-xs font-medium uppercase tracking-wider text-gray-700">收件人</th>
                  <th className="px-3 py-3 text-left text-xs font-medium uppercase tracking-wider text-gray-700">手机</th>
                  <th className="px-3 py-3 text-left text-xs font-medium uppercase tracking-wider text-gray-700">地址</th>
                  <th className="px-3 py-3 text-left text-xs font-medium uppercase tracking-wider text-gray-700">修改地址</th>
                  <th className="px-3 py-3 text-left text-xs font-medium uppercase tracking-wider text-gray-700">一键复制</th>
                  <th className="px-3 py-3 text-left text-xs font-medium uppercase tracking-wider text-gray-700">物品名称</th>
                  <th className="px-3 py-3 text-left text-xs font-medium uppercase tracking-wider text-gray-700 hidden lg:table-cell">物品数量</th>
                  <th className="px-3 py-3 text-left text-xs font-medium uppercase tracking-wider text-gray-700 hidden lg:table-cell">价值</th>
                  <th className="px-3 py-3 text-left text-xs font-medium uppercase tracking-wider text-gray-700 hidden xl:table-cell">积分</th>
                  <th className="px-3 py-3 text-left text-xs font-medium uppercase tracking-wider text-gray-700">状态</th>
                  <th className="px-3 py-3 text-left text-xs font-medium uppercase tracking-wider text-gray-700 hidden xl:table-cell">订单时间</th>
                  <th className="px-3 py-3 text-left text-xs font-medium uppercase tracking-wider text-gray-700 hidden xl:table-cell">备注</th>
                  <th className="px-3 py-3 text-left text-xs font-medium uppercase tracking-wider text-gray-700 hidden lg:table-cell">成本价</th>
                  <th className="px-3 py-3 text-left text-xs font-medium uppercase tracking-wider text-gray-700 hidden lg:table-cell">快递公司</th>
                  <th className="px-3 py-3 text-left text-xs font-medium uppercase tracking-wider text-gray-700 hidden lg:table-cell">快递单号</th>
                  <th className="px-3 py-3 text-left text-xs font-medium uppercase tracking-wider text-gray-700 hidden xl:table-cell">发货时间</th>
                        <th className="px-3 py-3 text-left text-xs font-medium uppercase tracking-wider text-gray-700 sticky right-0 bg-gray-50 z-10">操作</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-gray-200 bg-white">
                      {store.items.map((item) => (
                        <tr key={item.itemId} className={`hover:bg-gray-50 ${editingItem === item.itemId ? 'bg-blue-50' : ''}`}>
                          <td className="whitespace-nowrap px-3 py-3 text-sm text-gray-900 sticky left-0 bg-white z-10">
                            {item.orderNo || '-'}
                          </td>
                          <td className="whitespace-nowrap px-3 py-3 text-sm text-gray-600 hidden lg:table-cell">
                            {item.userNickname || '-'}
                          </td>
                          <td className="whitespace-nowrap px-3 py-3 text-sm text-gray-600 font-mono text-xs hidden xl:table-cell">
                            {item.openid || '-'}
                          </td>
                          <td className="whitespace-nowrap px-3 py-3 text-sm text-gray-900">
                            <div className="flex items-center gap-2">
                              <span>{item.recipient || '-'}</span>
                              {item.recipient && item.recipient !== '-' && (
                                <button
                                  onClick={() => handleCopy(item.recipient || '', `recipient-${item.itemId}`)}
                                  className="flex-shrink-0 rounded p-1 text-gray-400 transition-colors hover:bg-gray-100 hover:text-blue-600"
                                  title="复制收件人"
                                >
                                  {copiedField === `recipient-${item.itemId}` ? (
                                    <svg className="h-4 w-4 text-green-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                                    </svg>
                                  ) : (
                                    <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z" />
                                    </svg>
                                  )}
                                </button>
                              )}
                            </div>
                          </td>
                          <td className="whitespace-nowrap px-3 py-3 text-sm text-gray-600">
                      <div className="flex items-center gap-2">
                        <span>{item.phone || '-'}</span>
                        {item.phone && item.phone !== '-' && (
                          <button
                                  onClick={() => handleCopy(item.phone || '', `phone-${item.itemId}`)}
                            className="flex-shrink-0 rounded p-1 text-gray-400 transition-colors hover:bg-gray-100 hover:text-blue-600"
                            title="复制手机号"
                          >
                            {copiedField === `phone-${item.itemId}` ? (
                              <svg className="h-4 w-4 text-green-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                              </svg>
                            ) : (
                              <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z" />
                              </svg>
                            )}
                          </button>
                        )}
                      </div>
                    </td>
                    <td className="px-3 py-3 text-sm text-gray-600 max-w-xs hidden lg:table-cell">
                      <div className="flex items-center gap-2">
                        <div className="truncate flex-1" title={item.address || ''}>
                          {item.address || '-'}
                        </div>
                        {item.address && item.address !== '-' && (
                          <button
                                  onClick={() => handleCopy(item.address || '', `address-${item.itemId}`)}
                            className="flex-shrink-0 rounded p-1 text-gray-400 transition-colors hover:bg-gray-100 hover:text-blue-600"
                            title="复制地址"
                          >
                            {copiedField === `address-${item.itemId}` ? (
                              <svg className="h-4 w-4 text-green-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                              </svg>
                            ) : (
                              <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z" />
                              </svg>
                            )}
                          </button>
                        )}
                      </div>
                    </td>
                    <td className="px-3 py-3 text-sm text-gray-600 max-w-xs hidden lg:table-cell">
                      <div className="flex items-center gap-2">
                        <div className="truncate flex-1" title={item.modifiedAddress || ''}>
                          {item.modifiedAddress || '-'}
                        </div>
                        {item.modifiedAddress && item.modifiedAddress !== '-' && (
                          <button
                                  onClick={() => handleCopy(item.modifiedAddress || '', `modifiedAddress-${item.itemId}`)}
                            className="flex-shrink-0 rounded p-1 text-gray-400 transition-colors hover:bg-gray-100 hover:text-blue-600"
                            title="复制修改地址"
                          >
                            {copiedField === `modifiedAddress-${item.itemId}` ? (
                              <svg className="h-4 w-4 text-green-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                              </svg>
                            ) : (
                              <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z" />
                              </svg>
                            )}
                          </button>
                        )}
                      </div>
                    </td>
                    <td className="whitespace-nowrap px-3 py-3 text-sm">
                      <button
                        onClick={() => handleCopyAll(item)}
                        className="flex items-center gap-1 rounded-md bg-blue-600 px-2 py-1 text-xs text-white transition-colors hover:bg-blue-700"
                        title="一键复制全部信息（收件人、手机、地址）"
                      >
                        {copiedField === `all-${item.itemId}` ? (
                          <>
                            <svg className="h-3 w-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                            </svg>
                            <span>已复制</span>
                          </>
                        ) : (
                          <>
                            <svg className="h-3 w-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z" />
                            </svg>
                            <span>复制</span>
                          </>
                        )}
                      </button>
                    </td>
                    <td className="whitespace-nowrap px-3 py-3 text-sm font-bold text-gray-900">
                      {item.productName ? (
                        <button
                          onClick={(e) => handleProductNameClick(item.productName, e)}
                          className="text-blue-600 hover:text-blue-800 hover:underline transition-colors text-left"
                          title="点击在拼多多搜索此商品"
                        >
                          {item.productName}
                        </button>
                      ) : (
                        <span className="text-gray-400">-</span>
                      )}
                    </td>
                    <td className="whitespace-nowrap px-3 py-3 text-sm text-gray-600 hidden lg:table-cell">
                      {item.quantity} {item.unit || '件'}
                    </td>
                    <td className="whitespace-nowrap px-3 py-3 text-sm text-gray-600 hidden lg:table-cell">
                      {item.orderPrice ? `¥${Number(item.orderPrice).toFixed(2)}` : '-'}
                    </td>
                    <td className="whitespace-nowrap px-3 py-3 text-sm text-gray-600 hidden xl:table-cell">
                      {item.points || 0}
                    </td>
                    <td className="whitespace-nowrap px-3 py-3 text-sm">
                      <span className={`inline-flex rounded-full px-2 py-1 text-xs font-semibold ${
                        item.orderStatus === 'COMPLETED' ? 'bg-green-100 text-green-800' :
                        item.orderStatus === 'SHIPPED' ? 'bg-blue-100 text-blue-800' :
                        item.orderStatus === 'CANCELLED' ? 'bg-red-100 text-red-800' :
                        'bg-yellow-100 text-yellow-800'
                      }`}>
                        {getStatusText(item.orderStatus || 'PENDING')}
                      </span>
                    </td>
                    <td className="whitespace-nowrap px-3 py-3 text-sm text-gray-600 hidden xl:table-cell">
                      {item.orderTime ? new Date(item.orderTime).toLocaleString('zh-CN') : '-'}
                    </td>
                    <td className="px-3 py-3 text-sm text-gray-600 max-w-xs hidden xl:table-cell">
                      <div className="truncate" title={item.description || ''}>
                        {item.description || '-'}
                      </div>
                    </td>
                    <td className="whitespace-nowrap px-3 py-3 text-sm hidden lg:table-cell">
                      {editingItem === item.itemId ? (
                        <input
                          type="number"
                          step="0.01"
                          min="0"
                          value={costPrice}
                          onChange={(e) => setCostPrice(e.target.value)}
                          placeholder="成本价"
                          className="w-28 rounded-lg border-2 border-gray-300 px-3 py-2 text-sm text-gray-900 bg-white focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-0 transition-colors"
                          inputMode="decimal"
                        />
                      ) : (
                        <span className="text-gray-600 font-medium">
                          {item.costPrice ? `¥${Number(item.costPrice).toFixed(2)}` : '-'}
                        </span>
                      )}
                    </td>
                    <td className="whitespace-nowrap px-3 py-3 text-sm hidden lg:table-cell">
                      {editingItem === item.itemId ? (
                        <input
                          type="text"
                          value={carrier}
                          onChange={(e) => setCarrier(e.target.value)}
                          placeholder="快递公司"
                          className="w-32 rounded-lg border-2 border-gray-300 px-3 py-2 text-sm text-gray-900 bg-white focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-0 transition-colors"
                        />
                      ) : (
                        <span className="text-gray-600">{item.carrier || '-'}</span>
                      )}
                    </td>
                    <td className="whitespace-nowrap px-3 py-3 text-sm hidden lg:table-cell">
                      {editingItem === item.itemId ? (
                        <input
                          type="text"
                          value={trackingNo}
                          onChange={(e) => setTrackingNo(e.target.value)}
                          placeholder="物流单号"
                          className="w-40 rounded-lg border-2 border-gray-300 px-3 py-2 text-sm text-gray-900 bg-white font-mono focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-0 transition-colors"
                          autoFocus
                        />
                      ) : (
                        <span className="text-gray-600 font-mono text-xs">{item.trackingNo || '-'}</span>
                      )}
                    </td>
                    <td className="whitespace-nowrap px-3 py-3 text-sm text-gray-600 hidden xl:table-cell">
                      {item.shippedAt ? new Date(item.shippedAt).toLocaleString('zh-CN') : '-'}
                    </td>
                    <td className="whitespace-nowrap px-3 py-3 text-sm sticky right-0 bg-white z-10">
                      {editingItem === item.itemId ? (
                        <div className="flex gap-2">
                          <button
                            onClick={() => handleSaveTracking(item.itemId)}
                            className="rounded-lg bg-green-600 px-3 py-2 text-sm font-medium text-white hover:bg-green-700 active:bg-green-800 transition-colors shadow-sm"
                          >
                            保存
                          </button>
                          <button
                            onClick={handleCancelEdit}
                            className="rounded-lg bg-gray-300 px-3 py-2 text-sm font-medium text-gray-700 hover:bg-gray-400 active:bg-gray-500 transition-colors"
                          >
                            取消
                          </button>
                        </div>
                      ) : (
                        <button
                          onClick={() => handleEditTracking(item)}
                          className="rounded-lg bg-blue-600 px-3 py-2 text-sm font-medium text-white hover:bg-blue-700 active:bg-blue-800 transition-colors shadow-sm"
                        >
                          编辑
                        </button>
                      )}
                    </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
              ))}
            </div>
          </>
        )}
      </div>
    </div>
  );
}
