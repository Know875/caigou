'use client';

import { useEffect, useState, KeyboardEvent } from 'react';
import { useRouter } from 'next/navigation';
import { authApi } from '@/lib/auth';
import api from '@/lib/api';

interface Supplier {
  id: string;
  email: string;
  username: string;
  role: string;
  status: 'ACTIVE' | 'INACTIVE' | 'SUSPENDED';
  createdAt: string;
  updatedAt?: string;
}

interface Store {
  id: string;
  name: string;
  code: string;
  address?: string;
  contact?: string;
  status: string;
  createdAt: string;
  updatedAt?: string;
}

interface HistoryFilters {
  startDate: string;
  endDate: string;
  orderNo: string;
  trackingNo: string;
  recipient: string;
  phone: string;
  productName: string;
  status: string;
  storeId: string;
}

export default function AdminPage() {
  const router = useRouter();

  const [user, setUser] = useState<any>(null);
  const [loading, setLoading] = useState(true);

  // 危险操作
  const [clearing, setClearing] = useState(false);
  const [showConfirm, setShowConfirm] = useState(false);

  // 供应商管理
  const [suppliers, setSuppliers] = useState<Supplier[]>([]);
  const [showCreateForm, setShowCreateForm] = useState(false);
  const [showBatchForm, setShowBatchForm] = useState(false);
  const [creating, setCreating] = useState(false);
  const [formData, setFormData] = useState<{
    email: string;
    username: string;
    password: string;
    status: 'ACTIVE' | 'INACTIVE' | 'SUSPENDED';
  }>({
    email: '',
    username: '',
    password: '',
    status: 'ACTIVE',
  });
  const [batchData, setBatchData] = useState('');

  // 门店管理
  const [stores, setStores] = useState<Store[]>([]);
  const [showStoreForm, setShowStoreForm] = useState(false);
  const [creatingStore, setCreatingStore] = useState(false);
  const [deletingStore, setDeletingStore] = useState<string | null>(null);
  const [storeFormData, setStoreFormData] = useState<{
    name: string;
    code: string;
    address: string;
    contact: string;
  }>({
    name: '',
    code: '',
    address: '',
    contact: '',
  });

  // 注册审核
  const [pendingRegistrations, setPendingRegistrations] = useState<any[]>([]);
  const [loadingPending, setLoadingPending] = useState(false);
  const [approving, setApproving] = useState<string | null>(null);
  const [rejecting, setRejecting] = useState<string | null>(null);

  // 历史数据查询
  const [showHistoryModule, setShowHistoryModule] = useState(false);
  const [historyData, setHistoryData] = useState<any[]>([]);
  const [historyStats, setHistoryStats] = useState<any>(null);
  const [loadingHistory, setLoadingHistory] = useState(false);
  const [historyFilters, setHistoryFilters] = useState<HistoryFilters>({
    startDate: '',
    endDate: '',
    orderNo: '',
    trackingNo: '',
    recipient: '',
    phone: '',
    productName: '',
    status: '',
    storeId: '',
  });

  // 钉钉机器人测试
  const [testingDingTalk, setTestingDingTalk] = useState(false);
  const [dingTalkTestResult, setDingTalkTestResult] = useState<any>(null);
  const [testKeyword, setTestKeyword] = useState('');
  const [testingKeyword, setTestingKeyword] = useState(false);
  const [keywordTestResult, setKeywordTestResult] = useState<any>(null);

  useEffect(() => {
    const currentUser = authApi.getCurrentUser();
    if (!currentUser) {
      router.push('/login');
      return;
    }

    if (currentUser.role !== 'ADMIN') {
      router.push('/dashboard');
      return;
    }

    setUser(currentUser);
    setLoading(false);

    fetchSuppliers();
    fetchStores();
    fetchPendingRegistrations();
  }, [router]);

  /** 获取待审核注册申请 */
  const fetchPendingRegistrations = async () => {
    setLoadingPending(true);
    try {
      const response = await api.get('/admin/pending-registrations');
      // 处理不同的响应格式
      let registrations = [];
      if (response.data) {
        if (response.data.data && Array.isArray(response.data.data)) {
          // TransformInterceptor 格式: { success: true, data: [...] }
          registrations = response.data.data;
        } else if (Array.isArray(response.data)) {
          // 直接数组格式
          registrations = response.data;
        }
      }
      console.log('[Admin] 获取待审核注册申请:', {
        responseData: response.data,
        registrationsCount: registrations.length,
        registrations,
      });
      setPendingRegistrations(registrations);
    } catch (error: any) {
      console.error('获取待审核注册申请失败:', error);
      setPendingRegistrations([]);
    } finally {
      setLoadingPending(false);
    }
  };

  /** 审核通过 */
  const handleApprove = async (userId: string) => {
    if (!confirm('确定要【审核通过】这条注册申请吗？')) {
      return;
    }

    setApproving(userId);
    try {
      await api.patch(`/admin/users/${userId}/approve`);
      alert('审核通过成功');
      fetchPendingRegistrations();
      fetchSuppliers();
      fetchStores();
    } catch (error: any) {
      console.error('审核通过失败:', error);
      alert(error.response?.data?.message || '审核通过失败');
    } finally {
      setApproving(null);
    }
  };

  /** 审核拒绝 */
  const handleReject = async (userId: string) => {
    const reason = prompt('请输入拒绝原因（可选）：');
    if (reason === null) {
      // 用户取消
      return;
    }

    setRejecting(userId);
    try {
      await api.patch(`/admin/users/${userId}/reject`, { reason: reason || undefined });
      alert('已拒绝该注册申请');
      fetchPendingRegistrations();
    } catch (error: any) {
      console.error('审核拒绝失败:', error);
      alert(error.response?.data?.message || '审核拒绝失败');
    } finally {
      setRejecting(null);
    }
  };

  /** 获取供应商列表 */
  const fetchSuppliers = async () => {
    try {
      const response = await api.get('/admin/suppliers');
      setSuppliers(response.data.data || []);
    } catch (error: any) {
      console.error('获取供应商列表失败:', error);
    }
  };

  /** 获取门店列表 */
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

  /** 创建门店 */
  const handleCreateStore = async () => {
    if (!storeFormData.name || !storeFormData.code) {
      alert('请填写门店名称和门店编码');
      return;
    }

    setCreatingStore(true);
    try {
      await api.post('/stores', {
        name: storeFormData.name,
        code: storeFormData.code,
        address: storeFormData.address || undefined,
        contact: storeFormData.contact || undefined,
      });
      alert('门店创建成功');
      setShowStoreForm(false);
      setStoreFormData({ name: '', code: '', address: '', contact: '' });
      fetchStores();
    } catch (error: any) {
      console.error('创建门店失败:', error);
      alert(error.response?.data?.message || '创建门店失败');
    } finally {
      setCreatingStore(false);
    }
  };

  /** 删除门店（实际上可以是停用） */
  const handleDeleteStore = async (store: Store) => {
    if (
      !confirm(
        `确定要删除门店 "${store.name}" (${store.code}) 吗？\n\n此操作会将门店状态设置为停用，如果该门店下存在关联的订单或发货记录，将无法删除。`,
      )
    ) {
      return;
    }

    setDeletingStore(store.id);
    try {
      await api.delete(`/stores/${store.id}`);
      alert('门店删除成功');
      fetchStores();
    } catch (error: any) {
      console.error('删除门店失败:', error);
      const errorMessage = error.response?.data?.message || error.message || '删除门店失败';
      alert(errorMessage);
    } finally {
      setDeletingStore(null);
    }
  };

  /** 创建单个供应商账号 */
  const handleCreateSupplier = async () => {
    if (!formData.email || !formData.username || !formData.password) {
      alert('请填写所有必填字段');
      return;
    }

    setCreating(true);
    try {
      await api.post('/admin/suppliers', formData);
      alert('供应商账号创建成功');
      setShowCreateForm(false);
      setFormData({ email: '', username: '', password: '', status: 'ACTIVE' });
      fetchSuppliers();
    } catch (error: any) {
      console.error('创建供应商失败:', error);
      alert(error.response?.data?.message || '创建供应商失败');
    } finally {
      setCreating(false);
    }
  };

  /** 批量创建供应商 */
  const handleBatchCreate = async () => {
    if (!batchData.trim()) {
      alert('请填写供应商数据');
      return;
    }

    try {
      let parsedSuppliers: any[] = [];

      // 优先尝试 JSON
      try {
        const parsed = JSON.parse(batchData);
        if (Array.isArray(parsed)) {
          parsedSuppliers = parsed;
        } else {
          alert('JSON 格式错误：必须是数组格式');
          return;
        }
      } catch {
        // 如果不是 JSON，则尝试按 CSV 解析
        const lines = batchData.trim().split('\n');
        if (lines.length <= 1) {
          alert('CSV 格式错误：内容为空');
          return;
        }

        const headers = lines[0].split(',').map((h) => h.trim());

        if (
          !headers.includes('email') ||
          !headers.includes('username') ||
          !headers.includes('password')
        ) {
          alert('CSV 格式错误：必须包含 email, username, password 列');
          return;
        }

        for (let i = 1; i < lines.length; i++) {
          const line = lines[i].trim();
          if (!line) continue;

          const values = line.split(',').map((v) => v.trim());
          if (values.length !== headers.length) continue;

          const supplier: any = {};
          headers.forEach((header, index) => {
            supplier[header] = values[index];
          });
          parsedSuppliers.push(supplier);
        }
      }

      if (parsedSuppliers.length === 0) {
        alert('没有有效的供应商数据');
        return;
      }

      setCreating(true);
      const response = await api.post('/admin/suppliers/batch', {
        suppliers: parsedSuppliers,
      });
      const result = response.data.data || response.data;

      alert(
        `批量创建完成，成功：${result?.success ?? 0}，失败：${result?.failed ?? 0}${
          result?.message ? `（${result.message}）` : ''
        }`,
      );
      setShowBatchForm(false);
      setBatchData('');
      fetchSuppliers();
    } catch (error: any) {
      console.error('批量创建供应商失败:', error);
      alert(error.response?.data?.message || '批量创建供应商失败');
    } finally {
      setCreating(false);
    }
  };

  /** 更新供应商状态 */
  const handleUpdateStatus = async (
    supplierId: string,
    status: 'ACTIVE' | 'INACTIVE' | 'SUSPENDED',
  ) => {
    try {
      await api.patch(`/admin/suppliers/${supplierId}/status`, { status });
      alert('状态更新成功');
      fetchSuppliers();
    } catch (error: any) {
      console.error('更新状态失败:', error);
      alert(error.response?.data?.message || '更新状态失败');
    }
  };

  /** 删除供应商 */
  const handleDeleteSupplier = async (supplierId: string) => {
    if (!confirm('确定要删除该供应商账号吗？')) {
      return;
    }

    try {
      await api.delete(`/admin/suppliers/${supplierId}`);
      alert('供应商账号已删除');
      fetchSuppliers();
    } catch (error: any) {
      console.error('删除供应商失败:', error);
      alert(error.response?.data?.message || '删除供应商失败');
    }
  };

  /** 一键清空所有业务数据 */
  const handleClearAllData = async () => {
    setClearing(true);
    try {
      await api.post('/admin/clear-all-data');
      alert('所有业务数据已清空成功（账号与门店信息保留）');
      setShowConfirm(false);
      window.location.reload();
    } catch (error: any) {
      console.error('清空数据失败:', error);
      alert(error.response?.data?.message || '清空数据失败');
    } finally {
      setClearing(false);
    }
  };

  /** 测试钉钉机器人 */
  const testDingTalk = async () => {
    setTestingDingTalk(true);
    setDingTalkTestResult(null);
    try {
      const response = await api.post('/dingtalk/test');
      const result = response.data;

      setDingTalkTestResult(result);

      const isSuccess =
        result?.success === true ||
        result?.data?.errcode === 0 ||
        result?.errcode === 0;

      if (isSuccess) {
        alert('钉钉机器人测试成功，请检查钉钉群是否收到测试消息。');
      } else {
        const errorMsg =
          result?.message ||
          result?.error ||
          result?.data?.errmsg ||
          (result?.errcode !== undefined ? `错误码：${result.errcode}` : '未知错误');
        alert(`钉钉机器人测试失败：${errorMsg}`);
      }
    } catch (error: any) {
      console.error('测试钉钉机器人失败:', error);
      const errorResult = {
        success: false,
        message: error.response?.data?.message || error.message || '测试失败',
      };
      setDingTalkTestResult(errorResult);
      alert(error.response?.data?.message || '测试钉钉机器人失败');
    } finally {
      setTestingDingTalk(false);
    }
  };

  /** 测试关键字消息 */
  const testKeywordMessage = async () => {
    if (!testKeyword.trim()) {
      alert('请输入要测试的关键字');
      return;
    }

    setTestingKeyword(true);
    setKeywordTestResult(null);
    try {
      const response = await api.post('/dingtalk/test-keyword', {
        keyword: testKeyword.trim(),
      });
      const result = response.data.data || response.data;
      setKeywordTestResult(result);

      if (result.success) {
        alert(
          `关键字「${testKeyword}」测试成功，请检查钉钉群是否收到包含该关键字的测试消息。`,
        );
      } else {
        alert(
          `关键字「${testKeyword}」测试失败：${
            result.error || result.message || '未知错误'
          }`,
        );
      }
    } catch (error: any) {
      console.error('测试关键字失败:', error);
      setKeywordTestResult({
        success: false,
        message: error.response?.data?.message || error.message || '测试失败',
      });
      alert(error.response?.data?.message || '测试关键字失败');
    } finally {
      setTestingKeyword(false);
    }
  };

  /** 查询历史数据 */
  const fetchHistoryData = async () => {
    setLoadingHistory(true);
    setHistoryData([]);
    setHistoryStats(null);

    try {
      const params: any = {};
      if (historyFilters.startDate) params.startDate = historyFilters.startDate;
      if (historyFilters.endDate) params.endDate = historyFilters.endDate;
      if (historyFilters.orderNo.trim()) params.orderNo = historyFilters.orderNo.trim();
      if (historyFilters.trackingNo.trim()) params.trackingNo = historyFilters.trackingNo.trim();
      if (historyFilters.recipient.trim()) params.recipient = historyFilters.recipient.trim();
      if (historyFilters.phone.trim()) params.phone = historyFilters.phone.trim();
      if (historyFilters.productName.trim())
        params.productName = historyFilters.productName.trim();
      if (historyFilters.status) params.status = historyFilters.status;
      if (historyFilters.storeId) params.storeId = historyFilters.storeId;

      const [dataResponse, statsResponse] = await Promise.all([
        api.get('/orders/history/data', { params }),
        api.get('/orders/history/stats', { params }),
      ]);

      const data = dataResponse.data.data || dataResponse.data || [];
      const stats = statsResponse.data.data || statsResponse.data || null;

      const arr = Array.isArray(data) ? data : [];
      setHistoryData(arr);
      setHistoryStats(stats);

      if (arr.length === 0) {
        alert('未查询到数据，请调整筛选条件后重试。');
      }
    } catch (error: any) {
      console.error('[历史数据查询] 失败:', error);
      alert(error.response?.data?.message || error.message || '查询历史数据失败');
      setHistoryData([]);
      setHistoryStats(null);
    } finally {
      setLoadingHistory(false);
    }
  };

  /** 导出历史数据为 CSV */
  const exportHistoryData = () => {
    if (historyData.length === 0) {
      alert('没有可导出的数据');
      return;
    }

    const headers = [
      '发货编号',
      '订单号',
      'open_id',
      '收件人',
      '手机号',
      '地址',
      '修改地址',
      '品名',
      '数量',
      '平台标价',
      '积分',
      '状态',
      '日期',
      '备注',
      '快递单号',
      '成本价',
    ];

    const csvRows = [
      headers.join(','),
      ...historyData.map((item) =>
        [
          item.shipmentNo || '',
          item.orderNo || '',
          item.openid || '',
          item.recipient || '',
          item.phone || '',
          `"${(item.address || '').replace(/"/g, '""')}"`,
          `"${(item.modifiedAddress || '').replace(/"/g, '""')}"`,
          `"${(item.productName || '').replace(/"/g, '""')}"`,
          item.quantity || 0,
          item.price || 0,
          item.points || 0,
          item.status || '',
          item.date ? new Date(item.date).toLocaleString('zh-CN') : '',
          `"${(item.notes || '').replace(/"/g, '""')}"`,
          item.trackingNo || '',
          item.costPrice || '',
        ].join(','),
      ),
    ];

    const csvContent = csvRows.join('\n');
    const blob = new Blob(['\uFEFF' + csvContent], {
      type: 'text/csv;charset=utf-8;',
    });
    const link = document.createElement('a');
    const url = URL.createObjectURL(blob);
    link.setAttribute(
      'download',
      `历史数据_${new Date().toISOString().split('T')[0]}.csv`,
    );
    link.href = url;
    link.style.visibility = 'hidden';
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  const handleKeywordInputKeyPress = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter') {
      testKeywordMessage();
    }
  };

  if (loading) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-gray-50">
        <div className="text-center">
          <div className="mx-auto h-12 w-12 animate-spin rounded-full border-4 border-blue-600 border-t-transparent" />
          <p className="mt-4 text-gray-600">加载中...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gray-50">
      <div className="mx-auto max-w-4xl px-4 py-8 sm:px-6 lg:px-8">
        {/* 头部 */}
        <div className="mb-8">
          <h1 className="text-3xl font-bold text-gray-900">系统管理</h1>
          <p className="mt-2 text-sm text-gray-600">管理员专用功能面板</p>
        </div>

        {/* 历史数据管理模块 */}
        <div className="mb-8 rounded-xl border-2 border-blue-200 bg-gradient-to-r from-blue-50 to-purple-50 p-6 shadow-lg">
          <div className="mb-4 flex items-center justify-between">
            <div className="flex items-center gap-3">
              <div className="flex h-12 w-12 items-center justify-center rounded-full bg-blue-600">
                <svg
                  className="h-6 w-6 text-white"
                  fill="none"
                  stroke="currentColor"
                  viewBox="0 0 24 24"
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth={2}
                    d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z"
                  />
                </svg>
              </div>
              <div>
                <h2 className="text-xl font-semibold text-gray-900">历史数据管理</h2>
                <p className="text-sm text-gray-600">
                  导入 / 查询 / 统计历史订单与发货数据
                </p>
              </div>
            </div>
            <div className="flex gap-2">
              <button
                onClick={() => router.push('/admin/history-import')}
                className="flex items-center gap-2 rounded-lg bg-green-600 px-5 py-2.5 text-sm font-medium text-white shadow-md transition-all hover:bg-green-700 hover:shadow-lg"
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
                    d="M7 16a4 4 0 01-.88-7.903A5 5 0 1115.9 6L16 6a5 5 0 011 9.9M15 13l-3-3m0 0l-3 3m3-3v12"
                  />
                </svg>
                导入历史数据
              </button>
              <button
                onClick={() => {
                  const next = !showHistoryModule;
                  setShowHistoryModule(next);
                  if (next && historyData.length === 0) {
                    fetchHistoryData();
                  }
                }}
                className="flex items-center gap-2 rounded-lg bg-purple-600 px-5 py-2.5 text-sm font-medium text-white shadow-md transition-all hover:bg-purple-700 hover:shadow-lg"
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
                    d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z"
                  />
                </svg>
                {showHistoryModule ? '收起查询' : '展开查询'}
              </button>
            </div>
          </div>

          {showHistoryModule && (
            <div className="space-y-4">
              {/* 筛选条件 */}
              <div className="rounded-lg border border-gray-200 bg-gray-50 p-4">
                <div className="mb-3 flex items-center justify-between">
                  <h3 className="text-sm font-semibold text-gray-700">筛选条件</h3>
                  <div className="flex gap-2">
                    <button
                      onClick={() =>
                        setHistoryFilters((prev) => ({
                          ...prev,
                          orderNo: '',
                          trackingNo: '',
                          recipient: '',
                          phone: '',
                          productName: '',
                          status: '',
                        }))
                      }
                      className="rounded bg-white px-2 py-1 text-xs text-gray-600 hover:bg-gray-100"
                    >
                      清空条件
                    </button>
                    <button
                      onClick={() => {
                        const today = new Date().toISOString().split('T')[0];
                        setHistoryFilters((prev) => ({
                          ...prev,
                          startDate: today,
                          endDate: today,
                        }));
                      }}
                      className="rounded bg-white px-2 py-1 text-xs text-blue-600 hover:bg-blue-50"
                    >
                      今天
                    </button>
                    <button
                      onClick={() => {
                        const endDate = new Date();
                        const startDate = new Date();
                        startDate.setDate(startDate.getDate() - 7);
                        setHistoryFilters((prev) => ({
                          ...prev,
                          startDate: startDate.toISOString().split('T')[0],
                          endDate: endDate.toISOString().split('T')[0],
                        }));
                      }}
                      className="rounded bg-white px-2 py-1 text-xs text-blue-600 hover:bg-blue-50"
                    >
                      最近7天
                    </button>
                    <button
                      onClick={() => {
                        const endDate = new Date();
                        const startDate = new Date();
                        startDate.setDate(startDate.getDate() - 30);
                        setHistoryFilters((prev) => ({
                          ...prev,
                          startDate: startDate.toISOString().split('T')[0],
                          endDate: endDate.toISOString().split('T')[0],
                        }));
                      }}
                      className="rounded bg-white px-2 py-1 text-xs text-blue-600 hover:bg-blue-50"
                    >
                      最近30天
                    </button>
                  </div>
                </div>

                <div className="grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-3">
                  <div>
                    <label className="block text-xs font-medium text-gray-700">
                      开始日期
                    </label>
                    <input
                      type="date"
                      value={historyFilters.startDate}
                      onChange={(e) =>
                        setHistoryFilters((prev) => ({
                          ...prev,
                          startDate: e.target.value,
                        }))
                      }
                      className="mt-1 block w-full rounded-md border border-gray-300 px-3 py-2 text-sm shadow-sm focus:border-blue-500 focus:outline-none focus:ring-blue-500"
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-gray-700">
                      结束日期
                    </label>
                    <input
                      type="date"
                      value={historyFilters.endDate}
                      onChange={(e) =>
                        setHistoryFilters((prev) => ({
                          ...prev,
                          endDate: e.target.value,
                        }))
                      }
                      className="mt-1 block w-full rounded-md border border-gray-300 px-3 py-2 text-sm shadow-sm focus:border-blue-500 focus:outline-none focus:ring-blue-500"
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-gray-700">
                      门店
                    </label>
                    <select
                      value={historyFilters.storeId}
                      onChange={(e) =>
                        setHistoryFilters((prev) => ({
                          ...prev,
                          storeId: e.target.value,
                        }))
                      }
                      className="mt-1 block w-full rounded-md border border-gray-300 px-3 py-2 text-sm shadow-sm focus:border-blue-500 focus:outline-none focus:ring-blue-500"
                    >
                      <option value="">全部门店</option>
                      {stores.map((store) => (
                        <option key={store.id} value={store.id}>
                          {store.name}
                        </option>
                      ))}
                    </select>
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-gray-700">
                      订单号
                    </label>
                    <input
                      type="text"
                      value={historyFilters.orderNo}
                      onChange={(e) =>
                        setHistoryFilters((prev) => ({
                          ...prev,
                          orderNo: e.target.value,
                        }))
                      }
                      className="mt-1 block w-full rounded-md border border-gray-300 px-3 py-2 text-sm shadow-sm focus:border-blue-500 focus:outline-none focus:ring-blue-500"
                      placeholder="输入订单号"
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-gray-700">
                      快递单号
                    </label>
                    <input
                      type="text"
                      value={historyFilters.trackingNo}
                      onChange={(e) =>
                        setHistoryFilters((prev) => ({
                          ...prev,
                          trackingNo: e.target.value,
                        }))
                      }
                      className="mt-1 block w-full rounded-md border border-gray-300 px-3 py-2 text-sm shadow-sm focus:border-blue-500 focus:outline-none focus:ring-blue-500"
                      placeholder="输入快递单号"
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-gray-700">
                      收件人
                    </label>
                    <input
                      type="text"
                      value={historyFilters.recipient}
                      onChange={(e) =>
                        setHistoryFilters((prev) => ({
                          ...prev,
                          recipient: e.target.value,
                        }))
                      }
                      className="mt-1 block w-full rounded-md border border-gray-300 px-3 py-2 text-sm shadow-sm focus:border-blue-500 focus:outline-none focus:ring-blue-500"
                      placeholder="输入收件人"
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-gray-700">
                      手机号
                    </label>
                    <input
                      type="text"
                      value={historyFilters.phone}
                      onChange={(e) =>
                        setHistoryFilters((prev) => ({
                          ...prev,
                          phone: e.target.value,
                        }))
                      }
                      className="mt-1 block w-full rounded-md border border-gray-300 px-3 py-2 text-sm shadow-sm focus:border-blue-500 focus:outline-none focus:ring-blue-500"
                      placeholder="输入手机号"
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-gray-700">
                      商品名称
                    </label>
                    <input
                      type="text"
                      value={historyFilters.productName}
                      onChange={(e) =>
                        setHistoryFilters((prev) => ({
                          ...prev,
                          productName: e.target.value,
                        }))
                      }
                      className="mt-1 block w-full rounded-md border border-gray-300 px-3 py-2 text-sm shadow-sm focus:border-blue-500 focus:outline-none focus:ring-blue-500"
                      placeholder="输入商品名称"
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-gray-700">
                      状态
                    </label>
                    <select
                      value={historyFilters.status}
                      onChange={(e) =>
                        setHistoryFilters((prev) => ({
                          ...prev,
                          status: e.target.value,
                        }))
                      }
                      className="mt-1 block w-full rounded-md border border-gray-300 px-3 py-2 text-sm shadow-sm focus:border-blue-500 focus:outline-none focus:ring-blue-500"
                    >
                      <option value="">全部状态</option>
                      <option value="PENDING">待处理</option>
                      <option value="PROCESSING">处理中</option>
                      <option value="SHIPPED">已发货</option>
                      <option value="DELIVERED">已送达</option>
                      <option value="CANCELLED">已取消</option>
                    </select>
                  </div>
                </div>

                <div className="mt-4 flex gap-2">
                  <button
                    onClick={fetchHistoryData}
                    disabled={loadingHistory}
                    className="rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white transition-all hover:bg-blue-700 disabled:opacity-50"
                  >
                    {loadingHistory ? '查询中...' : '查询'}
                  </button>
                  <button
                    onClick={() =>
                      setHistoryFilters({
                        startDate: '',
                        endDate: '',
                        orderNo: '',
                        trackingNo: '',
                        recipient: '',
                        phone: '',
                        productName: '',
                        status: '',
                        storeId: '',
                      })
                    }
                    className="rounded-lg border border-gray-300 bg-white px-4 py-2 text-sm font-medium text-gray-700 transition-all hover:bg-gray-50"
                  >
                    重置
                  </button>
                  {historyData.length > 0 && (
                    <button
                      onClick={exportHistoryData}
                      className="rounded-lg bg-green-600 px-4 py-2 text-sm font-medium text-white transition-all hover:bg-green-700"
                    >
                      导出 CSV
                    </button>
                  )}
                </div>
              </div>

              {/* 统计信息 */}
              {historyStats && (
                <div className="space-y-4">
                  {/* 基本统计卡片 */}
                  <div className="grid grid-cols-2 gap-4 md:grid-cols-4 lg:grid-cols-6">
                    <div className="rounded-lg bg-blue-50 p-4">
                      <div className="text-sm text-gray-600">总订单数</div>
                      <div className="mt-1 text-2xl font-bold text-blue-600">
                        {historyStats.totalOrders || 0}
                      </div>
                    </div>
                    <div className="rounded-lg bg-green-50 p-4">
                      <div className="text-sm text-gray-600">总金额</div>
                      <div className="mt-1 text-xl font-bold text-green-600">
                        ¥{historyStats.totalAmount?.toFixed(2) || '0.00'}
                      </div>
                    </div>
                    <div className="rounded-lg bg-purple-50 p-4">
                      <div className="text-sm text-gray-600">总积分</div>
                      <div className="mt-1 text-2xl font-bold text-purple-600">
                        {historyStats.totalPoints || 0}
                      </div>
                    </div>
                    <div className="rounded-lg bg-orange-50 p-4">
                      <div className="text-sm text-gray-600">总发货数</div>
                      <div className="mt-1 text-2xl font-bold text-orange-600">
                        {historyStats.totalShipments || 0}
                      </div>
                    </div>
                    <div className="rounded-lg bg-indigo-50 p-4">
                      <div className="text-sm text-gray-600">平均订单金额</div>
                      <div className="mt-1 text-xl font-bold text-indigo-600">
                        ¥{historyStats.avgOrderAmount?.toFixed(2) || '0.00'}
                      </div>
                    </div>
                    <div className="rounded-lg bg-pink-50 p-4">
                      <div className="text-sm text-gray-600">最大订单金额</div>
                      <div className="mt-1 text-xl font-bold text-pink-600">
                        ¥{historyStats.maxOrderAmount?.toFixed(2) || '0.00'}
                      </div>
                    </div>
                  </div>

                  {/* 状态统计 */}
                  <div className="rounded-lg border border-gray-200 bg-white p-4">
                    <h3 className="mb-3 text-sm font-semibold text-gray-700">
                      订单状态分布
                    </h3>
                    <div className="grid grid-cols-2 gap-3 md:grid-cols-5">
                      <div className="rounded bg-gray-50 p-3">
                        <div className="text-xs text-gray-600">待处理</div>
                        <div className="mt-1 text-lg font-bold text-gray-700">
                          {historyStats.statusCount?.PENDING || 0}
                        </div>
                      </div>
                      <div className="rounded bg-yellow-50 p-3">
                        <div className="text-xs text-gray-600">处理中</div>
                        <div className="mt-1 text-lg font-bold text-yellow-700">
                          {historyStats.statusCount?.PROCESSING || 0}
                        </div>
                      </div>
                      <div className="rounded bg-blue-50 p-3">
                        <div className="text-xs text-gray-600">已发货</div>
                        <div className="mt-1 text-lg font-bold text-blue-700">
                          {historyStats.statusCount?.SHIPPED || 0}
                        </div>
                      </div>
                      <div className="rounded bg-green-50 p-3">
                        <div className="text-xs text-gray-600">已送达</div>
                        <div className="mt-1 text-lg font-bold text-green-700">
                          {historyStats.statusCount?.DELIVERED || 0}
                        </div>
                      </div>
                      <div className="rounded bg-red-50 p-3">
                        <div className="text-xs text-gray-600">已取消</div>
                        <div className="mt-1 text-lg font-bold text-red-700">
                          {historyStats.statusCount?.CANCELLED || 0}
                        </div>
                      </div>
                    </div>
                  </div>

                  {/* 按门店统计 */}
                  {historyStats.storeStatsList &&
                    historyStats.storeStatsList.length > 0 && (
                      <div className="rounded-lg border border-gray-200 bg-white p-4">
                        <h3 className="mb-3 text-sm font-semibold text-gray-700">
                          按门店统计
                        </h3>
                        <div className="overflow-x-auto">
                          <table className="min-w-full divide-y divide-gray-200">
                            <thead className="bg-gray-50">
                              <tr>
                                <th className="px-4 py-2 text-left text-xs font-medium uppercase tracking-wider text-gray-500">
                                  门店名称
                                </th>
                                <th className="px-4 py-2 text-left text-xs font-medium uppercase tracking-wider text-gray-500">
                                  门店编码
                                </th>
                                <th className="px-4 py-2 text-right text-xs font-medium uppercase tracking-wider text-gray-500">
                                  订单数
                                </th>
                                <th className="px-4 py-2 text-right text-xs font-medium uppercase tracking-wider text-gray-500">
                                  总金额
                                </th>
                              </tr>
                            </thead>
                            <tbody className="divide-y divide-gray-200 bg-white">
                              {historyStats.storeStatsList.map((store: any) => (
                                <tr key={store.storeId}>
                                  <td className="whitespace-nowrap px-4 py-2 text-sm text-gray-900">
                                    {store.name}
                                  </td>
                                  <td className="whitespace-nowrap px-4 py-2 text-sm text-gray-500">
                                    {store.code}
                                  </td>
                                  <td className="whitespace-nowrap px-4 py-2 text-right text-sm font-medium text-gray-900">
                                    {store.count}
                                  </td>
                                  <td className="whitespace-nowrap px-4 py-2 text-right text-sm font-medium text-green-600">
                                    ¥{store.amount?.toFixed(2) || '0.00'}
                                  </td>
                                </tr>
                              ))}
                            </tbody>
                          </table>
                        </div>
                      </div>
                    )}

                  {/* 热门商品 Top 10 */}
                  {historyStats.topProducts &&
                    historyStats.topProducts.length > 0 && (
                      <div className="rounded-lg border border-gray-200 bg-white p-4">
                        <h3 className="mb-3 text-sm font-semibold text-gray-700">
                          热门商品 Top 10
                        </h3>
                        <div className="overflow-x-auto">
                          <table className="min-w-full divide-y divide-gray-200">
                            <thead className="bg-gray-50">
                              <tr>
                                <th className="px-4 py-2 text-left text-xs font-medium uppercase tracking-wider text-gray-500">
                                  排名
                                </th>
                                <th className="px-4 py-2 text-left text-xs font-medium uppercase tracking-wider text-gray-500">
                                  商品名称
                                </th>
                                <th className="px-4 py-2 text-right text-xs font-medium uppercase tracking-wider text-gray-500">
                                  订单数
                                </th>
                                <th className="px-4 py-2 text-right text-xs font-medium uppercase tracking-wider text-gray-500">
                                  总金额
                                </th>
                              </tr>
                            </thead>
                            <tbody className="divide-y divide-gray-200 bg-white">
                              {historyStats.topProducts.map(
                                (product: any, index: number) => (
                                  <tr key={index}>
                                    <td className="whitespace-nowrap px-4 py-2 text-sm font-medium text-gray-900">
                                      #{index + 1}
                                    </td>
                                    <td className="px-4 py-2 text-sm text-gray-900">
                                      {product.name}
                                    </td>
                                    <td className="whitespace-nowrap px-4 py-2 text-right text-sm text-gray-500">
                                      {product.count}
                                    </td>
                                    <td className="whitespace-nowrap px-4 py-2 text-right text-sm font-medium text-green-600">
                                      ¥{product.amount?.toFixed(2) || '0.00'}
                                    </td>
                                  </tr>
                                ),
                              )}
                            </tbody>
                          </table>
                        </div>
                      </div>
                    )}

                  {/* 每日走势（最近若干天） */}
                  {historyStats.dailyStats &&
                    historyStats.dailyStats.length > 0 && (
                      <div className="rounded-lg border border-gray-200 bg-white p-4">
                        <h3 className="mb-3 text-sm font-semibold text-gray-700">
                          每日走势（最近若干天）
                        </h3>
                        <div className="overflow-x-auto">
                          <div className="flex gap-2">
                            {historyStats.dailyStats.slice(-10).map((day: any) => (
                              <div
                                key={day.date}
                                className="flex min-w-[80px] flex-col items-center rounded-lg bg-gray-50 p-2"
                              >
                                <div className="text-xs text-gray-600">
                                  {new Date(day.date).toLocaleDateString('zh-CN', {
                                    month: 'short',
                                    day: 'numeric',
                                  })}
                                </div>
                                <div className="mt-1 text-sm font-bold text-gray-900">
                                  {day.count}
                                </div>
                                <div className="text-xs text-green-600">
                                  ¥{day.amount?.toFixed(0) || '0'}
                                </div>
                              </div>
                            ))}
                          </div>
                        </div>
                      </div>
                    )}
                </div>
              )}

              {/* 数据表格 */}
              <div className="overflow-x-auto rounded-lg border border-gray-200 bg-white">
                <table className="min-w-full divide-y divide-gray-200">
                  <thead className="bg-gray-50">
                    <tr>
                      <th className="px-3 py-2 text-left text-xs font-medium uppercase tracking-wider text-gray-500">
                        发货编号
                      </th>
                      <th className="px-3 py-2 text-left text-xs font-medium uppercase tracking-wider text-gray-500">
                        订单号
                      </th>
                      <th className="px-3 py-2 text-left text-xs font-medium uppercase tracking-wider text-gray-500">
                        open_id
                      </th>
                      <th className="px-3 py-2 text-left text-xs font-medium uppercase tracking-wider text-gray-500">
                        收件人
                      </th>
                      <th className="px-3 py-2 text-left text-xs font-medium uppercase tracking-wider text-gray-500">
                        手机号
                      </th>
                      <th className="px-3 py-2 text-left text-xs font-medium uppercase tracking-wider text-gray-500">
                        地址
                      </th>
                      <th className="px-3 py-2 text-left text-xs font-medium uppercase tracking-wider text-gray-500">
                        修改地址
                      </th>
                      <th className="px-3 py-2 text-left text-xs font-medium uppercase tracking-wider text-gray-500">
                        品名
                      </th>
                      <th className="px-3 py-2 text-left text-xs font-medium uppercase tracking-wider text-gray-500">
                        数量
                      </th>
                      <th className="px-3 py-2 text-left text-xs font-medium uppercase tracking-wider text-gray-500">
                        平台标价
                      </th>
                      <th className="px-3 py-2 text-left text-xs font-medium uppercase tracking-wider text-gray-500">
                        积分
                      </th>
                      <th className="px-3 py-2 text-left text-xs font-medium uppercase tracking-wider text-gray-500">
                        状态
                      </th>
                      <th className="px-3 py-2 text-left text-xs font-medium uppercase tracking-wider text-gray-500">
                        日期
                      </th>
                      <th className="px-3 py-2 text-left text-xs font-medium uppercase tracking-wider text-gray-500">
                        备注
                      </th>
                      <th className="px-3 py-2 text-left text-xs font-medium uppercase tracking-wider text-gray-500">
                        快递单号
                      </th>
                      <th className="px-3 py-2 text-left text-xs font-medium uppercase tracking-wider text-gray-500">
                        成本价
                      </th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-200 bg-white">
                    {loadingHistory ? (
                      <tr>
                        <td
                          colSpan={16}
                          className="px-3 py-8 text-center text-sm text-gray-500"
                        >
                          加载中...
                        </td>
                      </tr>
                    ) : historyData.length === 0 ? (
                      <tr>
                        <td
                          colSpan={16}
                          className="px-3 py-8 text-center text-sm text-gray-500"
                        >
                          暂无数据
                        </td>
                      </tr>
                    ) : (
                      historyData.map((item, index) => (
                        <tr key={index} className="hover:bg-gray-50">
                          <td className="whitespace-nowrap px-3 py-2 text-xs text-gray-900">
                            {item.shipmentNo || '-'}
                          </td>
                          <td className="whitespace-nowrap px-3 py-2 text-xs text-gray-900">
                            {item.orderNo || '-'}
                          </td>
                          <td className="whitespace-nowrap px-3 py-2 text-xs text-gray-500">
                            {item.openid || '-'}
                          </td>
                          <td className="whitespace-nowrap px-3 py-2 text-xs text-gray-900">
                            {item.recipient || '-'}
                          </td>
                          <td className="whitespace-nowrap px-3 py-2 text-xs text-gray-900">
                            {item.phone || '-'}
                          </td>
                          <td className="px-3 py-2 text-xs text-gray-500">
                            {item.address || '-'}
                          </td>
                          <td className="px-3 py-2 text-xs text-gray-500">
                            {item.modifiedAddress || '-'}
                          </td>
                          <td className="px-3 py-2 text-xs text-gray-900">
                            {item.productName || '-'}
                          </td>
                          <td className="whitespace-nowrap px-3 py-2 text-xs text-gray-900">
                            {item.quantity || 0}
                          </td>
                          <td className="whitespace-nowrap px-3 py-2 text-xs text-gray-900">
                            ¥{(item.price ?? 0).toFixed(2)}
                          </td>
                          <td className="whitespace-nowrap px-3 py-2 text-xs text-gray-900">
                            {item.points || 0}
                          </td>
                          <td className="whitespace-nowrap px-3 py-2 text-xs">
                            <span
                              className={`inline-flex rounded-full px-2 py-1 text-xs font-semibold ${
                                item.status === 'DELIVERED'
                                  ? 'bg-green-100 text-green-800'
                                  : item.status === 'SHIPPED'
                                  ? 'bg-blue-100 text-blue-800'
                                  : item.status === 'PROCESSING'
                                  ? 'bg-yellow-100 text-yellow-800'
                                  : item.status === 'CANCELLED'
                                  ? 'bg-red-100 text-red-800'
                                  : 'bg-gray-100 text-gray-800'
                              }`}
                            >
                              {item.status === 'PENDING'
                                ? '待处理'
                                : item.status === 'PROCESSING'
                                ? '处理中'
                                : item.status === 'SHIPPED'
                                ? '已发货'
                                : item.status === 'DELIVERED'
                                ? '已送达'
                                : item.status === 'CANCELLED'
                                ? '已取消'
                                : item.status || '-'}
                            </span>
                          </td>
                          <td className="whitespace-nowrap px-3 py-2 text-xs text-gray-500">
                            {item.date
                              ? new Date(item.date).toLocaleString('zh-CN')
                              : '-'}
                          </td>
                          <td className="px-3 py-2 text-xs text-gray-500">
                            {item.notes || '-'}
                          </td>
                          <td className="whitespace-nowrap px-3 py-2 text-xs text-gray-900">
                            {item.trackingNo || '-'}
                          </td>
                          <td className="whitespace-nowrap px-3 py-2 text-xs text-gray-900">
                            {item.costPrice ? `¥${item.costPrice.toFixed(2)}` : '-'}
                          </td>
                        </tr>
                      ))
                    )}
                  </tbody>
                </table>
              </div>

              {historyData.length > 0 && (
                <div className="text-sm text-gray-600">
                  共查询到 <span className="font-semibold">{historyData.length}</span> 条记录
                </div>
              )}
            </div>
          )}
        </div>

        {/* 注册审核区域 */}
        <div className="mb-8 rounded-xl bg-white p-6 shadow-sm">
          <div className="mb-4 flex items-center justify-between">
            <h2 className="text-xl font-semibold text-gray-900">注册审核</h2>
            <button
              onClick={fetchPendingRegistrations}
              disabled={loadingPending}
              className="rounded-md bg-blue-600 px-3 py-1.5 text-sm text-white hover:bg-blue-700 disabled:opacity-50"
            >
              {loadingPending ? '刷新中...' : '刷新'}
            </button>
          </div>

          {loadingPending ? (
            <div className="py-8 text-center text-gray-500">加载中...</div>
          ) : pendingRegistrations.length === 0 ? (
            <div className="py-8 text-center text-gray-500">暂无待审核的注册申请</div>
          ) : (
            <div className="overflow-x-auto">
              <table className="min-w-full divide-y divide-gray-200">
                <thead className="bg-gray-50">
                  <tr>
                    <th className="px-4 py-3 text-left text-xs font-medium uppercase tracking-wider text-gray-500">
                      类型
                    </th>
                    <th className="px-4 py-3 text-left text-xs font-medium uppercase tracking-wider text-gray-500">
                      邮箱
                    </th>
                    <th className="px-4 py-3 text-left text-xs font-medium uppercase tracking-wider text-gray-500">
                      用户名
                    </th>
                    <th className="px-4 py-3 text-left text-xs font-medium uppercase tracking-wider text-gray-500">
                      门店信息
                    </th>
                    <th className="px-4 py-3 text-left text-xs font-medium uppercase tracking-wider text-gray-500">
                      注册时间
                    </th>
                    <th className="px-4 py-3 text-left text-xs font-medium uppercase tracking-wider text-gray-500">
                      操作
                    </th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-200 bg-white">
                  {pendingRegistrations.map((registration) => (
                    <tr key={registration.id} className="hover:bg-gray-50">
                      <td className="whitespace-nowrap px-4 py-3 text-sm">
                        <span
                          className={`inline-flex rounded-full px-2 py-1 text-xs font-semibold ${
                            registration.role === 'STORE'
                              ? 'bg-purple-100 text-purple-800'
                              : 'bg-green-100 text-green-800'
                          }`}
                        >
                          {registration.role === 'STORE' ? '门店' : '供应商'}
                        </span>
                      </td>
                      <td className="whitespace-nowrap px-4 py-3 text-sm text-gray-900">
                        {registration.email}
                      </td>
                      <td className="whitespace-nowrap px-4 py-3 text-sm text-gray-900">
                        {registration.username}
                      </td>
                      <td className="px-4 py-3 text-sm text-gray-500">
                        {registration.store ? (
                          <div>
                            <div className="font-medium">{registration.store.name}</div>
                            <div className="text-xs text-gray-400">
                              编码：{registration.store.code}
                            </div>
                            {registration.store.address && (
                              <div className="text-xs text-gray-400">
                                {registration.store.address}
                              </div>
                            )}
                          </div>
                        ) : (
                          '-'
                        )}
                      </td>
                      <td className="whitespace-nowrap px-4 py-3 text-sm text-gray-500">
                        {new Date(registration.createdAt).toLocaleString('zh-CN')}
                      </td>
                      <td className="whitespace-nowrap px-4 py-3 text-sm">
                        <div className="flex gap-2">
                          <button
                            onClick={() => handleApprove(registration.id)}
                            disabled={approving === registration.id}
                            className="rounded-md bg-green-600 px-3 py-1 text-xs text-white hover:bg-green-700 disabled:opacity-50"
                          >
                            {approving === registration.id ? '处理中...' : '通过'}
                          </button>
                          <button
                            onClick={() => handleReject(registration.id)}
                            disabled={rejecting === registration.id}
                            className="rounded-md bg-red-600 px-3 py-1 text-xs text-white hover:bg-red-700 disabled:opacity-50"
                          >
                            {rejecting === registration.id ? '处理中...' : '拒绝'}
                          </button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>

        {/* 门店管理区域 */}
        <div className="mb-8 rounded-xl bg-white p-6 shadow-sm">
          <div className="mb-4 flex items-center justify-between">
            <div>
              <h2 className="text-xl font-semibold text-gray-900">门店管理</h2>
              <p className="text-sm text-gray-600">创建与管理门店信息</p>
            </div>
            <button
              onClick={() => {
                setShowStoreForm(true);
                setShowCreateForm(false);
                setShowBatchForm(false);
              }}
              className="rounded-lg bg-green-600 px-4 py-2 text-sm font-medium text-white transition-all hover:bg-green-700"
            >
              创建门店
            </button>
          </div>

          {/* 门店列表 */}
          <div className="overflow-x-auto">
            <table className="min-w-full divide-y divide-gray-200">
              <thead className="bg-gray-50">
                <tr>
                  <th className="px-6 py-3 text-left text-xs font-medium uppercase tracking-wider text-gray-500">
                    门店名称
                  </th>
                  <th className="px-6 py-3 text-left text-xs font-medium uppercase tracking-wider text-gray-500">
                    门店编码
                  </th>
                  <th className="px-6 py-3 text-left text-xs font-medium uppercase tracking-wider text-gray-500">
                    地址
                  </th>
                  <th className="px-6 py-3 text-left text-xs font-medium uppercase tracking-wider text-gray-500">
                    联系方式
                  </th>
                  <th className="px-6 py-3 text-left text-xs font-medium uppercase tracking-wider text-gray-500">
                    创建时间
                  </th>
                  <th className="px-6 py-3 text-right text-xs font-medium uppercase tracking-wider text-gray-500">
                    操作
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-200 bg-white">
                {stores.map((store) => (
                  <tr key={store.id}>
                    <td className="whitespace-nowrap px-6 py-4 text-sm font-medium text-gray-900">
                      {store.name}
                    </td>
                    <td className="whitespace-nowrap px-6 py-4 text-sm text-gray-900">
                      <span className="rounded-md bg-gray-100 px-2 py-1 font-mono text-xs">
                        {store.code}
                      </span>
                    </td>
                    <td className="px-6 py-4 text-sm text-gray-500">
                      {store.address || '-'}
                    </td>
                    <td className="whitespace-nowrap px-6 py-4 text-sm text-gray-500">
                      {store.contact || '-'}
                    </td>
                    <td className="whitespace-nowrap px-6 py-4 text-sm text-gray-500">
                      {new Date(store.createdAt).toLocaleString('zh-CN')}
                    </td>
                    <td className="whitespace-nowrap px-6 py-4 text-right text-sm font-medium">
                      <button
                        onClick={() => handleDeleteStore(store)}
                        disabled={deletingStore === store.id}
                        className="rounded-lg bg-red-600 px-3 py-1.5 text-xs font-medium text-white transition-colors hover:bg-red-700 disabled:cursor-not-allowed disabled:opacity-50"
                      >
                        {deletingStore === store.id ? '删除中...' : '删除'}
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            {stores.length === 0 && (
              <div className="py-8 text-center text-gray-500">暂无门店</div>
            )}
          </div>
        </div>

        {/* 创建门店表单 */}
        {showStoreForm && (
          <div className="mb-8 rounded-xl bg-white p-6 shadow-sm">
            <h3 className="mb-4 text-lg font-semibold text-gray-900">创建门店</h3>
            <div className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-gray-700">
                  门店名称 *
                </label>
                <input
                  type="text"
                  value={storeFormData.name}
                  onChange={(e) =>
                    setStoreFormData((prev) => ({ ...prev, name: e.target.value }))
                  }
                  className="mt-1 block w-full rounded-md border border-gray-300 px-3 py-2 shadow-sm focus:border-blue-500 focus:outline-none focus:ring-blue-500"
                  placeholder="例如：广州天河店"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700">
                  门店编码 *
                </label>
                <input
                  type="text"
                  value={storeFormData.code}
                  onChange={(e) =>
                    setStoreFormData((prev) => ({
                      ...prev,
                      code: e.target.value.toUpperCase(),
                    }))
                  }
                  className="mt-1 block w-full rounded-md border border-gray-300 px-3 py-2 font-mono shadow-sm focus:border-blue-500 focus:outline-none focus:ring-blue-500"
                  placeholder="例如：GZ-TH-001"
                />
                <p className="mt-1 text-xs text-gray-500">
                  门店编码需全局唯一，建议使用大写字母 + 数字。
                </p>
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700">地址</label>
                <input
                  type="text"
                  value={storeFormData.address}
                  onChange={(e) =>
                    setStoreFormData((prev) => ({ ...prev, address: e.target.value }))
                  }
                  className="mt-1 block w-full rounded-md border border-gray-300 px-3 py-2 shadow-sm focus:border-blue-500 focus:outline-none focus:ring-blue-500"
                  placeholder="例如：广州市天河区某某路 XX 号"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700">
                  联系方式
                </label>
                <input
                  type="text"
                  value={storeFormData.contact}
                  onChange={(e) =>
                    setStoreFormData((prev) => ({ ...prev, contact: e.target.value }))
                  }
                  className="mt-1 block w-full rounded-md border border-gray-300 px-3 py-2 shadow-sm focus:border-blue-500 focus:outline-none focus:ring-blue-500"
                  placeholder="例如：13800000000 / 020-12345678"
                />
              </div>
              <div className="flex gap-2">
                <button
                  onClick={handleCreateStore}
                  disabled={creatingStore}
                  className="rounded-lg bg-green-600 px-4 py-2 text-sm font-medium text-white transition-all hover:bg-green-700 disabled:opacity-50"
                >
                  {creatingStore ? '创建中...' : '创建'}
                </button>
                <button
                  onClick={() => {
                    setShowStoreForm(false);
                    setStoreFormData({ name: '', code: '', address: '', contact: '' });
                  }}
                  className="rounded-lg border border-gray-300 bg-white px-4 py-2 text-sm font-medium text-gray-700 transition-all hover:bg-gray-50"
                >
                  取消
                </button>
              </div>
            </div>
          </div>
        )}

        {/* 供应商账号管理区域 */}
        <div className="mb-8 rounded-xl bg-white p-6 shadow-sm">
          <div className="mb-4 flex items-center justify-between">
            <div>
              <h2 className="text-xl font-semibold text-gray-900">供应商账号管理</h2>
              <p className="text-sm text-gray-600">创建与管理供应商登录账号</p>
            </div>
            <div className="flex gap-2">
              <button
                onClick={() => {
                  setShowCreateForm(true);
                  setShowBatchForm(false);
                }}
                className="rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white transition-all hover:bg-blue-700"
              >
                创建供应商
              </button>
              <button
                onClick={() => {
                  setShowBatchForm(true);
                  setShowCreateForm(false);
                }}
                className="rounded-lg bg-green-600 px-4 py-2 text-sm font-medium text-white transition-all hover:bg-green-700"
              >
                批量创建
              </button>
            </div>
          </div>

          {/* 供应商列表 */}
          <div className="overflow-x-auto">
            <table className="min-w-full divide-y divide-gray-200">
              <thead className="bg-gray-50">
                <tr>
                  <th className="px-6 py-3 text-left text-xs font-medium uppercase tracking-wider text-gray-500">
                    邮箱
                  </th>
                  <th className="px-6 py-3 text-left text-xs font-medium uppercase tracking-wider text-gray-500">
                    用户名
                  </th>
                  <th className="px-6 py-3 text-left text-xs font-medium uppercase tracking-wider text-gray-500">
                    状态
                  </th>
                  <th className="px-6 py-3 text-left text-xs font-medium uppercase tracking-wider text-gray-500">
                    创建时间
                  </th>
                  <th className="px-6 py-3 text-right text-xs font-medium uppercase tracking-wider text-gray-500">
                    操作
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-200 bg-white">
                {suppliers.map((supplier) => (
                  <tr key={supplier.id}>
                    <td className="whitespace-nowrap px-6 py-4 text-sm text-gray-900">
                      {supplier.email}
                    </td>
                    <td className="whitespace-nowrap px-6 py-4 text-sm text-gray-900">
                      {supplier.username}
                    </td>
                    <td className="whitespace-nowrap px-6 py-4 text-sm">
                      <span
                        className={`inline-flex rounded-full px-2 py-1 text-xs font-semibold ${
                          supplier.status === 'ACTIVE'
                            ? 'bg-green-100 text-green-800'
                            : supplier.status === 'SUSPENDED'
                            ? 'bg-red-100 text-red-800'
                            : 'bg-gray-100 text-gray-800'
                        }`}
                      >
                        {supplier.status === 'ACTIVE'
                          ? '启用'
                          : supplier.status === 'SUSPENDED'
                          ? '已停用'
                          : '未激活'}
                      </span>
                    </td>
                    <td className="whitespace-nowrap px-6 py-4 text-sm text-gray-500">
                      {new Date(supplier.createdAt).toLocaleString('zh-CN')}
                    </td>
                    <td className="whitespace-nowrap px-6 py-4 text-right text-sm font-medium">
                      <div className="flex justify-end gap-2">
                        {supplier.status === 'ACTIVE' ? (
                          <button
                            onClick={() =>
                              handleUpdateStatus(supplier.id, 'SUSPENDED')
                            }
                            className="text-yellow-600 hover:text-yellow-900"
                          >
                            停用
                          </button>
                        ) : (
                          <button
                            onClick={() => handleUpdateStatus(supplier.id, 'ACTIVE')}
                            className="text-green-600 hover:text-green-900"
                          >
                            启用
                          </button>
                        )}
                        <button
                          onClick={() => handleDeleteSupplier(supplier.id)}
                          className="text-red-600 hover:text-red-900"
                        >
                          删除
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            {suppliers.length === 0 && (
              <div className="py-8 text-center text-gray-500">暂无供应商账号</div>
            )}
          </div>
        </div>

        {/* 创建供应商表单 */}
        {showCreateForm && (
          <div className="mb-8 rounded-xl bg-white p-6 shadow-sm">
            <h3 className="mb-4 text-lg font-semibold text-gray-900">
              创建供应商账号
            </h3>
            <div className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-gray-700">
                  邮箱地址 *
                </label>
                <input
                  type="email"
                  value={formData.email}
                  onChange={(e) =>
                    setFormData((prev) => ({ ...prev, email: e.target.value }))
                  }
                  className="mt-1 block w-full rounded-md border border-gray-300 px-3 py-2 shadow-sm focus:border-blue-500 focus:outline-none focus:ring-blue-500"
                  placeholder="supplier@example.com"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700">
                  用户名 *
                </label>
                <input
                  type="text"
                  value={formData.username}
                  onChange={(e) =>
                    setFormData((prev) => ({ ...prev, username: e.target.value }))
                  }
                  className="mt-1 block w-full rounded-md border border-gray-300 px-3 py-2 shadow-sm focus:border-blue-500 focus:outline-none focus:ring-blue-500"
                  placeholder="供应商名称 / 登录名"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700">
                  密码 *
                </label>
                <input
                  type="password"
                  value={formData.password}
                  onChange={(e) =>
                    setFormData((prev) => ({ ...prev, password: e.target.value }))
                  }
                  className="mt-1 block w-full rounded-md border border-gray-300 px-3 py-2 shadow-sm focus:border-blue-500 focus:outline-none focus:ring-blue-500"
                  placeholder="至少 6 位字符"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700">
                  状态
                </label>
                <select
                  value={formData.status}
                  onChange={(e) =>
                    setFormData((prev) => ({
                      ...prev,
                      status: e.target.value as Supplier['status'],
                    }))
                  }
                  className="mt-1 block w-full rounded-md border border-gray-300 px-3 py-2 shadow-sm focus:border-blue-500 focus:outline-none focus:ring-blue-500"
                >
                  <option value="ACTIVE">启用</option>
                  <option value="INACTIVE">未激活</option>
                  <option value="SUSPENDED">停用</option>
                </select>
              </div>
              <div className="flex gap-2">
                <button
                  onClick={handleCreateSupplier}
                  disabled={creating}
                  className="rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white transition-all hover:bg-blue-700 disabled:opacity-50"
                >
                  {creating ? '创建中...' : '创建'}
                </button>
                <button
                  onClick={() => {
                    setShowCreateForm(false);
                    setFormData({
                      email: '',
                      username: '',
                      password: '',
                      status: 'ACTIVE',
                    });
                  }}
                  className="rounded-lg border border-gray-300 bg-white px-4 py-2 text-sm font-medium text-gray-700 transition-all hover:bg-gray-50"
                >
                  取消
                </button>
              </div>
            </div>
          </div>
        )}

        {/* 批量创建供应商表单 */}
        {showBatchForm && (
          <div className="mb-8 rounded-xl bg-white p-6 shadow-sm">
            <h3 className="mb-4 text-lg font-semibold text-gray-900">
              批量创建供应商账号
            </h3>
            <div className="mb-4 rounded-lg bg-blue-50 p-4">
              <p className="text-sm text-blue-800">
                <strong>JSON 格式示例：</strong>
              </p>
              <pre className="mt-2 overflow-x-auto text-xs text-blue-700">
                {`[
  {
    "email": "supplier1@example.com",
    "username": "供应商1",
    "password": "password123",
    "status": "ACTIVE"
  },
  {
    "email": "supplier2@example.com",
    "username": "供应商2",
    "password": "password123"
  }
]`}
              </pre>
              <p className="mt-2 text-sm text-blue-800">
                <strong>CSV 格式示例：</strong>
              </p>
              <pre className="mt-2 overflow-x-auto text-xs text-blue-700">
                {`email,username,password,status
supplier1@example.com,供应商1,password123,ACTIVE
supplier2@example.com,供应商2,password123,ACTIVE`}
              </pre>
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700">
                供应商数据 *
              </label>
              <textarea
                value={batchData}
                onChange={(e) => setBatchData(e.target.value)}
                rows={10}
                className="mt-1 block w-full rounded-md border border-gray-300 px-3 py-2 font-mono text-sm shadow-sm focus:border-blue-500 focus:outline-none focus:ring-blue-500"
                placeholder="粘贴 JSON 或 CSV 格式的供应商数据"
              />
            </div>
            <div className="mt-4 flex gap-2">
              <button
                onClick={handleBatchCreate}
                disabled={creating}
                className="rounded-lg bg-green-600 px-4 py-2 text-sm font-medium text-white transition-all hover:bg-green-700 disabled:opacity-50"
              >
                {creating ? '创建中...' : '批量创建'}
              </button>
              <button
                onClick={() => {
                  setShowBatchForm(false);
                  setBatchData('');
                }}
                className="rounded-lg border border-gray-300 bg-white px-4 py-2 text-sm font-medium text-gray-700 transition-all hover:bg-gray-50"
              >
                取消
              </button>
            </div>
          </div>
        )}

        {/* 钉钉通知配置 */}
        <div className="mb-8 rounded-xl bg-white p-6 shadow-sm">
          <div className="mb-4 flex items-center justify-between">
            <div>
              <h2 className="text-xl font-semibold text-gray-900">钉钉通知配置</h2>
              <p className="text-sm text-gray-600">
                测试与管理钉钉机器人通知功能
              </p>
            </div>
          </div>

          <div className="space-y-4">
            <div className="rounded-lg border border-blue-200 bg-blue-50 p-4">
              <h3 className="mb-2 text-sm font-semibold text-blue-900">配置说明</h3>
              <ul className="space-y-1 text-xs text-blue-800">
                <li>· 钉钉机器人 Webhook URL 已在服务端配置。</li>
                <li>
                  · 如需修改，请在环境变量中设置
                  <code className="mx-1 rounded bg-blue-100 px-1">DINGTALK_WEBHOOK_URL</code>
                  。
                </li>
                <li>· 系统会自动将重要通知发送到钉钉群。</li>
                <li>· 支持通知类型：订单/报价/发货/告警等。</li>
              </ul>
            </div>

            <div className="space-y-4">
              <div className="flex gap-2">
                <button
                  onClick={testDingTalk}
                  disabled={testingDingTalk}
                  className="rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white transition-all hover:bg-blue-700 disabled:opacity-50"
                >
                  {testingDingTalk ? '测试中...' : '测试钉钉机器人'}
                </button>
              </div>

              {/* 关键字测试 */}
              <div className="rounded-lg border border-gray-200 bg-gray-50 p-4">
                <h3 className="mb-2 text-sm font-semibold text-gray-900">
                  关键字测试
                </h3>
                <p className="mb-3 text-xs text-gray-600">
                  如果整体测试失败，可尝试单独测试关键字。请在钉钉机器人配置中查看实际关键字，然后在这里测试。
                </p>
                <div className="flex gap-2">
                  <input
                    type="text"
                    value={testKeyword}
                    onChange={(e) => setTestKeyword(e.target.value)}
                    placeholder="输入要测试的关键字（如：系统、通知、采购等）"
                    className="flex-1 rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
                    onKeyPress={handleKeywordInputKeyPress}
                  />
                  <button
                    onClick={testKeywordMessage}
                    disabled={testingKeyword || !testKeyword.trim()}
                    className="rounded-lg bg-green-600 px-4 py-2 text-sm font-medium text-white transition-all hover:bg-green-700 disabled:opacity-50"
                  >
                    {testingKeyword ? '测试中...' : '测试关键字'}
                  </button>
                </div>
                {keywordTestResult && (
                  <div
                    className={`mt-3 rounded-lg p-3 ${
                      keywordTestResult.success ? 'bg-green-50' : 'bg-red-50'
                    }`}
                  >
                    <div
                      className={`text-sm font-semibold ${
                        keywordTestResult.success ? 'text-green-800' : 'text-red-800'
                      }`}
                    >
                      {keywordTestResult.success ? '✔ 测试成功' : '✘ 测试失败'}
                    </div>
                    {keywordTestResult.message && (
                      <div
                        className={`mt-1 text-xs ${
                          keywordTestResult.success
                            ? 'text-green-700'
                            : 'text-red-700'
                        }`}
                      >
                        {keywordTestResult.message}
                      </div>
                    )}
                    {keywordTestResult.error && (
                      <div className="mt-1 text-xs text-red-700">
                        错误：{keywordTestResult.error}
                      </div>
                    )}
                  </div>
                )}
              </div>
            </div>

            {dingTalkTestResult && (
              <div
                className={`rounded-lg border p-4 ${
                  dingTalkTestResult.success
                    ? 'border-green-200 bg-green-50'
                    : 'border-red-200 bg-red-50'
                }`}
              >
                <div className="flex items-center gap-2">
                  {dingTalkTestResult.success ? (
                    <svg
                      className="h-5 w-5 text-green-600"
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
                  ) : (
                    <svg
                      className="h-5 w-5 text-red-600"
                      fill="none"
                      stroke="currentColor"
                      viewBox="0 0 24 24"
                    >
                      <path
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        strokeWidth={2}
                        d="M10 14l2-2m0 0l2-2m-2 2l-2-2m2 2l2 2m7-2a9 9 0 11-18 0 9 9 0 0118 0z"
                      />
                    </svg>
                  )}
                  <span
                    className={`text-sm font-medium ${
                      dingTalkTestResult.success ? 'text-green-800' : 'text-red-800'
                    }`}
                  >
                    {dingTalkTestResult.success ? '测试成功' : '测试失败'}
                  </span>
                </div>
                {dingTalkTestResult.message && (
                  <p
                    className={`mt-2 text-xs ${
                      dingTalkTestResult.success ? 'text-green-700' : 'text-red-700'
                    }`}
                  >
                    {dingTalkTestResult.message}
                  </p>
                )}
              </div>
            )}
          </div>
        </div>

        {/* 危险操作区域 */}
        <div className="rounded-xl bg-white p-6 shadow-sm">
          <div className="mb-4 flex items-center gap-3">
            <div className="flex h-12 w-12 items-center justify-center rounded-full bg-red-100">
              <svg
                className="h-6 w-6 text-red-600"
                fill="none"
                stroke="currentColor"
                viewBox="0 0 24 24"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2}
                  d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z"
                />
              </svg>
            </div>
            <div>
              <h2 className="text-xl font-semibold text-gray-900">危险操作</h2>
              <p className="text-sm text-gray-600">
                以下操作不可恢复，请务必谨慎使用。
              </p>
            </div>
          </div>

          <div className="rounded-lg border-2 border-red-200 bg-red-50 p-6">
            <div className="mb-4">
              <h3 className="mb-2 text-lg font-semibold text-red-900">
                清空所有业务数据
              </h3>
              <p className="mb-4 text-sm text-red-700">
                此操作将删除系统中的所有业务数据，包括但不限于：
              </p>
              <ul className="mb-4 list-inside list-disc space-y-1 text-sm text-red-700">
                <li>所有订单相关数据</li>
                <li>所有报价单与采购记录</li>
                <li>所有发货记录</li>
                <li>所有售后/补发记录</li>
                <li>所有导入历史记录</li>
                <li>所有系统日志与通知记录</li>
              </ul>
              <p className="mb-4 text-sm font-semibold text-red-900">
                ⚠ 注意：本操作不可撤销，用户账号与门店信息会被保留。
              </p>
            </div>

            <button
              onClick={() => setShowConfirm(true)}
              disabled={clearing}
              className="rounded-lg bg-red-600 px-6 py-3 text-sm font-medium text-white transition-all hover:bg-red-700 disabled:opacity-50"
            >
              {clearing ? '清空中...' : '清空所有业务数据'}
            </button>
          </div>
        </div>

        {/* 确认弹窗 */}
        {showConfirm && (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-black bg-opacity-50">
            <div className="w-full max-w-md rounded-xl bg-white p-6 shadow-xl">
              <div className="mb-4 flex items-center gap-3">
                <div className="flex h-12 w-12 items-center justify-center rounded-full bg-red-100">
                  <svg
                    className="h-6 w-6 text-red-600"
                    fill="none"
                    stroke="currentColor"
                    viewBox="0 0 24 24"
                  >
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      strokeWidth={2}
                      d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z"
                    />
                  </svg>
                </div>
                <div>
                  <h3 className="text-lg font-semibold text-gray-900">
                    确认清空所有业务数据？
                  </h3>
                  <p className="text-sm text-gray-600">此操作不可恢复。</p>
                </div>
              </div>

              <div className="mb-6 rounded-lg bg-red-50 p-4">
                <p className="text-sm font-semibold text-red-900">
                  你确定要清空所有业务数据吗？
                </p>
                <p className="mt-2 text-sm text-red-700">
                  这将删除系统中的所有业务记录，仅保留用户账号与门店信息。
                </p>
              </div>

              <div className="flex gap-3">
                <button
                  onClick={() => setShowConfirm(false)}
                  disabled={clearing}
                  className="flex-1 rounded-lg border border-gray-300 bg-white px-4 py-2 text-sm font-medium text-gray-700 transition-all hover:bg-gray-50 disabled:opacity-50"
                >
                  取消
                </button>
                <button
                  onClick={handleClearAllData}
                  disabled={clearing}
                  className="flex-1 rounded-lg bg-red-600 px-4 py-2 text-sm font-medium text-white transition-all hover:bg-red-700 disabled:opacity-50"
                >
                  {clearing ? '清空中...' : '确认清空'}
                </button>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
