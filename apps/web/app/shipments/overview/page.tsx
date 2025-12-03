'use client';

import { useEffect, useState, useMemo } from 'react';
import { useRouter } from 'next/navigation';
import { authApi } from '@/lib/auth';
import api from '@/lib/api';
import TrackingNumberLink from '@/components/TrackingNumberLink';

export default function ShipmentOverviewPage() {
  const router = useRouter();
  const [overview, setOverview] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState<'ALL' | 'SHIPPED' | 'NOT_SHIPPED' | 'ECOMMERCE'>('ALL');
  const [searchTerm, setSearchTerm] = useState('');
  const [selectedStore, setSelectedStore] = useState<string>(''); // 门店筛选
  const [stores, setStores] = useState<any[]>([]); // 门店列表
  const [currentUser, setCurrentUser] = useState<any>(null); // 当前用户信息
  const [isStoreUser, setIsStoreUser] = useState(false); // 是否是门店用户
  const [expandedStores, setExpandedStores] = useState<Set<string>>(new Set()); // 展开的门店
  const [trackingModal, setTrackingModal] = useState<{ open: boolean; trackingNo: string; carrier?: string }>({
    open: false,
    trackingNo: '',
  });
  const [trackingResult, setTrackingResult] = useState<any>(null);
  const [trackingLoading, setTrackingLoading] = useState(false);
  const [copiedOpenid, setCopiedOpenid] = useState<string | null>(null); // 跟踪已复制的 OPENID
  const [copiedAddress, setCopiedAddress] = useState<string | null>(null); // 跟踪已复制的收货信息
  const [expandedRows, setExpandedRows] = useState<Set<string>>(new Set()); // 展开的行

  useEffect(() => {
    const user = authApi.getCurrentUser();
    if (!user) {
      router.push('/login');
      return;
    }

    // 允许管理员、采购员和门店用户访问发货状态总览页面
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
    fetchOverview();

    // 每30秒自动刷新一次数据
    const interval = setInterval(() => {
      fetchOverview(false);
    }, 30000);

    return () => clearInterval(interval);
  }, [router]);

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

  const fetchOverview = async (showLoading = true) => {
    try {
      if (showLoading) {
        setLoading(true);
      }
      const response = await api.get('/rfqs/shipment-overview');
      const data = response.data.data || response.data || [];
      console.log('📦 发货总览数据:', { count: data.length, sample: data[0] });
      setOverview(Array.isArray(data) ? data : []);
    } catch (error: any) {
      console.error('获取发货状态总览失败:', error);
      setOverview([]);
    } finally {
      if (showLoading) {
        setLoading(false);
      }
    }
  };

  // 按门店分组数据（使用 useMemo 缓存，避免每次渲染都创建新对象）
  const groupedByStore = useMemo(() => {
    return overview.reduce((acc, item) => {
      const storeId = item.storeId || 'no-store';
      const storeName = item.storeName || '未分配门店';
      const storeCode = item.storeCode || '';
      
      if (!acc[storeId]) {
        acc[storeId] = {
          storeId,
          storeName,
          storeCode,
          items: [],
        };
      }
      acc[storeId].items.push(item);
      return acc;
    }, {} as Record<string, { storeId: string; storeName: string; storeCode: string; items: any[] }>);
  }, [overview]);

  // 过滤数据
  const filterItems = (items: any[]) => {
    return items.filter((item) => {
      // 状态过滤
      if (filter !== 'ALL' && item.shipmentStatus !== filter) {
        return false;
      }

      // 搜索过滤
      if (searchTerm) {
        const searchLower = searchTerm.toLowerCase();
        return (
          item.rfqNo?.toLowerCase().includes(searchLower) ||
          item.productName?.toLowerCase().includes(searchLower) ||
          item.orderNo?.toLowerCase().includes(searchLower) ||
          item.trackingNo?.toLowerCase().includes(searchLower) ||
          item.supplierName?.toLowerCase().includes(searchLower) ||
          item.recipient?.toLowerCase().includes(searchLower) ||
          item.userNickname?.toLowerCase().includes(searchLower) ||
          item.openid?.toLowerCase().includes(searchLower)
        );
      }

      return true;
    });
  };

  // 如果选择了门店，只显示该门店的数据
  // 门店用户自动过滤只显示自己店铺的数据
  type StoreGroup = { storeId: string; storeName: string; storeCode: string; items: any[] };
  const filteredStores = useMemo(() => {
    if (isStoreUser && currentUser?.storeId) {
      return (Object.values(groupedByStore) as StoreGroup[]).filter((store: StoreGroup) => store.storeId === currentUser.storeId);
    }
    return selectedStore
      ? (Object.values(groupedByStore) as StoreGroup[]).filter((store: StoreGroup) => store.storeId === selectedStore)
      : (Object.values(groupedByStore) as StoreGroup[]) as StoreGroup[];
  }, [groupedByStore, selectedStore, isStoreUser, currentUser]);

  // 统计数据（基于过滤后的数据）
  const filteredOverview = filterItems(overview);

  // 统计数据（基于过滤后的数据）
  const stats = {
    total: filteredOverview.length,
    shipped: filteredOverview.filter((item) => item.shipmentStatus === 'SHIPPED').length,
    notShipped: filteredOverview.filter((item) => item.shipmentStatus === 'NOT_SHIPPED').length,
    ecommerce: filteredOverview.filter((item) => item.shipmentStatus === 'ECOMMERCE').length,
    totalCost: filteredOverview.reduce((sum, item) => sum + (item.costPrice || 0), 0),
    totalAwardedPrice: filteredOverview.reduce((sum, item) => sum + (item.awardedPrice || 0) * (item.quantity || 1), 0),
  };

  // 计算每个门店的统计
  const getStoreStats = (items: any[]) => {
    return {
      total: items.length,
      shipped: items.filter((item) => item.shipmentStatus === 'SHIPPED').length,
      notShipped: items.filter((item) => item.shipmentStatus === 'NOT_SHIPPED').length,
      ecommerce: items.filter((item) => item.shipmentStatus === 'ECOMMERCE').length,
    };
  };

  const toggleStoreExpanded = (storeId: string) => {
    const newExpanded = new Set(expandedStores);
    if (newExpanded.has(storeId)) {
      newExpanded.delete(storeId);
    } else {
      newExpanded.add(storeId);
    }
    setExpandedStores(newExpanded);
  };

  // 当选择门店时，自动展开该门店
  // 使用 storeIds 的字符串化版本作为依赖项，避免数组引用变化导致的无限循环
  const storeIdsString = useMemo(() => Object.keys(groupedByStore).sort().join(','), [groupedByStore]);
  
  useEffect(() => {
    if (selectedStore) {
      setExpandedStores(new Set([selectedStore]));
    } else {
      const storeIds = Object.keys(groupedByStore);
      if (storeIds.length === 1) {
        // 如果只有一个门店，自动展开
        setExpandedStores(new Set([storeIds[0]]));
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedStore, storeIdsString]);

  const getStatusBadge = (status: string) => {
    const statusMap: Record<string, { bg: string; text: string; label: string }> = {
      SHIPPED: { bg: 'bg-green-100', text: 'text-green-800', label: '已发货' },
      NOT_SHIPPED: { bg: 'bg-yellow-100', text: 'text-yellow-800', label: '未发货' },
      ECOMMERCE: { bg: 'bg-blue-100', text: 'text-blue-800', label: '电商采购' },
    };
    const style = statusMap[status] || { bg: 'bg-gray-100', text: 'text-gray-800', label: status };
    return (
      <span className={`inline-flex rounded-full px-2 py-1 text-xs font-semibold ${style.bg} ${style.text}`}>
        {style.label}
      </span>
    );
  };

  const handleQueryTracking = async (trackingNo: string, carrier?: string) => {
    setTrackingModal({ open: true, trackingNo, carrier });
    setTrackingLoading(true);
    setTrackingResult(null);

    try {
      const params = new URLSearchParams();
      params.append('trackingNo', trackingNo);
      if (carrier) {
        params.append('carrier', carrier);
      }
      const response = await api.get(`/tracking/query?${params.toString()}`);
      setTrackingResult(response.data.data || response.data);
    } catch (error: any) {
      console.error('查询快递失败:', error);
      setTrackingResult({
        success: false,
        message: error.response?.data?.message || '查询失败',
      });
    } finally {
      setTrackingLoading(false);
    }
  };

  const copyToClipboard = async (text: string) => {
    if (!text || text === '-') {
      return false;
    }
    
    // 使用 Clipboard API（如果可用）
    if (navigator.clipboard && navigator.clipboard.writeText) {
      try {
        await navigator.clipboard.writeText(text);
        return true;
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
      
      return successful;
    } catch (error) {
      console.error('复制失败:', error);
      return false;
    }
  };

  const handleCopyOpenid = async (openid: string, e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    
    const success = await copyToClipboard(openid);
    if (success) {
      setCopiedOpenid(openid);
      setTimeout(() => setCopiedOpenid(null), 2000);
    } else {
      alert('复制失败，请手动复制');
    }
  };

  const handleCopyAddress = async (item: any, e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    
    const addressInfo = [
      `收件人：${item.recipient || ''}`,
      `电话：${item.phone || ''}`,
      `地址：${item.modifiedAddress || item.address || ''}`,
    ].filter(line => line.split('：')[1]).join('\n');
    
    if (!addressInfo) {
      return;
    }
    
    const success = await copyToClipboard(addressInfo);
    if (success) {
      setCopiedAddress(item.itemId);
      setTimeout(() => setCopiedAddress(null), 2000);
    } else {
      alert('复制失败，请手动复制');
    }
  };

  const toggleRowExpanded = (itemId: string) => {
    const newExpanded = new Set(expandedRows);
    if (newExpanded.has(itemId)) {
      newExpanded.delete(itemId);
    } else {
      newExpanded.add(itemId);
    }
    setExpandedRows(newExpanded);
  };

  const handleOpenBaidu = async (trackingNo: string, carrier?: string) => {
    try {
      // 先尝试获取快递公司官网链接
      const params = new URLSearchParams();
      params.append('trackingNo', trackingNo);
      if (carrier) {
        params.append('carrier', carrier);
      }
      const response = await api.get(`/tracking/carrier-url?${params.toString()}`);
      const data = response.data.data || response.data;
      window.open(data.url, '_blank');
    } catch (error: any) {
      // 如果获取失败，使用百度查询
      const url = `https://www.baidu.com/s?ie=utf-8&wd=${encodeURIComponent(trackingNo)}`;
      window.open(url, '_blank');
    }
  };

  if (loading) {
    return (
      <div className="flex h-screen items-center justify-center">
        <div className="text-gray-600">加载中...</div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gray-50 p-6">
      <div className="mx-auto max-w-7xl">
        <div className="mb-6">
          <h1 className="text-2xl font-bold text-gray-900">发货状态总览</h1>
          <p className="mt-1 text-sm text-gray-600">查看所有商品的发货状态、物流信息和成本价</p>
        </div>

        {/* 统计卡片 */}
        <div className="mb-6 grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <div className="rounded-lg bg-white p-4 shadow-sm">
            <div className="text-sm text-gray-600">总商品数</div>
            <div className="mt-1 text-2xl font-bold text-gray-900">{stats.total}</div>
          </div>
          <div className="rounded-lg bg-green-50 p-4 shadow-sm">
            <div className="text-sm text-green-600">已发货</div>
            <div className="mt-1 text-2xl font-bold text-green-900">{stats.shipped}</div>
          </div>
          <div className="rounded-lg bg-yellow-50 p-4 shadow-sm">
            <div className="text-sm text-yellow-600">未发货</div>
            <div className="mt-1 text-2xl font-bold text-yellow-900">{stats.notShipped}</div>
          </div>
          <div className="rounded-lg bg-blue-50 p-4 shadow-sm">
            <div className="text-sm text-blue-600">电商采购</div>
            <div className="mt-1 text-2xl font-bold text-blue-900">{stats.ecommerce}</div>
          </div>
        </div>

        {/* 财务统计 */}
        <div className="mb-6 grid grid-cols-1 gap-4 sm:grid-cols-2">
          <div className="rounded-lg bg-white p-4 shadow-sm">
            <div className="text-sm text-gray-600">总成本价</div>
            <div className="mt-1 text-2xl font-bold text-gray-900">
              ¥{stats.totalCost.toFixed(2)}
            </div>
            <div className="mt-1 text-xs text-gray-500">（电商采购成本价）</div>
          </div>
          <div className="rounded-lg bg-white p-4 shadow-sm">
            <div className="text-sm text-gray-600">供应商中标总价</div>
            <div className="mt-1 text-2xl font-bold text-gray-900">
              ¥{stats.totalAwardedPrice.toFixed(2)}
            </div>
            <div className="mt-1 text-xs text-gray-500">（供应商报价总价）</div>
          </div>
        </div>

        {/* 刷新按钮 */}
        <div className="mb-4 flex items-center justify-between">
          <button
            onClick={() => fetchOverview(true)}
            className="rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700 transition-colors"
          >
            刷新数据
          </button>
          <div className="text-sm text-gray-500">
            数据每30秒自动刷新
          </div>
        </div>

        {/* 过滤和搜索 */}
        <div className="mb-4 flex flex-col gap-4">
          <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
            <div className="flex flex-wrap gap-2">
              <button
                onClick={() => setFilter('ALL')}
                className={`rounded-lg px-4 py-2 text-sm font-medium transition-colors ${
                  filter === 'ALL'
                    ? 'bg-blue-600 text-white'
                    : 'bg-white text-gray-700 hover:bg-gray-50'
                }`}
              >
                全部 ({stats.total})
              </button>
              <button
                onClick={() => setFilter('SHIPPED')}
                className={`rounded-lg px-4 py-2 text-sm font-medium transition-colors ${
                  filter === 'SHIPPED'
                    ? 'bg-green-600 text-white'
                    : 'bg-white text-gray-700 hover:bg-gray-50'
                }`}
              >
                已发货 ({stats.shipped})
              </button>
              <button
                onClick={() => setFilter('NOT_SHIPPED')}
                className={`rounded-lg px-4 py-2 text-sm font-medium transition-colors ${
                  filter === 'NOT_SHIPPED'
                    ? 'bg-yellow-600 text-white'
                    : 'bg-white text-gray-700 hover:bg-gray-50'
                }`}
              >
                未发货 ({stats.notShipped})
              </button>
              <button
                onClick={() => setFilter('ECOMMERCE')}
                className={`rounded-lg px-4 py-2 text-sm font-medium transition-colors ${
                  filter === 'ECOMMERCE'
                    ? 'bg-blue-600 text-white'
                    : 'bg-white text-gray-700 hover:bg-gray-50'
                }`}
              >
                电商采购 ({stats.ecommerce})
              </button>
            </div>
            <div className="flex gap-2">
              {/* 门店筛选 - 门店用户不显示 */}
              {!isStoreUser && (
                <select
                  value={selectedStore}
                  onChange={(e) => setSelectedStore(e.target.value)}
                  className="rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
                >
                  <option value="">全部门店</option>
                  {stores.map((store) => (
                    <option key={store.id} value={store.id}>
                      {store.name} ({store.code})
                    </option>
                  ))}
                </select>
              )}
              {/* 门店用户显示当前店铺信息 */}
              {isStoreUser && stores.length > 0 && (
                <div className="flex items-center gap-2 rounded-lg bg-blue-50 px-3 py-2 border border-blue-200">
                  <svg className="h-4 w-4 text-blue-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 21V5a2 2 0 00-2-2H7a2 2 0 00-2 2v16m14 0h2m-2 0h-5m-9 0H3m2 0h5M9 7h1m-1 4h1m4-4h1m-1 4h1m-5 10v-5a1 1 0 011-1h2a1 1 0 011 1v5m-4 0h4" />
                  </svg>
                  <span className="text-sm font-medium text-blue-900">
                    {stores[0]?.name} ({stores[0]?.code})
                  </span>
                </div>
              )}
              <input
                type="text"
                placeholder="搜索询价单号、商品名称、订单号、物流单号、用户名、OPENID..."
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
                className="flex-1 rounded-lg border border-gray-300 px-4 py-2 text-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
              />
            </div>
          </div>
        </div>

        {/* 按门店分组显示 */}
        <div className="space-y-4">
          {filteredStores.length === 0 ? (
            <div className="rounded-lg bg-white p-12 text-center shadow-sm">
              <p className="text-gray-500">暂无数据</p>
            </div>
          ) : (
            filteredStores.map((store: { storeId: string; storeName: string; storeCode: string; items: any[] }) => {
              const storeItems = filterItems(store.items);
              const storeStats = getStoreStats(storeItems);
              const isExpanded = expandedStores.has(store.storeId) || selectedStore === store.storeId;

              if (storeItems.length === 0) {
                return null; // 如果该门店没有符合条件的数据，不显示
              }

              return (
                <div key={store.storeId} className="rounded-lg bg-white shadow-sm overflow-hidden">
                  {/* 门店标题栏 */}
                  <div
                    className="flex items-center justify-between p-4 bg-gradient-to-r from-blue-50 to-indigo-50 border-b border-gray-200 cursor-pointer hover:from-blue-100 hover:to-indigo-100 transition-colors"
                    onClick={() => toggleStoreExpanded(store.storeId)}
                  >
                    <div className="flex items-center gap-3">
                      <div className="flex h-10 w-10 items-center justify-center rounded-full bg-blue-100 text-blue-600 font-semibold">
                        {store.storeCode || store.storeName.charAt(0)}
                      </div>
                      <div>
                        <h3 className="text-lg font-semibold text-gray-900">{store.storeName}</h3>
                        {store.storeCode && (
                          <p className="text-xs text-gray-500">门店代码: {store.storeCode}</p>
                        )}
                      </div>
                    </div>
                    <div className="flex items-center gap-6">
                      <div className="text-right">
                        <div className="text-sm text-gray-600">共 {storeStats.total} 个商品</div>
                        <div className="flex gap-3 text-xs text-gray-500 mt-1">
                          <span className="text-green-600">已发货: {storeStats.shipped}</span>
                          <span className="text-yellow-600">未发货: {storeStats.notShipped}</span>
                          <span className="text-blue-600">电商: {storeStats.ecommerce}</span>
                        </div>
                      </div>
                      <svg
                        className={`h-5 w-5 text-gray-400 transition-transform ${
                          isExpanded ? 'rotate-180' : ''
                        }`}
                        fill="none"
                        stroke="currentColor"
                        viewBox="0 0 24 24"
                      >
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                      </svg>
                    </div>
                  </div>

                  {/* 门店数据表格 */}
                  {isExpanded && (
                    <div className="overflow-x-auto">
                      <table className="min-w-full divide-y divide-gray-200">
                        <thead className="bg-gray-50">
                          <tr>
                            <th className="px-4 py-3 text-left text-xs font-medium uppercase tracking-wider text-gray-500 w-12">
                              展开
                            </th>
                            <th className="px-4 py-3 text-left text-xs font-medium uppercase tracking-wider text-gray-500">
                              商品名称
                            </th>
                            <th className="px-4 py-3 text-left text-xs font-medium uppercase tracking-wider text-gray-500">
                              供应商
                            </th>
                            <th className="px-4 py-3 text-left text-xs font-medium uppercase tracking-wider text-gray-500">
                              发货状态
                            </th>
                            <th className="px-4 py-3 text-left text-xs font-medium uppercase tracking-wider text-gray-500">
                              物流单号
                            </th>
                            <th className="px-4 py-3 text-left text-xs font-medium uppercase tracking-wider text-gray-500">
                              中标价
                            </th>
                            <th className="px-4 py-3 text-left text-xs font-medium uppercase tracking-wider text-gray-500">
                              发货时间
                            </th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-gray-200 bg-white">
                          {storeItems.map((item) => {
                            const isExpanded = expandedRows.has(item.itemId);
                            return (
                              <>
                                <tr key={item.itemId} className="hover:bg-gray-50">
                                  <td className="whitespace-nowrap px-4 py-3 text-sm">
                                    <button
                                      onClick={() => toggleRowExpanded(item.itemId)}
                                      className="text-gray-400 hover:text-gray-600 transition-colors"
                                      title={isExpanded ? '收起' : '展开详情'}
                                    >
                                      <svg
                                        className={`h-5 w-5 transition-transform ${isExpanded ? 'rotate-90' : ''}`}
                                        fill="none"
                                        stroke="currentColor"
                                        viewBox="0 0 24 24"
                                      >
                                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
                                      </svg>
                                    </button>
                                  </td>
                                  <td className="px-4 py-3 text-sm font-medium text-gray-900">
                                    {item.productName}
                                  </td>
                                  <td className="whitespace-nowrap px-4 py-3 text-sm text-gray-600">
                                    {item.supplierName || '-'}
                                  </td>
                                  <td className="whitespace-nowrap px-4 py-3 text-sm">
                                    <div className="flex items-center gap-2">
                                      {getStatusBadge(item.shipmentStatus)}
                                      {item.isReplacement && (
                                        <span className="inline-flex items-center rounded-full bg-green-100 px-2 py-0.5 text-xs font-medium text-green-800">
                                          🔄 换货
                                        </span>
                                      )}
                                    </div>
                                  </td>
                                  <td className="whitespace-nowrap px-4 py-3 text-sm">
                                    {item.trackingNo ? (
                                      <div className="flex items-center gap-2 flex-wrap">
                                        {item.isReplacement && (
                                          <span className="inline-flex items-center rounded-full bg-green-100 px-1.5 py-0.5 text-xs font-medium text-green-800">
                                            🔄
                                          </span>
                                        )}
                                        <TrackingNumberLink
                                          trackingNo={item.trackingNo}
                                          carrier={item.carrier}
                                        />
                                      </div>
                                    ) : (
                                      <span className="text-gray-400">未填写</span>
                                    )}
                                  </td>
                                  <td className="whitespace-nowrap px-4 py-3 text-sm text-gray-900 font-medium">
                                    {item.awardedPrice
                                      ? `¥${(item.awardedPrice * (item.quantity || 1)).toFixed(2)}`
                                      : '-'}
                                  </td>
                                  <td className="whitespace-nowrap px-4 py-3 text-sm text-gray-600">
                                    {item.shipmentCreatedAt
                                      ? new Date(item.shipmentCreatedAt).toLocaleString('zh-CN')
                                      : '-'}
                                  </td>
                                </tr>
                                {/* 展开的详细信息行 */}
                                {isExpanded && (
                                  <tr key={`${item.itemId}-details`} className="bg-gray-50">
                                    <td colSpan={7} className="px-4 py-4">
                                      <div className="grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-3">
                                        {/* 询价单和订单信息 */}
                                        <div className="space-y-2">
                                          <h4 className="text-xs font-semibold text-gray-500 uppercase">询价单信息</h4>
                                          <div className="space-y-1 text-sm">
                                            <div>
                                              <span className="text-gray-600">询价单号：</span>
                                              <span className="font-medium">{item.rfqNo}</span>
                                            </div>
                                            <div>
                                              <span className="text-gray-600">订单号：</span>
                                              <span className="font-medium">{item.orderNo || '-'}</span>
                                            </div>
                                            <div>
                                              <span className="text-gray-600">数量：</span>
                                              <span className="font-medium">{item.quantity} {item.unit || ''}</span>
                                            </div>
                                          </div>
                                        </div>
                                        
                                        {/* 用户信息 */}
                                        <div className="space-y-2">
                                          <h4 className="text-xs font-semibold text-gray-500 uppercase">用户信息</h4>
                                          <div className="space-y-1 text-sm">
                                            <div>
                                              <span className="text-gray-600">用户名：</span>
                                              <span className="font-medium">{item.userNickname || '-'}</span>
                                            </div>
                                            <div>
                                              <span className="text-gray-600">OPENID：</span>
                                              {item.openid ? (
                                                <button
                                                  onClick={(e) => handleCopyOpenid(item.openid, e)}
                                                  className={`inline-flex items-center gap-1.5 text-gray-600 hover:text-blue-600 transition-colors cursor-pointer font-mono text-xs ${
                                                    copiedOpenid === item.openid ? 'text-green-600' : ''
                                                  }`}
                                                  title={copiedOpenid === item.openid ? '已复制！' : '点击复制'}
                                                >
                                                  <span>
                                                    {item.openid.length > 20 ? `${item.openid.substring(0, 20)}...` : item.openid}
                                                  </span>
                                                  <svg
                                                    className={`w-3.5 h-3.5 transition-opacity ${
                                                      copiedOpenid === item.openid ? 'opacity-100' : 'opacity-0 group-hover:opacity-100'
                                                    }`}
                                                    fill="none"
                                                    stroke="currentColor"
                                                    viewBox="0 0 24 24"
                                                  >
                                                    {copiedOpenid === item.openid ? (
                                                      <path
                                                        strokeLinecap="round"
                                                        strokeLinejoin="round"
                                                        strokeWidth={2}
                                                        d="M5 13l4 4L19 7"
                                                      />
                                                    ) : (
                                                      <path
                                                        strokeLinecap="round"
                                                        strokeLinejoin="round"
                                                        strokeWidth={2}
                                                        d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z"
                                                      />
                                                    )}
                                                  </svg>
                                                </button>
                                              ) : (
                                                <span className="font-medium">-</span>
                                              )}
                                            </div>
                                            <div>
                                              <span className="text-gray-600">积分：</span>
                                              <span className="font-medium">{item.points !== undefined && item.points !== null ? item.points : '-'}</span>
                                            </div>
                                            <div>
                                              <span className="text-gray-600">商品价值：</span>
                                              <span className="font-medium">
                                                {item.orderPrice !== undefined && item.orderPrice !== null ? `¥${item.orderPrice.toFixed(2)}` : '-'}
                                              </span>
                                            </div>
                                          </div>
                                        </div>
                                        
                                        {/* 收货信息 */}
                                        <div className="space-y-2">
                                          <div className="flex items-center justify-between">
                                            <h4 className="text-xs font-semibold text-gray-500 uppercase">收货信息</h4>
                                            <button
                                              onClick={(e) => handleCopyAddress(item, e)}
                                              className={`inline-flex items-center gap-1.5 rounded px-2 py-1 text-xs font-medium transition-colors ${
                                                copiedAddress === item.itemId
                                                  ? 'bg-green-100 text-green-700'
                                                  : 'bg-blue-100 text-blue-700 hover:bg-blue-200'
                                              }`}
                                              title="一键复制收货信息"
                                            >
                                              {copiedAddress === item.itemId ? (
                                                <>
                                                  <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                                                  </svg>
                                                  已复制
                                                </>
                                              ) : (
                                                <>
                                                  <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z" />
                                                  </svg>
                                                  复制
                                                </>
                                              )}
                                            </button>
                                          </div>
                                          <div className="space-y-1 text-sm">
                                            <div>
                                              <span className="text-gray-600">收件人：</span>
                                              <span className="font-medium">{item.recipient || '-'}</span>
                                            </div>
                                            <div>
                                              <span className="text-gray-600">电话：</span>
                                              <span className="font-medium">{item.phone || '-'}</span>
                                            </div>
                                            <div>
                                              <span className="text-gray-600">地址：</span>
                                              <span className="font-medium">{item.modifiedAddress || item.address || '-'}</span>
                                            </div>
                                          </div>
                                        </div>
                                        
                                        {/* 其他信息 */}
                                        <div className="space-y-2">
                                          <h4 className="text-xs font-semibold text-gray-500 uppercase">其他信息</h4>
                                          <div className="space-y-1 text-sm">
                                            <div>
                                              <span className="text-gray-600">快递公司：</span>
                                              <span className="font-medium">{item.carrier || '-'}</span>
                                            </div>
                                            <div>
                                              <span className="text-gray-600">成本价：</span>
                                              <span className="font-medium">{item.costPrice ? `¥${item.costPrice.toFixed(2)}` : '-'}</span>
                                            </div>
                                          </div>
                                        </div>
                                      </div>
                                    </td>
                                  </tr>
                                )}
                              </>
                            );
                          })}
                        </tbody>
                      </table>
                    </div>
                  )}
                </div>
              );
            })
          )}
        </div>

        {/* 分页信息 */}
        <div className="mt-4 text-sm text-gray-600">
          显示 {filteredOverview.length} / {overview.length} 条记录
          {selectedStore && (
            <span className="ml-2">
              （已筛选门店：{stores.find(s => s.id === selectedStore)?.name || '未知'}）
            </span>
          )}
        </div>
      </div>

      {/* 快递查询弹窗 */}
      {trackingModal.open && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black bg-opacity-50 p-4">
          <div className="w-full max-w-2xl rounded-xl bg-white shadow-xl">
            <div className="border-b border-gray-200 px-6 py-4">
              <div className="flex items-center justify-between">
                <h3 className="text-lg font-semibold text-gray-900">快递查询</h3>
                <button
                  onClick={() => {
                    setTrackingModal({ open: false, trackingNo: '' });
                    setTrackingResult(null);
                  }}
                  className="text-gray-400 hover:text-gray-600"
                >
                  <svg className="h-6 w-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                  </svg>
                </button>
              </div>
              <div className="mt-2 text-sm text-gray-600">
                快递单号：<span className="font-medium">{trackingModal.trackingNo}</span>
                {trackingModal.carrier && (
                  <span className="ml-2">快递公司：<span className="font-medium">{trackingModal.carrier}</span></span>
                )}
              </div>
            </div>

            <div className="max-h-[60vh] overflow-y-auto px-6 py-4">
              {trackingLoading ? (
                <div className="flex items-center justify-center py-12">
                  <div className="text-center">
                    <div className="mx-auto h-12 w-12 animate-spin rounded-full border-4 border-blue-600 border-t-transparent"></div>
                    <p className="mt-4 text-gray-600">查询中...</p>
                  </div>
                </div>
              ) : trackingResult ? (
                trackingResult.success ? (
                  <div className="space-y-4">
                    {trackingResult.carrierName && (
                      <div className="rounded-lg bg-blue-50 p-3">
                        <div className="text-sm font-medium text-blue-900">快递公司：{trackingResult.carrierName}</div>
                        {trackingResult.statusText && (
                          <div className="mt-1 text-sm text-blue-700">状态：{trackingResult.statusText}</div>
                        )}
                      </div>
                    )}
                    {trackingResult.tracks && trackingResult.tracks.length > 0 ? (
                      <div className="space-y-3">
                        <h4 className="font-medium text-gray-900">物流轨迹：</h4>
                        <div className="space-y-2">
                          {trackingResult.tracks.map((track: any, idx: number) => (
                            <div key={idx} className="flex gap-3 border-l-2 border-gray-200 pl-4">
                              <div className="flex-shrink-0">
                                <div className="flex h-8 w-8 items-center justify-center rounded-full bg-blue-100 text-xs font-medium text-blue-600">
                                  {idx + 1}
                                </div>
                              </div>
                              <div className="flex-1 pb-4">
                                <div className="text-sm font-medium text-gray-900">{track.context}</div>
                                {track.location && (
                                  <div className="mt-1 text-xs text-gray-500">{track.location}</div>
                                )}
                                <div className="mt-1 text-xs text-gray-400">{track.time}</div>
                              </div>
                            </div>
                          ))}
                        </div>
                      </div>
                    ) : (
                      <div className="rounded-lg bg-yellow-50 p-3 text-sm text-yellow-800">
                        {trackingResult.message || '暂无物流信息'}
                      </div>
                    )}
                  </div>
                ) : (
                  <div className="rounded-lg bg-red-50 p-4 text-center">
                    <p className="text-sm text-red-800">{trackingResult.message || '查询失败'}</p>
                    <button
                      onClick={() => handleOpenBaidu(trackingModal.trackingNo, trackingModal.carrier)}
                      className="mt-3 rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700"
                    >
                      在官网/百度查询
                    </button>
                  </div>
                )
              ) : (
                <div className="py-8 text-center text-gray-500">暂无查询结果</div>
              )}
            </div>

            <div className="border-t border-gray-200 px-6 py-4">
              <div className="flex justify-end gap-3">
                <button
                  onClick={() => handleOpenBaidu(trackingModal.trackingNo, trackingModal.carrier)}
                  className="rounded-lg border border-gray-300 bg-white px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50"
                >
                  在官网/百度查询
                </button>
                <button
                  onClick={() => {
                    setTrackingModal({ open: false, trackingNo: '' });
                    setTrackingResult(null);
                  }}
                  className="rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700"
                >
                  关闭
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

