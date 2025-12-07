'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { authApi } from '@/lib/auth';
import api from '@/lib/api';
import { getProxiedImageUrl } from '@/lib/utils/image-proxy';
import { handleImageError, handleVideoError } from '@/lib/utils/image-placeholder';
import TrackingNumberLink from '@/components/TrackingNumberLink';

export default function ShipmentsPage() {
  const router = useRouter();
  const [awards, setAwards] = useState<any[]>([]);
  const [orders, setOrders] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [sourceType, setSourceType] = useState<'rfq' | 'inventory'>('rfq'); // 数据源类型：询价单发货 / 现货订单
  const [previewImage, setPreviewImage] = useState<{ url: string; isVideo: boolean } | null>(null);
  const [showCancelDialog, setShowCancelDialog] = useState<{ awardId: string; award: any } | null>(null);
  const [cancelReason, setCancelReason] = useState('');
  const [cancelAction, setCancelAction] = useState<'CANCEL' | 'SWITCH_TO_ECOMMERCE' | 'REASSIGN'>('CANCEL');
  const [cancelling, setCancelling] = useState(false);
  const [recreating, setRecreating] = useState(false);
  const [converting, setConverting] = useState(false);
  const [syncingAll, setSyncingAll] = useState(false);
  const [uploadingPayment, setUploadingPayment] = useState<string | null>(null); // 正在上传付款截图的发货单ID

  useEffect(() => {
    const user = authApi.getCurrentUser();
    if (!user) {
      router.push('/login');
      return;
    }

    // 允许管理员 / 采购员 / 门店 用户访问发货管理页面
    if (user.role !== 'ADMIN' && user.role !== 'BUYER' && user.role !== 'STORE') {
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

    // 优化：先显示页面，再延迟加载数据（提升首次渲染速度）
    setLoading(false);
    setTimeout(() => {
      // 优先加载关键数据（中标订单），其他数据延迟加载
      fetchAwards().then(() => {
        // 延迟加载订单数据（不阻塞首次渲染）
        setTimeout(() => {
          fetchOrders().catch((error) => {
            console.error('获取订单数据失败:', error);
          });
        }, 200);
      }).catch((error) => {
        console.error('获取中标订单数据失败:', error);
      });
    }, 100);

    // 检查 URL 参数，如果有 awardId，则滚动到对应的中标卡片
    const urlParams = new URLSearchParams(window.location.search);
    const awardId = urlParams.get('awardId');
    if (awardId) {
      setTimeout(() => {
        const element = document.getElementById(`award-${awardId}`);
        if (element) {
          element.scrollIntoView({ behavior: 'smooth', block: 'center' });
          element.classList.add('ring-2', 'ring-blue-500', 'ring-offset-2');
          setTimeout(() => {
            element.classList.remove('ring-2', 'ring-blue-500', 'ring-offset-2');
          }, 3000);
        }
      }, 500);
    }
  }, [router]);

  // 处理 ESC 关闭预览
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
      const awardsArray = Array.isArray(awardsData) ? awardsData : [];
      console.log('📦 获取到的中标订单数据:', { count: awardsArray.length, data: awardsArray });
      setAwards(awardsArray);
    } catch (error: any) {
      console.error('获取中标订单失败:', error);
      setAwards([]);
    }
  };

  const fetchOrders = async () => {
    try {
      const response = await api.get('/orders');
      const ordersData = response.data.data || response.data || [];
      const ordersArray = Array.isArray(ordersData) ? ordersData : [];
      // 只显示从库存下单的订单（source: 'ECOMMERCE'）
      const inventoryOrders = ordersArray.filter((order: any) => order.source === 'ECOMMERCE');
      console.log('📦 获取到的订单数据:', { count: inventoryOrders.length, data: inventoryOrders });
      setOrders(inventoryOrders);
    } catch (error: any) {
      console.error('获取订单失败:', error);
      setOrders([]);
    }
    // 注意：不再在这里设置 loading，由 fetchAwards 统一管理
  };

  // 上传付款截图（现货订单）
  const handleUploadPaymentScreenshot = async (shipmentId: string, file: File) => {
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

      setUploadingPayment(shipmentId);
      const formData = new FormData();
      formData.append('file', file);

      await api.post(`/shipments/${shipmentId}/payment-screenshot`, formData, {
        headers: {
          'Content-Type': 'multipart/form-data',
        },
      });

      alert('付款截图上传成功，订单状态已更新为已结算');
      await fetchOrders();
    } catch (error: any) {
      console.error('上传付款截图失败:', error);
      const errorMessage = error.response?.data?.message || error.message || '上传失败';
      alert(`上传失败: ${errorMessage}`);
    } finally {
      setUploadingPayment(null);
    }
  };

  const handleSyncTrackingToOrder = async (orderNo: string, trackingNo: string, carrier?: string) => {
    if (!confirm(`确认将物流单号 ${trackingNo} 同步到订单 ${orderNo} 吗？`)) {
      return;
    }

    try {
      await api.post('/orders/sync-tracking', {
        orderNo,
        trackingNo,
        carrier,
      });
      alert('同步成功');
      await fetchOrders();
    } catch (error: any) {
      console.error('同步物流单号失败:', error);
      alert(error.response?.data?.message || '同步失败');
    }
  };

  const handleSyncAllTrackingToOrders = async () => {
    if (!confirm('确认要将所有物流单号同步到订单系统吗？')) {
      return;
    }

    setSyncingAll(true);
    try {
      let syncedCount = 0;
      let failedCount = 0;

      for (const award of awards) {
        if (award.quote?.items) {
          for (const quoteItem of award.quote.items) {
            const rfqItem = quoteItem.rfqItem;
            const shipment = award.shipments?.find((s: any) => s.rfqItemId === rfqItem?.id);
            
            if (shipment?.trackingNo && rfqItem?.orderNo) {
              try {
                await handleSyncTrackingToOrder(rfqItem.orderNo, shipment.trackingNo, shipment.carrier);
                syncedCount++;
              } catch (error) {
                failedCount++;
              }
            }
          }
        }
      }

      alert(`同步完成：成功 ${syncedCount} 条，失败 ${failedCount} 条`);
      await fetchOrders();
    } catch (error: any) {
      console.error('批量同步失败:', error);
      alert('批量同步失败');
    } finally {
      setSyncingAll(false);
    }
  };

  const handleCancelAward = async () => {
    if (!showCancelDialog) return;

    if (!cancelReason.trim()) {
      alert('请填写取消原因');
      return;
    }

    setCancelling(true);
    try {
      if (cancelAction === 'CANCEL') {
        await api.post(`/awards/${showCancelDialog.awardId}/cancel`, {
          reason: cancelReason,
        });
        alert('中标已取消');
      } else if (cancelAction === 'SWITCH_TO_ECOMMERCE') {
        await handleConvertToEcommerce(showCancelDialog.awardId);
        return;
      } else if (cancelAction === 'REASSIGN') {
        await handleRecreateRfq(showCancelDialog.awardId);
        return;
      }
      setShowCancelDialog(null);
      setCancelReason('');
      await fetchAwards();
    } catch (error: any) {
      console.error('取消中标失败:', error);
      alert(error.response?.data?.message || '取消失败');
    } finally {
      setCancelling(false);
    }
  };

  const handleRecreateRfq = async (awardId: string) => {
    if (!confirm('确认要重新创建询价单吗？')) {
      return;
    }

    setRecreating(true);
    try {
      await api.post(`/awards/${awardId}/recreate-rfq`, {});
      alert('已重新创建询价单');
      await fetchAwards();
    } catch (error: any) {
      console.error('重新创建询价单失败:', error);
      alert(error.response?.data?.message || '创建失败');
    } finally {
      setRecreating(false);
    }
  };

  const handleConvertToEcommerce = async (awardId: string) => {
    if (
      !confirm(
        '确认要将该缺货商品改为电商平台采购吗？\n\n' +
          '转换后需要在电商采购订单页面补充物流单号和成交价格。',
      )
    ) {
      return;
    }

    setConverting(true);
    try {
      await api.post(`/awards/${awardId}/convert-to-ecommerce`, {});
      alert('已转换为电商采购，请在电商采购订单页面补全物流信息和金额。');
      await fetchAwards();
    } catch (error: any) {
      console.error('转换为电商采购失败:', error);
      alert(error.response?.data?.message || '转换失败');
    } finally {
      setConverting(false);
    }
  };

  const getAwardStatusBadge = (award: any) => {
    const status = award.status || 'ACTIVE';
    const statusMap: Record<
      string,
      {
        label: string;
        bg: string;
        text: string;
      }
    > = {
      ACTIVE: { label: '有效', bg: 'bg-green-100', text: 'text-green-800' },
      OUT_OF_STOCK: { label: '缺货', bg: 'bg-orange-100', text: 'text-orange-800' },
      CANCELLED: { label: '已取消', bg: 'bg-red-100', text: 'text-red-800' },
    };
    const style = statusMap[status] || statusMap.ACTIVE;
    return (
      <span className={`inline-flex rounded-full px-2 py-1 text-xs font-semibold ${style.bg} ${style.text}`}>
        {style.label}
      </span>
    );
  };

  const getItemStatusBadge = (itemStatus: string) => {
    const statusMap: Record<
      string,
      {
        label: string;
        bg: string;
        text: string;
      }
    > = {
      PENDING: { label: '待报价', bg: 'bg-gray-100', text: 'text-gray-800' },
      QUOTED: { label: '已报价', bg: 'bg-blue-100', text: 'text-blue-800' },
      AWARDED: { label: '已中标', bg: 'bg-green-100', text: 'text-green-800' },
      OUT_OF_STOCK: { label: '缺货', bg: 'bg-orange-100', text: 'text-orange-800' },
      CANCELLED: { label: '已取消', bg: 'bg-red-100', text: 'text-red-800' },
      SHIPPED: { label: '已发货', bg: 'bg-purple-100', text: 'text-purple-800' },
      ECOMMERCE_PENDING: { label: '电商待支付', bg: 'bg-yellow-100', text: 'text-yellow-800' },
      ECOMMERCE_PAID: { label: '电商已支付', bg: 'bg-amber-100', text: 'text-amber-800' },
      ECOMMERCE_SHIPPED: { label: '电商已发货', bg: 'bg-indigo-100', text: 'text-indigo-800' },
    };
    const style = statusMap[itemStatus] || statusMap.PENDING;
    return (
      <span className={`inline-flex rounded-full px-2 py-1 text-xs font-semibold ${style.bg} ${style.text}`}>
        {style.label}
      </span>
    );
  };

  const getOrderStatusBadge = (order: any) => {
    // 检查是否有结算记录
    const hasSettlement = order.shipments?.some((shipment: any) => 
      shipment.settlements?.some((settlement: any) => settlement.qrCodeUrl)
    );
    
    if (hasSettlement) {
      return (
        <span className="inline-flex rounded-full px-3 py-1 text-xs font-semibold bg-green-100 text-green-800">
          已结算
        </span>
      );
    }

    const status = order.status || 'PENDING';
    const statusMap: Record<string, { bg: string; text: string }> = {
      PENDING: { bg: 'bg-yellow-100', text: 'text-yellow-800' },
      PROCESSING: { bg: 'bg-blue-100', text: 'text-blue-800' },
      SHIPPED: { bg: 'bg-purple-100', text: 'text-purple-800' },
      DELIVERED: { bg: 'bg-green-100', text: 'text-green-800' },
      CANCELLED: { bg: 'bg-red-100', text: 'text-red-800' },
    };
    const style = statusMap[status] || { bg: 'bg-gray-100', text: 'text-gray-800' };
    return (
      <span className={`inline-flex rounded-full px-3 py-1 text-xs font-semibold ${style.bg} ${style.text}`}>
        {status === 'PENDING' ? '待发货' : 
         status === 'SHIPPED' ? '已发货' : 
         status === 'DELIVERED' ? '已送达' : 
         status === 'CANCELLED' ? '已取消' : status}
      </span>
    );
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
        <div className="mb-6 flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold text-gray-900">发货与订单管理</h1>
            <p className="mt-1 text-sm text-gray-600">查看供应商上传的物流单号、收款二维码和订单信息</p>
          </div>
          {sourceType === 'rfq' && (
            <button
              onClick={handleSyncAllTrackingToOrders}
              disabled={syncingAll}
              className="px-4 py-2 bg-green-600 text-white rounded-lg hover:bg-green-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors flex items-center gap-2"
            >
              {syncingAll ? (
                <>
                  <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-white"></div>
                  <span>同步中...</span>
                </>
              ) : (
                <>
                  <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      strokeWidth={2}
                      d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15"
                    />
                  </svg>
                  <span>一键同步到订单系统</span>
                </>
              )}
            </button>
          )}
        </div>

        {/* 标签页切换 */}
        <div className="mb-6 flex gap-2 border-b border-gray-200">
          <button
            onClick={() => setSourceType('rfq')}
            className={`px-4 py-2 text-sm font-medium transition-colors ${
              sourceType === 'rfq'
                ? 'border-b-2 border-blue-600 text-blue-600'
                : 'text-gray-600 hover:text-gray-900'
            }`}
          >
            询价单发货 ({awards.length})
          </button>
          <button
            onClick={() => setSourceType('inventory')}
            className={`px-4 py-2 text-sm font-medium transition-colors ${
              sourceType === 'inventory'
                ? 'border-b-2 border-blue-600 text-blue-600'
                : 'text-gray-600 hover:text-gray-900'
            }`}
          >
            现货订单 ({orders.length})
          </button>
        </div>

        {/* 询价单发货内容 */}
        {sourceType === 'rfq' ? (
          awards.length === 0 ? (
            <div className="rounded-lg bg-white p-12 text-center shadow-sm">
              <p className="text-gray-500">暂无中标订单</p>
            </div>
          ) : (
            <div className="space-y-6">
              {awards.map((award) => (
                <div key={award.id} id={`award-${award.id}`} className="rounded-lg bg-white p-6 shadow-sm transition-all">
                  {/* 询价单信息 */}
                  <div className="mb-4 border-b border-gray-200 pb-4">
                    <div className="flex items-center justify-between">
                      <div>
                        <div className="flex items-center gap-2">
                          <h2 className="text-lg font-semibold text-gray-900">
                            {award.rfq?.rfqNo} - {award.rfq?.title}
                          </h2>
                          {getAwardStatusBadge(award)}
                        </div>
                        <p className="mt-1 text-sm text-gray-600">供应商：{award.supplier?.username}</p>
                        <p className="mt-1 text-sm text-gray-600">
                          中标时间：{award.awardedAt ? new Date(award.awardedAt).toLocaleString('zh-CN') : '-'}
                        </p>
                      </div>
                      <div className="flex items-center gap-4">
                        <div className="text-right">
                          <div className="text-2xl font-bold text-green-600">
                            ￥{Number(award.finalPrice || award.quote?.price || 0).toFixed(2)}
                          </div>
                          <div className="text-sm text-gray-600">中标金额</div>
                        </div>
                      </div>
                    </div>
                  </div>

                  {/* 收款二维码 */}
                  {award.paymentQrCodeUrl && (
                    <div className="mb-4 rounded-lg border border-gray-200 bg-gray-50 p-4">
                      <label className="mb-2 block text-sm font-medium text-gray-700">收款二维码</label>
                      <div className="flex items-center gap-4">
                        <img
                          src={getProxiedImageUrl(award.paymentQrCodeUrl)}
                          alt="收款二维码"
                          className="h-32 w-32 rounded border border-green-200 cursor-pointer hover:opacity-80 transition-opacity"
                          onClick={() =>
                            setPreviewImage({
                              url: getProxiedImageUrl(award.paymentQrCodeUrl),
                              isVideo: false,
                            })
                          }
                          onError={(e) => {
                            console.error('收款二维码加载失败:', award.paymentQrCodeUrl);
                            handleImageError(e);
                          }}
                          loading="lazy"
                          title="点击查看大图"
                        />
                        <div className="text-sm text-gray-600">
                          <p>供应商已上传收款二维码。</p>
                          <p className="mt-1 text-xs text-gray-500">
                            上传时间：{award.updatedAt ? new Date(award.updatedAt).toLocaleString('zh-CN') : '-'}
                          </p>
                        </div>
                      </div>
                    </div>
                  )}

                  {/* 中标商品列表 */}
                  <div className="space-y-4">
                    <h3 className="text-sm font-semibold text-gray-900">中标商品明细</h3>
                    {award.quote?.items?.map((quoteItem: any) => {
                      const rfqItem = quoteItem.rfqItem;
                      const shipments = award.shipments?.filter((s: any) => s.rfqItemId === rfqItem?.id) || [];
                      const shipment = shipments.find((s: any) => s.shipmentNo?.startsWith('REPLACE-')) || shipments[0];
                      const packages = shipment?.packages || [];
                      const shipmentPhotos = packages.flatMap((pkg: any) => pkg.photos || []);

                      return (
                        <div key={quoteItem.id} className="rounded-lg border border-gray-200 bg-gray-50 p-4">
                          <div className="mb-3 flex items-start justify-between">
                            <div className="flex-1">
                              <div className="flex items-center gap-2">
                                <h4 className="font-medium text-gray-900">{rfqItem?.productName}</h4>
                                {rfqItem?.itemStatus && getItemStatusBadge(rfqItem.itemStatus)}
                              </div>
                              <p className="mt-1 text-sm text-gray-600">
                                数量：{rfqItem?.quantity} {rfqItem?.unit || '件'}
                              </p>
                              <p className="mt-1 text-sm text-gray-600">
                                单价：￥{Number(quoteItem.price).toFixed(2)}/{rfqItem?.unit || '件'}
                              </p>
                              <p className="mt-1 text-sm font-medium text-blue-600">
                                小计：￥{(Number(quoteItem.price) * (rfqItem?.quantity || 1)).toFixed(2)}
                              </p>
                            </div>
                          </div>

                          {/* 物流信息 */}
                          {shipment && (
                            <div className="mb-3 rounded bg-white p-3">
                              <label className="mb-2 block text-sm font-medium text-gray-700">物流信息</label>
                              {shipment.trackingNo ? (
                                <div className="space-y-2">
                                  <div className="flex items-center gap-2 text-sm">
                                    <span className="font-medium text-gray-700">快递单号：</span>
                                    <TrackingNumberLink trackingNo={shipment.trackingNo} carrier={shipment.carrier} />
                                    {shipment.carrier && (
                                      <span className="text-gray-600">({shipment.carrier})</span>
                                    )}
                                  </div>
                                  {shipment.status && (
                                    <div className="text-sm text-gray-600">
                                      状态：{shipment.status === 'SHIPPED' ? '已发货' : shipment.status === 'IN_TRANSIT' ? '运输中' : shipment.status === 'DELIVERED' ? '已送达' : shipment.status === 'RECEIVED' ? '已签收' : shipment.status}
                                    </div>
                                  )}
                                </div>
                              ) : (
                                <p className="text-sm text-gray-500">暂无物流信息</p>
                              )}

                              {/* 快递面单 */}
                              {packages.length > 0 && packages[0].labelUrl && (
                                <div className="mt-3">
                                  <div className="mb-2 text-sm font-medium text-gray-700">快递面单：</div>
                                  <div
                                    className="relative cursor-pointer overflow-hidden rounded-lg border border-gray-200 bg-gray-100"
                                    onClick={() =>
                                      setPreviewImage({
                                        url: getProxiedImageUrl(packages[0].labelUrl),
                                        isVideo: false,
                                      })
                                    }
                                  >
                                    <img
                                      src={getProxiedImageUrl(packages[0].labelUrl)}
                                      alt="快递面单"
                                      className="h-auto w-full max-w-xs object-contain"
                                      onError={handleImageError}
                                    />
                                  </div>
                                </div>
                              )}

                              {/* 发货照片 */}
                              {shipmentPhotos.length > 0 && (
                                <div className="mt-3">
                                  <div className="mb-2 text-sm font-medium text-gray-700">发货照片/视频：</div>
                                  <div className="grid grid-cols-3 gap-2">
                                    {shipmentPhotos.map((photo: string, index: number) => {
                                      const isVideo = photo.toLowerCase().match(/\.(mp4|avi|mov|wmv)$/i);
                                      const photoUrl = getProxiedImageUrl(photo);
                                      return (
                                        <div
                                          key={index}
                                          className="relative aspect-square cursor-pointer overflow-hidden rounded-lg border border-gray-200 bg-gray-100"
                                          onClick={() => setPreviewImage({ url: photoUrl, isVideo: !!isVideo })}
                                        >
                                          {isVideo ? (
                                            <video src={photoUrl} className="h-full w-full object-cover" controls onError={handleVideoError} />
                                          ) : (
                                            <img src={photoUrl} alt={`发货照片 ${index + 1}`} className="h-full w-full object-cover" onError={handleImageError} />
                                          )}
                                        </div>
                                      );
                                    })}
                                  </div>
                                </div>
                              )}
                            </div>
                          )}
                        </div>
                      );
                    })}
                  </div>
                </div>
              ))}
            </div>
          )
        ) : (
          /* 现货订单内容 */
          orders.length === 0 ? (
            <div className="rounded-lg bg-white p-12 text-center shadow-sm">
              <p className="text-gray-500">暂无现货订单</p>
            </div>
          ) : (
            <div className="grid gap-4 sm:grid-cols-1 lg:grid-cols-2 xl:grid-cols-3">
              {orders.map((order) => {
                const shipment = order.shipments?.[0];
                const settlement = shipment?.settlements?.[0];
                const hasPaymentScreenshot = settlement?.qrCodeUrl;

                return (
                  <div key={order.id} className="group rounded-xl bg-white p-6 shadow-sm transition-all hover:shadow-lg">
                    <div className="flex items-start justify-between">
                      <div className="flex-1">
                        <div className="mb-3 flex items-center gap-2">
                          <div className="rounded-lg bg-purple-50 p-2">
                            <svg className="h-5 w-5 text-purple-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
                            </svg>
                          </div>
                          <div>
                            <h3 className="font-semibold text-gray-900">{order.orderNo || order.id}</h3>
                            {order.orderTime && (
                              <p className="text-xs text-gray-500">
                                {new Date(order.orderTime).toLocaleString('zh-CN', {
                                  year: 'numeric',
                                  month: '2-digit',
                                  day: '2-digit',
                                  hour: '2-digit',
                                  minute: '2-digit',
                                })}
                              </p>
                            )}
                          </div>
                        </div>

                        <div className="space-y-2">
                          <div className="flex items-center gap-2 text-sm">
                            <svg className="h-4 w-4 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M20 7l-8-4-8 4m16 0l-8 4m8-4v10l-8 4m0-10L4 7m8 4v10M4 7v10l8 4" />
                            </svg>
                            <span className="font-medium text-gray-900">{order.productName || '未知商品'}</span>
                            <span className="text-lg font-bold text-blue-600">¥{order.price || 0}</span>
                          </div>

                          <div className="flex items-center gap-2 text-sm text-gray-600">
                            <svg className="h-4 w-4 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z" />
                            </svg>
                            <span>{order.recipient || '未知'}</span>
                          </div>

                          {order.phone && (
                            <div className="flex items-center gap-2 text-sm text-gray-600">
                              <svg className="h-4 w-4 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 5a2 2 0 012-2h3.28a1 1 0 01.948.684l1.498 4.493a1 1 0 01-.502 1.21l-2.257 1.13a11.042 11.042 0 005.516 5.516l1.13-2.257a1 1 0 011.21-.502l4.493 1.498a1 1 0 01.684.949V19a2 2 0 01-2 2h-1C9.716 21 3 14.284 3 6V5z" />
                              </svg>
                              <span>{order.phone}</span>
                            </div>
                          )}

                          {order.address && (
                            <div className="flex items-start gap-2 text-sm text-gray-600">
                              <svg className="mt-0.5 h-4 w-4 flex-shrink-0 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17.657 16.657L13.414 20.9a1.998 1.998 0 01-2.827 0l-4.244-4.243a8 8 0 1111.314 0z" />
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 11a3 3 0 11-6 0 3 3 0 016 0z" />
                              </svg>
                              <span className="line-clamp-2">{order.address}</span>
                            </div>
                          )}
                        </div>

                        {/* 发货信息 */}
                        {shipment && (
                          <div className="mt-4 border-t border-gray-200 pt-4">
                            {shipment.trackingNo && (
                              <div className="mb-3 flex items-center gap-2 text-sm">
                                <svg className="h-4 w-4 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M20 13V6a2 2 0 00-2-2H6a2 2 0 00-2 2v7m16 0v5a2 2 0 01-2 2H6a2 2 0 01-2-2v-5m16 0h-2.586a1 1 0 00-.707.293l-2.414 2.414a1 1 0 01-.707.293h-3.172a1 1 0 01-.707-.293l-2.414-2.414A1 1 0 006.586 13H4" />
                                </svg>
                                <span className="font-medium text-gray-700">快递单号：</span>
                                <TrackingNumberLink trackingNo={shipment.trackingNo} carrier={shipment.carrier} />
                                {shipment.carrier && (
                                  <span className="text-gray-600">({shipment.carrier})</span>
                                )}
                              </div>
                            )}

                            {/* 付款截图上传 */}
                            {shipment.trackingNo && (
                              <div className="mt-3">
                                {hasPaymentScreenshot ? (
                                  <div className="rounded-lg border border-gray-200 bg-gray-50 p-3">
                                    <div className="mb-2 text-sm font-medium text-gray-700">付款截图：</div>
                                    <div className="flex items-center gap-3">
                                      <img
                                        src={getProxiedImageUrl(settlement.qrCodeUrl)}
                                        alt="付款截图"
                                        className="h-24 w-24 rounded border border-green-200 cursor-pointer hover:opacity-80 transition-opacity"
                                        onClick={() =>
                                          setPreviewImage({
                                            url: getProxiedImageUrl(settlement.qrCodeUrl),
                                            isVideo: false,
                                          })
                                        }
                                        onError={handleImageError}
                                        loading="lazy"
                                        title="点击查看大图"
                                      />
                                      <div className="flex-1 text-xs text-gray-600">
                                        <p className="font-medium text-green-600">已上传付款截图</p>
                                        <p className="mt-1">
                                          {settlement.paidAt
                                            ? new Date(settlement.paidAt).toLocaleString('zh-CN')
                                            : settlement.updatedAt
                                            ? new Date(settlement.updatedAt).toLocaleString('zh-CN')
                                            : '-'}
                                        </p>
                                      </div>
                                    </div>
                                  </div>
                                ) : (
                                  <div className="rounded-lg border border-dashed border-gray-300 bg-gray-50 p-3">
                                    <label className="block cursor-pointer text-sm font-medium text-gray-700">
                                      <input
                                        type="file"
                                        accept="image/*"
                                        className="hidden"
                                        onChange={(e) => {
                                          if (e.target.files && e.target.files[0]) {
                                            handleUploadPaymentScreenshot(shipment.id, e.target.files[0]);
                                            e.target.value = '';
                                          }
                                        }}
                                        disabled={uploadingPayment === shipment.id}
                                      />
                                      <div className="flex items-center gap-2">
                                        {uploadingPayment === shipment.id ? (
                                          <>
                                            <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-blue-600"></div>
                                            <span className="text-sm text-gray-600">上传中...</span>
                                          </>
                                        ) : (
                                          <>
                                            <svg className="h-5 w-5 text-blue-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
                                            </svg>
                                            <span className="text-sm text-blue-600">上传付款截图</span>
                                          </>
                                        )}
                                      </div>
                                      <p className="mt-1 text-xs text-gray-500">上传后订单状态将更新为已结算</p>
                                    </label>
                                  </div>
                                )}
                              </div>
                            )}

                            {/* 快递面单和发货照片 */}
                            {shipment.packages && shipment.packages.length > 0 && (
                              <>
                                {shipment.packages[0].labelUrl && (
                                  <div className="mt-3">
                                    <div className="mb-2 text-sm font-medium text-gray-700">快递面单：</div>
                                    <div
                                      className="relative cursor-pointer overflow-hidden rounded-lg border border-gray-200 bg-gray-100"
                                      onClick={() =>
                                        setPreviewImage({
                                          url: getProxiedImageUrl(shipment.packages[0].labelUrl),
                                          isVideo: false,
                                        })
                                      }
                                    >
                                      <img
                                        src={getProxiedImageUrl(shipment.packages[0].labelUrl)}
                                        alt="快递面单"
                                        className="h-auto w-full object-contain"
                                        onError={handleImageError}
                                      />
                                    </div>
                                  </div>
                                )}

                                {shipment.packages.flatMap((pkg: any) => {
                                  const photos = Array.isArray(pkg.photos) ? pkg.photos : [];
                                  return photos.map((photo: string, index: number) => {
                                    const isVideo = photo.toLowerCase().match(/\.(mp4|avi|mov|wmv)$/i);
                                    const photoUrl = getProxiedImageUrl(photo);
                                    return { photoUrl, isVideo, index, pkgId: pkg.id };
                                  });
                                }).length > 0 && (
                                  <div className="mt-3">
                                    <div className="mb-2 text-sm font-medium text-gray-700">发货照片/视频：</div>
                                    <div className="grid grid-cols-3 gap-2">
                                      {shipment.packages.flatMap((pkg: any) => {
                                        const photos = Array.isArray(pkg.photos) ? pkg.photos : [];
                                        return photos.map((photo: string, index: number) => {
                                          const isVideo = photo.toLowerCase().match(/\.(mp4|avi|mov|wmv)$/i);
                                          const photoUrl = getProxiedImageUrl(photo);
                                          return (
                                            <div
                                              key={`${pkg.id}-${index}`}
                                              className="relative aspect-square cursor-pointer overflow-hidden rounded-lg border border-gray-200 bg-gray-100"
                                              onClick={() => setPreviewImage({ url: photoUrl, isVideo: !!isVideo })}
                                            >
                                              {isVideo ? (
                                                <video src={photoUrl} className="h-full w-full object-cover" controls onError={handleVideoError} />
                                              ) : (
                                                <img src={photoUrl} alt={`发货照片 ${index + 1}`} className="h-full w-full object-cover" onError={handleImageError} />
                                              )}
                                            </div>
                                          );
                                        });
                                      })}
                                    </div>
                                  </div>
                                )}
                              </>
                            )}
                          </div>
                        )}
                      </div>

                      <div className="ml-4">
                        {getOrderStatusBadge(order)}
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          )
        )}
      </div>

      {/* 媒体预览模态框 */}
      {previewImage && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black bg-opacity-75 p-4"
          onClick={() => setPreviewImage(null)}
        >
          <div className="relative max-h-full max-w-full">
            <button
              onClick={() => setPreviewImage(null)}
              className="absolute -right-12 top-0 text-white hover:text-gray-300"
            >
              <svg className="h-8 w-8" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
            {previewImage.isVideo ? (
              <video
                src={previewImage.url}
                controls
                autoPlay
                className="max-h-[90vh] max-w-[90vw]"
                onClick={(e) => e.stopPropagation()}
                onError={handleVideoError}
              />
            ) : (
              <img
                src={previewImage.url}
                alt="预览"
                className="max-h-[90vh] max-w-[90vw]"
                onClick={(e) => e.stopPropagation()}
                onError={handleImageError}
              />
            )}
          </div>
        </div>
      )}

      {/* 取消中标对话框 */}
      {showCancelDialog && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black bg-opacity-50">
          <div className="rounded-lg bg-white p-6 shadow-xl max-w-md w-full mx-4">
            <h3 className="text-lg font-semibold text-gray-900 mb-4">取消中标</h3>
            <div className="mb-4">
              <label className="block text-sm font-medium text-gray-700 mb-2">取消原因</label>
              <textarea
                value={cancelReason}
                onChange={(e) => setCancelReason(e.target.value)}
                className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm"
                rows={3}
                placeholder="请填写取消原因..."
              />
            </div>
            <div className="flex gap-2">
              <button
                onClick={() => {
                  setShowCancelDialog(null);
                  setCancelReason('');
                }}
                className="flex-1 rounded-lg bg-gray-300 px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-400"
              >
                取消
              </button>
              <button
                onClick={handleCancelAward}
                disabled={cancelling}
                className="flex-1 rounded-lg bg-red-600 px-4 py-2 text-sm font-medium text-white hover:bg-red-700 disabled:opacity-50"
              >
                {cancelling ? '处理中...' : '确认取消'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
