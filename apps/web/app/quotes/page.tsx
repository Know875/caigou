'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { authApi } from '@/lib/auth';
import api from '@/lib/api';
import { getProxiedImageUrl } from '@/lib/utils/image-proxy';
import { handleImageError, handleVideoError } from '@/lib/utils/image-placeholder';
import type { RfqItem } from '@/types';

export default function QuotesPage() {
  const router = useRouter();
  const [quotes, setQuotes] = useState<any[]>([]);
  const [rfqs, setRfqs] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [activeTab, setActiveTab] = useState<'my-quotes' | 'available-rfqs'>('my-quotes');
  const [showQuoteForm, setShowQuoteForm] = useState(false);
  const [selectedRfq, setSelectedRfq] = useState<any>(null);
  const [isUpdatingQuote, setIsUpdatingQuote] = useState(false); // 是否是更新已有报价
  const [awards, setAwards] = useState<any[]>([]);
  const [editingAward, setEditingAward] = useState<string | null>(null);
  const [trackingForm, setTrackingForm] = useState<{
    rfqItemId: string;
    trackingNo: string;
    carrier: string;
  }>({ rfqItemId: '', trackingNo: '', carrier: '' });
  const [qrCodeFile, setQrCodeFile] = useState<File | null>(null);
  const [previewImage, setPreviewImage] = useState<{ url: string; isVideo: boolean } | null>(null);
  const [showOutOfStockDialog, setShowOutOfStockDialog] = useState<{ awardId: string; rfqItemId?: string } | null>(null);
  const [outOfStockReason, setOutOfStockReason] = useState('');
  const [markingOutOfStock, setMarkingOutOfStock] = useState(false);
  const [copiedField, setCopiedField] = useState<string | null>(null); // 用于显示复制成功提示
  const [quoteForm, setQuoteForm] = useState({
    price: '',
    deliveryDays: '',
    notes: '',
    items: [] as Array<{
      rfqItemId: string;
      selected: boolean; // 是否选择该商品进行报价
      price: string;
      deliveryDays: string;
      notes: string;
    }>,
  });

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

    fetchData();
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

  // 复制文本到剪贴板
  const copyToClipboard = async (text: string, fieldId: string) => {
    try {
      await navigator.clipboard.writeText(text);
      setCopiedField(fieldId);
      setTimeout(() => setCopiedField(null), 2000); // 2秒后清除提示
    } catch (err) {
      console.error('复制失败:', err);
      // 降级方案：使用传统方法
      const textArea = document.createElement('textarea');
      textArea.value = text;
      textArea.style.position = 'fixed';
      textArea.style.opacity = '0';
      document.body.appendChild(textArea);
      textArea.select();
      try {
        document.execCommand('copy');
        setCopiedField(fieldId);
        setTimeout(() => setCopiedField(null), 2000);
      } catch (err) {
        console.error('复制失败:', err);
      }
      document.body.removeChild(textArea);
    }
  };

  const fetchData = async () => {
    try {
      await Promise.all([fetchQuotes(), fetchAvailableRfqs(), fetchAwards()]);
    } finally {
      setLoading(false);
    }
  };

  const fetchQuotes = async () => {
    try {
      const response = await api.get('/quotes');
      const quotesData = response.data.data || response.data || [];
      const quotesList = Array.isArray(quotesData) ? quotesData : [];
      
      // 优化：批量获取询价单详情，避免 N+1 查询问题
      // 收集所有唯一的 rfqId
      const uniqueRfqIds = [...new Set(quotesList.map((q: any) => q.rfqId).filter(Boolean))];
      
      // 批量获取询价单详情（使用 Promise.all 并行请求）
      const rfqMap = new Map();
      if (uniqueRfqIds.length > 0) {
        await Promise.all(
          uniqueRfqIds.map(async (rfqId: string) => {
            try {
              const rfqResponse = await api.get(`/rfqs/${rfqId}`);
              rfqMap.set(rfqId, rfqResponse.data.data || rfqResponse.data);
            } catch (error) {
              // 单个失败不影响其他
              console.error(`获取询价单 ${rfqId} 失败:`, error);
            }
          })
        );
      }
      
      // 将询价单详情关联到报价
      const quotesWithRfq = quotesList.map((quote: any) => ({
        ...quote,
        rfq: quote.rfqId ? rfqMap.get(quote.rfqId) : null,
      }));
      
      setQuotes(quotesWithRfq);
    } catch (error: any) {
      console.error('获取报价失败:', error);
      setQuotes([]);
    }
  };

  const fetchAwards = async () => {
    try {
      console.log('[前端] 开始获取中标记录...');
      const response = await api.get('/awards');
      console.log('[前端] 中标记录API响应:', response.data);
      const awardsData = response.data.data || response.data || [];
      const awardsList = Array.isArray(awardsData) ? awardsData : [];
      console.log('[前端] 解析后的中标记录数量:', awardsList.length);
      
      // 详细检查订单信息
      awardsList.forEach((award: any, index: number) => {
        console.log(`[前端] 中标记录 #${index + 1}:`, {
          id: award.id,
          quoteId: award.quoteId,
          rfqId: award.rfqId,
          finalPrice: award.finalPrice,
          itemsCount: award.quote?.items?.length || 0,
        });
        
        // 检查每个商品的订单信息
        award.quote?.items?.forEach((quoteItem: any, itemIndex: number) => {
          const rfqItem = quoteItem.rfqItem;
          const order = (rfqItem as any)?.order;
          console.log(`[前端] 商品 #${itemIndex + 1} (${rfqItem?.productName}):`, {
            rfqItemId: rfqItem?.id,
            hasOrderInfo: !!rfqItem?.orderInfo,
            orderInfo: rfqItem?.orderInfo,
            orderInfoType: typeof rfqItem?.orderInfo,
            orderInfoValue: rfqItem?.orderInfo,
            orderNo: rfqItem?.orderNo,
            hasOrder: !!order,
            orderType: typeof order,
            orderValue: order,
            orderKeys: order ? Object.keys(order) : null,
            rfqItemKeys: Object.keys(rfqItem || {}),
            // 检查 rfq.orders
            hasRfqOrders: !!(award.rfq as any)?.orders,
            rfqOrdersCount: (award.rfq as any)?.orders?.length || 0,
            // 如果 order 存在但 orderInfo 不存在，说明后端逻辑有问题
            orderExistsButOrderInfoMissing: !!order && !rfqItem?.orderInfo,
          });
        });
      });
      
      setAwards(awardsList);
    } catch (error: any) {
      console.error('[前端] 获取中标记录失败:', error);
      console.error('[前端] 错误详情:', {
        message: error.message,
        status: error.response?.status,
        statusText: error.response?.statusText,
        data: error.response?.data,
      });
      setAwards([]);
    }
  };

  const fetchAvailableRfqs = async () => {
    try {
      // 获取所有已发布的询价单（后端会自动过滤掉已过期的）
      const response = await api.get('/rfqs');
      const rfqsData = response.data.data || response.data || [];
      const rfqsList = Array.isArray(rfqsData) ? rfqsData : [];
      
      // 存储到全局变量，方便调试
      (window as any).__rfqsList = rfqsList;
      
      console.log('📋 原始询价单数据:', rfqsList.length, '个');
      console.log('💡 提示：可以在控制台执行 window.__rfqsList 查看询价单数据');
      
      // 详细打印每个询价单的信息
      rfqsList.forEach((rfq: any, index: number) => {
        const hasItems = !!rfq.items;
        const itemsType = Array.isArray(rfq.items) ? 'array' : typeof rfq.items;
        const itemsCount = rfq.items?.length || 0;
        
        console.group(`📋 询价单 #${index + 1} (${rfq.rfqNo})`);
        console.log('基本信息:', {
          id: rfq.id,
          标题: rfq.title,
          状态: rfq.status,
          截止时间: new Date(rfq.deadline).toLocaleString('zh-CN'),
        });
        console.log('商品明细信息:', {
          是否有items: hasItems,
          items类型: itemsType,
          商品数量: itemsCount,
          items值: rfq.items,
        });
        
        if (rfq.items && rfq.items.length > 0) {
          console.log(`✅ 有 ${rfq.items.length} 个商品:`);
          console.table(rfq.items.map((item: any) => ({
            商品名称: item.productName,
            数量: item.quantity,
            单位: item.unit || '件',
            描述: item.description || '-',
          })));
        } else {
          console.warn(`⚠️ 没有商品明细`);
          console.log('详细信息:', {
            'items === undefined': rfq.items === undefined,
            'items === null': rfq.items === null,
            'items 是数组': Array.isArray(rfq.items),
            'items 值': rfq.items,
          });
        }
        console.groupEnd();
      });
      
      // 确保每个询价单都包含 items 数据
      rfqsList.forEach((rfq: any) => {
        if (!rfq.items) {
          rfq.items = [];
        }
      });
      
      // 前端再次过滤，确保只显示已发布且未过期的询价单
      const now = new Date();
      console.log('📋 当前时间:', now.toISOString(), now.getTime());
      
      // 暂时放宽过滤逻辑，先显示所有后端返回的询价单，方便调试
      const availableRfqs = rfqsList.filter((rfq: any) => {
        // 检查状态
        if (rfq.status !== 'PUBLISHED') {
          console.log('❌ 询价单状态不是PUBLISHED:', rfq.rfqNo, rfq.status);
          return false;
        }
        
        // 检查截止时间（添加容错，允许一些时间差）
        if (!rfq.deadline) {
          console.log('❌ 询价单没有截止时间:', rfq.rfqNo);
          return false;
        }
        
        const deadline = new Date(rfq.deadline);
        const deadlineTime = deadline.getTime();
        const nowTime = now.getTime();
        
        // 允许5分钟的时间差容错（可能是时区或服务器时间差异）
        const timeDiff = deadlineTime - nowTime;
        const timeDiffMinutes = timeDiff / (1000 * 60);
        
        console.log('📋 询价单截止时间检查:', {
          rfqNo: rfq.rfqNo,
          deadline: rfq.deadline,
          deadlineDate: deadline.toISOString(),
          deadlineTime,
          nowTime,
          timeDiff,
          timeDiffMinutes: timeDiffMinutes.toFixed(2),
          isFuture: deadlineTime > nowTime,
          diffHours: (timeDiff / (1000 * 60 * 60)).toFixed(2),
        });
        
        if (isNaN(deadlineTime)) {
          console.log('❌ 询价单截止时间无效:', rfq.rfqNo, rfq.deadline);
          return false;
        }
        
        // 暂时放宽：允许5分钟的时间差（可能是时区问题）
        if (timeDiffMinutes < -5) {
          console.log('❌ 询价单已过期（超过5分钟）:', rfq.rfqNo, '截止时间:', deadline.toISOString(), '时间差:', timeDiffMinutes.toFixed(2), '分钟');
          return false;
        }
        
        console.log('✅ 询价单可用:', rfq.rfqNo, '时间差:', timeDiffMinutes.toFixed(2), '分钟');
        return true;
      });
      
      console.log('📋 过滤后的询价单:', availableRfqs.length, '个');
      setRfqs(availableRfqs);
    } catch (error: any) {
      console.error('❌ 获取询价单失败:', error);
      console.error('❌ 错误详情:', error.response?.data);
      setRfqs([]);
    }
  };

  const handleSubmitQuote = async (e: React.FormEvent) => {
    e.preventDefault();
    console.log('📋 [前端] 开始提交报价流程');
    
    if (!selectedRfq) {
      console.error('❌ [前端] 没有选中的询价单');
      alert('请先选择要报价的询价单');
      return;
    }

    // 只处理选中的商品（移到 try 外面，以便在 catch 中使用）
    const selectedItems = quoteForm.items.filter(item => item.selected);
    console.log('📋 [前端] 选中的商品数量:', selectedItems.length);

    try {
      
      // 验证至少选择了一个商品
      if (selectedItems.length === 0) {
        console.warn('⚠️ [前端] 没有选中任何商品');
        alert('请至少选择一个商品进行报价');
        return;
      }
      
      // 验证所有选中的商品都填写了价格
      const itemsWithoutPrice = selectedItems.filter(item => !item.price || parseFloat(item.price) <= 0);
      if (itemsWithoutPrice.length > 0) {
        console.warn('⚠️ [前端] 有商品未填写价格:', itemsWithoutPrice);
        alert('请为所有选中的商品填写价格（价格必须大于0）');
        return;
      }

      // 验证报价不超过最高限价
      for (const quoteItem of selectedItems) {
        const rfqItem = selectedRfq.items.find((item: any) => item.id === quoteItem.rfqItemId);
        if (rfqItem && rfqItem.maxPrice) {
          const price = parseFloat(quoteItem.price);
          const maxPrice = Number(rfqItem.maxPrice);
          if (price > maxPrice) {
            console.warn('⚠️ [前端] 报价超过最高限价:', { productName: rfqItem.productName, price, maxPrice });
            alert(`商品 "${rfqItem.productName}" 的报价 ¥${price.toFixed(2)} 超过了最高限价 ¥${maxPrice.toFixed(2)}`);
            return;
          }
        }
      }
      
      // 计算总价（所有已报价商品的单价 × 数量，包括已报价和本次新报价的）
      // 注意：这里计算所有已报价商品的总价，而不仅仅是本次选中的
      let totalPrice = 0;
      if (selectedRfq.items) {
        // 计算所有已报价商品的总价（包括已报价和本次新报价的）
        quoteForm.items.forEach((quoteItem) => {
          if (quoteItem.selected && quoteItem.price && parseFloat(quoteItem.price) > 0) {
            const rfqItem = selectedRfq.items.find((item: any) => item.id === quoteItem.rfqItemId);
            if (rfqItem) {
              const itemPrice = parseFloat(quoteItem.price);
              const quantity = rfqItem.quantity || 1;
              totalPrice += itemPrice * quantity;
            }
          }
        });
      }
      
      // 如果计算出的总价为0，使用表单中的总价（向后兼容）
      if (totalPrice <= 0 && quoteForm.price) {
        totalPrice = parseFloat(quoteForm.price);
      }

      // 验证总价必须大于0
      if (totalPrice <= 0) {
        console.warn('⚠️ [前端] 总价无效:', totalPrice);
        alert('总价必须大于0，请检查商品价格');
        return;
      }

      // 准备商品级别的报价数据（只包含选中的商品）
      const quoteItems = selectedItems
        .filter(item => item.price && parseFloat(item.price) > 0) // 只包含已填写价格的商品
        .map(item => ({
          rfqItemId: item.rfqItemId,
          price: parseFloat(item.price),
          deliveryDays: parseInt(item.deliveryDays) || 0,
          notes: item.notes || undefined,
        }));

      // 准备提交的数据
      const submitData: any = {
        rfqId: selectedRfq.id,
        price: Number(totalPrice.toFixed(2)), // 确保是数字类型，保留2位小数
        deliveryDays: quoteForm.deliveryDays ? parseInt(quoteForm.deliveryDays) : 0,
        notes: quoteForm.notes || undefined,
      };

      // 如果有商品级别的报价，添加 items
      if (quoteItems.length > 0) {
        submitData.items = quoteItems.map(item => ({
          rfqItemId: item.rfqItemId,
          price: Number(item.price.toFixed(2)), // 确保是数字类型
          deliveryDays: item.deliveryDays || 0,
          notes: item.notes || undefined,
        }));
      }
      
      console.log('📋 [前端] 提交报价数据:', {
        rfqId: submitData.rfqId,
        price: submitData.price,
        priceType: typeof submitData.price,
        itemsCount: submitData.items?.length || 0,
        items: submitData.items,
      });
      
      console.log('📋 [前端] 开始发送 POST 请求到 /quotes');
      const response = await api.post('/quotes', submitData);
      console.log('✅ [前端] 报价提交成功:', response.data);

      // 关闭表单
      setShowQuoteForm(false);
      setSelectedRfq(null);
      setIsUpdatingQuote(false);
      setQuoteForm({ price: '', deliveryDays: '', notes: '', items: [] });
      
      // 刷新数据
      console.log('📋 [前端] 开始刷新数据...');
      await fetchData();
      console.log('✅ [前端] 数据刷新完成');
      
      // 切换到"我的报价"标签页，确保能看到新提交的报价
      setActiveTab('my-quotes');
      
      alert(isUpdatingQuote ? '报价更新成功！' : '报价提交成功！');
    } catch (error: any) {
      console.error('❌ [前端] 提交报价失败:', error);
      const submitDataForLog = {
        rfqId: selectedRfq?.id,
        price: quoteForm.price,
        itemsCount: selectedItems.filter((item: { price?: string }) => item.price && parseFloat(item.price) > 0).length,
      };
      console.error('❌ [前端] 错误详情:', {
        message: error.message,
        status: error.response?.status,
        statusText: error.response?.statusText,
        data: error.response?.data,
        requestData: submitDataForLog,
        errorCode: error.code,
        errorConfig: error.config,
      });
      
      // 提取详细的错误信息
      let errorMessage = '提交报价失败';
      if (error.response?.data) {
        const errorData = error.response.data;
        if (Array.isArray(errorData.message)) {
          errorMessage = errorData.message.join('\n');
        } else if (typeof errorData.message === 'string') {
          errorMessage = errorData.message;
        } else if (errorData.error) {
          errorMessage = errorData.error;
        }
      } else if (error.message) {
        errorMessage = error.message;
      }
      
      alert(`提交报价失败：\n${errorMessage}\n\n请查看浏览器控制台获取更多详情。`);
    }
  };

  const handleUploadQrCode = async (awardId: string, file: File) => {
    try {
      const formData = new FormData();
      formData.append('file', file);

      await api.post(`/awards/${awardId}/payment-qrcode`, formData, {
        headers: {
          'Content-Type': 'multipart/form-data',
        },
      });

      alert('收款二维码上传成功');
      await fetchAwards();
    } catch (error: any) {
      console.error('上传收款二维码失败:', error);
      alert('上传失败：' + (error.response?.data?.message || error.message));
    }
  };

  const handleSaveTracking = async (awardId: string, rfqItemId: string) => {
    try {
      if (!trackingForm.trackingNo.trim()) {
        alert('请输入物流单号');
        return;
      }

      await api.post(`/awards/${awardId}/tracking`, {
        rfqItemId,
        trackingNo: trackingForm.trackingNo.trim(),
        carrier: trackingForm.carrier.trim() || undefined,
      });

      alert('物流单号上传成功');
      setEditingAward(null);
      setTrackingForm({ rfqItemId: '', trackingNo: '', carrier: '' });
      await fetchAwards();
    } catch (error: any) {
      console.error('上传物流单号失败:', error);
      alert('上传失败：' + (error.response?.data?.message || error.message));
    }
  };

  /**
   * 上传快递面单（OCR识别）
   */
  const handleUploadLabel = async (awardId: string, rfqItemId: string, file: File) => {
    try {
      // 检查是否已有发货单
      const award = awards.find(a => a.id === awardId);
      const shipment = award?.shipments?.find((s: any) => s.rfqItemId === rfqItemId);

      let shipmentId: string;

      if (shipment && shipment.id) {
        // 如果已有发货单，直接使用
        shipmentId = shipment.id;
      } else {
        // 如果没有发货单，先创建一个临时发货单（使用临时单号，OCR识别后会更新）
        const tempTrackingNo = `TEMP-${Date.now()}`;
        try {
          const response = await api.post(`/awards/${awardId}/tracking`, {
            rfqItemId,
            trackingNo: tempTrackingNo,
            carrier: '', // OCR识别后会自动填写
          });
          
          // 从响应中直接获取发货单ID
          const shipmentData = response.data.data || response.data;
          shipmentId = shipmentData.id || shipmentData.shipmentId;
          
          if (!shipmentId) {
            console.error('创建发货单响应:', shipmentData);
            throw new Error('无法从响应中获取发货单ID，请重试');
          }
          
          console.log('✅ 创建发货单成功，发货单ID:', shipmentId);
        } catch (error: any) {
          console.error('创建发货单失败:', error);
          console.error('错误详情:', {
            message: error.message,
            response: error.response?.data,
            status: error.response?.status,
          });
          alert('创建发货单失败：' + (error.response?.data?.message || error.message));
          return;
        }
      }

      // 上传面单进行OCR识别
      const formData = new FormData();
      formData.append('file', file);

      console.log('📋 [前端] 上传快递面单（OCR识别）:', {
        shipmentId,
        fileName: file.name,
        fileSize: file.size,
        fileType: file.type,
      });

      // 文件上传 + OCR 识别需要更长时间，设置 90 秒超时
      const response = await api.post(`/shipments/${shipmentId}/upload-label`, formData, {
        timeout: 90000, // 90秒超时（文件上传 + OCR 识别）
      });
      
      const result = response.data.data || response.data;
      const ocrResult = result.trackingExtract;
      
      // 调试：打印返回的数据结构
      console.log('📋 OCR识别结果:', {
        result,
        ocrResult,
        autoFilled: result.autoFilled,
        trackingNo: ocrResult?.trackingNo,
      });
      
      // 先刷新数据，确保获取最新的运单号（如果后端已自动填充）
      await fetchAwards();
      
      // 如果识别到运单号
      if (ocrResult?.trackingNo) {
        if (result.autoFilled) {
          // 如果后端已经自动填充成功，直接刷新数据即可，不需要打开编辑模式
          // 等待一小段时间，确保状态更新完成
          await new Promise(resolve => setTimeout(resolve, 200));
          // 再次刷新数据，确保显示最新状态
          await fetchAwards();
          alert(`✅ OCR识别成功！\n\n运单号：${ocrResult.trackingNo}\n快递公司：${ocrResult.carrier || '未识别'}\n置信度：${(ocrResult.confidence * 100).toFixed(1)}%\n识别方式：${ocrResult.method}\n\n已自动回填到发货单`);
        } else {
          // 如果后端没有自动填充（如运单号已被使用或置信度较低），打开编辑模式让用户确认
          await new Promise(resolve => setTimeout(resolve, 100));
          setEditingAward(awardId);
          setTrackingForm({
            rfqItemId: rfqItemId,
            trackingNo: ocrResult.trackingNo,
            carrier: ocrResult.carrier || '',
          });
          alert(`⚠️ OCR识别到运单号：${ocrResult.trackingNo}\n快递公司：${ocrResult.carrier || '未识别'}\n置信度：${(ocrResult.confidence * 100).toFixed(1)}%\n识别方式：${ocrResult.method}\n\n注意：该运单号可能已被其他发货单使用，请确认后保存`);
        }
      } else {
        alert('❌ OCR识别失败，未能识别到运单号。\n请手动输入物流单号。');
      }
    } catch (error: any) {
      console.error('上传快递面单失败:', error);
      alert('上传失败：' + (error.response?.data?.message || error.message));
    }
  };

  const handleMarkOutOfStock = async () => {
    if (!showOutOfStockDialog || !outOfStockReason.trim()) {
      alert('请填写缺货原因');
      return;
    }

    setMarkingOutOfStock(true);
    try {
      const response = await api.post(`/awards/${showOutOfStockDialog.awardId}/out-of-stock`, {
        reason: outOfStockReason,
        rfqItemId: showOutOfStockDialog.rfqItemId,
      });
      
      console.log('标记缺货成功:', response.data);
      
      // 关闭对话框
      setShowOutOfStockDialog(null);
      setOutOfStockReason('');
      
      // 立即刷新数据
      await fetchAwards();
      
      // 延迟再次刷新，确保数据已更新
      setTimeout(async () => {
        await fetchAwards();
      }, 500);
      
      alert('已标记为缺货');
    } catch (error: any) {
      console.error('标记缺货失败:', error);
      const errorMessage = error.response?.data?.message || error.message || '标记失败';
      alert(`标记失败：${errorMessage}`);
    } finally {
      setMarkingOutOfStock(false);
    }
  };

  const handleUploadShipmentPhoto = async (awardId: string, rfqItemId: string, file: File) => {
    try {
      const formData = new FormData();
      formData.append('file', file);
      formData.append('rfqItemId', rfqItemId);

      console.log('📋 [前端] 上传发货照片/视频:', {
        awardId,
        rfqItemId,
        fileName: file.name,
        fileSize: file.size,
        fileType: file.type,
      });

      // 不手动设置 Content-Type，让 axios 自动处理（包括 boundary）
      const response = await api.post(`/awards/${awardId}/shipment-photos`, formData);
      console.log('📋 [前端] 上传发货照片/视频响应:', response.data);

      alert('发货照片/视频上传成功');
      
      // 刷新数据
      await fetchAwards();
      
      // 再次检查数据，确保照片已加载
      setTimeout(async () => {
        await fetchAwards();
        console.log('📋 [前端] 刷新后的 awards 数据:', awards);
      }, 500);
    } catch (error: any) {
      console.error('上传发货照片/视频失败:', error);
      console.error('错误详情:', {
        message: error.message,
        status: error.response?.status,
        statusText: error.response?.statusText,
        data: error.response?.data,
      });
      alert('上传失败：' + (error.response?.data?.message || error.response?.data?.error || error.message));
    }
  };

  const getStatusColor = (status: string) => {
    const statusMap: Record<string, { bg: string; text: string }> = {
      PENDING: { bg: 'bg-yellow-100', text: 'text-yellow-800' },
      SUBMITTED: { bg: 'bg-blue-100', text: 'text-blue-800' },
      AWARDED: { bg: 'bg-green-100', text: 'text-green-800' },
      REJECTED: { bg: 'bg-red-100', text: 'text-red-800' },
    };
    return statusMap[status] || { bg: 'bg-gray-100', text: 'text-gray-800' };
  };

  const getStatusText = (status: string) => {
    const statusMap: Record<string, string> = {
      PENDING: '待提交',
      SUBMITTED: '已提交',
      AWARDED: '已中标',
      REJECTED: '已拒绝',
    };
    return statusMap[status] || status;
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
    <div className="min-h-screen bg-gray-50 pb-20 sm:pb-8">
      <div className="mx-auto max-w-7xl px-3 py-4 sm:px-4 sm:py-6 lg:px-8 lg:py-8">
        {/* 头部 - 移动端优化 */}
        <div className="mb-4 sm:mb-8">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <h1 className="text-2xl font-bold text-gray-900 sm:text-3xl">报价管理</h1>
              <p className="mt-1 text-xs text-gray-600 sm:mt-2 sm:text-sm">
                管理您的报价和查看可报价的询价单
              </p>
            </div>
            <button
              onClick={fetchData}
              className="flex h-11 min-w-[44px] items-center justify-center gap-2 rounded-lg bg-white px-4 py-2.5 text-sm font-medium text-gray-700 shadow-sm transition-all active:bg-gray-100 sm:h-auto sm:py-2 sm:hover:bg-gray-50 sm:hover:shadow-md"
            >
              <svg className="h-5 w-5 sm:h-4 sm:w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
              </svg>
              <span className="sm:inline">刷新</span>
            </button>
          </div>
        </div>

        {/* 标签页 - 移动端优化 */}
        <div className="mb-4 border-b border-gray-200 sm:mb-6">
          <nav className="-mb-px flex space-x-4 sm:space-x-8">
            <button
              onClick={() => setActiveTab('my-quotes')}
              className={`min-h-[44px] flex-1 whitespace-nowrap border-b-2 px-2 py-3 text-sm font-medium transition-colors sm:flex-none sm:px-1 sm:py-4 ${
                activeTab === 'my-quotes'
                  ? 'border-blue-500 text-blue-600'
                  : 'border-transparent text-gray-500 active:text-gray-700 sm:hover:border-gray-300 sm:hover:text-gray-700'
              }`}
            >
              我的报价 <span className="text-xs opacity-75">({quotes.length})</span>
            </button>
            <button
              onClick={() => setActiveTab('available-rfqs')}
              className={`min-h-[44px] flex-1 whitespace-nowrap border-b-2 px-2 py-3 text-sm font-medium transition-colors sm:flex-none sm:px-1 sm:py-4 ${
                activeTab === 'available-rfqs'
                  ? 'border-blue-500 text-blue-600'
                  : 'border-transparent text-gray-500 active:text-gray-700 sm:hover:border-gray-300 sm:hover:text-gray-700'
              }`}
            >
              可报价 <span className="hidden sm:inline">询价单</span> <span className="text-xs opacity-75">({rfqs.length})</span>
            </button>
          </nav>
        </div>

        {/* 我的报价 */}
        {activeTab === 'my-quotes' && (
          <div>
            {quotes.length > 0 ? (
              <div className="grid gap-3 sm:gap-4 sm:grid-cols-1 lg:grid-cols-2 xl:grid-cols-3">
                {quotes.map((quote) => {
                  // ⚠️ 重要：验证 quote.status 是否真的是当前供应商中标的
                  // 如果 quote.status === 'AWARDED'，但 awards 数组中没有对应的记录，说明不是当前供应商中标的
                  let displayStatus = quote.status || 'PENDING';
                  const currentUser = authApi.getCurrentUser();
                  
                  // 检查 awards 数组中是否有对应的记录
                  let award = awards.find(a => a.quoteId === quote.id);
                  if (!award && quote.rfqId) {
                    award = awards.find(a => a.rfqId === quote.rfqId);
                  }
                  
                  // 如果 quote.status === 'AWARDED'，但 awards 数组中没有对应的记录，或者 award.supplierId 不匹配
                  // 说明不是当前供应商中标的，不应该显示"已中标"
                  if (displayStatus === 'AWARDED') {
                    if (!award || (currentUser && award.supplierId !== currentUser.id)) {
                      // 不是当前供应商中标的，改为显示"已提交"
                      displayStatus = 'SUBMITTED';
                      console.warn('[前端] 报价状态为AWARDED，但不是当前供应商中标的，改为显示SUBMITTED', {
                        quoteId: quote.id,
                        quoteStatus: quote.status,
                        hasAward: !!award,
                        awardSupplierId: award?.supplierId,
                        currentUserId: currentUser?.id,
                      });
                    }
                  }
                  
                  const statusStyle = getStatusColor(displayStatus);
                  return (
                    <div
                      key={quote.id}
                      className="rounded-xl bg-white p-4 shadow-sm transition-all active:shadow-md sm:p-6 sm:hover:shadow-lg"
                    >
                      <div className="mb-4 flex items-start justify-between gap-2">
                        <div className="flex-1 min-w-0">
                          <h3 className="font-semibold text-gray-900 text-sm sm:text-base truncate">
                            {quote.rfq?.rfqNo || quote.rfqId}
                          </h3>
                          <p className="mt-1 text-xs sm:text-sm text-gray-600 line-clamp-2">
                            {quote.rfq?.title || '询价单'}
                          </p>
                        </div>
                        <span className={`flex-shrink-0 inline-flex rounded-full px-2.5 py-1 text-xs font-semibold ${statusStyle.bg} ${statusStyle.text}`}>
                          {getStatusText(displayStatus)}
                        </span>
                      </div>

                      <div className="space-y-2.5">
                        <div className="flex items-center justify-between text-sm">
                          <span className="text-gray-600 text-xs sm:text-sm">报价金额</span>
                          <span className="text-base sm:text-lg font-bold text-blue-600">¥{quote.price || 0}</span>
                        </div>
                        <div className="flex items-center justify-between text-sm">
                          <span className="text-gray-600 text-xs sm:text-sm">交付天数</span>
                          <span className="text-gray-900 text-xs sm:text-sm">{quote.deliveryDays || 0} 天</span>
                        </div>
                        {quote.notes && (
                          <div className="mt-2 text-sm text-gray-600">
                            <span className="font-medium">备注：</span>
                            {quote.notes}
                          </div>
                        )}
                        {quote.submittedAt && (
                          <div className="mt-2 text-xs text-gray-500">
                            提交时间：{new Date(quote.submittedAt).toLocaleString('zh-CN')}
                          </div>
                        )}
                      </div>

                      {/* 显示报价的商品明细 */}
                      {quote.items && quote.items.length > 0 && (
                        <div className="mt-4 border-t pt-4">
                          <div className="mb-2 text-xs font-medium text-gray-700">报价商品明细：</div>
                          <div className="space-y-1.5 max-h-40 overflow-y-auto">
                            {quote.items.map((item: any, idx: number) => (
                              <div key={item.id || idx} className="flex items-start justify-between text-xs bg-gray-50 rounded px-2 py-1.5">
                                <div className="flex-1 min-w-0">
                                  <div className="font-medium text-gray-900 truncate">
                                    {item.rfqItem?.productName || '未知商品'}
                                  </div>
                                  <div className="text-gray-600 mt-0.5">
                                    数量：{item.rfqItem?.quantity || 1} {item.rfqItem?.unit || '件'}
                                  </div>
                                </div>
                                <div className="ml-2 text-right flex-shrink-0">
                                  <div className="font-semibold text-blue-600">
                                    ¥{Number(item.price || 0).toFixed(2)}
                                  </div>
                                  {item.deliveryDays > 0 && (
                                    <div className="text-gray-500 text-[10px] mt-0.5">
                                      {item.deliveryDays}天
                                    </div>
                                  )}
                                </div>
                              </div>
                            ))}
                          </div>
                        </div>
                      )}

                      {/* 修改报价按钮 - 如果询价单还未截单，可以继续添加或修改报价 */}
                      {quote.rfq && quote.rfq.status === 'PUBLISHED' && (
                        <div className="mt-4 border-t pt-4">
                          <button
                            onClick={async () => {
                              try {
                                // 重新获取询价单详情
                                const rfqResponse = await api.get(`/rfqs/${quote.rfqId}`);
                                const rfqDetail = rfqResponse.data.data || rfqResponse.data;
                                setSelectedRfq(rfqDetail);
                                
                                // 加载已有报价信息
                                const existingQuoteResponse = await api.get('/quotes', {
                                  params: { rfqId: quote.rfqId }
                                });
                                const existingQuotes = existingQuoteResponse.data.data || existingQuoteResponse.data || [];
                                const existingQuote = Array.isArray(existingQuotes) && existingQuotes.length > 0 
                                  ? existingQuotes[0] 
                                  : null;
                                
                                if (existingQuote && existingQuote.items) {
                                  setIsUpdatingQuote(true);
                                  const initialItems = (rfqDetail.items || []).map((item: any) => {
                                    const existingQuoteItem = existingQuote.items.find((qi: any) => qi.rfqItemId === item.id);
                                    return {
                                      rfqItemId: item.id,
                                      selected: !!existingQuoteItem,
                                      price: existingQuoteItem ? String(existingQuoteItem.price || '') : '',
                                      deliveryDays: existingQuoteItem ? String(existingQuoteItem.deliveryDays || '') : '',
                                      notes: existingQuoteItem ? (existingQuoteItem.notes || '') : '',
                                    };
                                  });
                                  setQuoteForm({
                                    price: String(existingQuote.price || ''),
                                    deliveryDays: String(existingQuote.deliveryDays || ''),
                                    notes: existingQuote.notes || '',
                                    items: initialItems,
                                  });
                                } else {
                                  setIsUpdatingQuote(false);
                                  const initialItems = (rfqDetail.items || []).map((item: any) => ({
                                    rfqItemId: item.id,
                                    selected: false,
                                    price: '',
                                    deliveryDays: '',
                                    notes: '',
                                  }));
                                  setQuoteForm({
                                    price: '',
                                    deliveryDays: '',
                                    notes: '',
                                    items: initialItems,
                                  });
                                }
                                setShowQuoteForm(true);
                              } catch (error: any) {
                                console.error('❌ 打开报价表单失败:', error);
                                alert('打开报价表单失败，请稍后重试');
                              }
                            }}
                            className="w-full rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white transition-all hover:bg-blue-700 active:bg-blue-800"
                          >
                            修改报价 / 继续添加商品
                          </button>
                        </div>
                      )}

                      {/* 如果该报价中有商品中标，显示发货管理入口 */}
                      {(() => {
                        // ⚠️ 重要：只依赖 awards 数组来判断是否中标，不要检查 quote.items 中的 itemStatus
                        // 因为 itemStatus === 'AWARDED' 只表示商品已中标，但不一定是当前供应商中标的
                        // 后端 findBySupplier 已经过滤了，只返回当前供应商中标的商品
                        
                        // 检查 awards 数组中是否有对应的记录（通过 quoteId 或 rfqId 匹配）
                        let award = awards.find(a => a.quoteId === quote.id);
                        if (!award && quote.rfqId) {
                          award = awards.find(a => a.rfqId === quote.rfqId);
                        }
                        
                        // ⚠️ 权限验证：确保 award 的 supplierId 与当前用户匹配
                        const currentUser = authApi.getCurrentUser();
                        if (award && currentUser) {
                          if (award.supplierId !== currentUser.id) {
                            // 如果 award 的 supplierId 与当前用户不匹配，不显示中标信息
                            console.warn('[前端] 中标记录的供应商ID与当前用户不匹配，不显示中标信息', {
                              awardSupplierId: award.supplierId,
                              currentUserId: currentUser.id,
                              quoteId: quote.id,
                              quoteSupplierId: quote.supplierId,
                            });
                            award = null; // 清空 award，不显示中标信息
                          } else {
                            console.log('[前端] 中标记录验证通过', {
                              awardId: award.id,
                              supplierId: award.supplierId,
                              currentUserId: currentUser.id,
                              itemsCount: award.quote?.items?.length || 0,
                            });
                          }
                        }
                        
                        // 只有找到 award 记录且供应商ID匹配时，才显示发货管理入口
                        if (award) {
                          return (
                            <div className="mt-4 border-t pt-4">
                              {(() => {
                                console.log('[前端] 查找中标记录，quote.id:', quote.id, 'quote.rfqId:', quote.rfqId);
                                console.log('[前端] 当前awards列表:', awards.map((a: any) => ({
                                  id: a.id,
                                  quoteId: a.quoteId,
                                  rfqId: a.rfqId,
                                })));
                                console.log('[前端] 找到的中标记录:', award ? {
                                  id: award.id,
                                  quoteId: award.quoteId,
                                  rfqId: award.rfqId,
                                } : null);
                                if (!award) {
                              // 如果awards已经加载完成（不是初始状态），显示提示
                              if (awards.length === 0 && !loading) {
                                return (
                                  <div className="space-y-2">
                                    <div className="text-xs text-yellow-600">
                                      ⚠️ 未找到中标信息
                                    </div>
                                    <button
                                      onClick={fetchAwards}
                                      className="text-xs text-blue-600 hover:text-blue-800 underline"
                                    >
                                      点击刷新
                                    </button>
                                  </div>
                                );
                              }
                              return (
                                <div className="text-xs text-gray-500">
                                  正在加载中标信息...
                                </div>
                              );
                            }
                            return (
                              <div className="space-y-3">
                                <div className="rounded-lg bg-green-50 p-3">
                                  <div className="mb-2 flex items-center justify-between">
                                    <span className="text-sm font-semibold text-green-800">🎉 恭喜中标！</span>
                                    <span className="text-xs text-green-600">
                                      中标金额：¥{award?.finalPrice || quote.price}
                                    </span>
                                  </div>
                                </div>
                                
                                {/* 上传收款二维码 - 整个订单只有一个 */}
                                <div className="space-y-2 rounded border border-gray-200 p-3">
                                  <label className="block text-xs font-medium text-gray-700">
                                    收款二维码（整个订单只需上传一次）
                                  </label>
                                  {award?.paymentQrCodeUrl ? (
                                    <div>
                                      <img 
                                        src={getProxiedImageUrl(award.paymentQrCodeUrl)} 
                                        alt="收款二维码" 
                                        className="h-24 w-24 rounded border border-green-200 cursor-pointer hover:opacity-80 transition-opacity"
                                        onClick={() => setPreviewImage({ url: getProxiedImageUrl(award.paymentQrCodeUrl), isVideo: false })}
                                        onError={(e) => {
                                          console.error('收款二维码加载失败:', award.paymentQrCodeUrl);
                                          handleImageError(e);
                                        }}
                                        title="点击查看大图"
                                      />
                                      <button
                                        onClick={() => {
                                          const input = document.createElement('input');
                                          input.type = 'file';
                                          input.accept = 'image/*';
                                          input.onchange = (e: any) => {
                                            if (e.target.files && e.target.files[0]) {
                                              handleUploadQrCode(award.id, e.target.files[0]);
                                            }
                                          };
                                          input.click();
                                        }}
                                        className="mt-2 text-xs text-blue-600 hover:text-blue-800"
                                      >
                                        重新上传
                                      </button>
                                    </div>
                                  ) : (
                                    <input
                                      type="file"
                                      accept="image/*"
                                      onChange={(e) => {
                                        if (e.target.files && e.target.files[0]) {
                                          handleUploadQrCode(award.id, e.target.files[0]);
                                        }
                                      }}
                                      className="block w-full text-xs text-gray-600 file:mr-2 file:rounded file:border-0 file:bg-blue-50 file:px-2 file:py-1 file:text-xs file:font-semibold file:text-blue-700 hover:file:bg-blue-100"
                                    />
                                  )}
                                </div>

                                {/* 中标商品详情 - 显示订单信息和上传功能 */}
                                {award?.quote?.items && award.quote.items.length > 0 && (
                                  <div className="space-y-3">
                                    <label className="block text-xs font-medium text-gray-700">
                                      中标商品详情（仅显示您中标的商品）
                                    </label>
                                    {award.quote.items.map((quoteItem: any) => {
                                      const rfqItem = quoteItem.rfqItem;
                                      if (!rfqItem) return null;
                                      
                                      const orderInfo = rfqItem.orderInfo;
                                      const shipment = award.shipments?.find((s: any) => s.rfqItemId === rfqItem.id);
                                      const packageRecord = shipment?.packages?.[0];
                                      const shipmentPhotos = packageRecord?.photos || [];
                                      
                                      // 调试日志
                                      if (shipment) {
                                        console.log('📋 [前端] 发货单数据:', {
                                          shipmentId: shipment.id,
                                          rfqItemId: shipment.rfqItemId,
                                          packagesCount: shipment.packages?.length || 0,
                                          packageRecord: packageRecord ? {
                                            id: packageRecord.id,
                                            photosCount: packageRecord.photos?.length || 0,
                                            photos: packageRecord.photos,
                                          } : null,
                                          shipmentPhotosCount: shipmentPhotos.length,
                                        });
                                      }
                                      
                                      return (
                                        <div key={quoteItem.id} className="rounded-lg border border-gray-200 p-3">
                                          {/* 商品基本信息 */}
                                          <div className="mb-2 border-b pb-2">
                                            <div className="flex items-center justify-between">
                                              <div className="text-sm font-semibold text-gray-900">
                                                {rfqItem.productName} × {rfqItem.quantity}
                                                <span className="ml-2 text-green-600">（中标价：¥{quoteItem.price}）</span>
                                                {rfqItem.itemStatus === 'OUT_OF_STOCK' && (
                                                  <span className="ml-2 inline-flex rounded-full bg-orange-100 px-2 py-0.5 text-xs font-semibold text-orange-800">
                                                    缺货
                                                  </span>
                                                )}
                                              </div>
                                              {award.status === 'ACTIVE' && rfqItem.itemStatus !== 'OUT_OF_STOCK' && rfqItem.itemStatus !== 'SHIPPED' && (
                                                <button
                                                  onClick={() => setShowOutOfStockDialog({ awardId: award.id, rfqItemId: rfqItem.id })}
                                                  className="rounded bg-orange-600 px-2 py-1 text-xs text-white hover:bg-orange-700"
                                                >
                                                  标记缺货
                                                </button>
                                              )}
                                            </div>
                                            {rfqItem.exceptionReason && (
                                              <p className="mt-1 text-xs text-orange-600">
                                                缺货原因: {rfqItem.exceptionReason}
                                              </p>
                                            )}
                                          </div>

                                          {/* 订单信息 */}
                                          {(() => {
                                            // 调试：检查订单信息
                                            if (!orderInfo && rfqItem.orderNo) {
                                              console.warn('[前端] 订单信息缺失:', {
                                                rfqItemId: rfqItem.id,
                                                productName: rfqItem.productName,
                                                orderNo: rfqItem.orderNo,
                                                hasOrderInfo: !!rfqItem.orderInfo,
                                                rfqItemKeys: Object.keys(rfqItem || {}),
                                              });
                                            }
                                            return null;
                                          })()}
                                          {orderInfo ? (
                                            <div className="mb-3 rounded bg-blue-50 p-2 text-xs">
                                              <div className="mb-1 flex items-center justify-between">
                                                <div className="font-semibold text-gray-700">收货信息：</div>
                                                <button
                                                  onClick={() => {
                                                    const address = orderInfo.modifiedAddress || orderInfo.address || '';
                                                    const fullInfo = `${orderInfo.recipient} ${orderInfo.phone} ${address}`;
                                                    copyToClipboard(fullInfo, `full-${rfqItem.id}`);
                                                  }}
                                                  className="flex items-center gap-1 rounded-md bg-blue-600 px-2 py-0.5 text-xs font-medium text-white hover:bg-blue-700 active:bg-blue-800 transition-colors"
                                                  title="一键复制完整收货信息"
                                                >
                                                  {copiedField === `full-${rfqItem.id}` ? (
                                                    <>
                                                      <svg className="h-3 w-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                                                      </svg>
                                                      已复制
                                                    </>
                                                  ) : (
                                                    <>
                                                      <svg className="h-3 w-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z" />
                                                      </svg>
                                                      复制全部
                                                    </>
                                                  )}
                                                </button>
                                              </div>
                                              <div className="space-y-1 text-gray-600">
                                                <div>订单号：{orderInfo.orderNo}</div>
                                                <div className="flex items-center gap-1 group">
                                                  <span>收件人：{orderInfo.recipient}</span>
                                                  <button
                                                    onClick={() => copyToClipboard(orderInfo.recipient, `recipient-${rfqItem.id}`)}
                                                    className="opacity-0 group-hover:opacity-100 transition-opacity p-0.5 hover:bg-blue-100 rounded"
                                                    title="复制收件人"
                                                  >
                                                    {copiedField === `recipient-${rfqItem.id}` ? (
                                                      <svg className="h-3 w-3 text-green-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                                                      </svg>
                                                    ) : (
                                                      <svg className="h-3 w-3 text-gray-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z" />
                                                      </svg>
                                                    )}
                                                  </button>
                                                </div>
                                                <div className="flex items-center gap-1 group">
                                                  <span>手机：{orderInfo.phone}</span>
                                                  <button
                                                    onClick={() => copyToClipboard(orderInfo.phone, `phone-${rfqItem.id}`)}
                                                    className="opacity-0 group-hover:opacity-100 transition-opacity p-0.5 hover:bg-blue-100 rounded"
                                                    title="复制手机号"
                                                  >
                                                    {copiedField === `phone-${rfqItem.id}` ? (
                                                      <svg className="h-3 w-3 text-green-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                                                      </svg>
                                                    ) : (
                                                      <svg className="h-3 w-3 text-gray-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z" />
                                                      </svg>
                                                    )}
                                                  </button>
                                                </div>
                                                <div className="flex items-start gap-1 group">
                                                  <span>地址：{orderInfo.modifiedAddress || orderInfo.address}</span>
                                                  <button
                                                    onClick={() => copyToClipboard(orderInfo.modifiedAddress || orderInfo.address || '', `address-${rfqItem.id}`)}
                                                    className="opacity-0 group-hover:opacity-100 transition-opacity p-0.5 hover:bg-blue-100 rounded flex-shrink-0"
                                                    title="复制地址"
                                                  >
                                                    {copiedField === `address-${rfqItem.id}` ? (
                                                      <svg className="h-3 w-3 text-green-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                                                      </svg>
                                                    ) : (
                                                      <svg className="h-3 w-3 text-gray-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z" />
                                                      </svg>
                                                    )}
                                                  </button>
                                                </div>
                                                {orderInfo.modifiedAddress && orderInfo.modifiedAddress !== orderInfo.address && (
                                                  <div className="text-orange-600">原地址：{orderInfo.address}</div>
                                                )}
                                                {orderInfo.userNickname && (
                                                  <div>用户昵称：{orderInfo.userNickname}</div>
                                                )}
                                                {orderInfo.orderTime && (
                                                  <div>订单时间：{new Date(orderInfo.orderTime).toLocaleString('zh-CN')}</div>
                                                )}
                                              </div>
                                            </div>
                                          ) : rfqItem.orderNo ? (
                                            <div className="mb-3 rounded bg-yellow-50 p-2 text-xs text-yellow-800">
                                              <div className="font-semibold">⚠️ 订单信息未加载</div>
                                              <div className="mt-1 text-gray-600">订单号：{rfqItem.orderNo}</div>
                                              <div className="mt-1 text-gray-500">请联系管理员检查订单信息</div>
                                            </div>
                                          ) : null}

                                          {/* 物流单号 */}
                                          <div className="mb-2">
                                            <label className="mb-1 block text-xs font-medium text-gray-700">
                                              物流单号
                                            </label>
                                            {editingAward === award.id && trackingForm.rfqItemId === rfqItem.id ? (
                                              <div className="space-y-2">
                                                <input
                                                  type="text"
                                                  placeholder="物流单号"
                                                  value={trackingForm.trackingNo}
                                                  onChange={(e) => setTrackingForm({ ...trackingForm, trackingNo: e.target.value })}
                                                  className="w-full rounded border border-gray-300 px-2 py-1 text-xs !text-gray-900 !bg-white"
                                                />
                                                <input
                                                  type="text"
                                                  placeholder="快递公司"
                                                  value={trackingForm.carrier}
                                                  onChange={(e) => setTrackingForm({ ...trackingForm, carrier: e.target.value })}
                                                  className="w-full rounded border border-gray-300 px-2 py-1 text-xs !text-gray-900 !bg-white"
                                                />
                                                <div className="flex gap-2">
                                                  <button
                                                    onClick={() => handleSaveTracking(award.id, rfqItem.id)}
                                                    className="flex-1 rounded bg-blue-600 px-2 py-1 text-xs text-white hover:bg-blue-700"
                                                  >
                                                    保存
                                                  </button>
                                                  <button
                                                    onClick={() => {
                                                      setEditingAward(null);
                                                      setTrackingForm({ rfqItemId: '', trackingNo: '', carrier: '' });
                                                    }}
                                                    className="flex-1 rounded bg-gray-300 px-2 py-1 text-xs text-gray-700 hover:bg-gray-400"
                                                  >
                                                    取消
                                                  </button>
                                                </div>
                                              </div>
                                            ) : (
                                              <div className="space-y-2">
                                                {shipment ? (
                                                  <div className="text-xs text-gray-600">
                                                    <div>物流单号：{shipment.trackingNo}</div>
                                                    <div>快递公司：{shipment.carrier || '-'}</div>
                                                    <div className="mt-2 flex gap-2">
                                                      <button
                                                        onClick={() => {
                                                          setEditingAward(award.id);
                                                          setTrackingForm({ 
                                                            rfqItemId: rfqItem.id, 
                                                            trackingNo: shipment.trackingNo || '', 
                                                            carrier: shipment.carrier || '' 
                                                          });
                                                        }}
                                                        className="flex-1 rounded bg-blue-600 px-2 py-1 text-xs text-white hover:bg-blue-700"
                                                      >
                                                        修改
                                                      </button>
                                                      <label className="flex-1 cursor-pointer rounded bg-green-600 px-2 py-1 text-center text-xs text-white hover:bg-green-700">
                                                        <input
                                                          type="file"
                                                          accept="image/*"
                                                          className="hidden"
                                                          onChange={(e) => {
                                                            if (e.target.files && e.target.files[0]) {
                                                              handleUploadLabel(award.id, rfqItem.id, e.target.files[0]);
                                                              e.target.value = ''; // 重置input
                                                            }
                                                          }}
                                                        />
                                                        上传面单
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
                                                      className="w-full rounded bg-yellow-600 px-2 py-1 text-xs text-white hover:bg-yellow-700"
                                                    >
                                                      手动输入物流单号
                                                    </button>
                                                    <label className="block w-full cursor-pointer rounded bg-green-600 px-2 py-1 text-center text-xs text-white hover:bg-green-700">
                                                      <input
                                                        type="file"
                                                        accept="image/*"
                                                        className="hidden"
                                                        onChange={(e) => {
                                                          if (e.target.files && e.target.files[0]) {
                                                            handleUploadLabel(award.id, rfqItem.id, e.target.files[0]);
                                                            e.target.value = ''; // 重置input
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
                                            <label className="mb-1 block text-xs font-medium text-gray-700">
                                              发货照片/视频
                                            </label>
                                            {shipmentPhotos.length > 0 ? (
                                              <div className="mb-2 grid grid-cols-3 gap-2">
                                                {shipmentPhotos.map((photoUrl: string, index: number) => {
                                                  const isVideo = photoUrl.match(/\.(mp4|avi|mov|wmv)$/i);
                                                  console.log('📋 [前端] 渲染照片:', { index, photoUrl, isVideo, rfqItemId: rfqItem.id });
                                                  return (
                                                    <div 
                                                      key={`photo-${rfqItem.id}-${index}`} 
                                                      className="relative group cursor-pointer" 
                                                      onClick={() => {
                                                        console.log('📋 [前端] 点击预览照片:', photoUrl);
                                                        setPreviewImage({ url: getProxiedImageUrl(photoUrl), isVideo: !!isVideo });
                                                      }}
                                                    >
                                                      {isVideo ? (
                                                        <video src={photoUrl} className="h-20 w-full rounded border object-cover" controls onError={handleVideoError} />
                                                      ) : (
                                                        <>
                                                          <img 
                                                            src={getProxiedImageUrl(photoUrl)} 
                                                            alt={`发货照片 ${index + 1}`} 
                                                            className="h-20 w-full rounded border object-cover hover:opacity-80 transition-opacity" 
                                                            onError={(e) => {
                                                              console.error('图片加载失败:', photoUrl);
                                                              handleImageError(e);
                                                            }}
                                                            loading="lazy"
                                                            onLoad={() => {
                                                              console.log('📋 [前端] 图片加载成功:', photoUrl);
                                                            }}
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
                                              <div className="text-xs text-gray-500">
                                                {shipment ? '暂无照片' : '未创建发货单'}
                                                {shipment && shipment.packages && shipment.packages.length > 0 && (
                                                  <div className="mt-1 text-red-500">
                                                    调试：发货单有 {shipment.packages.length} 个包裹，但照片为空
                                                  </div>
                                                )}
                                              </div>
                                            )}
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
                                          </div>
                                        </div>
                                      );
                                    })}
                                  </div>
                                )}
                              </div>
                            );
                          })()}
                            </div>
                          );
                        }
                        return null;
                      })()}
                    </div>
                  );
                })}
              </div>
            ) : (
              <div className="rounded-xl bg-white p-12 text-center shadow-sm">
                <div className="mx-auto mb-4 flex h-16 w-16 items-center justify-center rounded-full bg-gray-100">
                  <svg className="h-8 w-8 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
                  </svg>
                </div>
                <h3 className="mb-2 text-lg font-semibold text-gray-900">暂无报价</h3>
                <p className="mb-6 text-sm text-gray-500">
                  您还没有提交任何报价
                </p>
              </div>
            )}
          </div>
        )}

        {/* 可报价询价单 */}
        {activeTab === 'available-rfqs' && (
          <div>
            {rfqs.length > 0 ? (
              <div className="grid gap-4 sm:grid-cols-1 lg:grid-cols-2 xl:grid-cols-3">
                {rfqs.map((rfq) => (
                  <div
                    key={rfq.id}
                    className="rounded-xl bg-white p-6 shadow-sm transition-all hover:shadow-lg"
                  >
                    <div className="mb-4">
                      <h3 className="font-semibold text-gray-900">{rfq.rfqNo}</h3>
                      <p className="mt-1 text-sm text-gray-600">{rfq.title}</p>
                      {rfq.description && (
                        <p className="mt-2 text-sm text-gray-500 line-clamp-2">{rfq.description}</p>
                      )}
                    </div>

                    <div className="space-y-2 text-sm">
                      <div className="flex items-center justify-between">
                        <span className="text-gray-600">截止时间</span>
                        <span className="text-gray-900">
                          {new Date(rfq.deadline).toLocaleString('zh-CN')}
                        </span>
                      </div>
                      <div className="flex items-center justify-between">
                        <span className="text-gray-600">询价类型</span>
                        <span className="text-gray-900">
                          {rfq.type === 'AUCTION' ? '竞价' : rfq.type === 'FIXED' ? '固定价' : '询价'}
                        </span>
                      </div>
                      {rfq.items && rfq.items.length > 0 && (
                        <>
                          <div className="flex items-center justify-between">
                            <span className="text-gray-600">商品数量</span>
                            <span className="text-gray-900">{rfq.items.length} 个</span>
                          </div>
                          {/* 显示商品明细预览 */}
                          <div className="mt-2 rounded-lg border border-gray-200 bg-gray-50 p-2">
                            <div className="text-xs font-medium text-gray-700 mb-1">商品明细：</div>
                            <div className="space-y-1 max-h-32 overflow-y-auto">
                              {rfq.items.slice(0, 3).map((item: any, idx: number) => (
                                <div key={item.id || idx} className="text-xs text-gray-600">
                                  • {item.productName} × {item.quantity} {item.unit || '件'}
                                </div>
                              ))}
                              {rfq.items.length > 3 && (
                                <div className="text-xs text-gray-500">
                                  ...还有 {rfq.items.length - 3} 个商品
                                </div>
                              )}
                            </div>
                          </div>
                        </>
                      )}
                    </div>

                    <button
                      onClick={async () => {
                        console.log('📋 点击提交报价，询价单数据:', {
                          id: rfq.id,
                          rfqNo: rfq.rfqNo,
                          itemsCount: rfq.items?.length || 0,
                          items: rfq.items,
                        });
                        
                        // 重新从后端获取询价单详情，确保包含最新的商品明细
                        try {
                          console.log('📋 重新获取询价单详情，ID:', rfq.id);
                          const detailResponse = await api.get(`/rfqs/${rfq.id}`);
                          const rfqDetail = detailResponse.data.data || detailResponse.data;
                          console.log('📋 获取到的询价单详情:', {
                            id: rfqDetail.id,
                            rfqNo: rfqDetail.rfqNo,
                            itemsCount: rfqDetail.items?.length || 0,
                            items: rfqDetail.items,
                          });
                          
                          setSelectedRfq(rfqDetail);
                          
                          // 检查是否已有报价
                          try {
                            const existingQuoteResponse = await api.get('/quotes', {
                              params: { rfqId: rfqDetail.id }
                            });
                            const existingQuotes = existingQuoteResponse.data.data || existingQuoteResponse.data || [];
                            const existingQuote = Array.isArray(existingQuotes) && existingQuotes.length > 0 
                              ? existingQuotes[0] 
                              : null;
                            
                            if (existingQuote && existingQuote.items) {
                              // 已有报价：加载已报价的商品信息
                              console.log('📋 发现已有报价，加载已报价商品:', existingQuote.items);
                              setIsUpdatingQuote(true);
                              const initialItems = (rfqDetail.items || []).map((item: any) => {
                                const existingQuoteItem = existingQuote.items.find((qi: any) => qi.rfqItemId === item.id);
                                return {
                                  rfqItemId: item.id,
                                  selected: !!existingQuoteItem, // 已报价的商品默认选中
                                  price: existingQuoteItem ? String(existingQuoteItem.price || '') : '',
                                  deliveryDays: existingQuoteItem ? String(existingQuoteItem.deliveryDays || '') : '',
                                  notes: existingQuoteItem ? (existingQuoteItem.notes || '') : '',
                                };
                              });
                              setQuoteForm({
                                price: String(existingQuote.price || ''),
                                deliveryDays: String(existingQuote.deliveryDays || ''),
                                notes: existingQuote.notes || '',
                                items: initialItems,
                              });
                            } else {
                              setIsUpdatingQuote(false);
                              // 没有报价：初始化空表单，并加载历史报价记忆
                              const initialItems = await Promise.all(
                                (rfqDetail.items || []).map(async (item: any) => {
                                  // 尝试加载该商品的历史报价
                                  let memoryPrice = '';
                                  let memoryDeliveryDays = '';
                                  let memoryNotes = '';
                                  
                                  try {
                                    const memoryResponse = await api.get('/quotes/previous-prices', {
                                      params: { productName: item.productName },
                                    });
                                    const memoryData = memoryResponse.data.data || memoryResponse.data || [];
                                    if (Array.isArray(memoryData) && memoryData.length > 0) {
                                      // 使用最近一次报价的价格
                                      const latestQuote = memoryData[0];
                                      memoryPrice = String(latestQuote.price || '');
                                      memoryDeliveryDays = String(latestQuote.deliveryDays || '');
                                      memoryNotes = latestQuote.notes || '';
                                      console.log('📝 加载报价记忆:', {
                                        productName: item.productName,
                                        price: memoryPrice,
                                        deliveryDays: memoryDeliveryDays,
                                      });
                                    }
                                  } catch (memoryError) {
                                    // 如果加载失败，忽略错误，继续使用空值
                                    console.debug('加载报价记忆失败:', memoryError);
                                  }
                                  
                                  return {
                                    rfqItemId: item.id,
                                    selected: false, // 默认不选中，供应商需要手动选择
                                    price: memoryPrice,
                                    deliveryDays: memoryDeliveryDays,
                                    notes: memoryNotes,
                                  };
                                })
                              );
                              
                              setQuoteForm({
                                price: '',
                                deliveryDays: '',
                                notes: '',
                                items: initialItems,
                              });
                            }
                          } catch (quoteError) {
                            // 如果获取报价失败，使用空表单
                            console.warn('⚠️ 获取已有报价失败，使用空表单:', quoteError);
                            const initialItems = (rfqDetail.items || []).map((item: any) => ({
                              rfqItemId: item.id,
                              selected: false,
                              price: '',
                              deliveryDays: '',
                              notes: '',
                            }));
                            setQuoteForm({
                              price: '',
                              deliveryDays: '',
                              notes: '',
                              items: initialItems,
                            });
                          }
                          setShowQuoteForm(true);
                        } catch (error: any) {
                          console.error('❌ 获取询价单详情失败:', error);
                          // 如果获取详情失败，使用列表中的数据
                          setSelectedRfq(rfq);
                          
                          // 检查是否已有报价
                          try {
                            const existingQuoteResponse = await api.get('/quotes', {
                              params: { rfqId: rfq.id }
                            });
                            const existingQuotes = existingQuoteResponse.data.data || existingQuoteResponse.data || [];
                            const existingQuote = Array.isArray(existingQuotes) && existingQuotes.length > 0 
                              ? existingQuotes[0] 
                              : null;
                            
                            if (existingQuote && existingQuote.items) {
                              // 已有报价：加载已报价的商品信息
                              setIsUpdatingQuote(true);
                              const initialItems = (rfq.items || []).map((item: any) => {
                                const existingQuoteItem = existingQuote.items.find((qi: any) => qi.rfqItemId === item.id);
                                return {
                                  rfqItemId: item.id,
                                  selected: !!existingQuoteItem,
                                  price: existingQuoteItem ? String(existingQuoteItem.price || '') : '',
                                  deliveryDays: existingQuoteItem ? String(existingQuoteItem.deliveryDays || '') : '',
                                  notes: existingQuoteItem ? (existingQuoteItem.notes || '') : '',
                                };
                              });
                              setQuoteForm({
                                price: String(existingQuote.price || ''),
                                deliveryDays: String(existingQuote.deliveryDays || ''),
                                notes: existingQuote.notes || '',
                                items: initialItems,
                              });
                            } else {
                              setIsUpdatingQuote(false);
                              // 没有报价：初始化空表单，并加载历史报价记忆
                              const initialItems = await Promise.all(
                                (rfq.items || []).map(async (item: any) => {
                                  // 尝试加载该商品的历史报价
                                  let memoryPrice = '';
                                  let memoryDeliveryDays = '';
                                  let memoryNotes = '';
                                  
                                  try {
                                    const memoryResponse = await api.get('/quotes/previous-prices', {
                                      params: { productName: item.productName },
                                    });
                                    const memoryData = memoryResponse.data.data || memoryResponse.data || [];
                                    if (Array.isArray(memoryData) && memoryData.length > 0) {
                                      // 使用最近一次报价的价格
                                      const latestQuote = memoryData[0];
                                      memoryPrice = String(latestQuote.price || '');
                                      memoryDeliveryDays = String(latestQuote.deliveryDays || '');
                                      memoryNotes = latestQuote.notes || '';
                                      console.log('📝 加载报价记忆:', {
                                        productName: item.productName,
                                        price: memoryPrice,
                                        deliveryDays: memoryDeliveryDays,
                                      });
                                    }
                                  } catch (memoryError) {
                                    // 如果加载失败，忽略错误，继续使用空值
                                    console.debug('加载报价记忆失败:', memoryError);
                                  }
                                  
                                  return {
                                    rfqItemId: item.id,
                                    selected: false,
                                    price: memoryPrice,
                                    deliveryDays: memoryDeliveryDays,
                                    notes: memoryNotes,
                                  };
                                })
                              );
                              
                              setQuoteForm({
                                price: '',
                                deliveryDays: '',
                                notes: '',
                                items: initialItems,
                              });
                            }
                          } catch (quoteError) {
                            // 如果获取报价失败，使用空表单
                            const initialItems = (rfq.items || []).map((item: any) => ({
                              rfqItemId: item.id,
                              selected: false,
                              price: '',
                              deliveryDays: '',
                              notes: '',
                            }));
                            setQuoteForm({
                              price: '',
                              deliveryDays: '',
                              notes: '',
                              items: initialItems,
                            });
                          }
                          setShowQuoteForm(true);
                        }
                      }}
                      className="mt-4 w-full rounded-lg bg-blue-600 px-4 py-3 text-sm font-medium text-white transition-all active:bg-blue-700 sm:py-2 sm:hover:bg-blue-700"
                    >
                      提交报价 {rfq.items && rfq.items.length > 0 && `(${rfq.items.length}个商品)`}
                    </button>
                  </div>
                ))}
              </div>
            ) : (
              <div className="rounded-xl bg-white p-12 text-center shadow-sm">
                <div className="mx-auto mb-4 flex h-16 w-16 items-center justify-center rounded-full bg-gray-100">
                  <svg className="h-8 w-8 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
                  </svg>
                </div>
                <h3 className="mb-2 text-lg font-semibold text-gray-900">暂无询价单</h3>
                <p className="mb-6 text-sm text-gray-500">
                  当前没有可报价的询价单
                </p>
              </div>
            )}
          </div>
        )}

        {/* 报价表单弹窗 - 移动端优化 */}
        {showQuoteForm && selectedRfq && (
          <div className="fixed inset-0 z-50 flex items-end justify-center bg-black bg-opacity-50 sm:items-center sm:bg-opacity-50">
            <div className="w-full max-w-2xl max-h-[95vh] sm:max-h-[90vh] rounded-t-2xl bg-white shadow-2xl sm:rounded-xl sm:my-8 flex flex-col overflow-hidden">
              {/* 移动端拖拽指示器 */}
              <div className="mx-auto mt-2 h-1 w-12 rounded-full bg-gray-300 sm:hidden flex-shrink-0"></div>
              
              <div className="flex-shrink-0 px-4 pt-4 pb-3 sm:px-6 sm:pt-6 sm:pb-4 border-b border-gray-200">
                <div className="flex items-center justify-between">
                  <h2 className="text-lg font-bold text-gray-900 sm:text-xl">
                    {isUpdatingQuote ? '更新报价' : '提交报价'}
                  </h2>
                  <button
                    onClick={() => {
                      setShowQuoteForm(false);
                      setSelectedRfq(null);
                      setIsUpdatingQuote(false);
                      setQuoteForm({ price: '', deliveryDays: '', notes: '', items: [] as Array<{
                        rfqItemId: string;
                        selected: boolean;
                        price: string;
                        deliveryDays: string;
                        notes: string;
                      }> });
                    }}
                    className="flex h-10 w-10 items-center justify-center rounded-full text-gray-400 active:bg-gray-100 sm:hover:bg-gray-100 sm:hover:text-gray-600"
                  >
                    <svg className="h-6 w-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                    </svg>
                  </button>
                </div>
              </div>

              <div className="flex-shrink-0 px-4 py-3 sm:px-6 sm:py-4">
                <div className="rounded-lg bg-gray-50 p-3 sm:p-4">
                  <p className="text-sm font-medium text-gray-900">{selectedRfq.rfqNo}</p>
                  <p className="mt-1 text-xs sm:text-sm text-gray-600 line-clamp-2">{selectedRfq.title}</p>
                </div>
              </div>

              <form onSubmit={handleSubmitQuote} className="flex-1 flex flex-col overflow-hidden">
                <div className="flex-1 overflow-y-auto overscroll-contain px-4 sm:px-6 space-y-4">
                  {/* 商品明细报价 */}
                  {(() => {
                    console.log('📋 报价表单渲染，selectedRfq:', selectedRfq);
                    console.log('📋 selectedRfq.items:', selectedRfq?.items);
                    return null;
                  })()}
                  {selectedRfq.items && selectedRfq.items.length > 0 ? (
                    <div className="space-y-4">
                      <div className="flex items-center justify-between">
                        <h3 className="text-sm font-semibold text-gray-900">商品报价明细</h3>
                        <div className="flex items-center gap-3">
                          {/* 统计相同商品数量 */}
                          {(() => {
                            const productCounts = selectedRfq.items.reduce((acc: any, item: any) => {
                              acc[item.productName] = (acc[item.productName] || 0) + 1;
                              return acc;
                            }, {} as Record<string, number>);
                            const duplicateProducts = Object.entries(productCounts).filter(([_, count]) => typeof count === 'number' && count > 1);
                            return duplicateProducts.length > 0 && (
                              <span className="text-xs text-gray-500">
                                有 {duplicateProducts.length} 种商品存在多个订单
                              </span>
                            );
                          })()}
                          <span className="text-xs text-gray-500">
                            已选择 {quoteForm.items.filter(item => item.selected).length} / {selectedRfq.items.length} 个商品
                          </span>
                        </div>
                      </div>
                      <div className="space-y-3 sm:space-y-4">
                      {selectedRfq.items.map((rfqItem: any, index: number) => {
                        // 统计相同商品的数量
                        const sameProductCount = selectedRfq.items.filter((i: any) => i.productName === rfqItem.productName).length;
                        const sameProductItems = selectedRfq.items.filter((i: any) => i.productName === rfqItem.productName);
                        const hasSameProduct = sameProductCount > 1;
                        const quoteItem = quoteForm.items.find(item => item.rfqItemId === rfqItem.id) || {
                          rfqItemId: rfqItem.id,
                          selected: false,
                          price: '',
                          deliveryDays: '',
                          notes: '',
                        };
                        const itemIndex = quoteForm.items.findIndex(item => item.rfqItemId === rfqItem.id);
                        const isSelected = quoteItem.selected;
                        const hasExistingPrice = quoteItem.price && parseFloat(quoteItem.price) > 0; // 是否已有报价
                        
                        return (
                          <div key={rfqItem.id} className={`rounded-lg border p-3 sm:p-4 transition-all ${
                            isSelected 
                              ? hasExistingPrice
                                ? 'border-green-300 bg-green-50' // 已报价的商品用绿色
                                : 'border-blue-300 bg-blue-50' // 新选择的商品用蓝色
                              : 'border-gray-200 bg-white opacity-60'
                          }`}>
                            {/* 商品信息和选择开关 - 移动端优化 */}
                            <div className="mb-3 flex items-start justify-between gap-2">
                              <div className="flex-1 min-w-0">
                                <div className="flex items-center gap-2.5">
                                  {hasExistingPrice && (
                                    <span className="inline-flex items-center rounded-full bg-green-100 px-2 py-0.5 text-xs font-medium text-green-800">
                                      已报价
                                    </span>
                                  )}
                                  <input
                                    type="checkbox"
                                    checked={isSelected}
                                    onChange={async (e) => {
                                      const newItems = [...quoteForm.items];
                                      if (itemIndex >= 0) {
                                        const item = newItems[itemIndex];
                                        const isChecked = e.target.checked;
                                        
                                        // 如果选中且价格为空，尝试加载历史报价
                                        if (isChecked && !item.price) {
                                          try {
                                            const memoryResponse = await api.get('/quotes/previous-prices', {
                                              params: { productName: rfqItem.productName },
                                            });
                                            const memoryData = memoryResponse.data.data || memoryResponse.data || [];
                                            if (Array.isArray(memoryData) && memoryData.length > 0) {
                                              const latestQuote = memoryData[0];
                                              item.price = String(latestQuote.price || '');
                                              item.deliveryDays = String(latestQuote.deliveryDays || '');
                                              item.notes = latestQuote.notes || '';
                                              console.log('📝 选择商品时加载报价记忆:', {
                                                productName: rfqItem.productName,
                                                price: item.price,
                                              });
                                            }
                                          } catch (memoryError) {
                                            console.debug('加载报价记忆失败:', memoryError);
                                          }
                                        }
                                        
                                        newItems[itemIndex] = { 
                                          ...item, 
                                          selected: isChecked,
                                          // 如果取消选择，清空价格
                                          price: isChecked ? item.price : '',
                                        };
                                      } else {
                                        newItems.push({ 
                                          ...quoteItem, 
                                          selected: e.target.checked 
                                        });
                                      }
                                      setQuoteForm({ ...quoteForm, items: newItems });
                                    }}
                                    className="h-5 w-5 flex-shrink-0 rounded border-gray-300 text-blue-600 focus:ring-2 focus:ring-blue-500 focus:ring-offset-0"
                                  />
                                  <h4 className="font-medium text-gray-900 text-sm sm:text-base flex-1 min-w-0">{rfqItem.productName}</h4>
                                  {hasSameProduct && (
                                    <span className="inline-flex items-center px-2 py-0.5 rounded text-xs font-medium bg-purple-100 text-purple-800">
                                      相同商品 ×{sameProductCount}
                                    </span>
                                  )}
                                </div>
                                <div className="mt-1.5 ml-7.5 flex flex-wrap gap-2 sm:gap-4 text-xs text-gray-600">
                                  <span>数量: {rfqItem.quantity} {rfqItem.unit || '件'}</span>
                                  {rfqItem.description && <span className="line-clamp-1 flex-1 min-w-0">{rfqItem.description}</span>}
                                </div>
                              </div>
                            </div>
                            
                            {/* 只有选中的商品才显示报价输入框 - 移动端优化 */}
                            {isSelected && (
                              <div className="ml-7.5 space-y-3">
                                {/* 价格信息提示 */}
                                <div className="space-y-2">
                                  {rfqItem.maxPrice && (
                                    <div className="rounded-md bg-green-50 border border-green-200 p-2.5">
                                      <div className="text-xs text-green-800">
                                        <span className="font-semibold">最高限价：</span>¥{Number(rfqItem.maxPrice).toFixed(2)}
                                      </div>
                                    </div>
                                  )}
                                  {rfqItem.instantPrice && (
                                    <div className="rounded-md bg-blue-50 border border-blue-200 p-2.5">
                                      <div className="text-xs text-blue-800">
                                        <span className="font-semibold">一口价：</span>¥{Number(rfqItem.instantPrice).toFixed(2)}
                                        <span className="ml-1 text-blue-600">（报价≤此价格时自动中标）</span>
                                      </div>
                                    </div>
                                  )}
                                </div>
                                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                                  <div>
                                    <label className="block text-xs font-medium text-gray-700 mb-1.5">
                                      单价 (¥) <span className="text-red-500">*</span>
                                      {rfqItem.maxPrice && (
                                        <span className="ml-1 text-xs text-gray-500 hidden sm:inline">(不超过 ¥{Number(rfqItem.maxPrice).toFixed(2)})</span>
                                      )}
                                    </label>
                                    {/* 一口价快捷按钮 */}
                                    {rfqItem.instantPrice && (
                                      <div className="mb-2">
                                        <button
                                          type="button"
                                          onClick={() => {
                                            const instantPrice = Number(rfqItem.instantPrice).toFixed(2);
                                            const newItems = [...quoteForm.items];
                                            if (itemIndex >= 0) {
                                              newItems[itemIndex] = { ...newItems[itemIndex], price: instantPrice };
                                            } else {
                                              newItems.push({ ...quoteItem, price: instantPrice });
                                            }
                                            setQuoteForm({ ...quoteForm, items: newItems });
                                          }}
                                          className="inline-flex items-center gap-1.5 rounded-md bg-blue-600 px-3 py-1.5 text-xs font-medium text-white transition-all hover:bg-blue-700 active:bg-blue-800"
                                        >
                                          <svg className="h-3.5 w-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 10V3L4 14h7v7l9-11h-7z" />
                                          </svg>
                                          使用一口价 ¥{Number(rfqItem.instantPrice).toFixed(2)}
                                        </button>
                                      </div>
                                    )}
                                    <input
                                      type="number"
                                      inputMode="decimal"
                                      step="0.01"
                                      required
                                      max={rfqItem.maxPrice ? Number(rfqItem.maxPrice) : undefined}
                                      value={quoteItem.price}
                                      onChange={(e) => {
                                        const price = parseFloat(e.target.value);
                                        if (rfqItem.maxPrice && price > Number(rfqItem.maxPrice)) {
                                          alert(`报价不能超过最高限价 ¥${Number(rfqItem.maxPrice).toFixed(2)}`);
                                          return;
                                        }
                                        const newItems = [...quoteForm.items];
                                        if (itemIndex >= 0) {
                                          newItems[itemIndex] = { ...newItems[itemIndex], price: e.target.value };
                                        } else {
                                          newItems.push({ ...quoteItem, price: e.target.value });
                                        }
                                        setQuoteForm({ ...quoteForm, items: newItems });
                                      }}
                                      className={`block w-full rounded-lg border px-3 py-2.5 text-base !text-gray-900 !bg-white shadow-sm focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-0 ${
                                        rfqItem.maxPrice && quoteItem.price && parseFloat(quoteItem.price) > Number(rfqItem.maxPrice)
                                          ? 'border-red-500 focus:border-red-500 focus:ring-red-500'
                                          : 'border-gray-300 focus:border-blue-500'
                                      }`}
                                      placeholder="0.00"
                                    />
                                    {rfqItem.maxPrice && quoteItem.price && parseFloat(quoteItem.price) > Number(rfqItem.maxPrice) && (
                                      <p className="mt-1 text-xs text-red-600">报价超过最高限价</p>
                                    )}
                                    {hasSameProduct && (
                                      <div className="mt-2 rounded-md bg-purple-50 border border-purple-200 p-2">
                                        <label className="flex items-center gap-2 text-xs text-purple-800 cursor-pointer">
                                          <input
                                            type="checkbox"
                                            checked={(() => {
                                              // 检查是否所有相同商品都已选择且价格相同
                                              const sameProductSelectedItems = sameProductItems
                                                .map((sameItem: RfqItem) => quoteForm.items.find(item => item.rfqItemId === sameItem.id))
                                                .filter(Boolean);
                                              if (sameProductSelectedItems.length !== sameProductCount) return false;
                                              const firstPrice = sameProductSelectedItems[0]?.price;
                                              return sameProductSelectedItems.every((item: { price?: string }) => item?.price === firstPrice && firstPrice);
                                            })()}
                                            onChange={(e) => {
                                              // 批量应用到所有相同商品
                                              if (e.target.checked && quoteItem.price) {
                                                const newItems = [...quoteForm.items];
                                                sameProductItems.forEach((sameItem: any) => {
                                                  const sameItemIndex = newItems.findIndex(item => item.rfqItemId === sameItem.id);
                                                  if (sameItemIndex >= 0) {
                                                    newItems[sameItemIndex] = {
                                                      ...newItems[sameItemIndex],
                                                      price: quoteItem.price,
                                                      deliveryDays: quoteItem.deliveryDays,
                                                      notes: quoteItem.notes,
                                                      selected: true,
                                                    };
                                                  } else {
                                                    newItems.push({
                                                      rfqItemId: sameItem.id,
                                                      selected: true,
                                                      price: quoteItem.price,
                                                      deliveryDays: quoteItem.deliveryDays,
                                                      notes: quoteItem.notes,
                                                    });
                                                  }
                                                });
                                                setQuoteForm({ ...quoteForm, items: newItems });
                                              }
                                            }}
                                            className="rounded border-gray-300 text-purple-600 focus:ring-purple-500"
                                          />
                                          <span>应用到所有相同商品（{sameProductCount}个）</span>
                                        </label>
                                      </div>
                                    )}
                                  </div>
                                  <div>
                                    <label className="block text-xs font-medium text-gray-700 mb-1.5">
                                      交付天数
                                    </label>
                                    <input
                                      type="number"
                                      inputMode="numeric"
                                      min="0"
                                      value={quoteItem.deliveryDays}
                                      onChange={(e) => {
                                        const newItems = [...quoteForm.items];
                                        if (itemIndex >= 0) {
                                          newItems[itemIndex] = { ...newItems[itemIndex], deliveryDays: e.target.value };
                                        } else {
                                          newItems.push({ ...quoteItem, deliveryDays: e.target.value });
                                        }
                                        setQuoteForm({ ...quoteForm, items: newItems });
                                      }}
                                      className="block w-full rounded-lg border border-gray-300 px-3 py-2.5 text-base !text-gray-900 !bg-white shadow-sm focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-0"
                                      placeholder="天数"
                                    />
                                  </div>
                                </div>
                                
                                <div>
                                  <label className="block text-xs font-medium text-gray-700 mb-1.5">
                                    备注
                                  </label>
                                  <textarea
                                    rows={2}
                                    value={quoteItem.notes}
                                    onChange={(e) => {
                                      const newItems = [...quoteForm.items];
                                      if (itemIndex >= 0) {
                                        newItems[itemIndex] = { ...newItems[itemIndex], notes: e.target.value };
                                      } else {
                                        newItems.push({ ...quoteItem, notes: e.target.value });
                                      }
                                      setQuoteForm({ ...quoteForm, items: newItems });
                                    }}
                                    className="block w-full rounded-lg border border-gray-300 px-3 py-2 text-sm !text-gray-900 !bg-white shadow-sm focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-0"
                                    placeholder="可选备注"
                                  />
                                </div>
                              </div>
                            )}
                            
                            {!isSelected && (
                              <div className="ml-7.5 text-xs text-gray-500 italic">
                                未选择此商品，将不对此商品报价
                              </div>
                            )}
                          </div>
                        );
                      })}
                    </div>
                  </div>
                ) : (
                  <div className="rounded-lg border border-yellow-200 bg-yellow-50 p-4">
                    <p className="text-sm text-yellow-800">
                      ⚠️ 该询价单没有商品明细，请使用总价报价。
                    </p>
                  </div>
                )}

                  {/* 总价（自动计算） */}
                  <div>
                    <label htmlFor="price" className="block text-sm font-medium text-gray-700">
                      总价 (¥) <span className="text-xs text-gray-500">（自动计算）</span>
                    </label>
                    <input
                      id="price"
                      type="number"
                      step="0.01"
                      required
                      value={(() => {
                        // 自动计算总价
                        let total = 0;
                        if (selectedRfq.items && quoteForm.items.length > 0) {
                          quoteForm.items.forEach((quoteItem) => {
                            const rfqItem = selectedRfq.items.find((item: any) => item.id === quoteItem.rfqItemId);
                            if (rfqItem && quoteItem.price) {
                              total += parseFloat(quoteItem.price) * (rfqItem.quantity || 1);
                            }
                          });
                        }
                        return total.toFixed(2);
                      })()}
                      readOnly
                      className="mt-1 block w-full rounded-lg border border-gray-300 bg-gray-50 px-3 py-2.5 text-base !text-gray-900 shadow-sm focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-0"
                      placeholder="0.00"
                    />
                    <p className="mt-1 text-xs text-gray-500">
                      总价 = 所有商品（单价 × 数量）的总和
                    </p>
                  </div>

                  <div>
                    <label htmlFor="deliveryDays" className="block text-sm font-medium text-gray-700">
                      整体交付天数
                    </label>
                    <input
                      id="deliveryDays"
                      type="number"
                      inputMode="numeric"
                      min="0"
                      value={quoteForm.deliveryDays}
                      onChange={(e) => setQuoteForm({ ...quoteForm, deliveryDays: e.target.value })}
                      className="mt-1 block w-full rounded-lg border border-gray-300 px-3 py-2.5 text-base !text-gray-900 !bg-white shadow-sm focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-0"
                      placeholder="0"
                    />
                  </div>

                  <div>
                    <label htmlFor="notes" className="block text-sm font-medium text-gray-700">
                      整体备注
                    </label>
                    <textarea
                      id="notes"
                      rows={3}
                      value={quoteForm.notes}
                      onChange={(e) => setQuoteForm({ ...quoteForm, notes: e.target.value })}
                      className="mt-1 block w-full rounded-lg border border-gray-300 px-3 py-2.5 text-sm !text-gray-900 !bg-white shadow-sm focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-0"
                      placeholder="可选备注信息"
                    />
                  </div>
                </div>

                {/* 移动端底部固定操作栏 */}
                <div className="flex-shrink-0 flex gap-3 border-t border-gray-200 bg-white p-4 sm:pt-4">
                  <button
                    type="button"
                    onClick={() => {
                      setShowQuoteForm(false);
                      setSelectedRfq(null);
                      setQuoteForm({ price: '', deliveryDays: '', notes: '', items: [] });
                    }}
                    className="flex-1 rounded-lg border border-gray-300 bg-white px-4 py-3 text-sm font-medium text-gray-700 transition-all active:bg-gray-50 sm:py-2 sm:hover:bg-gray-50"
                  >
                    取消
                  </button>
                  <button
                    type="submit"
                    className="flex-1 rounded-lg bg-blue-600 px-4 py-3 text-sm font-medium text-white transition-all active:bg-blue-700 sm:py-2 sm:hover:bg-blue-700"
                  >
                    提交报价
                  </button>
                </div>
              </form>
            </div>
          </div>
        )}
      </div>

      {/* 图片预览模态框 */}
      {previewImage && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black bg-opacity-75"
          onClick={() => setPreviewImage(null)}
        >
          <div className="relative max-h-[90vh] max-w-[90vw]">
            {/* 图片或视频 */}
            <div
              className="relative max-h-[90vh] max-w-[90vw]"
              onClick={(e) => e.stopPropagation()}
            >
              {/* 关闭按钮 */}
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
                  onError={(e) => {
                    console.error('图片加载失败:', previewImage.url);
                    handleImageError(e);
                  }}
                />
              )}
            </div>

            {/* 提示文字 */}
            <div className="absolute bottom-4 left-1/2 -translate-x-1/2 rounded bg-black bg-opacity-50 px-4 py-2 text-sm text-white">
              按 ESC 键或点击背景关闭
            </div>
          </div>
        </div>
      )}

      {/* 缺货标记对话框 */}
      {showOutOfStockDialog && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black bg-opacity-50">
          <div className="w-full max-w-md rounded-xl bg-white p-6 shadow-xl">
            <h3 className="mb-4 text-lg font-semibold text-gray-900">标记缺货</h3>
            <div className="mb-4">
              <label className="mb-2 block text-sm font-medium text-gray-700">缺货原因 *</label>
              <textarea
                value={outOfStockReason}
                onChange={(e) => setOutOfStockReason(e.target.value)}
                rows={3}
                className="w-full rounded-md border border-gray-300 px-3 py-2 text-sm !text-gray-900 !bg-white shadow-sm focus:border-orange-500 focus:outline-none focus:ring-orange-500"
                placeholder="请输入缺货原因，例如：库存不足、暂时无法供货等..."
              />
            </div>
            <div className="flex gap-3">
              <button
                onClick={() => {
                  setShowOutOfStockDialog(null);
                  setOutOfStockReason('');
                }}
                disabled={markingOutOfStock}
                className="flex-1 rounded-lg border border-gray-300 bg-white px-4 py-2 text-sm font-medium text-gray-700 transition-colors hover:bg-gray-50 disabled:opacity-50"
              >
                取消
              </button>
              <button
                onClick={handleMarkOutOfStock}
                disabled={markingOutOfStock || !outOfStockReason.trim()}
                className="flex-1 rounded-lg bg-orange-600 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-orange-700 disabled:opacity-50"
              >
                {markingOutOfStock ? '处理中...' : '确认标记'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

