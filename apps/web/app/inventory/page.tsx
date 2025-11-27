'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { authApi } from '@/lib/auth';
import api from '@/lib/api';

interface InventoryItem {
  id: string;
  productName: string;
  price: number | string; // Prisma Decimal 可能序列化为字符串
  quantity: number;
  boxCondition?: string;
  description?: string;
  status: string;
  createdAt: string;
  updatedAt: string;
}

const BOX_CONDITION_OPTIONS = [
  { value: 'WITH_SHIPPING_BOX', label: '带运输盒' },
  { value: 'NEW_UNOPENED', label: '全新未拆封' },
  { value: 'COLOR_BOX_ONLY', label: '仅彩盒' },
  { value: 'MINOR_DAMAGE', label: '轻微盒损' },
  { value: 'SEVERE_DAMAGE', label: '严重盒损' },
  { value: 'OPENED_SECONDHAND', label: '已拆二手' },
];

const STATUS_OPTIONS = [
  { value: 'ACTIVE', label: '在售' },
  { value: 'INACTIVE', label: '下架' },
  { value: 'SOLD_OUT', label: '已售罄' },
];

export default function InventoryPage() {
  const router = useRouter();
  const [user, setUser] = useState<any>(null);
  const [inventory, setInventory] = useState<InventoryItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [showCreateForm, setShowCreateForm] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [searchTerm, setSearchTerm] = useState('');
  const [statusFilter, setStatusFilter] = useState<string>('');
  const [showImportModal, setShowImportModal] = useState(false);
  const [importFile, setImportFile] = useState<File | null>(null);
  const [importing, setImporting] = useState(false);
  const [importResult, setImportResult] = useState<any>(null);
  
  const [formData, setFormData] = useState({
    productName: '',
    price: '',
    quantity: '',
    boxCondition: '',
    description: '',
    status: 'ACTIVE',
  });

  useEffect(() => {
    const currentUser = authApi.getCurrentUser();
    if (!currentUser) {
      router.push('/login');
      return;
    }

    if (currentUser.role !== 'SUPPLIER') {
      router.push('/dashboard');
      return;
    }

    setUser(currentUser);
    fetchInventory();
  }, [router, statusFilter]);

  const fetchInventory = async () => {
    try {
      setLoading(true);
      const params = new URLSearchParams();
      if (statusFilter) params.append('status', statusFilter);
      if (searchTerm) params.append('search', searchTerm);
      
      const response = await api.get(`/inventory/supplier?${params.toString()}`);
      const data = response.data.data || response.data || [];
      // 确保 price 字段是数字类型（Prisma Decimal 可能序列化为字符串）
      const normalizedData = Array.isArray(data) 
        ? data.map((item: any) => ({
            ...item,
            price: typeof item.price === 'string' ? parseFloat(item.price) : item.price,
          }))
        : [];
      setInventory(normalizedData);
    } catch (error) {
      console.error('获取库存列表失败:', error);
      setInventory([]);
    } finally {
      setLoading(false);
    }
  };

  const handleSearch = () => {
    fetchInventory();
  };

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      const payload: any = {
        productName: formData.productName,
        price: parseFloat(formData.price),
        quantity: parseInt(formData.quantity),
      };

      if (formData.boxCondition) {
        payload.boxCondition = formData.boxCondition;
      }

      if (formData.description) {
        payload.description = formData.description;
      }

      await api.post('/inventory', payload);
      setShowCreateForm(false);
      resetForm();
      fetchInventory();
    } catch (error: any) {
      alert(error.response?.data?.message || '创建失败');
    }
  };

  const handleUpdate = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!editingId) return;

    try {
      const payload: any = {
        productName: formData.productName,
        price: parseFloat(formData.price),
        quantity: parseInt(formData.quantity),
        status: formData.status,
      };

      if (formData.boxCondition) {
        payload.boxCondition = formData.boxCondition;
      }

      if (formData.description) {
        payload.description = formData.description;
      }

      await api.patch(`/inventory/${editingId}`, payload);
      setEditingId(null);
      resetForm();
      fetchInventory();
    } catch (error: any) {
      alert(error.response?.data?.message || '更新失败');
    }
  };

  const handleDelete = async (id: string) => {
    if (!confirm('确定要删除这个库存吗？')) return;

    try {
      await api.delete(`/inventory/${id}`);
      fetchInventory();
    } catch (error: any) {
      alert(error.response?.data?.message || '删除失败');
    }
  };

  const handleQuantityChange = async (item: InventoryItem, delta: number) => {
    const currentQuantity = typeof item.quantity === 'string' ? parseInt(item.quantity) : item.quantity;
    const newQuantity = Math.max(0, currentQuantity + delta);
    
    if (newQuantity === currentQuantity && delta < 0) {
      return; // 已经是0，不能再减
    }

    try {
      await api.patch(`/inventory/${item.id}`, {
        quantity: newQuantity,
      });
      fetchInventory();
    } catch (error: any) {
      alert(error.response?.data?.message || '更新库存失败');
    }
  };

  const handleEdit = (item: InventoryItem) => {
    setEditingId(item.id);
    const priceValue = typeof item.price === 'string' ? parseFloat(item.price) : item.price;
    setFormData({
      productName: item.productName,
      price: priceValue.toString(),
      quantity: item.quantity.toString(),
      boxCondition: item.boxCondition || '',
      description: item.description || '',
      status: item.status,
    });
    setShowCreateForm(true);
  };

  const resetForm = () => {
    setFormData({
      productName: '',
      price: '',
      quantity: '',
      boxCondition: '',
      description: '',
      status: 'ACTIVE',
    });
    setEditingId(null);
  };

  const getBoxConditionLabel = (value?: string) => {
    return BOX_CONDITION_OPTIONS.find(opt => opt.value === value)?.label || '-';
  };

  const getStatusLabel = (status: string) => {
    return STATUS_OPTIONS.find(opt => opt.value === status)?.label || status;
  };

  const getStatusColor = (status: string) => {
    switch (status) {
      case 'ACTIVE':
        return 'bg-green-100 text-green-800';
      case 'INACTIVE':
        return 'bg-gray-100 text-gray-800';
      case 'SOLD_OUT':
        return 'bg-red-100 text-red-800';
      default:
        return 'bg-gray-100 text-gray-800';
    }
  };

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files[0]) {
      const selectedFile = e.target.files[0];
      const ext = selectedFile.name.split('.').pop()?.toLowerCase();
      if (ext !== 'csv' && ext !== 'xlsx' && ext !== 'xls') {
        alert('请上传 CSV 或 Excel 文件（.csv, .xlsx, .xls）');
        return;
      }
      setImportFile(selectedFile);
      setImportResult(null);
    }
  };

  const handleDownloadTemplate = async () => {
    try {
      const response = await api.get('/import/template?type=inventory', {
        responseType: 'blob',
      });
      const url = window.URL.createObjectURL(new Blob([response.data]));
      const link = document.createElement('a');
      link.href = url;
      link.setAttribute('download', '库存导入模板.xlsx');
      document.body.appendChild(link);
      link.click();
      link.remove();
      window.URL.revokeObjectURL(url);
    } catch (error: any) {
      console.error('下载模板失败:', error);
      alert('下载模板失败：' + (error.response?.data?.message || error.message));
    }
  };

  const handleImport = async () => {
    if (!importFile) {
      alert('请选择要导入的文件');
      return;
    }

    setImporting(true);
    setImportResult(null);

    try {
      const formData = new FormData();
      formData.append('file', importFile);

      const response = await api.post('/inventory/import', formData, {
        headers: {
          'Content-Type': 'multipart/form-data',
        },
      });

      const result = response.data.data || response.data;
      setImportResult(result);

      if (result.errorRows === 0) {
        alert(`导入成功！共导入 ${result.successRows} 条记录`);
        setShowImportModal(false);
        setImportFile(null);
        fetchInventory();
      } else {
        alert(
          `导入完成！成功: ${result.successRows} 条，失败: ${result.errorRows} 条。请查看错误详情。`,
        );
      }
    } catch (error: any) {
      console.error('导入失败:', error);
      alert(error.response?.data?.message || '导入失败');
    } finally {
      setImporting(false);
    }
  };

  if (loading && !user) {
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
    <div className="min-h-screen bg-gray-50">
      {/* 导航栏 */}
      <nav className="sticky top-0 z-50 border-b border-gray-200 bg-white shadow-sm">
        <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
          <div className="flex h-16 items-center justify-between">
            <div className="flex items-center gap-3">
              <button
                onClick={() => router.push('/dashboard')}
                className="flex items-center gap-2 text-gray-600 hover:text-gray-900"
              >
                <svg className="h-5 w-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 19l-7-7m0 0l7-7m-7 7h18" />
                </svg>
                <span>返回</span>
              </button>
              <div className="h-6 w-px bg-gray-300"></div>
              <h1 className="text-lg font-bold text-gray-900">库存管理</h1>
            </div>
          </div>
        </div>
      </nav>

      <main className="mx-auto max-w-7xl px-4 py-8 sm:px-6 lg:px-8">
        {/* 操作栏 */}
        <div className="mb-6 flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex flex-1 gap-2">
            <input
              type="text"
              placeholder="搜索货名..."
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              onKeyPress={(e) => e.key === 'Enter' && handleSearch()}
              className="rounded-lg border border-gray-300 px-4 py-2 focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
            <select
              value={statusFilter}
              onChange={(e) => setStatusFilter(e.target.value)}
              className="rounded-lg border border-gray-300 px-4 py-2 focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-500"
            >
              <option value="">全部状态</option>
              {STATUS_OPTIONS.map(opt => (
                <option key={opt.value} value={opt.value}>{opt.label}</option>
              ))}
            </select>
            <button
              onClick={handleSearch}
              className="rounded-lg bg-blue-600 px-4 py-2 text-white transition-colors hover:bg-blue-700"
            >
              搜索
            </button>
          </div>
          <div className="flex gap-2">
            <button
              onClick={handleDownloadTemplate}
              className="rounded-lg border border-blue-600 bg-white px-4 py-2 text-blue-600 transition-colors hover:bg-blue-50"
            >
              📥 下载模板
            </button>
            <button
              onClick={() => setShowImportModal(true)}
              className="rounded-lg border border-green-600 bg-white px-4 py-2 text-green-600 transition-colors hover:bg-green-50"
            >
              📤 导入库存
            </button>
            <button
              onClick={() => {
                resetForm();
                setShowCreateForm(true);
              }}
              className="rounded-lg bg-green-600 px-4 py-2 text-white transition-colors hover:bg-green-700"
            >
              + 添加库存
            </button>
          </div>
        </div>

        {/* 创建/编辑表单 */}
        {showCreateForm && (
          <div className="mb-6 rounded-lg border border-gray-200 bg-white p-6 shadow-sm">
            <h2 className="mb-4 text-lg font-semibold text-gray-900">
              {editingId ? '编辑库存' : '添加库存'}
            </h2>
            <form onSubmit={editingId ? handleUpdate : handleCreate} className="space-y-4">
              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                <div>
                  <label className="block text-sm font-medium text-gray-700">
                    货名 <span className="text-red-500">*</span>
                  </label>
                  <input
                    type="text"
                    required
                    value={formData.productName}
                    onChange={(e) => setFormData({ ...formData, productName: e.target.value })}
                    className="mt-1 w-full rounded-lg border border-gray-300 px-3 py-2 focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-500"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700">
                    价格 <span className="text-red-500">*</span>
                  </label>
                  <input
                    type="number"
                    step="0.01"
                    min="0.01"
                    required
                    value={formData.price}
                    onChange={(e) => setFormData({ ...formData, price: e.target.value })}
                    className="mt-1 w-full rounded-lg border border-gray-300 px-3 py-2 focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-500"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700">
                    数量 <span className="text-red-500">*</span>
                  </label>
                  <input
                    type="number"
                    min="1"
                    required
                    value={formData.quantity}
                    onChange={(e) => setFormData({ ...formData, quantity: e.target.value })}
                    className="mt-1 w-full rounded-lg border border-gray-300 px-3 py-2 focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-500"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700">盒况（可选）</label>
                  <select
                    value={formData.boxCondition}
                    onChange={(e) => setFormData({ ...formData, boxCondition: e.target.value })}
                    className="mt-1 w-full rounded-lg border border-gray-300 px-3 py-2 focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-500"
                  >
                    <option value="">请选择</option>
                    {BOX_CONDITION_OPTIONS.map(opt => (
                      <option key={opt.value} value={opt.value}>{opt.label}</option>
                    ))}
                  </select>
                </div>
                {editingId && (
                  <div>
                    <label className="block text-sm font-medium text-gray-700">状态</label>
                    <select
                      value={formData.status}
                      onChange={(e) => setFormData({ ...formData, status: e.target.value })}
                      className="mt-1 w-full rounded-lg border border-gray-300 px-3 py-2 focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-500"
                    >
                      {STATUS_OPTIONS.map(opt => (
                        <option key={opt.value} value={opt.value}>{opt.label}</option>
                      ))}
                    </select>
                  </div>
                )}
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700">描述（可选）</label>
                <textarea
                  value={formData.description}
                  onChange={(e) => setFormData({ ...formData, description: e.target.value })}
                  rows={3}
                  className="mt-1 w-full rounded-lg border border-gray-300 px-3 py-2 focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-500"
                />
              </div>
              <div className="flex gap-2">
                <button
                  type="submit"
                  className="rounded-lg bg-blue-600 px-4 py-2 text-white transition-colors hover:bg-blue-700"
                >
                  {editingId ? '更新' : '创建'}
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setShowCreateForm(false);
                    resetForm();
                  }}
                  className="rounded-lg border border-gray-300 bg-white px-4 py-2 text-gray-700 transition-colors hover:bg-gray-50"
                >
                  取消
                </button>
              </div>
            </form>
          </div>
        )}

        {/* 导入模态框 */}
        {showImportModal && (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-black bg-opacity-50">
            <div className="w-full max-w-2xl rounded-lg bg-white p-6 shadow-xl">
              <h2 className="mb-4 text-xl font-semibold text-gray-900">批量导入库存</h2>
              
              <div className="mb-4 space-y-4">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-2">
                    选择文件（CSV 或 Excel）
                  </label>
                  <input
                    type="file"
                    accept=".csv,.xlsx,.xls"
                    onChange={handleFileChange}
                    className="w-full rounded-lg border border-gray-300 px-3 py-2 focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-500"
                  />
                  {importFile && (
                    <p className="mt-2 text-sm text-gray-600">
                      已选择：{importFile.name} ({(importFile.size / 1024).toFixed(2)} KB)
                    </p>
                  )}
                </div>

                <div className="rounded-lg border border-blue-200 bg-blue-50 p-3 text-sm text-blue-800">
                  <p className="font-semibold mb-1">导入说明：</p>
                  <ul className="list-disc list-inside space-y-1">
                    <li>请先下载模板文件，按照模板格式填写数据</li>
                    <li>支持 CSV、Excel (.xlsx, .xls) 格式</li>
                    <li>必填字段：货名、价格、数量</li>
                    <li>可选字段：盒况、描述</li>
                    <li>盒况可选值：带运输盒、全新未拆封、仅彩盒、轻微盒损、严重盒损、已拆二手</li>
                  </ul>
                </div>

                {importResult && importResult.errors && importResult.errors.length > 0 && (
                  <div className="rounded-lg border border-red-200 bg-red-50 p-3 max-h-60 overflow-y-auto">
                    <p className="font-semibold text-red-800 mb-2">导入错误详情：</p>
                    <div className="space-y-1 text-sm text-red-700">
                      {importResult.errors.slice(0, 10).map((error: any, index: number) => (
                        <div key={index}>
                          第 {error.row} 行：{error.error}
                        </div>
                      ))}
                      {importResult.errors.length > 10 && (
                        <div className="text-red-600">
                          ...还有 {importResult.errors.length - 10} 个错误
                        </div>
                      )}
                    </div>
                  </div>
                )}
              </div>

              <div className="flex justify-end gap-2">
                <button
                  onClick={() => {
                    setShowImportModal(false);
                    setImportFile(null);
                    setImportResult(null);
                  }}
                  className="rounded-lg border border-gray-300 bg-white px-4 py-2 text-gray-700 transition-colors hover:bg-gray-50"
                  disabled={importing}
                >
                  取消
                </button>
                <button
                  onClick={handleImport}
                  disabled={!importFile || importing}
                  className="rounded-lg bg-blue-600 px-4 py-2 text-white transition-colors hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  {importing ? '导入中...' : '开始导入'}
                </button>
              </div>
            </div>
          </div>
        )}

        {/* 库存列表 */}
        <div className="rounded-lg border border-gray-200 bg-white shadow-sm">
          <div className="overflow-x-auto">
            <table className="min-w-full divide-y divide-gray-200">
              <thead className="bg-gray-50">
                <tr>
                  <th className="px-6 py-3 text-left text-xs font-medium uppercase tracking-wider text-gray-500">
                    货名
                  </th>
                  <th className="px-6 py-3 text-left text-xs font-medium uppercase tracking-wider text-gray-500">
                    价格
                  </th>
                  <th className="px-6 py-3 text-left text-xs font-medium uppercase tracking-wider text-gray-500">
                    数量
                  </th>
                  <th className="px-6 py-3 text-left text-xs font-medium uppercase tracking-wider text-gray-500">
                    盒况
                  </th>
                  <th className="px-6 py-3 text-left text-xs font-medium uppercase tracking-wider text-gray-500">
                    状态
                  </th>
                  <th className="px-6 py-3 text-left text-xs font-medium uppercase tracking-wider text-gray-500">
                    描述
                  </th>
                  <th className="px-6 py-3 text-left text-xs font-medium uppercase tracking-wider text-gray-500">
                    更新时间
                  </th>
                  <th className="px-6 py-3 text-right text-xs font-medium uppercase tracking-wider text-gray-500">
                    操作
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-200 bg-white">
                {inventory.length === 0 ? (
                  <tr>
                    <td colSpan={8} className="px-6 py-8 text-center text-gray-500">
                      {loading ? '加载中...' : '暂无库存数据'}
                    </td>
                  </tr>
                ) : (
                  inventory.map((item) => (
                    <tr key={item.id} className="hover:bg-gray-50">
                      <td className="whitespace-nowrap px-6 py-4 text-sm font-medium text-gray-900">
                        {item.productName}
                      </td>
                      <td className="whitespace-nowrap px-6 py-4 text-sm text-gray-900">
                        ¥{Number(item.price).toFixed(2)}
                      </td>
                      <td className="whitespace-nowrap px-6 py-4 text-sm text-gray-900">
                        <div className="flex items-center gap-2">
                          <button
                            onClick={() => handleQuantityChange(item, -1)}
                            disabled={item.quantity === 0}
                            className="flex h-7 w-7 items-center justify-center rounded border border-gray-300 bg-white text-gray-700 transition-colors hover:bg-gray-50 disabled:cursor-not-allowed disabled:opacity-50"
                            title="减少1"
                          >
                            <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M20 12H4" />
                            </svg>
                          </button>
                          <span className="min-w-[3ch] text-center font-medium">
                            {item.quantity}
                          </span>
                          <button
                            onClick={() => handleQuantityChange(item, 1)}
                            className="flex h-7 w-7 items-center justify-center rounded border border-gray-300 bg-white text-gray-700 transition-colors hover:bg-gray-50"
                            title="增加1"
                          >
                            <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
                            </svg>
                          </button>
                        </div>
                      </td>
                      <td className="whitespace-nowrap px-6 py-4 text-sm text-gray-500">
                        {getBoxConditionLabel(item.boxCondition)}
                      </td>
                      <td className="whitespace-nowrap px-6 py-4">
                        <span className={`inline-flex rounded-full px-2 py-1 text-xs font-semibold ${getStatusColor(item.status)}`}>
                          {getStatusLabel(item.status)}
                        </span>
                      </td>
                      <td className="px-6 py-4 text-sm text-gray-500">
                        {item.description || '-'}
                      </td>
                      <td className="whitespace-nowrap px-6 py-4 text-sm text-gray-500">
                        {new Date(item.updatedAt).toLocaleString('zh-CN')}
                      </td>
                      <td className="whitespace-nowrap px-6 py-4 text-right text-sm font-medium">
                        <button
                          onClick={() => handleEdit(item)}
                          className="mr-2 text-blue-600 hover:text-blue-900"
                        >
                          编辑
                        </button>
                        <button
                          onClick={() => handleDelete(item.id)}
                          className="text-red-600 hover:text-red-900"
                        >
                          删除
                        </button>
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </div>
      </main>
    </div>
  );
}

