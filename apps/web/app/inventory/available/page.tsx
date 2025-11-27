'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { authApi } from '@/lib/auth';
import api from '@/lib/api';

interface AvailableInventoryItem {
  id: string;
  productName: string;
  price: number;
  quantity: number;
  boxCondition?: string;
  description?: string;
  createdAt: string;
  updatedAt: string;
  supplierId?: string; // 供应商ID（后端需要返回）
}

interface OrderFormData {
  recipient: string;
  phone: string;
  address: string;
  quantity: number;
  openid?: string;
  userNickname?: string;
}

const BOX_CONDITION_OPTIONS = [
  { value: 'WITH_SHIPPING_BOX', label: '带运输盒' },
  { value: 'NEW_UNOPENED', label: '全新未拆封' },
  { value: 'COLOR_BOX_ONLY', label: '仅彩盒' },
  { value: 'MINOR_DAMAGE', label: '轻微盒损' },
  { value: 'SEVERE_DAMAGE', label: '严重盒损' },
  { value: 'OPENED_SECONDHAND', label: '已拆二手' },
];

export default function AvailableInventoryPage() {
  const router = useRouter();
  const [user, setUser] = useState<any>(null);
  const [inventory, setInventory] = useState<AvailableInventoryItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchTerm, setSearchTerm] = useState('');
  const [boxConditionFilter, setBoxConditionFilter] = useState<string>('');
  const [minPrice, setMinPrice] = useState<string>('');
  const [maxPrice, setMaxPrice] = useState<string>('');
  const [showOrderModal, setShowOrderModal] = useState(false);
  const [selectedItem, setSelectedItem] = useState<AvailableInventoryItem | null>(null);
  const [orderForm, setOrderForm] = useState<OrderFormData>({
    recipient: '',
    phone: '',
    address: '',
    quantity: 1,
    openid: '',
    userNickname: '',
  });
  const [ordering, setOrdering] = useState(false);

  useEffect(() => {
    const currentUser = authApi.getCurrentUser();
    if (!currentUser) {
      router.push('/login');
      return;
    }

    // 允许管理员、采购员、门店用户查看现货库存
    if (currentUser.role !== 'ADMIN' && currentUser.role !== 'BUYER' && currentUser.role !== 'STORE') {
      router.push('/dashboard');
      return;
    }

    setUser(currentUser);
    fetchInventory();
  }, [router]);

  const fetchInventory = async () => {
    try {
      setLoading(true);
      const params = new URLSearchParams();
      if (searchTerm) params.append('search', searchTerm);
      if (boxConditionFilter) params.append('boxCondition', boxConditionFilter);
      if (minPrice) params.append('minPrice', minPrice);
      if (maxPrice) params.append('maxPrice', maxPrice);
      
      const response = await api.get(`/inventory/available?${params.toString()}`);
      const data = response.data.data || response.data || [];
      setInventory(Array.isArray(data) ? data : []);
    } catch (error) {
      console.error('获取现货库存失败:', error);
      setInventory([]);
    } finally {
      setLoading(false);
    }
  };

  const handleSearch = () => {
    fetchInventory();
  };

  const handleReset = () => {
    setSearchTerm('');
    setBoxConditionFilter('');
    setMinPrice('');
    setMaxPrice('');
    fetchInventory();
  };

  const getBoxConditionLabel = (value?: string) => {
    return BOX_CONDITION_OPTIONS.find(opt => opt.value === value)?.label || '-';
  };

  // 解析剪切板文本，提取收件人信息
  const parseClipboardText = (text: string) => {
    const info: { recipient?: string; phone?: string; address?: string } = {};
    
    // 辅助函数：判断是否是有效的姓名（支持中英文，至少1个字符）
    const isValidName = (str: string): boolean => {
      if (!str || str.trim().length === 0) return false;
      const trimmed = str.trim();
      // 至少1个字符，最多50个字符
      if (trimmed.length < 1 || trimmed.length > 50) return false;
      // 不能全是数字
      if (/^\d+$/.test(trimmed)) return false;
      // 不能全是数字、空格、连字符
      if (/^[\d\s\-]+$/.test(trimmed)) return false;
      // 不能包含地址关键词（如果整个字符串就是地址关键词，则不是姓名）
      if (/^(省|市|区|县|路|街|号|小区|大厦|村|镇|组)$/.test(trimmed)) return false;
      // 支持中文字符、英文字母、空格、连字符、点号等常见名字字符
      return /^[\u4e00-\u9fa5a-zA-Z\s\-\.']+$/.test(trimmed);
    };
    
    // 辅助函数：提取手机号（支持多种格式）
    const extractPhone = (text: string): string | undefined => {
      // 先尝试提取连续11位手机号
      const phonePatterns = [
        /1[3-9]\d{10}/,  // 连续11位（优先）
        /1[3-9]\d[\s-]?\d{4}[\s-]?\d{4}/,  // 标准格式（带分隔符）
        /1[3-9]\d[\s\-]?\d{4}[\s\-]?\d{4}/,  // 更灵活的分隔符
      ];
      
      for (const pattern of phonePatterns) {
        const match = text.match(pattern);
        if (match) {
          const phone = match[0].replace(/[\s\-]/g, '');
          if (phone.length === 11 && /^1[3-9]\d{9}$/.test(phone)) {
            return phone;
          }
        }
      }
      return undefined;
    };
    
    // 策略1：处理制表符分隔的格式（姓名\t手机号\t地址）
    if (text.includes('\t')) {
      const parts = text.split('\t').map(p => p.trim()).filter(p => p.length > 0);
      if (parts.length >= 2) {
        // 第一部分：姓名（支持中英文，至少1个字符）
        const firstPart = parts[0];
        if (isValidName(firstPart)) {
          info.recipient = firstPart.trim();
        }
        
        // 第二部分：手机号（尝试从整个第二部分提取）
        const phoneFromPart = extractPhone(parts[1]);
        if (phoneFromPart) {
          info.phone = phoneFromPart;
        }
        
        // 第三部分或后续部分：地址
        if (parts.length >= 3) {
          const addressPart = parts.slice(2).join(' ').trim();
          if (addressPart.length >= 5 && (addressPart.includes('省') || addressPart.includes('市') || 
              addressPart.includes('区') || addressPart.includes('县') || addressPart.includes('路') || 
              addressPart.includes('街') || addressPart.includes('号'))) {
            info.address = addressPart;
          }
        }
      }
    }
    
    // 策略2：处理空格分隔的格式（姓名 手机号 地址）
    const spaceParts = text.split(/\s+/).filter(p => p.length > 0);
    if (spaceParts.length >= 2 && !info.recipient) {
      // 第一部分：可能是姓名
      const firstPart = spaceParts[0];
      if (isValidName(firstPart)) {
        info.recipient = firstPart.trim();
      }
    }
    
    // 通用手机号提取（如果还没找到，从整个文本中提取）
    if (!info.phone) {
      const phoneFromText = extractPhone(text);
      if (phoneFromText) {
        info.phone = phoneFromText;
      }
    }
    
    // 策略3：提取收件人姓名（带标签的格式）
    if (!info.recipient) {
      const labelPatterns = [
        /(?:收件人|姓名|Name|Recipient|收货人|联系人)[：:\s]+([^\n\t]{1,50})/i,
      ];
      
      for (const pattern of labelPatterns) {
        const match = text.match(pattern);
        if (match && match[1]) {
          const name = match[1].trim();
          // 移除手机号
          let cleanName = name.replace(/1[3-9]\d[\s-]?\d{4}[\s-]?\d{4}/g, '').trim();
          // 如果包含地址关键词，只取前面的部分
          const addressKeywordIndex = cleanName.search(/[省市区县路街号]/);
          if (addressKeywordIndex > 0) {
            cleanName = cleanName.substring(0, addressKeywordIndex).trim();
          }
          
          if (isValidName(cleanName)) {
            info.recipient = cleanName;
            break;
          }
        }
      }
    }
    
    // 策略4：手机号前后的名字（如果还没找到）
    if (!info.recipient && info.phone) {
      const phoneIndex = text.indexOf(info.phone);
      if (phoneIndex > 0) {
        // 手机号前面的文本
        const beforePhone = text.substring(0, phoneIndex).trim();
        // 提取最后的名字（支持中英文，1-50个字符）
        // 匹配中文字符、英文字母、空格、连字符等
        const nameMatch = beforePhone.match(/[\u4e00-\u9fa5a-zA-Z\s\-\.']{1,50}$/);
        if (nameMatch) {
          const candidateName = nameMatch[0].trim();
          if (isValidName(candidateName)) {
            info.recipient = candidateName;
          }
        }
      }
      
      // 如果手机号后面还有文本，也可能是名字（某些格式）
      if (!info.recipient && phoneIndex >= 0) {
        const afterPhone = text.substring(phoneIndex + info.phone.length).trim();
        const nameMatch = afterPhone.match(/^[\u4e00-\u9fa5a-zA-Z\s\-\.']{1,50}/);
        if (nameMatch) {
          const candidateName = nameMatch[0].trim();
          if (isValidName(candidateName)) {
            info.recipient = candidateName;
          }
        }
      }
    }
    
    // 提取地址
    const addressPatterns = [
      /(?:地址|Address|收货地址|详细地址)[：:\s]+([^\n]{5,200})/i,
      /(?:省|市|区|县|路|街|号|小区|大厦|村|镇|组|号)[^\n]{5,100}/,
    ];
    
    for (const pattern of addressPatterns) {
      const match = text.match(pattern);
      if (match) {
        let addr = match[1] || match[0];
        addr = addr.trim();
        if (addr.length >= 5 && addr.length <= 200) {
          info.address = addr;
          break;
        }
      }
    }
    
    // 如果没有找到带标签的地址，尝试从文本中提取包含地址关键词的长文本
    if (!info.address) {
      const lines = text.split(/[\n\t]/).map(line => line.trim()).filter(line => line.length > 0);
      for (const line of lines) {
        if (line.length >= 10 && (line.includes('省') || line.includes('市') || line.includes('区') || 
            line.includes('县') || line.includes('路') || line.includes('街') || line.includes('号'))) {
          // 排除手机号和姓名
          if (!/^1[3-9]\d{9}$/.test(line.replace(/[\s-]/g, '')) && 
              !line.match(/^(收件人|姓名|Name|Recipient|收货人|联系人|手机|电话|Phone)/i) &&
              !isValidName(line)) {
            info.address = line;
            break;
          }
        }
      }
    }
    
    return info;
  };

  const handlePasteClipboard = async () => {
    try {
      if (!navigator.clipboard || !navigator.clipboard.readText) {
        const text = prompt('您的浏览器不支持自动读取剪切板。\n\n请粘贴包含收件人信息的文本：\n\n格式示例：\n收件人：张三\n手机号：13800138000\n地址：北京市朝阳区xxx路xxx号');
        if (text && text.trim()) {
          const info = parseClipboardText(text.trim());
          setOrderForm(prev => ({
            ...prev,
            recipient: info.recipient || prev.recipient,
            phone: info.phone || prev.phone,
            address: info.address || prev.address,
          }));
        }
        return;
      }
      const text = await navigator.clipboard.readText();
      if (text && text.trim()) {
        const info = parseClipboardText(text.trim());
        setOrderForm(prev => ({
          ...prev,
          recipient: info.recipient || prev.recipient,
          phone: info.phone || prev.phone,
          address: info.address || prev.address,
        }));
      } else {
        alert('剪切板为空，请先复制包含收件人信息的文本');
      }
    } catch (err: any) {
      console.error('读取剪切板失败:', err);
      const text = prompt('请粘贴包含收件人信息的文本：\n\n格式示例：\n收件人：张三\n手机号：13800138000\n地址：北京市朝阳区xxx路xxx号\n\n或直接粘贴订单信息文本');
      if (text && text.trim()) {
        const info = parseClipboardText(text.trim());
        setOrderForm(prev => ({
          ...prev,
          recipient: info.recipient || prev.recipient,
          phone: info.phone || prev.phone,
          address: info.address || prev.address,
        }));
      }
    }
  };

  const handleOpenOrderModal = (item: AvailableInventoryItem) => {
    setSelectedItem(item);
    setOrderForm({
      recipient: '',
      phone: '',
      address: '',
      quantity: 1,
      openid: '',
      userNickname: '',
    });
    setShowOrderModal(true);
  };

  const handleCreateOrder = async () => {
    if (!selectedItem) return;

    // 验证必填字段
    if (!orderForm.recipient || !orderForm.phone || !orderForm.address) {
      alert('请填写完整的收件人信息');
      return;
    }

    if (orderForm.quantity < 1 || orderForm.quantity > selectedItem.quantity) {
      alert(`数量必须在1-${selectedItem.quantity}之间`);
      return;
    }

    // 验证手机号格式
    const phoneRegex = /^1[3-9]\d{9}$/;
    if (!phoneRegex.test(orderForm.phone.replace(/[\s-]/g, ''))) {
      alert('请输入正确的手机号');
      return;
    }

    setOrdering(true);
    try {
      // 生成订单号
      const orderNo = `INV-${Date.now()}-${Math.random().toString(36).substr(2, 6).toUpperCase()}`;
      
      const orderData = {
        orderNo,
        orderTime: new Date().toISOString(),
        recipient: orderForm.recipient.trim(),
        phone: orderForm.phone.replace(/[\s-]/g, ''),
        address: orderForm.address.trim(),
        productName: selectedItem.productName,
        price: Number(selectedItem.price),
        quantity: orderForm.quantity,
        storeId: user?.storeId,
        buyerId: user?.id,
        openid: orderForm.openid || `store_${user?.id}`,
        userNickname: orderForm.userNickname || user?.username,
        inventoryId: selectedItem.id, // 关联库存ID
        supplierId: selectedItem.supplierId, // 供应商ID
      };

      await api.post('/orders/from-inventory', orderData);
      
      alert('下单成功！供应商将尽快处理您的订单。');
      setShowOrderModal(false);
      fetchInventory(); // 刷新库存列表
    } catch (error: any) {
      console.error('下单失败:', error);
      alert(error.response?.data?.message || '下单失败，请稍后重试');
    } finally {
      setOrdering(false);
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
              <h1 className="text-lg font-bold text-gray-900">供应商现货库</h1>
            </div>
          </div>
        </div>
      </nav>

      <main className="mx-auto max-w-7xl px-4 py-8 sm:px-6 lg:px-8">
        {/* 筛选栏 */}
        <div className="mb-6 rounded-lg border border-gray-200 bg-white p-4 shadow-sm">
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-5">
            <div>
              <label className="block text-sm font-medium text-gray-700">搜索货名</label>
              <input
                type="text"
                placeholder="输入货名..."
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
                onKeyPress={(e) => e.key === 'Enter' && handleSearch()}
                className="mt-1 w-full rounded-lg border border-gray-300 px-3 py-2 focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700">盒况筛选</label>
              <select
                value={boxConditionFilter}
                onChange={(e) => setBoxConditionFilter(e.target.value)}
                className="mt-1 w-full rounded-lg border border-gray-300 px-3 py-2 focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-500"
              >
                <option value="">全部</option>
                {BOX_CONDITION_OPTIONS.map(opt => (
                  <option key={opt.value} value={opt.value}>{opt.label}</option>
                ))}
              </select>
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700">最低价格</label>
              <input
                type="number"
                step="0.01"
                min="0"
                placeholder="0.00"
                value={minPrice}
                onChange={(e) => setMinPrice(e.target.value)}
                className="mt-1 w-full rounded-lg border border-gray-300 px-3 py-2 focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700">最高价格</label>
              <input
                type="number"
                step="0.01"
                min="0"
                placeholder="9999.99"
                value={maxPrice}
                onChange={(e) => setMaxPrice(e.target.value)}
                className="mt-1 w-full rounded-lg border border-gray-300 px-3 py-2 focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
            </div>
            <div className="flex items-end gap-2">
              <button
                onClick={handleSearch}
                className="w-full rounded-lg bg-blue-600 px-4 py-2 text-white transition-colors hover:bg-blue-700"
              >
                搜索
              </button>
              <button
                onClick={handleReset}
                className="w-full rounded-lg border border-gray-300 bg-white px-4 py-2 text-gray-700 transition-colors hover:bg-gray-50"
              >
                重置
              </button>
            </div>
          </div>
        </div>

        {/* 统计信息 */}
        <div className="mb-6 grid grid-cols-1 gap-4 sm:grid-cols-3">
          <div className="rounded-lg border border-gray-200 bg-white p-4 shadow-sm">
            <div className="text-sm text-gray-600">现货总数</div>
            <div className="mt-1 text-2xl font-bold text-gray-900">{inventory.length}</div>
          </div>
          <div className="rounded-lg border border-gray-200 bg-white p-4 shadow-sm">
            <div className="text-sm text-gray-600">总库存量</div>
            <div className="mt-1 text-2xl font-bold text-gray-900">
              {inventory.reduce((sum, item) => sum + item.quantity, 0)}
            </div>
          </div>
          <div className="rounded-lg border border-gray-200 bg-white p-4 shadow-sm">
            <div className="text-sm text-gray-600">平均价格</div>
            <div className="mt-1 text-2xl font-bold text-gray-900">
              {inventory.length > 0
                ? `¥${(inventory.reduce((sum, item) => sum + item.price, 0) / inventory.length).toFixed(2)}`
                : '¥0.00'}
            </div>
          </div>
        </div>

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
                    <td colSpan={7} className="px-6 py-8 text-center text-gray-500">
                      {loading ? '加载中...' : '暂无现货库存'}
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
                        {item.quantity}
                      </td>
                      <td className="whitespace-nowrap px-6 py-4 text-sm text-gray-500">
                        {getBoxConditionLabel(item.boxCondition)}
                      </td>
                      <td className="px-6 py-4 text-sm text-gray-500">
                        {item.description || '-'}
                      </td>
                      <td className="whitespace-nowrap px-6 py-4 text-sm text-gray-500">
                        {new Date(item.updatedAt).toLocaleString('zh-CN')}
                      </td>
                      <td className="whitespace-nowrap px-6 py-4 text-right text-sm font-medium">
                        <button
                          onClick={() => handleOpenOrderModal(item)}
                          className="rounded-lg bg-green-600 px-4 py-2 text-white transition-colors hover:bg-green-700"
                        >
                          下单
                        </button>
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </div>

        {/* 下单模态框 */}
        {showOrderModal && selectedItem && (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-black bg-opacity-50 p-4">
            <div className="w-full max-w-2xl rounded-lg bg-white shadow-xl">
              <div className="border-b border-gray-200 px-6 py-4">
                <h2 className="text-xl font-semibold text-gray-900">创建订单</h2>
                <p className="mt-1 text-sm text-gray-600">商品：{selectedItem.productName}</p>
                <p className="text-sm text-gray-600">价格：¥{Number(selectedItem.price).toFixed(2)}</p>
              </div>

              <div className="px-6 py-4 space-y-4">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">
                    购买数量 <span className="text-red-500">*</span>
                  </label>
                  <input
                    type="number"
                    min="1"
                    max={selectedItem.quantity}
                    value={orderForm.quantity}
                    onChange={(e) => setOrderForm({ ...orderForm, quantity: parseInt(e.target.value) || 1 })}
                    className="w-full rounded-lg border border-gray-300 px-3 py-2 focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-500"
                  />
                  <p className="mt-1 text-xs text-gray-500">可用库存：{selectedItem.quantity}</p>
                </div>

                <div className="flex items-center justify-between border-t border-gray-200 pt-4">
                  <h3 className="text-lg font-semibold text-gray-900">收件人信息</h3>
                  <button
                    type="button"
                    onClick={handlePasteClipboard}
                    className="flex items-center gap-2 rounded-lg border border-blue-600 bg-white px-3 py-1.5 text-sm text-blue-600 transition-colors hover:bg-blue-50"
                  >
                    <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2" />
                    </svg>
                    从剪切板粘贴
                  </button>
                </div>

                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">
                    收件人 <span className="text-red-500">*</span>
                  </label>
                  <input
                    type="text"
                    required
                    value={orderForm.recipient}
                    onChange={(e) => setOrderForm({ ...orderForm, recipient: e.target.value })}
                    className="w-full rounded-lg border border-gray-300 px-3 py-2 focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-500"
                    placeholder="请输入收件人姓名"
                  />
                </div>

                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">
                    手机号 <span className="text-red-500">*</span>
                  </label>
                  <input
                    type="tel"
                    required
                    value={orderForm.phone}
                    onChange={(e) => setOrderForm({ ...orderForm, phone: e.target.value })}
                    className="w-full rounded-lg border border-gray-300 px-3 py-2 focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-500"
                    placeholder="请输入11位手机号"
                    maxLength={11}
                  />
                </div>

                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">
                    收货地址 <span className="text-red-500">*</span>
                  </label>
                  <textarea
                    required
                    value={orderForm.address}
                    onChange={(e) => setOrderForm({ ...orderForm, address: e.target.value })}
                    rows={3}
                    className="w-full rounded-lg border border-gray-300 px-3 py-2 focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-500"
                    placeholder="请输入详细收货地址"
                  />
                </div>

                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">
                      OpenID（可选）
                    </label>
                    <input
                      type="text"
                      value={orderForm.openid || ''}
                      onChange={(e) => setOrderForm({ ...orderForm, openid: e.target.value })}
                      className="w-full rounded-lg border border-gray-300 px-3 py-2 focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-500"
                      placeholder="微信OpenID"
                    />
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">
                      用户昵称（可选）
                    </label>
                    <input
                      type="text"
                      value={orderForm.userNickname || ''}
                      onChange={(e) => setOrderForm({ ...orderForm, userNickname: e.target.value })}
                      className="w-full rounded-lg border border-gray-300 px-3 py-2 focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-500"
                      placeholder="用户昵称"
                    />
                  </div>
                </div>
              </div>

              <div className="border-t border-gray-200 px-6 py-4 flex justify-end gap-3">
                <button
                  onClick={() => setShowOrderModal(false)}
                  className="rounded-lg border border-gray-300 bg-white px-4 py-2 text-gray-700 transition-colors hover:bg-gray-50"
                  disabled={ordering}
                >
                  取消
                </button>
                <button
                  onClick={handleCreateOrder}
                  disabled={ordering}
                  className="rounded-lg bg-green-600 px-4 py-2 text-white transition-colors hover:bg-green-700 disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  {ordering ? '下单中...' : '确认下单'}
                </button>
              </div>
            </div>
          </div>
        )}
      </main>
    </div>
  );
}

