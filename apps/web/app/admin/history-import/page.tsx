'use client';

import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { authApi } from '@/lib/auth';
import api from '@/lib/api';

interface Store {
  id: string;
  name: string;
  code: string;
}

export default function HistoryImportPage() {
  const router = useRouter();
  const [user, setUser] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [stores, setStores] = useState<Store[]>([]);
  const [selectedStoreId, setSelectedStoreId] = useState('');
  const [file, setFile] = useState<File | null>(null);
  const [importing, setImporting] = useState(false);
  const [importResult, setImportResult] = useState<any>(null);

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
    fetchStores();
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

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files[0]) {
      const selectedFile = e.target.files[0];
      const ext = selectedFile.name.split('.').pop()?.toLowerCase();
      if (ext !== 'csv' && ext !== 'xlsx' && ext !== 'xls') {
        alert('请上传 CSV 或 Excel 文件');
        return;
      }
      setFile(selectedFile);
      setImportResult(null);
    }
  };

  const handleImport = async () => {
    if (!selectedStoreId) {
      alert('请选择门店');
      return;
    }

    if (!file) {
      alert('请选择要导入的文件');
      return;
    }

    setImporting(true);
    setImportResult(null);

    try {
      const formData = new FormData();
      formData.append('file', file);
      formData.append('storeId', selectedStoreId);

      const response = await api.post('/orders/history/import', formData, {
        headers: {
          'Content-Type': 'multipart/form-data',
        },
      });

      const result = response.data.data || response.data;
      setImportResult(result);

      if (result.errorRows === 0) {
        alert(`导入成功！共导入 ${result.successRows} 条记录`);
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

  const downloadErrorFile = () => {
    if (!importResult || !importResult.errors || importResult.errors.length === 0) {
      return;
    }

    const headers = [
      '行号',
      '错误信息',
      '发货编号',
      '订单号',
      'open_id',
      '收件人',
      '手机号',
      '地址',
      '修改地址',
      '货名',
      '数量',
      '机台标价',
      '积分',
      '状态',
      '日期',
      '备注',
      '快递单号',
      '成本价',
    ];

    const csvRows = [
      headers.join(','),
      ...importResult.errors.map((error: any) => {
        const row = error.data || {};
        return [
          error.row || '',
          `"${(error.error || '').replace(/"/g, '""')}"`,
          row.shipmentNo || row['发货编号'] || '',
          row.orderNo || row['订单号'] || '',
          row.openid || row['open_id'] || '',
          row.recipient || row['收件人'] || '',
          row.phone || row['手机号'] || '',
          `"${((row.address || row['地址'] || '').toString().replace(/"/g, '""'))}"`,
          `"${((row.modifiedAddress || row['修改地址'] || '').toString().replace(/"/g, '""'))}"`,
          `"${((row.productName || row['货名'] || '').toString().replace(/"/g, '""'))}"`,
          row.quantity || row['数量'] || '',
          row.price || row['机台标价'] || '',
          row.points || row['积分'] || '',
          row.status || row['状态'] || '',
          row.date || row['日期'] || '',
          `"${((row.notes || row['备注'] || '').toString().replace(/"/g, '""'))}"`,
          row.trackingNo || row['快递单号'] || '',
          row.costPrice || row['成本价'] || '',
        ].join(',');
      }),
    ];

    const csvContent = csvRows.join('\n');
    const blob = new Blob(['\uFEFF' + csvContent], { type: 'text/csv;charset=utf-8;' });
    const link = document.createElement('a');
    const url = URL.createObjectURL(blob);
    link.setAttribute('href', url);
    link.setAttribute('download', `导入错误_${new Date().toISOString().split('T')[0]}.csv`);
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
    <div className="min-h-screen bg-gray-50">
      <div className="mx-auto max-w-4xl px-4 py-8 sm:px-6 lg:px-8">
        {/* 头部 */}
        <div className="mb-8">
          <button
            onClick={() => router.push('/admin')}
            className="mb-4 text-sm text-blue-600 hover:text-blue-800"
          >
            ← 返回系统管理
          </button>
          <h1 className="text-3xl font-bold text-gray-900">历史数据导入</h1>
          <p className="mt-2 text-sm text-gray-600">导入历史订单和发货数据（支持 CSV/Excel 格式）</p>
        </div>

        {/* 导入表单 */}
        <div className="mb-8 rounded-xl bg-white p-6 shadow-sm">
          <h2 className="mb-4 text-xl font-semibold text-gray-900">导入设置</h2>

          <div className="space-y-4">
            {/* 门店选择 */}
            <div>
              <label className="block text-sm font-medium text-gray-700">
                选择门店 <span className="text-red-500">*</span>
              </label>
              <select
                value={selectedStoreId}
                onChange={(e) => setSelectedStoreId(e.target.value)}
                className="mt-1 block w-full rounded-md border border-gray-300 px-3 py-2 shadow-sm focus:border-blue-500 focus:outline-none focus:ring-blue-500"
                disabled={importing}
              >
                <option value="">请选择门店</option>
                {stores.map((store) => (
                  <option key={store.id} value={store.id}>
                    {store.name} ({store.code})
                  </option>
                ))}
              </select>
              <p className="mt-1 text-xs text-gray-500">
                请选择要导入数据所属的门店，导入的数据将关联到该门店
              </p>
            </div>

            {/* 文件选择 */}
            <div>
              <label className="block text-sm font-medium text-gray-700">
                选择文件 <span className="text-red-500">*</span>
              </label>
              <div className="mt-1 flex items-center gap-4">
                <input
                  type="file"
                  accept=".csv,.xlsx,.xls"
                  onChange={handleFileChange}
                  className="block w-full text-sm text-gray-500 file:mr-4 file:rounded-md file:border-0 file:bg-blue-50 file:px-4 file:py-2 file:text-sm file:font-semibold file:text-blue-700 hover:file:bg-blue-100"
                  disabled={importing}
                />
              </div>
              {file && (
                <p className="mt-2 text-sm text-gray-600">
                  已选择文件: <span className="font-medium">{file.name}</span> (
                  {(file.size / 1024).toFixed(2)} KB)
                </p>
              )}
              <p className="mt-1 text-xs text-gray-500">
                支持 CSV、Excel (.xlsx, .xls) 格式。文件表头应包含：发货编号、订单号、open_id、收件人、手机号、地址、修改地址、货名、数量、机台标价、积分、状态、日期、备注、快递单号、成本价
              </p>
            </div>

            {/* 导入按钮 */}
            <div className="flex gap-2">
              <button
                onClick={handleImport}
                disabled={importing || !selectedStoreId || !file}
                className="rounded-lg bg-blue-600 px-6 py-2 text-sm font-medium text-white transition-all hover:bg-blue-700 disabled:opacity-50"
              >
                {importing ? '导入中...' : '开始导入'}
              </button>
              <button
                onClick={() => {
                  setFile(null);
                  setSelectedStoreId('');
                  setImportResult(null);
                }}
                disabled={importing}
                className="rounded-lg border border-gray-300 bg-white px-6 py-2 text-sm font-medium text-gray-700 transition-all hover:bg-gray-50 disabled:opacity-50"
              >
                重置
              </button>
            </div>
          </div>
        </div>

        {/* 导入结果 */}
        {importResult && (
          <div className="rounded-xl bg-white p-6 shadow-sm">
            <h2 className="mb-4 text-xl font-semibold text-gray-900">导入结果</h2>

            <div className="mb-4 grid grid-cols-3 gap-4">
              <div className="rounded-lg bg-blue-50 p-4">
                <div className="text-sm text-gray-600">总行数</div>
                <div className="mt-1 text-2xl font-bold text-blue-600">
                  {importResult.totalRows || 0}
                </div>
              </div>
              <div className="rounded-lg bg-green-50 p-4">
                <div className="text-sm text-gray-600">成功</div>
                <div className="mt-1 text-2xl font-bold text-green-600">
                  {importResult.successRows || 0}
                </div>
              </div>
              <div className="rounded-lg bg-red-50 p-4">
                <div className="text-sm text-gray-600">失败</div>
                <div className="mt-1 text-2xl font-bold text-red-600">
                  {importResult.errorRows || 0}
                </div>
              </div>
            </div>

            {/* 错误详情 */}
            {importResult.errors && importResult.errors.length > 0 && (
              <div className="mt-4">
                <div className="mb-2 flex items-center justify-between">
                  <h3 className="text-sm font-semibold text-gray-700">错误详情</h3>
                  <button
                    onClick={downloadErrorFile}
                    className="rounded-lg bg-red-600 px-4 py-2 text-xs font-medium text-white transition-all hover:bg-red-700"
                  >
                    下载错误文件
                  </button>
                </div>
                <div className="max-h-96 overflow-y-auto rounded-lg border border-gray-200">
                  <table className="min-w-full divide-y divide-gray-200">
                    <thead className="bg-gray-50">
                      <tr>
                        <th className="px-3 py-2 text-left text-xs font-medium uppercase tracking-wider text-gray-500">
                          行号
                        </th>
                        <th className="px-3 py-2 text-left text-xs font-medium uppercase tracking-wider text-gray-500">
                          订单号
                        </th>
                        <th className="px-3 py-2 text-left text-xs font-medium uppercase tracking-wider text-gray-500">
                          错误信息
                        </th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-gray-200 bg-white">
                      {importResult.errors.slice(0, 50).map((error: any, index: number) => (
                        <tr key={index}>
                          <td className="whitespace-nowrap px-3 py-2 text-xs text-gray-900">
                            {error.row}
                          </td>
                          <td className="whitespace-nowrap px-3 py-2 text-xs text-gray-900">
                            {error.data?.orderNo || error.data?.['订单号'] || '-'}
                          </td>
                          <td className="px-3 py-2 text-xs text-red-600">{error.error}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                  {importResult.errors.length > 50 && (
                    <div className="bg-gray-50 px-3 py-2 text-xs text-gray-500">
                      仅显示前 50 条错误，共 {importResult.errors.length} 条。请下载错误文件查看全部。
                    </div>
                  )}
                </div>
              </div>
            )}
          </div>
        )}

        {/* 使用说明 */}
        <div className="rounded-xl bg-blue-50 p-6">
          <h3 className="mb-3 text-lg font-semibold text-blue-900">使用说明</h3>
          <ul className="space-y-2 text-sm text-blue-800">
            <li>
              <strong>1. 文件格式：</strong>支持 CSV 和 Excel (.xlsx, .xls) 格式
            </li>
            <li>
              <strong>2. 表头要求：</strong>文件第一行必须包含表头，支持中英文表头，字段包括：
              <ul className="ml-4 mt-1 list-disc">
                <li>发货编号、订单号、open_id、收件人、手机号、地址、修改地址</li>
                <li>货名、数量、机台标价、积分、状态、日期、备注、快递单号、成本价</li>
              </ul>
            </li>
            <li>
              <strong>3. 必填字段：</strong>订单号为必填字段，其他字段可为空
            </li>
            <li>
              <strong>4. 数据更新：</strong>如果订单号已存在，系统会更新该订单的信息
            </li>
            <li>
              <strong>5. 门店关联：</strong>导入的数据将自动关联到所选门店
            </li>
            <li>
              <strong>6. 发货单：</strong>如果包含发货编号或快递单号，系统会自动创建或更新发货单
            </li>
          </ul>
        </div>
      </div>
    </div>
  );
}

