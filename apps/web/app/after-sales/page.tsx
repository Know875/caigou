'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { authApi } from '@/lib/auth';
import api from '@/lib/api';
import { getProxiedImageUrl } from '@/lib/utils/image-proxy';
import { handleImageError, handleVideoError } from '@/lib/utils/image-placeholder';

interface AfterSalesCase {
  id: string;
  caseNo: string;
  orderId: string;
  shipmentId?: string;
  type: string;
  status: string;
  priority: string;
  description: string;
  claimAmount?: number;
  inventoryDisposition?: string;
  resolution?: string;
  resolvedAt?: Date;
  slaDeadline?: Date;
  createdAt: Date;
  updatedAt: Date;
  supplierId?: string;
  order: {
    id: string;
    orderNo: string;
    productName: string;
    recipient: string;
    phone: string;
    address: string;
  };
  shipment?: {
    id: string;
    trackingNo?: string;
    carrier?: string;
    source?: 'SUPPLIER' | 'ECOMMERCE';
    supplier?: {
      id: string;
      username: string;
    };
  };
  replacementShipment?: {
    id: string;
    trackingNo?: string;
    carrier?: string;
    supplier?: {
      id: string;
      username: string;
    };
  };
  handler?: {
    id: string;
    username: string;
  };
  supplier?: {
    id: string;
    username: string;
  };
  store?: {
    id: string;
    name: string;
    code: string;
  };
  attachments: Array<{
    id: string;
    fileUrl: string;
    fileType: string;
    fileName: string;
  }>;
  logs: Array<{
    id: string;
    action: string;
    description?: string;
    createdAt: Date;
    user?: {
      id: string;
      username: string;
    };
  }>;
}

const TYPE_LABELS: Record<string, string> = {
  DAMAGED: '破损',
  MISSING: '缺件',
  WRONG_ITEM: '错发',
  REPAIR: '换货',
  CLAIM: '补差价',
  DISCOUNT: '二手充新',
  SCRAP: '报废',
};

const STATUS_LABELS: Record<string, string> = {
  OPENED: '已打开',
  INSPECTING: '待质检',
  NEGOTIATING: '协商中',
  EXECUTING: '执行中',
  RESOLVED: '已解决',
  CLOSED: '已关闭',
  CANCELLED: '已取消',
};

const PRIORITY_LABELS: Record<string, string> = {
  LOW: '低',
  MEDIUM: '中',
  HIGH: '高',
  URGENT: '紧急',
};

const PRIORITY_COLORS: Record<string, string> = {
  LOW: 'bg-gray-100 text-gray-800',
  MEDIUM: 'bg-blue-100 text-blue-800',
  HIGH: 'bg-orange-100 text-orange-800',
  URGENT: 'bg-red-100 text-red-800',
};

const STATUS_COLORS: Record<string, string> = {
  OPENED: 'bg-blue-100 text-blue-800',
  INSPECTING: 'bg-yellow-100 text-yellow-800',
  NEGOTIATING: 'bg-purple-100 text-purple-800',
  EXECUTING: 'bg-orange-100 text-orange-800',
  RESOLVED: 'bg-green-100 text-green-800',
  CLOSED: 'bg-gray-100 text-gray-800',
  CANCELLED: 'bg-red-100 text-red-800',
};

export default function AfterSalesPage() {
  const router = useRouter();
  const [user, setUser] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [cases, setCases] = useState<AfterSalesCase[]>([]);
  const [selectedCase, setSelectedCase] = useState<AfterSalesCase | null>(null);
  const [showCreateForm, setShowCreateForm] = useState(false);
  const [showDetailModal, setShowDetailModal] = useState(false);
  const [statusFilter, setStatusFilter] = useState<string>('ALL');
  const [typeFilter, setTypeFilter] = useState<string>('ALL');
  const [priorityFilter, setPriorityFilter] = useState<string>('ALL');
  const [searchQuery, setSearchQuery] = useState('');
  const [editingResolution, setEditingResolution] = useState(false);
  const [resolutionText, setResolutionText] = useState('');
  const [progressDescription, setProgressDescription] = useState('');
  const [updatingResolution, setUpdatingResolution] = useState(false);
  const [submittingResolution, setSubmittingResolution] = useState(false);
  const [showAssignModal, setShowAssignModal] = useState(false);
  const [assigningSupplier, setAssigningSupplier] = useState(false);
  const [suppliers, setSuppliers] = useState<Array<{ id: string; username: string; email: string }>>([]);
  const [selectedSupplierId, setSelectedSupplierId] = useState('');
  const [confirming, setConfirming] = useState(false);
  const [replacementTrackingNo, setReplacementTrackingNo] = useState('');
  const [replacementCarrier, setReplacementCarrier] = useState('');
  const [uploadingReplacementTracking, setUploadingReplacementTracking] = useState(false);

  useEffect(() => {
    const currentUser = authApi.getCurrentUser();
    if (!currentUser) {
      router.push('/login');
      return;
    }

    // 鍏佽绠＄悊鍛樸€侀噰璐憳銆佷緵搴斿晢鍜岄棬搴楃敤鎴疯闂?
    if (currentUser.role !== 'ADMIN' && currentUser.role !== 'BUYER' && currentUser.role !== 'SUPPLIER' && currentUser.role !== 'STORE') {
      router.push('/dashboard');
      return;
    }

    setUser(currentUser);
    fetchCases();
    // 濡傛灉鏄噰璐憳鎴栫鐞嗗憳锛岃幏鍙栦緵搴斿晢鍒楄〃锛堢敤浜庝笅鍙戝伐鍗曪級
    if (currentUser.role === 'BUYER' || currentUser.role === 'ADMIN') {
      fetchSuppliers();
    }
  }, [router, statusFilter, typeFilter, priorityFilter]);

  const fetchSuppliers = async () => {
    try {
      const response = await api.get('/admin/suppliers');
      const suppliersData = response.data.data || response.data || [];
      setSuppliers(Array.isArray(suppliersData) ? suppliersData : []);
    } catch (error: any) {
      console.error('获取供应商列表失败', error);
      setSuppliers([]);
    }
  };

  const fetchCases = async () => {
    setLoading(true);
    try {
      const filters: any = {};
      if (statusFilter !== 'ALL') filters.status = statusFilter;
      if (typeFilter !== 'ALL') filters.type = typeFilter;

      const response = await api.get('/after-sales', { params: filters });
      let allCases = response.data?.data || response.data || [];

      // 瀹㈡埛绔繃婊や紭鍏堢骇鍜屾悳绱?
      if (priorityFilter !== 'ALL') {
        allCases = allCases.filter((c: AfterSalesCase) => c.priority === priorityFilter);
      }

      if (searchQuery) {
        const query = searchQuery.toLowerCase();
        allCases = allCases.filter(
          (c: AfterSalesCase) =>
            c.caseNo.toLowerCase().includes(query) ||
            c.order.orderNo.toLowerCase().includes(query) ||
            c.order.productName.toLowerCase().includes(query) ||
            c.description.toLowerCase().includes(query) ||
            c.shipment?.trackingNo?.toLowerCase().includes(query)
        );
      }

      setCases(allCases);
    } catch (error: any) {
      console.error('鑾峰彇鍞悗宸ュ崟澶辫触:', error);
      setCases([]);
    } finally {
      setLoading(false);
    }
  };

  const handleStatusUpdate = async (caseId: string, status: string, description?: string) => {
    try {
      await api.patch(`/after-sales/${caseId}/status`, { status, description });
      await fetchCases();
      if (selectedCase?.id === caseId) {
        const updated = await api.get(`/after-sales/${caseId}`);
        setSelectedCase(updated.data?.data || updated.data);
      }
      alert('状态更新成功');
    } catch (error: any) {
      console.error('更新状态失败:', error);
      alert('更新状态失败：' + (error.response?.data?.message || error.message));
    }
  };
  
  const handleUpdateResolution = async () => {
    if (!selectedCase) return;
    
    if (!resolutionText.trim() && !progressDescription.trim()) {
      alert('请填写处理方案或进度描述');
      return;
    }
  
    setUpdatingResolution(true);
    try {
      await api.patch(`/after-sales/${selectedCase.id}/resolution`, {
        resolution: resolutionText.trim() || undefined,
        progressDescription: progressDescription.trim() || undefined,
      });
      
      // 刷新数据
      await fetchCases();
      const updated = await api.get(`/after-sales/${selectedCase.id}`);
      setSelectedCase(updated.data?.data || updated.data);
      
      setEditingResolution(false);
      setResolutionText('');
      setProgressDescription('');
      alert('处理方案更新成功');
    } catch (error: any) {
      console.error('更新处理方案失败:', error);
      alert('更新处理方案失败：' + (error.response?.data?.message || error.message));
    } finally {
      setUpdatingResolution(false);
    }
  };
  
  const handleSubmitResolution = async () => {
    if (!selectedCase) {
      console.error('提交方案失败：未选择工单');
      alert('请先选择工单');
      return;
    }
    
    if (!resolutionText.trim()) {
      alert('请填写处理方案');
      return;
    }
  
    // 检查工单状态
    if (selectedCase.status !== 'EXECUTING') {
      alert(
        `当前工单状态为「${selectedCase.status}」，只有“执行中”的工单才能提交方案`
      );
      return;
    }
  
    if (
      !confirm(
        '确认提交处理方案吗？提交后将无法修改，请等待管理员审核。'
      )
    ) {
      return;
    }
  
    console.log('开始提交处理方案', {
      caseId: selectedCase.id,
      caseNo: selectedCase.caseNo,
      status: selectedCase.status,
      resolutionLength: resolutionText.trim().length,
    });
  
    setSubmittingResolution(true);
    try {
      const response = await api.post(
        `/after-sales/${selectedCase.id}/submit-resolution`,
        {
          resolution: resolutionText.trim(),
        },
      );
      
      console.log('提交处理方案成功', response.data);
      
      // 刷新数据
      await fetchCases();
      const updated = await api.get(`/after-sales/${selectedCase.id}`);
      setSelectedCase(updated.data?.data || updated.data);
      
      setEditingResolution(false);
      setResolutionText('');
      setProgressDescription('');
      alert('处理方案已提交，等待管理员审核');
    } catch (error: any) {
      console.error('提交处理方案失败:', error);
      const errorMessage =
        error.response?.data?.message ||
        error.response?.data?.error ||
        error.message ||
        '未知错误';
      console.error('错误详情:', {
        status: error.response?.status,
        statusText: error.response?.statusText,
        data: error.response?.data,
        message: errorMessage,
      });
      alert(`提交处理方案失败：${errorMessage}`);
    } finally {
      setSubmittingResolution(false);
    }
  };
  
  const handleAssignToSupplier = async () => {
    if (!selectedCase || !selectedSupplierId) {
      alert('请选择供应商');
      return;
    }
  
    setAssigningSupplier(true);
    try {
      await api.patch(`/after-sales/${selectedCase.id}/assign`, {
        supplierId: selectedSupplierId,
      });
      
      alert('工单已下发给供应商');
      setShowAssignModal(false);
      setSelectedSupplierId('');
      
      // 刷新数据
      await fetchCases();
      const updated = await api.get(`/after-sales/${selectedCase.id}`);
      setSelectedCase(updated.data?.data || updated.data);
    } catch (error: any) {
      console.error('下发工单失败:', error);
      alert('下发工单失败：' + (error.response?.data?.message || error.message));
    } finally {
      setAssigningSupplier(false);
    }
  };
  
  const handleUploadReplacementTracking = async () => {
    if (!selectedCase) return;
    
    if (!replacementTrackingNo.trim()) {
      alert('请输入换货快递单号');
      return;
    }
  
    setUploadingReplacementTracking(true);
    try {
      await api.post(`/after-sales/${selectedCase.id}/replacement-tracking`, {
        trackingNo: replacementTrackingNo.trim(),
        carrier: replacementCarrier.trim() || undefined,
      });
      
      alert('换货快递单号已上传，并已同步到发货管理');
      setReplacementTrackingNo('');
      setReplacementCarrier('');
      
      // 刷新数据
      await fetchCases();
      const updated = await api.get(`/after-sales/${selectedCase.id}`);
      setSelectedCase(updated.data?.data || updated.data);
    } catch (error: any) {
      console.error('上传换货快递单号失败:', error);
      alert(
        '上传换货快递单号失败：' +
          (error.response?.data?.message || error.message),
      );
    } finally {
      setUploadingReplacementTracking(false);
    }
  };
  
  const handleConfirmResolution = async (confirmed: boolean) => {
    if (!selectedCase) return;
  
    const message = confirmed
      ? '确认售后已完成吗？'
      : '确认退回给供应商重新处理吗？';
    
    if (!confirm(message)) {
      return;
    }
  
    setConfirming(true);
    try {
      await api.patch(`/after-sales/${selectedCase.id}/confirm`, {
        confirmed,
      });
      
      alert(confirmed ? '已确认售后完成' : '已退回给供应商');
      
      // 刷新数据
      await fetchCases();
      const updated = await api.get(`/after-sales/${selectedCase.id}`);
      setSelectedCase(updated.data?.data || updated.data);
    } catch (error: any) {
      console.error('确认失败:', error);
      alert('确认失败：' + (error.response?.data?.message || error.message));
    } finally {
      setConfirming(false);
    }
  };
  
  const formatDate = (date: Date | string | undefined) => {
    if (!date) return '-';
    return new Date(date).toLocaleString('zh-CN');
  };
  
  const isSLAOverdue = (slaDeadline?: Date) => {
    if (!slaDeadline) return false;
    return new Date() > new Date(slaDeadline);
  };
  
  const getSLAStatus = (slaDeadline?: Date) => {
    if (!slaDeadline) return null;
    const now = new Date();
    const deadline = new Date(slaDeadline);
    const hoursLeft = (deadline.getTime() - now.getTime()) / (1000 * 60 * 60);
  
    if (hoursLeft < 0) {
      return { text: '已超时', color: 'text-red-600 font-bold' };
    } else if (hoursLeft < 4) {
      return { text: `还剩 ${Math.round(hoursLeft)} 小时`, color: 'text-orange-600' };
    } else {
      return {
        text: `还剩 ${Math.round(hoursLeft / 24)} 天`,
        color: 'text-gray-600',
      };
    }
  };
  

  const stats = {
    total: cases.length,
    opened: cases.filter((c) => c.status === 'OPENED').length,
    executing: cases.filter((c) => c.status === 'EXECUTING').length,
    inspecting: cases.filter((c) => c.status === 'INSPECTING').length,
    resolved: cases.filter((c) => c.status === 'RESOLVED').length,
    overdue: cases.filter((c) => isSLAOverdue(c.slaDeadline)).length,
  };

  if (loading) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center">
        <div className="text-center">
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-600 mx-auto"></div>
          <p className="mt-4 text-gray-600">加载中...</p>
        </div>
      </div>
    );
  }
  
  return (
    <div className="min-h-screen bg-gray-50">
      {/* Header */}
      <div className="bg-white shadow-sm border-b">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-4">
          <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
            <div>
              <h1 className="text-2xl font-bold text-gray-900">售后管理</h1>
              <p className="text-sm text-gray-500 mt-1">处理售后工单和客户投诉</p>
            </div>
            {/* 管理员和采购员可以创建工单 */}
            {(user?.role === 'ADMIN' || user?.role === 'BUYER') && (
              <button
                onClick={() => setShowCreateForm(true)}
                className="px-4 py-2.5 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors text-sm md:text-base font-medium whitespace-nowrap"
              >
                + 创建工单
              </button>
            )}
          </div>
        </div>
      </div>
  
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-6">
        {/* Stats */}
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3 md:gap-4 mb-6">
          <div className="bg-white rounded-lg shadow p-3 md:p-4">
            <div className="text-xs md:text-sm text-gray-500">总工单</div>
            <div className="text-xl md:text-2xl font-bold mt-1">{stats.total}</div>
          </div>
          <div className="bg-white rounded-lg shadow p-3 md:p-4">
            <div className="text-xs md:text-sm text-gray-500">已开启</div>
            <div className="text-xl md:text-2xl font-bold mt-1 text-blue-600">{stats.opened}</div>
          </div>
          <div className="bg-white rounded-lg shadow p-3 md:p-4">
            <div className="text-xs md:text-sm text-gray-500">执行中</div>
            <div className="text-xl md:text-2xl font-bold mt-1 text-orange-600">{stats.executing}</div>
          </div>
          <div className="bg-white rounded-lg shadow p-3 md:p-4">
            <div className="text-xs md:text-sm text-gray-500">待验收</div>
            <div className="text-xl md:text-2xl font-bold mt-1 text-yellow-600">{stats.inspecting}</div>
          </div>
          <div className="bg-white rounded-lg shadow p-3 md:p-4">
            <div className="text-xs md:text-sm text-gray-500">已解决</div>
            <div className="text-xl md:text-2xl font-bold mt-1 text-green-600">{stats.resolved}</div>
          </div>
          <div className="bg-white rounded-lg shadow p-3 md:p-4">
            <div className="text-xs md:text-sm text-gray-500">已超时</div>
            <div className="text-xl md:text-2xl font-bold mt-1 text-red-600">{stats.overdue}</div>
          </div>
        </div>
  
        {/* Filters */}
        <div className="bg-white rounded-lg shadow p-3 md:p-4 mb-6">
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3 md:gap-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">状态</label>
              <select
                value={statusFilter}
                onChange={(e) => setStatusFilter(e.target.value)}
                className="w-full px-3 py-2.5 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500 text-base"
              >
                <option value="ALL">全部</option>
                {Object.entries(STATUS_LABELS).map(([value, label]) => (
                  <option key={value} value={value}>
                    {label}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">类型</label>
              <select
                value={typeFilter}
                onChange={(e) => setTypeFilter(e.target.value)}
                className="w-full px-3 py-2.5 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500 text-base"
              >
                <option value="ALL">全部</option>
                {Object.entries(TYPE_LABELS).map(([value, label]) => (
                  <option key={value} value={value}>
                    {label}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">优先级</label>
              <select
                value={priorityFilter}
                onChange={(e) => setPriorityFilter(e.target.value)}
                className="w-full px-3 py-2.5 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500 text-base"
              >
                <option value="ALL">全部</option>
                {Object.entries(PRIORITY_LABELS).map(([value, label]) => (
                  <option key={value} value={value}>
                    {label}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">搜索</label>
              <input
                type="text"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') {
                    fetchCases();
                  }
                }}
                placeholder="工单号 / 订单号 / 商品名..."
                className="w-full px-3 py-2.5 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500 text-base"
              />
            </div>
          </div>
        </div>
  
        {/* Cases List - Desktop Table View */}
        <div className="hidden md:block bg-white rounded-lg shadow overflow-hidden">
          <div className="overflow-x-auto">
            <table className="min-w-full divide-y divide-gray-200">
              <thead className="bg-gray-50">
                <tr>
                  <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                    工单号
                  </th>
                  <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                    订单号
                  </th>
                  <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                    所属门店
                  </th>
                  <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                    商品
                  </th>
                  <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                    类型
                  </th>
                  <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                    状态
                  </th>
                  <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                    优先级
                  </th>
                  <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                    SLA
                  </th>
                  <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                    创建时间
                  </th>
                  <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                    操作
                  </th>
                </tr>
              </thead>
              <tbody className="bg-white divide-y divide-gray-200">
                {cases.length === 0 ? (
                  <tr>
                    <td colSpan={10} className="px-4 py-8 text-center text-gray-500">
                      暂时没有售后工单
                    </td>
                  </tr>
                ) : (
                  cases.map((caseItem) => {
                    const slaStatus = getSLAStatus(caseItem.slaDeadline);
                    return (
                      <tr
                        key={caseItem.id}
                        className={`hover:bg-gray-50 ${
                          isSLAOverdue(caseItem.slaDeadline) ? 'bg-red-50' : ''
                        }`}
                      >
                        <td className="px-4 py-3 whitespace-nowrap">
                          <div className="text-sm font-medium text-gray-900">
                            {caseItem.caseNo}
                          </div>
                        </td>
                        <td className="px-4 py-3 whitespace-nowrap">
                          <div className="text-sm text-gray-900">
                            {caseItem.order.orderNo}
                          </div>
                        </td>
                        <td className="px-4 py-3 whitespace-nowrap">
                          <div className="text-sm text-gray-900">
                            {caseItem.store
                              ? `${caseItem.store.name} (${caseItem.store.code})`
                              : '-'}
                          </div>
                        </td>
                        <td className="px-4 py-3">
                          <div className="text-sm text-gray-900">
                            {caseItem.order.productName}
                          </div>
                          {caseItem.shipment?.trackingNo && (
                            <div className="text-xs text-gray-500">
                              运单：{caseItem.shipment.trackingNo}
                            </div>
                          )}
                          {caseItem.shipment?.source && (
                            <div className="mt-1">
                              <span
                                className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ${
                                  caseItem.shipment.source === 'ECOMMERCE'
                                    ? 'bg-purple-100 text-purple-800'
                                    : 'bg-blue-100 text-blue-800'
                                }`}
                              >
                                {caseItem.shipment.source === 'ECOMMERCE'
                                  ? '电商平台'
                                  : '供应商'}
                              </span>
                            </div>
                          )}
                        </td>
                        <td className="px-4 py-3 whitespace-nowrap">
                          <div className="text-sm text-gray-900">
                            {TYPE_LABELS[caseItem.type] || caseItem.type}
                          </div>
                        </td>
                        <td className="px-4 py-3 whitespace-nowrap">
                          <span
                            className={`px-2 py-1 text-xs font-medium rounded-full ${
                              STATUS_COLORS[caseItem.status] ||
                              'bg-gray-100 text-gray-800'
                            }`}
                          >
                            {STATUS_LABELS[caseItem.status] || caseItem.status}
                          </span>
                        </td>
                        <td className="px-4 py-3 whitespace-nowrap">
                          <span
                            className={`px-2 py-1 text-xs font-medium rounded-full ${
                              PRIORITY_COLORS[caseItem.priority] ||
                              'bg-gray-100 text-gray-800'
                            }`}
                          >
                            {PRIORITY_LABELS[caseItem.priority] ||
                              caseItem.priority}
                          </span>
                        </td>
                        <td className="px-4 py-3 whitespace-nowrap">
                          {slaStatus ? (
                            <div className={`text-xs ${slaStatus.color}`}>
                              {slaStatus.text}
                            </div>
                          ) : (
                            <div className="text-xs text-gray-400">-</div>
                          )}
                        </td>
                        <td className="px-4 py-3 whitespace-nowrap">
                          <div className="text-sm text-gray-900">
                            {formatDate(caseItem.createdAt)}
                          </div>
                        </td>
                        <td className="px-4 py-3 whitespace-nowrap">
                          <button
                            onClick={() => {
                              setSelectedCase(caseItem);
                              setShowDetailModal(true);
                            }}
                            className="text-blue-600 hover:text-blue-800 text-sm font-medium"
                          >
                            查看详情
                          </button>
                        </td>
                      </tr>
                    );
                  })
                )}
              </tbody>
            </table>
          </div>
        </div>
  
        {/* Cases List - Mobile Card View */}
        <div className="md:hidden space-y-3">
          {cases.length === 0 ? (
            <div className="bg-white rounded-lg shadow p-8 text-center text-gray-500">
              暂时没有售后工单
            </div>
          ) : (
            cases.map((caseItem) => {
              const slaStatus = getSLAStatus(caseItem.slaDeadline);
              return (
                <div
                  key={caseItem.id}
                  className={`bg-white rounded-lg shadow p-4 ${
                    isSLAOverdue(caseItem.slaDeadline)
                      ? 'border-l-4 border-red-500'
                      : ''
                  }`}
                  onClick={() => {
                    setSelectedCase(caseItem);
                    setShowDetailModal(true);
                  }}
                >
                  <div className="flex items-start justify-between mb-3">
                    <div className="flex-1 min-w-0">
                      <div className="text-base font-semibold text-gray-900 truncate">
                        {caseItem.caseNo}
                      </div>
                      <div className="text-sm text-gray-500 mt-1">
                        {caseItem.order.orderNo}
                      </div>
                      {caseItem.store && (
                        <div className="text-xs text-gray-400 mt-1">
                          门店：{caseItem.store.name} ({caseItem.store.code})
                        </div>
                      )}
                    </div>
                    <span
                      className={`ml-2 px-2 py-1 text-xs font-medium rounded-full whitespace-nowrap ${
                        STATUS_COLORS[caseItem.status] ||
                        'bg-gray-100 text-gray-800'
                      }`}
                    >
                      {STATUS_LABELS[caseItem.status] || caseItem.status}
                    </span>
                  </div>
  
                  <div className="text-sm text-gray-900 mb-2 line-clamp-2">
                    {caseItem.order.productName}
                  </div>
  
                  {caseItem.shipment?.trackingNo && (
                    <div className="text-xs text-gray-500 mb-2">
                      运单：{caseItem.shipment.trackingNo}
                    </div>
                  )}
  
                  <div className="flex flex-wrap items-center gap-2 mt-3">
                    <span
                      className={`px-2 py-0.5 text-xs font-medium rounded-full ${
                        PRIORITY_COLORS[caseItem.priority] ||
                        'bg-gray-100 text-gray-800'
                      }`}
                    >
                      {PRIORITY_LABELS[caseItem.priority] ||
                        caseItem.priority}
                    </span>
                    <span className="px-2 py-0.5 text-xs text-gray-600 bg-gray-100 rounded-full">
                      {TYPE_LABELS[caseItem.type] || caseItem.type}
                    </span>
                    {caseItem.shipment?.source && (
                      <span
                        className={`px-2 py-0.5 text-xs font-medium rounded-full ${
                          caseItem.shipment.source === 'ECOMMERCE'
                            ? 'bg-purple-100 text-purple-800'
                            : 'bg-blue-100 text-blue-800'
                        }`}
                      >
                        {caseItem.shipment.source === 'ECOMMERCE'
                          ? '电商平台'
                          : '供应商'}
                      </span>
                    )}
                    {slaStatus && (
                      <span
                        className={`px-2 py-0.5 text-xs font-medium rounded-full ${slaStatus.color}`}
                      >
                        {slaStatus.text}
                      </span>
                    )}
                  </div>
  
                  <div className="text-xs text-gray-500 mt-3 pt-3 border-t border-gray-100">
                    {formatDate(caseItem.createdAt)}
                  </div>
                </div>
              );
            })
          )}
        </div>
      </div>
  
      {/* Detail Modal */}
      {showDetailModal && selectedCase && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-0 md:p-4">
          <div className="bg-white rounded-none md:rounded-lg max-w-4xl w-full h-full md:h-auto md:max-h-[90vh] overflow-y-auto">
            <div className="p-4 md:p-6">
              <div className="flex justify-between items-start mb-4 sticky top-0 bg-white pb-4 border-b border-gray-200 -mx-4 md:-mx-6 px-4 md:px-6 pt-0 md:pt-0">
                <div className="flex-1 min-w-0 pr-2">
                  <h2 className="text-xl md:text-2xl font-bold text-gray-900 truncate">
                    {selectedCase.caseNo}
                  </h2>
                  <p className="text-xs md:text-sm text-gray-500 mt-1">
                    创建时间：{formatDate(selectedCase.createdAt)}
                  </p>
                </div>
                <button
                  onClick={() => {
                    setShowDetailModal(false);
                    setSelectedCase(null);
                    setEditingResolution(false);
                    setResolutionText('');
                    setProgressDescription('');
                  }}
                  className="text-gray-400 hover:text-gray-600 flex-shrink-0 p-1"
                  aria-label="关闭"
                >
                  <svg
                    className="w-6 h-6"
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
              </div>
  
              <div className="grid grid-cols-1 md:grid-cols-2 gap-3 md:gap-4 mb-4 md:mb-6">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">
                    订单号
                  </label>
                  <div className="text-sm text-gray-900">
                    {selectedCase.order.orderNo}
                  </div>
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">
                    商品名称
                  </label>
                  <div className="text-sm text-gray-900">
                    {selectedCase.order.productName}
                  </div>
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">
                    类型
                  </label>
                  <div className="text-sm text-gray-900">
                    {TYPE_LABELS[selectedCase.type] || selectedCase.type}
                  </div>
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">
                    状态
                  </label>
                  <span
                    className={`inline-block px-2 py-1 text-xs font-medium rounded-full ${
                      STATUS_COLORS[selectedCase.status] ||
                      'bg-gray-100 text-gray-800'
                    }`}
                  >
                    {STATUS_LABELS[selectedCase.status] ||
                      selectedCase.status}
                  </span>
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">
                    优先级
                  </label>
                  <span
                    className={`inline-block px-2 py-1 text-xs font-medium rounded-full ${
                      PRIORITY_COLORS[selectedCase.priority] ||
                      'bg-gray-100 text-gray-800'
                    }`}
                  >
                    {PRIORITY_LABELS[selectedCase.priority] ||
                      selectedCase.priority}
                  </span>
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">
                    SLA 截止时间
                  </label>
                  <div className="text-sm text-gray-900">
                    {selectedCase.slaDeadline ? (
                      <span
                        className={
                          isSLAOverdue(selectedCase.slaDeadline)
                            ? 'text-red-600 font-bold'
                            : ''
                        }
                      >
                        {formatDate(selectedCase.slaDeadline)}
                        {isSLAOverdue(selectedCase.slaDeadline) &&
                          '（已超时）'}
                      </span>
                    ) : (
                      '-'
                    )}
                  </div>
                </div>
                {selectedCase.shipment && (
                  <>
                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-1">
                        运单号
                      </label>
                      <div className="text-sm text-gray-900">
                        {selectedCase.shipment.trackingNo || '-'}
                      </div>
                    </div>
                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-1">
                        来源
                      </label>
                      <div className="text-sm text-gray-900">
                        {selectedCase.shipment.source === 'ECOMMERCE' ? (
                          <span className="inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium bg-purple-100 text-purple-800">
                            电商平台采购
                          </span>
                        ) : (
                          <span className="inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium bg-blue-100 text-blue-800">
                            供应商发货
                          </span>
                        )}
                      </div>
                    </div>
                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-1">
                        供应商
                      </label>
                      <div className="text-sm text-gray-900">
                        {selectedCase.supplier?.username ||
                          selectedCase.shipment.supplier?.username ||
                          (selectedCase.shipment.source === 'ECOMMERCE'
                            ? '电商平台采购（无供应商）'
                            : '-')}
                      </div>
                    </div>
                  </>
                )}
                {!selectedCase.shipment && selectedCase.order && (
                  <>
                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-1">
                        来源
                      </label>
                      <div className="text-sm text-gray-900">
                        <span className="inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium bg-gray-100 text-gray-800">
                          未知来源
                        </span>
                      </div>
                    </div>
                  </>
                )}
                {selectedCase.claimAmount && (
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">
                      索赔金额
                    </label>
                    <div className="text-sm text-gray-900">
                      ¥
                      {Number(selectedCase.claimAmount).toLocaleString('zh-CN', {
                        minimumFractionDigits: 2,
                        maximumFractionDigits: 2,
                      })}
                    </div>
                  </div>
                )}
              </div>
  
              <div className="mb-4 md:mb-6">
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  问题描述
                </label>
                <div className="text-sm text-gray-900 bg-gray-50 p-3 rounded-lg whitespace-pre-wrap">
                  {selectedCase.description}
                </div>
              </div>
  
              {/* 处理方案和进度 */}
              <div className="mb-4 md:mb-6">
                <div className="flex items-center justify-between mb-2">
                  <label className="block text-sm font-medium text-gray-700">
                    处理方案和进度
                  </label>
                  {/* 供应商可编辑（EXECUTING 状态） */}
                  {user?.role === 'SUPPLIER' &&
                    selectedCase.supplierId === user.id &&
                    selectedCase.status === 'EXECUTING' && (
                      <button
                        onClick={() => {
                          if (editingResolution) {
                            setEditingResolution(false);
                            setResolutionText(selectedCase.resolution || '');
                            setProgressDescription('');
                          } else {
                            setEditingResolution(true);
                            setResolutionText(selectedCase.resolution || '');
                            setProgressDescription('');
                          }
                        }}
                        className="text-sm text-blue-600 hover:text-blue-800 font-medium"
                      >
                        {editingResolution ? '取消编辑' : '编辑'}
                      </button>
                    )}
                </div>
  
                {editingResolution ? (
                  <div className="space-y-3">
                    <div>
                      <label className="block text-xs font-medium text-gray-600 mb-1">
                        处理方案 *
                      </label>
                      <textarea
                        value={resolutionText}
                        onChange={(e) =>
                          setResolutionText(e.target.value)
                        }
                        placeholder="请输入处理方案..."
                        rows={4}
                        className="w-full rounded-lg border border-gray-300 px-3 py-2.5 text-sm md:text-base focus:border-blue-500 focus:outline-none focus:ring-blue-500"
                      />
                    </div>
                    <div>
                      <label className="block text-xs font-medium text-gray-600 mb-1">
                        进度描述（可选）
                      </label>
                      <textarea
                        value={progressDescription}
                        onChange={(e) =>
                          setProgressDescription(e.target.value)
                        }
                        placeholder="请输入当前处理进度..."
                        rows={3}
                        className="w-full rounded-lg border border-gray-300 px-3 py-2.5 text-sm md:text-base focus:border-blue-500 focus:outline-none focus:ring-blue-500"
                      />
                    </div>
                    <div className="flex flex-col sm:flex-row gap-2">
                      <button
                        onClick={handleUpdateResolution}
                        disabled={updatingResolution}
                        className="flex-1 rounded-lg bg-blue-600 px-4 py-2.5 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed"
                      >
                        {updatingResolution ? '保存中...' : '保存草稿'}
                      </button>
                      <button
                        onClick={handleSubmitResolution}
                        disabled={
                          submittingResolution ||
                          !resolutionText.trim()
                        }
                        className="flex-1 rounded-lg bg-green-600 px-4 py-2.5 text-sm font-medium text-white hover:bg-green-700 disabled:opacity-50 disabled:cursor-not-allowed"
                      >
                        {submittingResolution ? '提交中...' : '提交方案'}
                      </button>
                      <button
                        onClick={() => {
                          setEditingResolution(false);
                          setResolutionText(
                            selectedCase.resolution || '',
                          );
                          setProgressDescription('');
                        }}
                        className="flex-1 rounded-lg bg-gray-200 px-4 py-2.5 text-sm font-medium text-gray-700 hover:bg-gray-300"
                      >
                        取消
                      </button>
                    </div>
                    <p className="text-xs text-gray-500">
                      提示：保存草稿可以随时修改，提交方案后将等待管理员审核。
                    </p>
                  </div>
                ) : (
                  <div className="space-y-3">
                    {selectedCase.resolution ? (
                      <div className="text-sm text-gray-900 bg-green-50 p-3 rounded-lg whitespace-pre-wrap">
                        {selectedCase.resolution}
                      </div>
                    ) : (
                      <div className="text-sm text-gray-400 bg-gray-50 p-3 rounded-lg italic">
                        暂无处理方案
                      </div>
                    )}
                    {/* 供应商可填写方案（EXECUTING 状态且无方案） */}
                    {user?.role === 'SUPPLIER' &&
                      selectedCase.supplierId === user.id &&
                      selectedCase.status === 'EXECUTING' &&
                      !selectedCase.resolution && (
                        <button
                          onClick={() => {
                            setEditingResolution(true);
                            setResolutionText('');
                            setProgressDescription('');
                          }}
                          className="w-full rounded-lg bg-blue-600 px-4 py-2.5 text-sm md:text-base font-medium text-white hover:bg-blue-700"
                        >
                          填写处理方案
                        </button>
                      )}
                  </div>
                )}
              </div>
  
              {/* Attachments */}
              {selectedCase.attachments &&
                selectedCase.attachments.length > 0 && (
                  <div className="mb-4 md:mb-6">
                    <label className="block text-sm font-medium text-gray-700 mb-2">
                      附件
                    </label>
                    <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-3 md:gap-4">
                      {selectedCase.attachments.map((attachment) => {
                        const isImage =
                          attachment.fileType.startsWith('image/');
                        const isVideo =
                          attachment.fileType.startsWith('video/');
                        return (
                          <div
                            key={attachment.id}
                            className="border rounded-lg p-2"
                          >
                            {isImage ? (
                              <img
                                src={getProxiedImageUrl(
                                  attachment.fileUrl,
                                )}
                                alt={attachment.fileName}
                                className="w-full h-32 object-cover rounded mb-2"
                                loading="lazy"
                                onError={handleImageError}
                              />
                            ) : isVideo ? (
                              <video
                                src={attachment.fileUrl}
                                className="w-full h-32 object-cover rounded mb-2"
                                controls
                                onError={handleVideoError}
                              />
                            ) : (
                              <div className="w-full h-32 bg-gray-100 rounded mb-2 flex items-center justify-center">
                                <svg
                                  className="w-12 h-12 text-gray-400"
                                  fill="none"
                                  stroke="currentColor"
                                  viewBox="0 0 24 24"
                                >
                                  <path
                                    strokeLinecap="round"
                                    strokeLinejoin="round"
                                    strokeWidth={2}
                                    d="M7 21h10a2 2 0 002-2V9.414a1 1 0 00-.293-.707l-5.414-5.414A1 1 0 0012.586 3H7a2 2 0 00-2 2v14a2 2 0 002 2z"
                                  />
                                </svg>
                              </div>
                            )}
                            <a
                              href={attachment.fileUrl}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="text-xs text-blue-600 hover:text-blue-800 truncate block"
                              title={attachment.fileName}
                            >
                              {attachment.fileName}
                            </a>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                )}

              {/* Upload Attachments - 供应商/管理员/采购可以上传处理凭证 */}
              {selectedCase.status !== 'CLOSED' &&
                selectedCase.status !== 'CANCELLED' &&
                (
                  (user?.role === 'SUPPLIER' &&
                    selectedCase.supplierId === user.id &&
                    selectedCase.status === 'EXECUTING') ||
                  user?.role === 'BUYER' ||
                  user?.role === 'ADMIN'
                ) && (
                  <div className="mb-4 md:mb-6 p-3 md:p-4 bg-blue-50 rounded-lg border border-blue-200">
                    <label className="block text-sm font-medium text-gray-700 mb-3">
                      <span className="flex items-center gap-2">
                        <svg
                          className="w-5 h-5 text-blue-600"
                          fill="none"
                          stroke="currentColor"
                          viewBox="0 0 24 24"
                        >
                          <path
                            strokeLinecap="round"
                            strokeLinejoin="round"
                            strokeWidth={2}
                            d="M7 16a4 4 0 01-.88-7.903A5 5 0 1115.9 6L16 6a5 5 0 011 9.9M15 13l-3-3m0 0l-3 3m3-3v12"
                          />
                        </svg>
                        上传售后照片 / 视频
                      </span>
                    </label>
                    <div className="space-y-2">
                      <input
                        type="file"
                        multiple
                        accept="image/*,video/*"
                        onChange={async (e) => {
                          const files = e.target.files;
                          if (!files || files.length === 0) return;

                          const formData = new FormData();
                          Array.from(files).forEach((file) => {
                            formData.append('files', file);
                          });

                          try {
                            await api.post(
                              `/after-sales/${selectedCase.id}/attachments`,
                              formData,
                              {
                                headers: {
                                  'Content-Type': 'multipart/form-data',
                                },
                              },
                            );
                            alert('附件上传成功');
                            const updated = await api.get(
                              `/after-sales/${selectedCase.id}`,
                            );
                            setSelectedCase(updated.data?.data || updated.data);
                            await fetchCases();
                          } catch (error: any) {
                            console.error('上传附件失败:', error);
                            alert(
                              '上传附件失败: ' +
                                (error.response?.data?.message || error.message),
                            );
                          } finally {
                            // 清空 input，方便再次选择同一个文件
                            e.target.value = '';
                          }
                        }}
                        className="block w-full text-sm text-gray-500 file:mr-4 file:py-2 file:px-4 file:rounded-lg file:border-0 file:text-sm file:font-semibold file:bg-blue-600 file:text-white hover:file:bg-blue-700 cursor-pointer"
                      />
                      <p className="text-xs text-gray-500">
                        支持上传图片和视频，可以一次选择多个文件。
                      </p>
                    </div>
                  </div>
                )}

              {/* 换货快递单号上传 - 供应商在换货类型且执行中时可见 */}
              {user?.role === 'SUPPLIER' &&
                selectedCase.supplierId === user.id &&
                selectedCase.status === 'EXECUTING' &&
                (selectedCase.type === 'REPAIR' ||
                  selectedCase.inventoryDisposition === '换货') && (
                  <div className="mb-4 md:mb-6 p-3 md:p-4 bg-green-50 rounded-lg border border-green-200">
                    <label className="block text-sm font-medium text-gray-700 mb-3">
                      <span className="flex items-center gap-2">
                        <svg
                          className="w-5 h-5 text-green-600"
                          fill="none"
                          stroke="currentColor"
                          viewBox="0 0 24 24"
                        >
                          <path
                            strokeLinecap="round"
                            strokeLinejoin="round"
                            strokeWidth={2}
                            d="M20 13V6a2 2 0 00-2-2H6a2 2 0 00-2 2v7m16 0v5a2 2 0 01-2 2H6a2 2 0 01-2-2v-5m16 0h-2.586a1 1 0 00-.707.293l-2.414 2.414a1 1 0 01-.707.293h-3.172a1 1 0 01-.707-.293l-2.414-2.414A1 1 0 006.586 13H4"
                          />
                        </svg>
                        换货快递单号
                      </span>
                    </label>
                    {selectedCase.replacementShipment ? (
                      <div className="space-y-2">
                        <div className="bg-white p-3 rounded-lg border border-green-300">
                          <div className="flex items-center justify-between">
                            <div>
                              <div className="text-sm font-medium text-gray-900">
                                快递单号：
                                {selectedCase.replacementShipment.trackingNo}
                              </div>
                              {selectedCase.replacementShipment.carrier && (
                                <div className="text-xs text-gray-500 mt-1">
                                  快递公司：
                                  {selectedCase.replacementShipment.carrier}
                                </div>
                              )}
                            </div>
                            <span className="px-2 py-1 text-xs font-medium bg-green-100 text-green-800 rounded">
                              已上传
                            </span>
                          </div>
                        </div>
                        <p className="text-xs text-gray-500">
                          ✓ 换货快递单号已上传，系统已同步至发货管理。
                        </p>
                      </div>
                    ) : (
                      <div className="space-y-3">
                        <div className="flex flex-col sm:flex-row gap-2">
                          <input
                            type="text"
                            value={replacementTrackingNo}
                            onChange={(e) =>
                              setReplacementTrackingNo(e.target.value)
                            }
                            placeholder="请输入换货快递单号"
                            className="flex-1 px-3 py-2.5 border border-gray-300 rounded-lg focus:ring-2 focus:ring-green-500 focus:border-green-500 text-base"
                          />
                          <input
                            type="text"
                            value={replacementCarrier}
                            onChange={(e) =>
                              setReplacementCarrier(e.target.value)
                            }
                            placeholder="快递公司（可选）"
                            className="w-full sm:w-32 px-3 py-2.5 border border-gray-300 rounded-lg focus:ring-2 focus:ring-green-500 focus:border-green-500 text-base"
                          />
                          <button
                            onClick={handleUploadReplacementTracking}
                            disabled={
                              uploadingReplacementTracking ||
                              !replacementTrackingNo.trim()
                            }
                            className="px-4 py-2.5 bg-green-600 text-white rounded-lg hover:bg-green-700 disabled:opacity-50 disabled:cursor-not-allowed text-base font-medium"
                          >
                            {uploadingReplacementTracking ? '上传中...' : '上传'}
                          </button>
                        </div>
                        <p className="text-xs text-gray-500">
                          提示：换货时请上传新的快递单号，系统会自动同步到发货管理。
                        </p>
                      </div>
                    )}
                  </div>
                )}

              {/* 管理员 / 采购：派发工单给供应商 */}
              {(user?.role === 'ADMIN' || user?.role === 'BUYER') &&
                selectedCase.status === 'OPENED' &&
                !selectedCase.supplierId && (
                  <div className="mb-4 md:mb-6 p-3 md:p-4 bg-yellow-50 rounded-lg border border-yellow-200">
                    <label className="block text-sm font-medium text-gray-700 mb-2">
                      <span className="flex items-center gap-2">
                        <svg
                          className="w-5 h-5 text-yellow-600"
                          fill="none"
                          stroke="currentColor"
                          viewBox="0 0 24 24"
                        >
                          <path
                            strokeLinecap="round"
                            strokeLinejoin="round"
                            strokeWidth={2}
                            d="M12 4v16m8-8H4"
                          />
                        </svg>
                        派发工单给供应商
                      </span>
                    </label>
                    <div className="flex flex-col sm:flex-row gap-2">
                      <select
                        value={selectedSupplierId}
                        onChange={(e) =>
                          setSelectedSupplierId(e.target.value)
                        }
                        className="flex-1 px-3 py-2.5 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500 text-base"
                      >
                        <option value="">请选择供应商</option>
                        {suppliers.map((supplier) => (
                          <option key={supplier.id} value={supplier.id}>
                            {supplier.username} ({supplier.email})
                          </option>
                        ))}
                      </select>
                      <button
                        onClick={handleAssignToSupplier}
                        disabled={assigningSupplier || !selectedSupplierId}
                        className="px-4 py-2.5 bg-yellow-600 text-white rounded-lg hover:bg-yellow-700 disabled:opacity-50 disabled:cursor-not-allowed text-base font-medium whitespace-nowrap"
                      >
                        {assigningSupplier ? '派发中...' : '派发'}
                      </button>
                    </div>
                    {suppliers.length === 0 && (
                      <p className="text-xs text-gray-500 mt-2">
                        暂无供应商，请联系管理员添加供应商后再派发。
                      </p>
                    )}
                  </div>
                )}

              {/* 管理员 / 采购：确认完成 */}
              {(user?.role === 'ADMIN' || user?.role === 'BUYER') &&
                selectedCase.status === 'INSPECTING' && (
                  <div className="mb-4 md:mb-6 p-3 md:p-4 bg-green-50 rounded-lg border border-green-200">
                    <label className="block text-sm font-medium text-gray-700 mb-2">
                      <span className="flex items-center gap-2">
                        <svg
                          className="w-5 h-5 text-green-600"
                          fill="none"
                          stroke="currentColor"
                          viewBox="0 0 24 24"
                        >
                          <path
                            strokeLinecap="round"
                            strokeLinejoin="round"
                            strokeWidth={2}
                            d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z"
                          />
                        </svg>
                        确认售后完成
                      </span>
                    </label>
                    <div className="flex flex-col sm:flex-row gap-2">
                      <button
                        onClick={() => handleConfirmResolution(true)}
                        disabled={confirming}
                        className="flex-1 px-4 py-2.5 bg-green-600 text-white rounded-lg hover:bg-green-700 disabled:opacity-50 disabled:cursor-not-allowed text-base font-medium"
                      >
                        {confirming ? '确认中...' : '✓ 确认完成'}
                      </button>
                      <button
                        onClick={() => handleConfirmResolution(false)}
                        disabled={confirming}
                        className="flex-1 px-4 py-2.5 bg-orange-600 text-white rounded-lg hover:bg-orange-700 disabled:opacity-50 disabled:cursor-not-allowed text-base font-medium"
                      >
                        {confirming ? '退回中...' : '↺ 退回重新处理'}
                      </button>
                    </div>
                    <p className="text-xs text-gray-500 mt-2">
                      提示：确认完成后，工单状态将变为「已解决」；退回重新处理，工单将返回供应商继续处理。
                    </p>
                  </div>
                )}

              {/* 管理员 / 采购：手动更新状态（特殊情况使用） */}
              {selectedCase.status !== 'CLOSED' &&
                selectedCase.status !== 'CANCELLED' &&
                (user?.role === 'ADMIN' || user?.role === 'BUYER') && (
                  <div className="mb-4 md:mb-6 p-3 md:p-4 bg-blue-50 rounded-lg">
                    <label className="block text-sm font-medium text-gray-700 mb-2">
                      手动更新状态（管理员 / 采购）
                    </label>
                    <div className="flex flex-wrap gap-2 mb-2">
                      {['EXECUTING', 'INSPECTING', 'RESOLVED', 'CLOSED'].map(
                        (status) => (
                          <button
                            key={status}
                            onClick={() =>
                              handleStatusUpdate(selectedCase.id, status)
                            }
                            className="px-3 py-1 text-sm bg-white border border-gray-300 rounded hover:bg-gray-50"
                          >
                            {STATUS_LABELS[status]}
                          </button>
                        ),
                      )}
                    </div>
                  </div>
                )}

              {/* Logs */}
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">
                  操作日志
                </label>
                <div className="space-y-2">
                  {selectedCase.logs.map((log) => (
                    <div key={log.id} className="bg-gray-50 p-3 rounded-lg">
                      <div className="flex justify-between items-start">
                        <div>
                          <div className="text-sm font-medium text-gray-900">
                            {STATUS_LABELS[log.action] || log.action}
                          </div>
                          {log.description && (
                            <div className="text-sm text-gray-600 mt-1">
                              {log.description}
                            </div>
                          )}
                        </div>
                        <div className="text-xs text-gray-500">
                          {formatDate(log.createdAt)}
                          {log.user && ` · ${log.user.username}`}
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Create Form Modal */}
      {showCreateForm && (
        <CreateCaseModal
          onClose={() => {
            setShowCreateForm(false);
          }}
          onSuccess={() => {
            setShowCreateForm(false);
            fetchCases();
          }}
        />
      )}
    </div>
  );
}

// 创建工单表单组件
function CreateCaseModal({
  onClose,
  onSuccess,
}: {
  onClose: () => void;
  onSuccess: () => void;
}) {
  const [formData, setFormData] = useState({
    orderId: '',
    trackingNo: '',
    supplierId: '',
    type: 'DAMAGED',
    priority: 'MEDIUM',
    description: '',
    claimAmount: '',
    inventoryDisposition: '',
  });
  const [loading, setLoading] = useState(false);
  const [searchResults, setSearchResults] = useState<any[]>([]);
  const [searching, setSearching] = useState(false);
  const [matchedStore, setMatchedStore] = useState<{
    id: string;
    name: string;
    code: string;
  } | null>(null);
  const [matchedSupplier, setMatchedSupplier] = useState<{
    id: string;
    username: string;
  } | null>(null);
  const [selectedFiles, setSelectedFiles] = useState<File[]>([]);
  const [uploadingAttachments, setUploadingAttachments] = useState(false);

  // 清理预览 URL，避免内存泄漏（这里写法有点粗暴，但不影响运行）
  useEffect(() => {
    return () => {
      selectedFiles.forEach((file) => {
        const previewUrl = URL.createObjectURL(file);
        URL.revokeObjectURL(previewUrl);
      });
    };
  }, [selectedFiles]);

  const handleSearchTracking = async () => {
    if (!formData.trackingNo.trim()) return;
    setSearching(true);
    try {
      const response = await api.get(
        `/after-sales/tracking/${formData.trackingNo}`,
      );
      const data = response.data?.data || response.data;
      if (data) {
        setSearchResults([data]);
        // 自动填充订单 ID
        if (data.order) {
          setFormData((prev) => ({ ...prev, orderId: data.order.id }));
        }
        // 自动匹配门店
        if (data.store) {
          setMatchedStore(data.store);
        } else {
          setMatchedStore(null);
        }
        // 自动匹配供应商
        if (data.supplier) {
          setMatchedSupplier(data.supplier);
          setFormData((prev) => ({ ...prev, supplierId: data.supplier.id }));
        } else {
          setMatchedSupplier(null);
          setFormData((prev) => ({ ...prev, supplierId: '' }));
        }
      } else {
        setSearchResults([]);
        setMatchedStore(null);
        setMatchedSupplier(null);
        setFormData((prev) => ({ ...prev, supplierId: '' }));
      }
    } catch (error: any) {
      console.error('查询失败:', error);
      setSearchResults([]);
      setMatchedStore(null);
      setMatchedSupplier(null);
      setFormData((prev) => ({ ...prev, supplierId: '' }));
    } finally {
      setSearching(false);
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    try {
      // 清理空字符串，转换为 undefined
      const submitData = {
        ...formData,
        supplierId: formData.supplierId?.trim() || undefined,
        claimAmount: formData.claimAmount?.trim()
          ? parseFloat(formData.claimAmount)
          : undefined,
        inventoryDisposition:
          formData.inventoryDisposition?.trim() || undefined,
        trackingNo: formData.trackingNo?.trim() || undefined,
      };
      const response = await api.post('/after-sales', submitData);
      const createdCase = response.data?.data || response.data;
      const caseId = createdCase.id;

      // 如果有附件，顺带上传
      if (selectedFiles.length > 0 && caseId) {
        setUploadingAttachments(true);
        try {
          const formDataUpload = new FormData();
          selectedFiles.forEach((file) => {
            formDataUpload.append('files', file);
          });

          await api.post(
            `/after-sales/${caseId}/attachments`,
            formDataUpload,
            {
              headers: {
                'Content-Type': 'multipart/form-data',
              },
            },
          );
        } catch (uploadError: any) {
          console.error('上传附件失败:', uploadError);
          alert(
            '工单创建成功，但附件上传失败: ' +
              (uploadError.response?.data?.message ||
                uploadError.message),
          );
        } finally {
          setUploadingAttachments(false);
        }
      }

      alert(
        '工单创建成功' +
          (selectedFiles.length > 0 ? '，附件已上传' : ''),
      );
      // 重置所有状态
      setFormData({
        orderId: '',
        trackingNo: '',
        supplierId: '',
        type: 'DAMAGED',
        priority: 'MEDIUM',
        description: '',
        claimAmount: '',
        inventoryDisposition: '',
      });
      setSearchResults([]);
      setMatchedStore(null);
      setMatchedSupplier(null);
      setSelectedFiles([]);
      onSuccess();
    } catch (error: any) {
      console.error('创建工单失败:', error);
      alert(
        '创建工单失败: ' +
          (error.response?.data?.message || error.message),
      );
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-lg max-w-2xl w-full max-h-[90vh] overflow-y-auto">
        <div className="p-6">
          <div className="flex justify-between items-center mb-6">
            <h2 className="text-xl font-bold">创建售后工单</h2>
            <button
              onClick={() => {
                // 清理预览 URL
                selectedFiles.forEach((file) => {
                  const previewUrl = URL.createObjectURL(file);
                  URL.revokeObjectURL(previewUrl);
                });
                // 重置所有状态
                setFormData({
                  orderId: '',
                  trackingNo: '',
                  supplierId: '',
                  type: 'DAMAGED',
                  priority: 'MEDIUM',
                  description: '',
                  claimAmount: '',
                  inventoryDisposition: '',
                });
                setSearchResults([]);
                setMatchedStore(null);
                setMatchedSupplier(null);
                setSelectedFiles([]);
                onClose();
              }}
              className="text-gray-400 hover:text-gray-600"
            >
              <svg
                className="w-6 h-6"
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
          </div>

          <form onSubmit={handleSubmit} className="space-y-4">
            {/* 快递单号查询 */}
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                快递单号（可选）
              </label>
              <div className="flex gap-2">
                <input
                  type="text"
                  value={formData.trackingNo}
                  onChange={(e) => {
                    const value = e.target.value;
                    setFormData({ ...formData, trackingNo: value });
                    // 清空时同时清空匹配信息
                    if (!value.trim()) {
                      setSearchResults([]);
                      setMatchedStore(null);
                      setMatchedSupplier(null);
                      setFormData((prev) => ({ ...prev, supplierId: '' }));
                    }
                  }}
                  placeholder="输入快递单号自动匹配订单"
                  className="flex-1 px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                />
                <button
                  type="button"
                  onClick={handleSearchTracking}
                  disabled={searching || !formData.trackingNo.trim()}
                  className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:bg-gray-400"
                >
                  {searching ? '查询中...' : '查询'}
                </button>
              </div>
              {searchResults.length > 0 && (
                <div className="mt-2 p-3 bg-blue-50 rounded-lg">
                  <div className="text-sm space-y-1">
                    <div className="font-medium text-blue-900">
                      ✓ 已匹配到发货记录
                    </div>
                    {searchResults[0].order?.orderNo && (
                      <div className="text-gray-700">
                        <span className="font-medium">订单号：</span>
                        {searchResults[0].order.orderNo}
                      </div>
                    )}
                    <div className="text-gray-700">
                      <span className="font-medium">商品：</span>
                      {searchResults[0].order?.productName ||
                        searchResults[0].rfqItem?.productName ||
                        '未知'}
                    </div>
                    {matchedStore && (
                      <div className="text-gray-700">
                        <span className="font-medium">门店：</span>
                        {matchedStore.name} ({matchedStore.code})
                      </div>
                    )}
                    {searchResults[0].source && (
                      <div className="text-gray-700">
                        <span className="font-medium">来源：</span>
                        <span
                          className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ${
                            searchResults[0].source === 'ECOMMERCE'
                              ? 'bg-purple-100 text-purple-800'
                              : 'bg-blue-100 text-blue-800'
                          }`}
                        >
                          {searchResults[0].source === 'ECOMMERCE'
                            ? '电商平台采购'
                            : '供应商发货'}
                        </span>
                      </div>
                    )}
                    {matchedSupplier && (
                      <div className="text-gray-700">
                        <span className="font-medium">供应商：</span>
                        {matchedSupplier.username}
                      </div>
                    )}
                    {!matchedSupplier &&
                      searchResults[0].source === 'ECOMMERCE' && (
                        <div className="text-gray-700">
                          <span className="font-medium">供应商：</span>
                          <span className="text-gray-500">
                            电商平台采购（无供应商）
                          </span>
                        </div>
                      )}
                    {searchResults[0].carrier && (
                      <div className="text-gray-700">
                        <span className="font-medium">快递公司：</span>
                        {searchResults[0].carrier}
                      </div>
                    )}
                  </div>
                </div>
              )}
              {searchResults.length === 0 &&
                formData.trackingNo &&
                !searching && (
                  <div className="mt-2 p-3 bg-yellow-50 rounded-lg">
                    <div className="text-sm text-yellow-800">
                      未找到匹配的快递单号，请手动填写订单信息。
                    </div>
                  </div>
                )}
            </div>

            {/* 匹配门店（只读） */}
            {matchedStore && (
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  关联门店（自动匹配）
                </label>
                <input
                  type="text"
                  value={`${matchedStore.name} (${matchedStore.code})`}
                  disabled
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg bg-gray-50 text-gray-600 cursor-not-allowed"
                />
              </div>
            )}

            {/* 匹配供应商（只读） */}
            {matchedSupplier && (
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  关联供应商（自动匹配）
                </label>
                <input
                  type="text"
                  value={matchedSupplier.username}
                  disabled
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg bg-gray-50 text-gray-600 cursor-not-allowed"
                />
              </div>
            )}

            {/* 订单 ID */}
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                订单 ID
              </label>
              <input
                type="text"
                value={formData.orderId}
                onChange={(e) =>
                  setFormData({ ...formData, orderId: e.target.value })
                }
                required
                placeholder="订单 ID（必填，可通过快递单号自动填充）"
                className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
              />
            </div>

            {/* 问题类型 */}
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                问题类型
              </label>
              <select
                value={formData.type}
                onChange={(e) =>
                  setFormData({ ...formData, type: e.target.value })
                }
                required
                className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
              >
                {Object.entries(TYPE_LABELS).map(([value, label]) => (
                  <option key={value} value={value}>
                    {label}
                  </option>
                ))}
              </select>
            </div>

            {/* 优先级 */}
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                优先级
              </label>
              <select
                value={formData.priority}
                onChange={(e) =>
                  setFormData({ ...formData, priority: e.target.value })
                }
                required
                className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
              >
                {Object.entries(PRIORITY_LABELS).map(([value, label]) => (
                  <option key={value} value={value}>
                    {label}
                  </option>
                ))}
              </select>
            </div>

            {/* 问题描述 */}
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                问题描述
              </label>
              <textarea
                value={formData.description}
                onChange={(e) =>
                  setFormData({ ...formData, description: e.target.value })
                }
                required
                rows={4}
                placeholder="请详细描述客户遇到的问题、数量、时间等信息..."
                className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
              />
            </div>

            {/* 索赔金额 */}
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                索赔金额（可选）
              </label>
              <input
                type="number"
                value={formData.claimAmount}
                onChange={(e) =>
                  setFormData({ ...formData, claimAmount: e.target.value })
                }
                placeholder="0.00"
                step="0.01"
                className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
              />
            </div>

            {/* 客户诉求 */}
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                客户诉求（可选）
              </label>
              <input
                type="text"
                value={formData.inventoryDisposition}
                onChange={(e) =>
                  setFormData({
                    ...formData,
                    inventoryDisposition: e.target.value,
                  })
                }
                placeholder="如：退款 / 换货 / 补发 / 赔偿积分 等"
                className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
              />
            </div>

            {/* 上传附件 */}
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">
                上传售后照片 / 视频（可选）
              </label>
              <div className="space-y-3">
                <input
                  type="file"
                  multiple
                  accept="image/*,video/*"
                  onChange={(e) => {
                    const files = e.target.files;
                    if (files) {
                      setSelectedFiles(Array.from(files));
                    }
                  }}
                  className="block w-full text-sm text-gray-500 file:mr-4 file:py-2 file:px-4 file:rounded-lg file:border-0 file:text-sm file:font-semibold file:bg-blue-50 file:text-blue-700 hover:file:bg-blue-100"
                />
                {selectedFiles.length > 0 && (
                  <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                    {selectedFiles.map((file, index) => {
                      const isImage = file.type.startsWith('image/');
                      const isVideo = file.type.startsWith('video/');
                      const previewUrl = URL.createObjectURL(file);
                      return (
                        <div
                          key={index}
                          className="relative border rounded-lg p-2 bg-gray-50"
                        >
                          {isImage ? (
                            <img
                              src={previewUrl}
                              alt={file.name}
                              className="w-full h-24 object-cover rounded mb-1"
                            />
                          ) : isVideo ? (
                            <video
                              src={previewUrl}
                              className="w-full h-24 object-cover rounded mb-1"
                              muted
                              onError={handleVideoError}
                            />
                          ) : null}
                          <div className="flex items-center justify-between">
                            <span
                              className="text-xs text-gray-600 truncate flex-1"
                              title={file.name}
                            >
                              {file.name}
                            </span>
                            <button
                              type="button"
                              onClick={() => {
                                const newFiles = selectedFiles.filter(
                                  (_, i) => i !== index,
                                );
                                setSelectedFiles(newFiles);
                                URL.revokeObjectURL(previewUrl);
                              }}
                              className="ml-1 text-red-500 hover:text-red-700"
                            >
                              <svg
                                className="w-4 h-4"
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
                          </div>
                        </div>
                      );
                    })}
                  </div>
                )}
                {selectedFiles.length > 0 && (
                  <p className="text-xs text-gray-500">
                    已选择 {selectedFiles.length} 个文件，提交工单后会自动上传。
                  </p>
                )}
              </div>
            </div>

            <div className="flex gap-3 pt-4">
              <button
                type="button"
                onClick={onClose}
                className="flex-1 px-4 py-2 border border-gray-300 rounded-lg hover:bg-gray-50"
              >
                取消
              </button>
              <button
                type="submit"
                disabled={loading || uploadingAttachments}
                className="flex-1 px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:bg-gray-400"
              >
                {uploadingAttachments
                  ? '上传附件中...'
                  : loading
                  ? '创建中...'
                  : '创建工单'}
              </button>
            </div>
          </form>
        </div>
      </div>
    </div>
  );
}
