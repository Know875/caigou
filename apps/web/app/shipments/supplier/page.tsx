'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { authApi } from '@/lib/auth';
import api from '@/lib/api';
import { getProxiedImageUrl } from '@/lib/utils/image-proxy';
import { handleImageError, handleVideoError } from '@/lib/utils/image-placeholder';
import TrackingNumberLink from '@/components/TrackingNumberLink';

interface SupplierOrder {
  id: string;
  orderNo: string;
  orderTime: string;
  recipient: string;
  phone: string;
  address: string;
  productName: string;
  price: number;
  quantity: number;
  status: string;
  source?: string;
  shipments: Array<{
    id: string;
    shipmentNo: string;
    trackingNo?: string;
    carrier?: string;
    status: string;
    packages: Array<{
      id: string;
      photos: any;
    }>;
  }>;
  store?: {
    id: string;
    name: string;
    code: string;
  };
}

export default function SupplierShipmentsPage() {
  const router = useRouter();
  const [awards, setAwards] = useState<any[]>([]);
  const [orders, setOrders] = useState<SupplierOrder[]>([]);
  const [loading, setLoading] = useState(true);
  const [sourceType, setSourceType] = useState<'rfq' | 'inventory'>('rfq'); // 新增：数据源类型标签
  const [activeTab, setActiveTab] = useState<'all' | 'pending' | 'shipped' | 'delivered'>('all');
  const [statusFilter, setStatusFilter] = useState<string>(''); // 新增：库存订单状态筛选
  const [previewImage, setPreviewImage] = useState<{ url: string; isVideo: boolean } | null>(null);
  const [editingAward, setEditingAward] = useState<string | null>(null);
  const [editingShipment, setEditingShipment] = useState<string | null>(null); // 新增：编辑库存订单发货单
  const [trackingForm, setTrackingForm] = useState<{
    rfqItemId: string;
    trackingNo: string;
    carrier: string;
  }>({ rfqItemId: '', trackingNo: '', carrier: '' });
  const [orderTrackingForm, setOrderTrackingForm] = useState<{ // 新增：库存订单快递单号表单
    trackingNo: string;
    carrier: string;
  }>({ trackingNo: '', carrier: '' });
  const [uploadingPhoto, setUploadingPhoto] = useState<string | null>(null);

  useEffect(() => {
    const user = authApi.getCurrentUser();
    if (!user) {
      router.push('/login');
      return;
    }

    if (user.role !== 'SUPPLIER') {
      router.push('/dashboard');
      return;
    }

    // 根据 URL 参数决定加载哪个标签页
    if (typeof window !== 'undefined') {
      const urlParams = new URLSearchParams(window.location.search);
      const tab = urlParams.get('tab');
      if (tab === 'orders' || tab === 'inventory') {
        setSourceType('inventory');
      }
    }

    fetchAwards();
    fetchOrders();
  }, [router]);

  // 处理 ESC 键关闭预览
  useEffect(() => {
    const handleEscape = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && previewImage) {
        setPreviewImage(null);
      }
    };
    window.addEventListener('keydown', handleEscape);
    return () => window.removeEventListener('keydown', handleEscape);
  }, [previewImage]);

  const fetchAwards = async () => {
    try {
      const response = await api.get('/awards');
      const awardsData = response.data.data || response.data || [];
      setAwards(Array.isArray(awardsData) ? awardsData : []);
    } catch (error: any) {
      console.error('获取发货单失败:', error);
      setAwards([]);
    } finally {
      if (sourceType === 'rfq') {
        setLoading(false);
      }
    }
  };

  const fetchOrders = async () => {
    try {
      const params = new URLSearchParams();
      if (statusFilter) params.append('status', statusFilter);
      
      const response = await api.get(`/orders/supplier/orders?${params.toString()}`);
      const data = response.data.data || response.data || [];
      setOrders(Array.isArray(data) ? data : []);
    } catch (error: any) {
      console.error('获取订单失败:', error);
      setOrders([]);
    } finally {
      if (sourceType === 'inventory') {
        setLoading(false);
      }
    }
  };

  // 当状态筛选改变时重新获取订单
  useEffect(() => {
    if (sourceType === 'inventory' && !loading) {
      fetchOrders();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [statusFilter, sourceType]);

  // 根据状态筛选发货单
  const filteredAwards = awards.filter((award: any) => {
    if (activeTab === 'all') return true;
    
    // 检查所有商品的状态
    const items = award.quote?.items || [];
    if (items.length === 0) return false;
    
    if (activeTab === 'pending') {
      // 待发货：没有物流单号或状态为 PENDING
      return items.some((item: any) => {
        const shipment = award.shipments?.find((s: any) => s.rfqItemId === item.rfqItem?.id);
        return !shipment?.trackingNo || shipment?.status === 'PENDING';
      });
    }
    
    if (activeTab === 'shipped') {
      // 已发货：有物流单号且状态为 SHIPPED 或 IN_TRANSIT
      return items.some((item: any) => {
        const shipment = award.shipments?.find((s: any) => s.rfqItemId === item.rfqItem?.id);
        return shipment?.trackingNo && (shipment?.status === 'SHIPPED' || shipment?.status === 'IN_TRANSIT');
      });
    }
    
    if (activeTab === 'delivered') {
      // 已送达：状态为 DELIVERED 或 RECEIVED
      return items.some((item: any) => {
        const shipment = award.shipments?.find((s: any) => s.rfqItemId === item.rfqItem?.id);
        return shipment?.status === 'DELIVERED' || shipment?.status === 'RECEIVED';
      });
    }
    
    return true;
  });

  // 统计信息 - 询价单发货
  const rfqStats = {
    total: awards.length,
    pending: awards.filter((award: any) => {
      const items = award.quote?.items || [];
      return items.some((item: any) => {
        const shipment = award.shipments?.find((s: any) => s.rfqItemId === item.rfqItem?.id);
        return !shipment?.trackingNo || shipment?.status === 'PENDING';
      });
    }).length,
    shipped: awards.filter((award: any) => {
      const items = award.quote?.items || [];
      return items.some((item: any) => {
        const shipment = award.shipments?.find((s: any) => s.rfqItemId === item.rfqItem?.id);
        return shipment?.trackingNo && (shipment?.status === 'SHIPPED' || shipment?.status === 'IN_TRANSIT');
      });
    }).length,
    delivered: awards.filter((award: any) => {
      const items = award.quote?.items || [];
      return items.some((item: any) => {
        const shipment = award.shipments?.find((s: any) => s.rfqItemId === item.rfqItem?.id);
        return shipment?.status === 'DELIVERED' || shipment?.status === 'RECEIVED';
      });
    }).length,
  };

  // 统计信息 - 库存订单
  const orderStats = {
    total: orders.length,
    pending: orders.filter((order: SupplierOrder) => {
      const shipment = order.shipments?.[0];
      return !shipment?.trackingNo || shipment?.status === 'PENDING';
    }).length,
    shipped: orders.filter((order: SupplierOrder) => {
      const shipment = order.shipments?.[0];
      return shipment?.trackingNo && (shipment?.status === 'SHIPPED' || shipment?.status === 'IN_TRANSIT');
    }).length,
    delivered: orders.filter((order: SupplierOrder) => {
      const shipment = order.shipments?.[0];
      return shipment?.status === 'DELIVERED' || shipment?.status === 'RECEIVED';
    }).length,
  };

  // 根据当前数据源类型选择统计信息
  const stats = sourceType === 'rfq' ? rfqStats : orderStats;

  const handleSaveTracking = async (awardId: string, rfqItemId: string) => {
    if (!trackingForm.trackingNo.trim()) {
      alert('请输入物流单号');
      return;
    }

    try {
      await api.post(`/awards/${awardId}/tracking`, {
        rfqItemId,
        trackingNo: trackingForm.trackingNo.trim(),
        carrier: trackingForm.carrier.trim() || undefined,
      });
      
      setEditingAward(null);
      setTrackingForm({ rfqItemId: '', trackingNo: '', carrier: '' });
      await fetchAwards();
      alert('物流单号保存成功');
    } catch (error: any) {
      console.error('保存物流单号失败:', error);
      alert('保存失败：' + (error.response?.data?.message || error.message));
    }
  };

  const handleUploadLabel = async (awardId: string, rfqItemId: string, file: File) => {
    try {
      // 前端文件验证
      if (!file) {
        alert('请选择要上传的文件');
        return;
      }

      // 验证文件类型（只允许图片）
      const allowedImageTypes = ['image/jpeg', 'image/png', 'image/gif', 'image/webp', 'image/bmp'];
      if (!allowedImageTypes.includes(file.type)) {
        alert(`不支持的文件类型: ${file.type}。仅支持图片格式: ${allowedImageTypes.join(', ')}`);
        return;
      }

      // 验证文件大小（最大 10MB）
      const maxSize = 10 * 1024 * 1024; // 10MB
      if (file.size > maxSize) {
        alert(`文件大小超过限制（最大 ${maxSize / 1024 / 1024}MB）`);
        return;
      }

      // 检查是否已有发货单
      const award = awards.find(a => a.id === awardId);
      const shipment = award?.shipments?.find((s: any) => s.rfqItemId === rfqItemId);

      let shipmentId: string;

      if (shipment && shipment.id) {
        shipmentId = shipment.id;
      } else {
        try {
          // 创建临时发货单
          const tempTrackingNo = `TEMP-${Date.now()}`;
          const response = await api.post(`/awards/${awardId}/tracking`, {
            rfqItemId,
            trackingNo: tempTrackingNo,
            carrier: '',
          });
          
          const shipmentData = response.data.data || response.data;
          shipmentId = shipmentData.id || shipmentData.shipmentId;
          
          if (!shipmentId) {
            throw new Error('无法获取发货单ID');
          }
        } catch (createError: any) {
          console.error('创建发货单失败:', createError);
          const errorMsg = createError.response?.data?.message || createError.message || '创建发货单失败';
          alert(`创建发货单失败: ${errorMsg}`);
          return;
        }
      }

      // 上传面单进行OCR识别
      const formData = new FormData();
      formData.append('file', file);

      // 文件上传 + OCR 识别需要更长时间，设置 90 秒超时
      await api.post(`/shipments/${shipmentId}/upload-label`, formData, {
        timeout: 90000, // 90秒超时（文件上传 + OCR 识别）
        headers: {
          'Content-Type': 'multipart/form-data',
        },
      });
      await fetchAwards();
      alert('面单上传成功，系统正在识别运单号...');
    } catch (error: any) {
      console.error('上传面单失败:', error);
      
      // 提取错误信息
      let errorMessage = '上传失败';
      
      if (error.response) {
        // 服务器返回的错误
        const status = error.response.status;
        const data = error.response.data;
        
        if (data?.message) {
          errorMessage = data.message;
        } else if (status === 400) {
          errorMessage = '请求参数错误，请检查文件格式和大小';
        } else if (status === 401) {
          errorMessage = '未授权，请重新登录';
        } else if (status === 403) {
          errorMessage = '无权操作此发货单';
        } else if (status === 404) {
          errorMessage = '发货单不存在';
        } else if (status === 413) {
          errorMessage = '文件太大，请选择小于 10MB 的文件';
        } else if (status >= 500) {
          errorMessage = '服务器错误，请稍后重试';
        } else {
          errorMessage = `上传失败 (${status})`;
        }
      } else if (error.request) {
        // 请求已发出但没有收到响应
        if (error.code === 'ECONNABORTED') {
          errorMessage = '上传超时，请检查网络连接后重试';
        } else {
          errorMessage = '网络错误，请检查网络连接';
        }
      } else {
        // 其他错误
        errorMessage = error.message || '未知错误';
      }
      
      alert(`上传失败: ${errorMessage}`);
    }
  };

  const handleUploadShipmentPhoto = async (awardId: string, rfqItemId: string, file: File) => {
    try {
      const formData = new FormData();
      formData.append('file', file);
      formData.append('rfqItemId', rfqItemId);

      await api.post(`/awards/${awardId}/shipment-photos`, formData);
      await fetchAwards();
      alert('发货照片上传成功');
    } catch (error: any) {
      console.error('上传发货照片失败:', error);
      alert('上传失败：' + (error.response?.data?.message || error.message));
    }
  };

  // 库存订单相关处理函数
  const handleSaveOrderTracking = async (shipmentId: string) => {
    if (!orderTrackingForm.trackingNo.trim()) {
      alert('请输入快递单号');
      return;
    }

    try {
      await api.patch(`/shipments/${shipmentId}/tracking`, {
        trackingNo: orderTrackingForm.trackingNo.trim(),
        carrier: orderTrackingForm.carrier.trim() || undefined,
      });
      
      setOrderTrackingForm({ trackingNo: '', carrier: '' });
      setEditingShipment(null);
      await fetchOrders();
      alert('快递单号保存成功');
    } catch (error: any) {
      console.error('保存快递单号失败:', error);
      alert('保存失败：' + (error.response?.data?.message || error.message));
    }
  };

  /**
   * 上传快递面单（OCR识别）- 库存订单
   * 参考报价管理模块的实现方式
   */
  const handleUploadOrderLabel = async (shipmentId: string, file: File) => {
    try {
      // 前端文件验证
      if (!file) {
        alert('请选择要上传的文件');
        return;
      }

      // 验证文件类型（只允许图片）
      const allowedImageTypes = ['image/jpeg', 'image/png', 'image/gif', 'image/webp', 'image/bmp'];
      if (!allowedImageTypes.includes(file.type)) {
        alert(`不支持的文件类型: ${file.type}。仅支持图片格式: ${allowedImageTypes.join(', ')}`);
        return;
      }

      // 验证文件大小（最大 10MB）
      const maxSize = 10 * 1024 * 1024; // 10MB
      if (file.size > maxSize) {
        alert(`文件大小超过限制（最大 ${maxSize / 1024 / 1024}MB）`);
        return;
      }

      // 上传面单进行OCR识别
      const formData = new FormData();
      formData.append('file', file);

      console.log('📋 [前端] 上传快递面单（OCR识别）- 库存订单:', {
        shipmentId,
        fileName: file.name,
        fileSize: file.size,
        fileType: file.type,
      });

      // 文件上传 + OCR 识别需要更长时间，设置 90 秒超时
      const response = await api.post(`/shipments/${shipmentId}/upload-label`, formData, {
        timeout: 90000, // 90秒超时（文件上传 + OCR 识别）
        headers: {
          'Content-Type': 'multipart/form-data',
        },
      });
      
      const result = response.data.data || response.data;
      const ocrResult = result.trackingExtract;
      
      // 调试：打印返回的数据结构
      console.log('📋 OCR识别结果（库存订单）:', {
        result,
        ocrResult,
        autoFilled: result.autoFilled,
        trackingNo: ocrResult?.trackingNo,
      });
      
      // 先刷新数据，确保获取最新的运单号（如果后端已自动填充）
      await fetchOrders();
      
      // 如果识别到运单号
      if (ocrResult?.trackingNo) {
        if (result.autoFilled) {
          // 如果后端已经自动填充成功，直接刷新数据即可，不需要打开编辑模式
          // 等待一小段时间，确保状态更新完成
          await new Promise(resolve => setTimeout(resolve, 200));
          // 再次刷新数据，确保显示最新状态
          await fetchOrders();
          alert(`✅ OCR识别成功！\n\n运单号：${ocrResult.trackingNo}\n快递公司：${ocrResult.carrier || '未识别'}\n置信度：${(ocrResult.confidence * 100).toFixed(1)}%\n识别方式：${ocrResult.method}\n\n已自动回填到发货单`);
        } else {
          // 如果后端没有自动填充（如运单号已被使用或置信度较低），打开编辑模式让用户确认
          await new Promise(resolve => setTimeout(resolve, 100));
          setEditingShipment(shipmentId);
          setOrderTrackingForm({
            trackingNo: ocrResult.trackingNo,
            carrier: ocrResult.carrier || '',
          });
          alert(`⚠️ OCR识别到运单号：${ocrResult.trackingNo}\n快递公司：${ocrResult.carrier || '未识别'}\n置信度：${(ocrResult.confidence * 100).toFixed(1)}%\n识别方式：${ocrResult.method}\n\n注意：该运单号可能已被其他发货单使用，请确认后保存`);
        }
      } else {
        // OCR识别失败，提示用户手动输入
        alert('❌ OCR识别失败，未能识别到运单号。\n请手动输入物流单号。');
        // 打开编辑模式，方便用户手动输入
        setEditingShipment(shipmentId);
        setOrderTrackingForm({
          trackingNo: '',
          carrier: '',
        });
      }
    } catch (error: any) {
      console.error('上传面单失败（库存订单）:', error);
      console.error('错误详情:', {
        message: error.message,
        response: error.response?.data,
        status: error.response?.status,
      });
      
      // 提取错误信息
      let errorMessage = '上传失败';
      
      if (error.response) {
        // 服务器返回的错误
        const status = error.response.status;
        const data = error.response.data;
        
        if (data?.message) {
          errorMessage = data.message;
        } else if (status === 400) {
          errorMessage = '请求参数错误，请检查文件格式和大小';
        } else if (status === 401) {
          errorMessage = '未授权，请重新登录';
        } else if (status === 403) {
          errorMessage = '无权操作此发货单';
        } else if (status === 404) {
          errorMessage = '发货单不存在';
        } else if (status === 413) {
          errorMessage = '文件太大，请选择小于 10MB 的文件';
        } else if (status >= 500) {
          errorMessage = '服务器错误，请稍后重试';
        } else {
          errorMessage = `上传失败 (${status})`;
        }
      } else if (error.request) {
        // 请求已发出但没有收到响应
        if (error.code === 'ECONNABORTED') {
          errorMessage = '上传超时，请检查网络连接后重试';
        } else {
          errorMessage = '网络错误，请检查网络连接';
        }
      } else {
        // 其他错误
        errorMessage = error.message || '未知错误';
      }
      
      alert(`上传失败: ${errorMessage}`);
    }
  };

  const handleUploadOrderPhoto = async (shipmentId: string, file: File) => {
    setUploadingPhoto(shipmentId);
    try {
      const formData = new FormData();
      formData.append('file', file);

      await api.post(`/shipments/${shipmentId}/photos`, formData);
      await fetchOrders();
      alert('发货照片/视频上传成功');
    } catch (error: any) {
      console.error('上传发货照片/视频失败:', error);
      alert('上传失败：' + (error.response?.data?.message || error.message));
    } finally {
      setUploadingPhoto(null);
    }
  };

  // 根据状态筛选库存订单
  const filteredOrders = orders.filter((order: SupplierOrder) => {
    if (statusFilter) {
      const shipment = order.shipments?.[0];
      if (!shipment) return statusFilter === 'PENDING';
      return shipment.status === statusFilter;
    }
    return true;
  });

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

  return (
    <div className="min-h-screen bg-gray-50 pb-20 sm:pb-8">
      <div className="mx-auto max-w-7xl px-3 py-4 sm:px-4 sm:py-6 lg:px-8 lg:py-8">
        {/* 头部 */}
        <div className="mb-6 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <h1 className="text-2xl font-bold text-gray-900 sm:text-3xl">发货管理</h1>
            <p className="mt-1 text-sm text-gray-600">管理您的发货单和物流信息</p>
          </div>
          <button
            onClick={() => {
              if (sourceType === 'rfq') {
                fetchAwards();
              } else {
                fetchOrders();
              }
            }}
            className="h-11 min-w-[44px] rounded-lg bg-blue-600 px-4 text-sm font-medium text-white hover:bg-blue-700 active:bg-blue-800 sm:h-10"
          >
            刷新
          </button>
        </div>

        {/* 数据源类型标签页 */}
        <div className="mb-6 border-b border-gray-200">
          <nav className="-mb-px flex space-x-4 sm:space-x-8" aria-label="Source Tabs">
            {[
              { id: 'rfq', label: '询价单发货', count: rfqStats.total },
              { id: 'inventory', label: '库存订单', count: orderStats.total },
            ].map((tab) => (
              <button
                key={tab.id}
                onClick={() => {
                  setSourceType(tab.id as 'rfq' | 'inventory');
                  setActiveTab('all');
                  setStatusFilter('');
                  // 更新 URL 参数
                  const newUrl = tab.id === 'inventory' 
                    ? '/shipments/supplier?tab=orders'
                    : '/shipments/supplier';
                  window.history.pushState({}, '', newUrl);
                }}
                className={`min-h-[44px] flex-1 whitespace-nowrap border-b-2 px-2 py-3 text-sm font-medium sm:flex-none sm:px-1 sm:py-4 ${
                  sourceType === tab.id
                    ? 'border-blue-500 text-blue-600'
                    : 'border-transparent text-gray-500 hover:border-gray-300 hover:text-gray-700 active:text-gray-700'
                }`}
              >
                {tab.label}
                {tab.count > 0 && (
                  <span className={`ml-2 rounded-full px-2 py-0.5 text-xs ${
                    sourceType === tab.id ? 'bg-blue-100 text-blue-600' : 'bg-gray-100 text-gray-600'
                  }`}>
                    {tab.count}
                  </span>
                )}
              </button>
            ))}
          </nav>
        </div>

        {/* 统计卡片 */}
        <div className="mb-6 grid grid-cols-2 gap-3 sm:grid-cols-4 sm:gap-4">
          <div className="rounded-lg bg-white p-4 shadow-sm">
            <div className="text-sm text-gray-600">全部订单</div>
            <div className="mt-1 text-2xl font-bold text-gray-900">{stats.total}</div>
          </div>
          <div className="rounded-lg bg-white p-4 shadow-sm">
            <div className="text-sm text-gray-600">待发货</div>
            <div className="mt-1 text-2xl font-bold text-orange-600">{stats.pending}</div>
          </div>
          <div className="rounded-lg bg-white p-4 shadow-sm">
            <div className="text-sm text-gray-600">已发货</div>
            <div className="mt-1 text-2xl font-bold text-blue-600">{stats.shipped}</div>
          </div>
          <div className="rounded-lg bg-white p-4 shadow-sm">
            <div className="text-sm text-gray-600">已送达</div>
            <div className="mt-1 text-2xl font-bold text-green-600">{stats.delivered}</div>
          </div>
        </div>

        {/* 状态标签页 - 仅询价单发货显示 */}
        {sourceType === 'rfq' && (
          <div className="mb-6 border-b border-gray-200">
            <nav className="-mb-px flex space-x-4 sm:space-x-8" aria-label="Status Tabs">
              {[
                { id: 'all', label: '全部', count: stats.total },
                { id: 'pending', label: '待发货', count: stats.pending },
                { id: 'shipped', label: '已发货', count: stats.shipped },
                { id: 'delivered', label: '已送达', count: stats.delivered },
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
                  {tab.count > 0 && (
                    <span className={`ml-2 rounded-full px-2 py-0.5 text-xs ${
                      activeTab === tab.id ? 'bg-blue-100 text-blue-600' : 'bg-gray-100 text-gray-600'
                    }`}>
                      {tab.count}
                    </span>
                  )}
                </button>
              ))}
            </nav>
          </div>
        )}

        {/* 状态筛选 - 仅库存订单显示 */}
        {sourceType === 'inventory' && (
          <div className="mb-6 flex items-center gap-4">
            <select
              value={statusFilter}
              onChange={(e) => {
                setStatusFilter(e.target.value);
              }}
              className="rounded-lg border border-gray-300 px-4 py-2 focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-500"
            >
              <option value="">全部状态</option>
              <option value="PENDING">待发货</option>
              <option value="SHIPPED">已发货</option>
              <option value="IN_TRANSIT">运输中</option>
              <option value="DELIVERED">已送达</option>
            </select>
            <div className="text-sm text-gray-600">
              共 {filteredOrders.length} 个订单
            </div>
          </div>
        )}

        {/* 内容区域 */}
        {sourceType === 'rfq' ? (
          /* 询价单发货列表 */
          filteredAwards.length === 0 ? (
          <div className="rounded-xl bg-white p-12 text-center shadow-sm">
            <div className="mx-auto mb-4 flex h-16 w-16 items-center justify-center rounded-full bg-gray-100">
              <svg className="h-8 w-8 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M20 7l-8-4-8 4m16 0l-8 4m8-4v10l-8 4m0-10L4 7m8 4v10M4 7v10l8 4" />
              </svg>
            </div>
            <h3 className="mb-2 text-lg font-semibold text-gray-900">暂无发货单</h3>
            <p className="text-sm text-gray-500">
              {activeTab === 'all' ? '您还没有中标任何订单' : `暂无${activeTab === 'pending' ? '待发货' : activeTab === 'shipped' ? '已发货' : '已送达'}的订单`}
            </p>
          </div>
        ) : (
          <div className="space-y-4">
            {filteredAwards.map((award: any) => {
              const items = award.quote?.items || [];
              const totalAmount = items.reduce((sum: number, item: any) => {
                return sum + (Number(item.price) || 0) * (item.rfqItem?.quantity || 1);
              }, 0);

              return (
                <div key={award.id} className="rounded-xl bg-white p-4 shadow-sm sm:p-6">
                  {/* 订单头部 */}
                  <div className="mb-4 flex flex-col gap-2 border-b border-gray-200 pb-4 sm:flex-row sm:items-center sm:justify-between">
                    <div>
                      <div className="flex items-center gap-2">
                        <h3 className="text-base font-semibold text-gray-900 sm:text-lg">
                          询价单：{award.rfq?.rfqNo || 'N/A'}
                        </h3>
                        <span className="rounded-full bg-green-100 px-2 py-0.5 text-xs font-medium text-green-800">
                          中标
                        </span>
                      </div>
                      <p className="mt-1 text-xs text-gray-600 sm:text-sm">
                        中标金额：<span className="font-semibold text-green-600">¥{totalAmount.toFixed(2)}</span>
                      </p>
                    </div>
                    <div className="text-xs text-gray-500 sm:text-sm">
                      {new Date(award.awardedAt || award.createdAt).toLocaleString('zh-CN')}
                    </div>
                  </div>

                  {/* 商品列表 */}
                  <div className="space-y-4">
                    {items.map((quoteItem: any) => {
                      const rfqItem = quoteItem.rfqItem;
                      if (!rfqItem) return null;

                      const shipment = award.shipments?.find((s: any) => s.rfqItemId === rfqItem.id);
                      const packageRecord = shipment?.packages?.[0];
                      const shipmentPhotos = packageRecord?.photos || [];
                      const isEditing = editingAward === award.id && trackingForm.rfqItemId === rfqItem.id;

                      return (
                        <div key={quoteItem.id} className="rounded-lg border border-gray-200 p-3 sm:p-4">
                          {/* 商品信息 */}
                          <div className="mb-3 flex items-start justify-between">
                            <div className="flex-1">
                              <div className="text-sm font-semibold text-gray-900 sm:text-base">
                                {rfqItem.productName} × {rfqItem.quantity}
                              </div>
                              <div className="mt-1 text-xs text-gray-600 sm:text-sm">
                                单价：¥{quoteItem.price} | 小计：¥{(Number(quoteItem.price) * (rfqItem.quantity || 1)).toFixed(2)}
                              </div>
                            </div>
                            {shipment?.status && (
                              <span className={`ml-2 rounded-full px-2 py-0.5 text-xs font-medium ${
                                shipment.status === 'PENDING' ? 'bg-orange-100 text-orange-800' :
                                shipment.status === 'SHIPPED' || shipment.status === 'IN_TRANSIT' ? 'bg-blue-100 text-blue-800' :
                                shipment.status === 'DELIVERED' || shipment.status === 'RECEIVED' ? 'bg-green-100 text-green-800' :
                                'bg-gray-100 text-gray-800'
                              }`}>
                                {shipment.status === 'PENDING' ? '待发货' :
                                 shipment.status === 'SHIPPED' ? '已发货' :
                                 shipment.status === 'IN_TRANSIT' ? '运输中' :
                                 shipment.status === 'DELIVERED' ? '已送达' :
                                 shipment.status === 'RECEIVED' ? '已签收' :
                                 shipment.status}
                              </span>
                            )}
                          </div>

                          {/* 订单信息 - 只有中标后才能看到 */}
                          {rfqItem?.orderInfo && (
                            <div className="mb-3 rounded-lg bg-blue-50 p-3 text-sm">
                              <p className="mb-2 font-medium text-gray-700">收货信息：</p>
                              <div className="grid grid-cols-1 gap-2 text-xs text-gray-600 sm:grid-cols-2">
                                <div>
                                  <span className="font-medium">订单号：</span>
                                  {rfqItem.orderInfo.orderNo}
                                </div>
                                <div>
                                  <span className="font-medium">收件人：</span>
                                  {rfqItem.orderInfo.recipient}
                                </div>
                                <div>
                                  <span className="font-medium">手机：</span>
                                  {rfqItem.orderInfo.phone}
                                </div>
                                <div className="sm:col-span-2">
                                  <span className="font-medium">地址：</span>
                                  {rfqItem.orderInfo.modifiedAddress || rfqItem.orderInfo.address || '-'}
                                </div>
                                {rfqItem.orderInfo.modifiedAddress && rfqItem.orderInfo.modifiedAddress !== rfqItem.orderInfo.address && (
                                  <div className="col-span-2 text-orange-600">
                                    <span className="font-medium">原地址：</span>
                                    {rfqItem.orderInfo.address}
                                  </div>
                                )}
                                {rfqItem.orderInfo.userNickname && (
                                  <div>
                                    <span className="font-medium">用户昵称：</span>
                                    {rfqItem.orderInfo.userNickname}
                                  </div>
                                )}
                                {rfqItem.orderInfo.orderTime && (
                                  <div>
                                    <span className="font-medium">下单时间：</span>
                                    {new Date(rfqItem.orderInfo.orderTime).toLocaleString('zh-CN')}
                                  </div>
                                )}
                              </div>
                            </div>
                          )}

                          {/* 物流单号 */}
                          <div className="mb-3">
                            <label className="mb-1 block text-xs font-medium text-gray-700 sm:text-sm">
                              物流单号
                            </label>
                            {isEditing ? (
                              <div className="space-y-2">
                                <input
                                  type="text"
                                  placeholder="物流单号"
                                  value={trackingForm.trackingNo}
                                  onChange={(e) => setTrackingForm({ ...trackingForm, trackingNo: e.target.value })}
                                  className="w-full rounded-lg border border-gray-300 px-3 py-2.5 text-base !text-gray-900 !bg-white shadow-sm focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-0"
                                  autoFocus
                                />
                                <input
                                  type="text"
                                  placeholder="快递公司（可选）"
                                  value={trackingForm.carrier}
                                  onChange={(e) => setTrackingForm({ ...trackingForm, carrier: e.target.value })}
                                  className="w-full rounded-lg border border-gray-300 px-3 py-2.5 text-base !text-gray-900 !bg-white shadow-sm focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-0"
                                />
                                <div className="flex gap-2">
                                  <button
                                    onClick={() => handleSaveTracking(award.id, rfqItem.id)}
                                    className="flex-1 rounded-lg bg-blue-600 px-4 py-2.5 text-sm font-medium text-white hover:bg-blue-700 active:bg-blue-800"
                                  >
                                    保存
                                  </button>
                                  <button
                                    onClick={() => {
                                      setEditingAward(null);
                                      setTrackingForm({ rfqItemId: '', trackingNo: '', carrier: '' });
                                    }}
                                    className="flex-1 rounded-lg bg-gray-300 px-4 py-2.5 text-sm font-medium text-gray-700 hover:bg-gray-400 active:bg-gray-500"
                                  >
                                    取消
                                  </button>
                                </div>
                              </div>
                            ) : (
                              <div className="space-y-2">
                                {shipment?.trackingNo ? (
                                  <div className="rounded-lg bg-gray-50 p-3">
                                    <div className="flex items-center gap-2 flex-wrap text-sm text-gray-900">
                                      <span className="font-medium">单号：</span>
                                      {shipment?.shipmentNo?.startsWith('REPLACE-') && (
                                        <span className="inline-flex items-center rounded-full bg-green-100 px-2 py-0.5 text-xs font-medium text-green-800">
                                          🔄 换货
                                        </span>
                                      )}
                                      <TrackingNumberLink
                                        trackingNo={shipment.trackingNo}
                                        carrier={shipment.carrier}
                                      />
                                    </div>
                                    {shipment.carrier && (
                                      <div className="mt-1 text-sm text-gray-600">
                                        <span className="font-medium">快递：</span>
                                        {shipment.carrier}
                                      </div>
                                    )}
                                    <div className="mt-2 flex gap-2">
                                      <button
                                        onClick={() => {
                                          setEditingAward(award.id);
                                          setTrackingForm({
                                            rfqItemId: rfqItem.id,
                                            trackingNo: shipment.trackingNo || '',
                                            carrier: shipment.carrier || '',
                                          });
                                        }}
                                        className="flex-1 rounded-lg bg-blue-600 px-3 py-2 text-xs font-medium text-white hover:bg-blue-700 active:bg-blue-800 sm:text-sm"
                                      >
                                        修改
                                      </button>
                                      <label className="flex-1 cursor-pointer rounded-lg bg-green-600 px-3 py-2 text-center text-xs font-medium text-white hover:bg-green-700 active:bg-green-800 sm:text-sm">
                                        <input
                                          type="file"
                                          accept="image/*"
                                          className="hidden"
                                          onChange={(e) => {
                                            if (e.target.files && e.target.files[0]) {
                                              handleUploadLabel(award.id, rfqItem.id, e.target.files[0]);
                                              e.target.value = '';
                                            }
                                          }}
                                        />
                                        重新识别
                                      </label>
                                    </div>
                                  </div>
                                ) : (
                                  <div className="space-y-2">
                                    <button
                                      onClick={() => {
                                        setEditingAward(award.id);
                                        setTrackingForm({ rfqItemId: rfqItem.id, trackingNo: '', carrier: '' });
                                      }}
                                      className="w-full rounded-lg bg-yellow-600 px-4 py-2.5 text-sm font-medium text-white hover:bg-yellow-700 active:bg-yellow-800"
                                    >
                                      手动输入物流单号
                                    </button>
                                    <label className="block w-full cursor-pointer rounded-lg bg-green-600 px-4 py-2.5 text-center text-sm font-medium text-white hover:bg-green-700 active:bg-green-800">
                                      <input
                                        type="file"
                                        accept="image/*"
                                        className="hidden"
                                        onChange={(e) => {
                                          if (e.target.files && e.target.files[0]) {
                                            handleUploadLabel(award.id, rfqItem.id, e.target.files[0]);
                                            e.target.value = '';
                                          }
                                        }}
                                      />
                                      📷 上传面单（OCR识别）
                                    </label>
                                    <p className="text-xs text-gray-500">
                                      上传快递面单图片，系统将自动识别运单号和快递公司
                                    </p>
                                  </div>
                                )}
                              </div>
                            )}
                          </div>

                          {/* 发货照片 */}
                          <div>
                            <label className="mb-2 block text-xs font-medium text-gray-700 sm:text-sm">
                              发货照片/视频
                            </label>
                            {shipmentPhotos.length > 0 ? (
                              <div className="mb-2 grid grid-cols-3 gap-2">
                                {shipmentPhotos.map((photoUrl: string, index: number) => {
                                  const isVideo = photoUrl.match(/\.(mp4|avi|mov|wmv)$/i);
                                  return (
                                    <div
                                      key={index}
                                      className="relative group cursor-pointer"
                                      onClick={() => setPreviewImage({ url: getProxiedImageUrl(photoUrl), isVideo: !!isVideo })}
                                    >
                                      {isVideo ? (
                                        <video src={photoUrl} className="h-20 w-full rounded border object-cover" controls onError={handleVideoError} />
                                      ) : (
                                        <>
                                          <img
                                            src={getProxiedImageUrl(photoUrl)}
                                            alt={`发货照片 ${index + 1}`}
                                            className="h-20 w-full rounded border object-cover hover:opacity-80 transition-opacity"
                                            loading="lazy"
                                            onError={handleImageError}
                                          />
                                          <div className="absolute inset-0 bg-black bg-opacity-0 group-hover:bg-opacity-10 transition-all flex items-center justify-center">
                                            <span className="text-white text-xs opacity-0 group-hover:opacity-100">点击查看大图</span>
                                          </div>
                                        </>
                                      )}
                                    </div>
                                  );
                                })}
                              </div>
                            ) : (
                              <div className="mb-2 text-xs text-gray-500">
                                {shipment ? '暂无照片' : '请先上传物流单号'}
                              </div>
                            )}
                            {shipment && (
                              <input
                                type="file"
                                accept="image/*,video/*"
                                onChange={(e) => {
                                  if (e.target.files && e.target.files[0]) {
                                    handleUploadShipmentPhoto(award.id, rfqItem.id, e.target.files[0]);
                                  }
                                }}
                                className="block w-full text-xs text-gray-600 file:mr-2 file:rounded file:border-0 file:bg-green-50 file:px-2 file:py-1 file:text-xs file:font-semibold file:text-green-700 hover:file:bg-green-100"
                              />
                            )}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>
              );
            })}
          </div>
        )
        ) : (
          /* 库存订单列表 */
          filteredOrders.length === 0 ? (
            <div className="rounded-xl bg-white p-12 text-center shadow-sm">
              <div className="mx-auto mb-4 flex h-16 w-16 items-center justify-center rounded-full bg-gray-100">
                <svg className="h-8 w-8 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2" />
                </svg>
              </div>
              <h3 className="mb-2 text-lg font-semibold text-gray-900">暂无订单</h3>
              <p className="text-sm text-gray-500">
                {statusFilter ? `暂无${statusFilter === 'PENDING' ? '待发货' : statusFilter === 'SHIPPED' ? '已发货' : statusFilter === 'IN_TRANSIT' ? '运输中' : '已送达'}的订单` : '您还没有从库存下单的订单'}
              </p>
            </div>
          ) : (
            <div className="space-y-4">
              {filteredOrders.map((order: SupplierOrder) => {
                const shipment = order.shipments?.[0];
                const isEditing = editingShipment === shipment?.id;
                
                return (
                  <div key={order.id} className="rounded-xl bg-white p-4 shadow-sm sm:p-6">
                    {/* 订单头部 */}
                    <div className="mb-4 flex flex-col gap-2 border-b border-gray-200 pb-4 sm:flex-row sm:items-center sm:justify-between">
                      <div>
                        <div className="flex items-center gap-2">
                          <h3 className="text-base font-semibold text-gray-900 sm:text-lg">{order.productName}</h3>
                          <span className="rounded-full bg-purple-100 px-2 py-0.5 text-xs font-medium text-purple-800">
                            库存订单
                          </span>
                        </div>
                        <p className="mt-1 text-xs text-gray-600 sm:text-sm">
                          订单号：{order.orderNo}
                        </p>
                        {order.store && (
                          <p className="mt-1 text-xs text-gray-600 sm:text-sm">
                            门店：{order.store.name} ({order.store.code})
                          </p>
                        )}
                        <p className="mt-1 text-xs text-gray-600 sm:text-sm">
                          金额：<span className="font-semibold text-green-600">¥{Number(order.price).toFixed(2)} × {order.quantity}</span>
                        </p>
                      </div>
                      <div className="text-xs text-gray-500 sm:text-sm">
                        {new Date(order.orderTime).toLocaleString('zh-CN')}
                      </div>
                    </div>

                    {/* 收件人信息 */}
                    <div className="mb-4 rounded-lg bg-gray-50 p-3 sm:p-4">
                      <h4 className="mb-2 text-xs font-semibold text-gray-700 sm:text-sm">收件人信息</h4>
                      <div className="grid grid-cols-1 gap-2 text-xs text-gray-600 sm:grid-cols-3 sm:text-sm">
                        <div>
                          <span className="font-medium">收件人：</span>
                          {order.recipient}
                        </div>
                        <div>
                          <span className="font-medium">手机号：</span>
                          {order.phone}
                        </div>
                        <div className="sm:col-span-3">
                          <span className="font-medium">地址：</span>
                          {order.address}
                        </div>
                      </div>
                    </div>

                    {/* 发货信息 */}
                    <div className="border-t border-gray-200 pt-4">
                      {shipment ? (
                        <>
                          <div className="mb-3 flex items-center justify-between">
                            <h4 className="text-xs font-semibold text-gray-700 sm:text-sm">发货信息</h4>
                            {shipment.status && (
                              <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${
                                shipment.status === 'PENDING' ? 'bg-orange-100 text-orange-800' :
                                shipment.status === 'SHIPPED' || shipment.status === 'IN_TRANSIT' ? 'bg-blue-100 text-blue-800' :
                                shipment.status === 'DELIVERED' || shipment.status === 'RECEIVED' ? 'bg-green-100 text-green-800' :
                                'bg-gray-100 text-gray-800'
                              }`}>
                                {shipment.status === 'PENDING' ? '待发货' :
                                 shipment.status === 'SHIPPED' ? '已发货' :
                                 shipment.status === 'IN_TRANSIT' ? '运输中' :
                                 shipment.status === 'DELIVERED' ? '已送达' :
                                 shipment.status === 'RECEIVED' ? '已签收' :
                                 shipment.status}
                              </span>
                            )}
                          </div>

                          {/* 物流单号 */}
                          <div className="mb-3">
                            <label className="mb-1 block text-xs font-medium text-gray-700 sm:text-sm">
                              物流单号
                            </label>
                            {isEditing ? (
                              <div className="space-y-2">
                                <input
                                  type="text"
                                  placeholder="物流单号"
                                  value={orderTrackingForm.trackingNo}
                                  onChange={(e) => setOrderTrackingForm({ ...orderTrackingForm, trackingNo: e.target.value })}
                                  className="w-full rounded-lg border border-gray-300 px-3 py-2.5 text-base !text-gray-900 !bg-white shadow-sm focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-0"
                                  autoFocus
                                />
                                <input
                                  type="text"
                                  placeholder="快递公司（可选）"
                                  value={orderTrackingForm.carrier}
                                  onChange={(e) => setOrderTrackingForm({ ...orderTrackingForm, carrier: e.target.value })}
                                  className="w-full rounded-lg border border-gray-300 px-3 py-2.5 text-base !text-gray-900 !bg-white shadow-sm focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-0"
                                />
                                <div className="flex gap-2">
                                  <button
                                    onClick={() => handleSaveOrderTracking(shipment.id)}
                                    className="flex-1 rounded-lg bg-blue-600 px-4 py-2.5 text-sm font-medium text-white hover:bg-blue-700 active:bg-blue-800"
                                  >
                                    保存
                                  </button>
                                  <button
                                    onClick={() => {
                                      setEditingShipment(null);
                                      setOrderTrackingForm({ trackingNo: '', carrier: '' });
                                    }}
                                    className="flex-1 rounded-lg bg-gray-300 px-4 py-2.5 text-sm font-medium text-gray-700 hover:bg-gray-400 active:bg-gray-500"
                                  >
                                    取消
                                  </button>
                                </div>
                              </div>
                            ) : (
                              <div className="space-y-2">
                                {shipment.trackingNo ? (
                                  <div className="rounded-lg bg-gray-50 p-3">
                                    <div className="flex items-center gap-2 flex-wrap text-sm text-gray-900">
                                      <span className="font-medium">单号：</span>
                                      <TrackingNumberLink
                                        trackingNo={shipment.trackingNo}
                                        carrier={shipment.carrier}
                                      />
                                    </div>
                                    {shipment.carrier && (
                                      <div className="mt-1 text-sm text-gray-600">
                                        <span className="font-medium">快递：</span>
                                        {shipment.carrier}
                                      </div>
                                    )}
                                    <div className="mt-2 flex gap-2">
                                      <button
                                        onClick={() => {
                                          setEditingShipment(shipment.id);
                                          setOrderTrackingForm({
                                            trackingNo: shipment.trackingNo || '',
                                            carrier: shipment.carrier || '',
                                          });
                                        }}
                                        className="flex-1 rounded-lg bg-blue-600 px-3 py-2 text-xs font-medium text-white hover:bg-blue-700 active:bg-blue-800 sm:text-sm"
                                      >
                                        修改
                                      </button>
                                      <label className="flex-1 cursor-pointer rounded-lg bg-green-600 px-3 py-2 text-center text-xs font-medium text-white hover:bg-green-700 active:bg-green-800 sm:text-sm">
                                        <input
                                          type="file"
                                          accept="image/*"
                                          className="hidden"
                                          onChange={(e) => {
                                            if (e.target.files && e.target.files[0]) {
                                              handleUploadOrderLabel(shipment.id, e.target.files[0]);
                                              e.target.value = '';
                                            }
                                          }}
                                        />
                                        重新识别
                                      </label>
                                    </div>
                                  </div>
                                ) : (
                                  <div className="space-y-2">
                                    <button
                                      onClick={() => {
                                        setEditingShipment(shipment.id);
                                        setOrderTrackingForm({ trackingNo: '', carrier: '' });
                                      }}
                                      className="w-full rounded-lg bg-yellow-600 px-4 py-2.5 text-sm font-medium text-white hover:bg-yellow-700 active:bg-yellow-800"
                                    >
                                      手动输入物流单号
                                    </button>
                                    <label className="block w-full cursor-pointer rounded-lg bg-green-600 px-4 py-2.5 text-center text-sm font-medium text-white hover:bg-green-700 active:bg-green-800">
                                      <input
                                        type="file"
                                        accept="image/*"
                                        className="hidden"
                                        onChange={(e) => {
                                          if (e.target.files && e.target.files[0]) {
                                            handleUploadOrderLabel(shipment.id, e.target.files[0]);
                                            e.target.value = '';
                                          }
                                        }}
                                      />
                                      📷 上传面单（OCR识别）
                                    </label>
                                    <p className="text-xs text-gray-500">
                                      上传快递面单图片，系统将自动识别运单号和快递公司
                                    </p>
                                  </div>
                                )}
                              </div>
                            )}
                          </div>

                          {/* 发货照片/视频 */}
                          <div>
                            <label className="mb-2 block text-xs font-medium text-gray-700 sm:text-sm">
                              发货照片/视频
                            </label>
                            {shipment.packages && shipment.packages.length > 0 && (
                              <div className="mb-2 grid grid-cols-3 gap-2">
                                {shipment.packages.flatMap((pkg) => {
                                  const photos = Array.isArray(pkg.photos) ? pkg.photos : [];
                                  return photos.map((photo: string, index: number) => {
                                    const isVideo = photo.toLowerCase().endsWith('.mp4') || 
                                                   photo.toLowerCase().endsWith('.mov') ||
                                                   photo.toLowerCase().endsWith('.avi');
                                    const photoUrl = getProxiedImageUrl(photo);
                                    
                                    return (
                                      <div
                                        key={`${pkg.id}-${index}`}
                                        className="relative group cursor-pointer"
                                        onClick={() => setPreviewImage({ url: photoUrl, isVideo })}
                                      >
                                        {isVideo ? (
                                          <video src={photoUrl} className="h-20 w-full rounded border object-cover" controls onError={handleVideoError} />
                                        ) : (
                                          <>
                                            <img
                                              src={photoUrl}
                                              alt={`发货照片 ${index + 1}`}
                                              className="h-20 w-full rounded border object-cover hover:opacity-80 transition-opacity"
                                              loading="lazy"
                                              onError={handleImageError}
                                            />
                                            <div className="absolute inset-0 bg-black bg-opacity-0 group-hover:bg-opacity-10 transition-all flex items-center justify-center">
                                              <span className="text-white text-xs opacity-0 group-hover:opacity-100">点击查看大图</span>
                                            </div>
                                          </>
                                        )}
                                      </div>
                                    );
                                  });
                                })}
                              </div>
                            )}
                            <input
                              type="file"
                              accept="image/*,video/*"
                              onChange={(e) => {
                                if (e.target.files && e.target.files[0]) {
                                  handleUploadOrderPhoto(shipment.id, e.target.files[0]);
                                }
                              }}
                              disabled={uploadingPhoto === shipment.id}
                              className="block w-full text-xs text-gray-600 file:mr-2 file:rounded file:border-0 file:bg-green-50 file:px-2 file:py-1 file:text-xs file:font-semibold file:text-green-700 hover:file:bg-green-100"
                            />
                          </div>
                        </>
                      ) : (
                        <div className="rounded-lg border border-yellow-200 bg-yellow-50 p-4">
                          <p className="text-sm text-yellow-800">
                            这是从库存下单的订单，请尽快发货并填写快递单号。如果看不到发货信息，请刷新页面或联系管理员。
                          </p>
                        </div>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          )
        )}
      </div>

      {/* 图片预览模态框 */}
      {previewImage && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black bg-opacity-75"
          onClick={() => setPreviewImage(null)}
        >
          <div className="relative max-h-[90vh] max-w-[90vw]">
            {previewImage.isVideo ? (
              <video src={previewImage.url} controls className="max-h-[90vh] max-w-[90vw] rounded-lg" onError={handleVideoError} />
            ) : (
              <img
                src={getProxiedImageUrl(previewImage.url)}
                alt="预览"
                className="max-h-[90vh] max-w-[90vw] rounded-lg object-contain"
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
  );
}

