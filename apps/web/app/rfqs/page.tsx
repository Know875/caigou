'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { authApi } from '@/lib/auth';
import api from '@/lib/api';
import type { Rfq, Order, Store, ParsedItem } from '@/types';

// API 错误类型
interface ApiError extends Error {
  response?: {
    status?: number;
    statusText?: string;
    data?: {
      message?: string;
    };
  };
  config?: {
    url?: string;
    method?: string;
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

export default function RfqsPage() {
  const router = useRouter();
  const [rfqs, setRfqs] = useState<Rfq[]>([]);
  const [orders, setOrders] = useState<Order[]>([]);
  const [stores, setStores] = useState<Store[]>([]);
  const [loading, setLoading] = useState(true);
  const [showCreateForm, setShowCreateForm] = useState(false);
  const [createMode, setCreateMode] = useState<'manual' | 'file'>('manual');
  const [file, setFile] = useState<File | null>(null);
  const [parsedItems, setParsedItems] = useState<ParsedItem[]>([]);
  const [storeFilter, setStoreFilter] = useState<string>(''); // 店铺筛选
  const [statusFilter, setStatusFilter] = useState<string>(''); // 状态筛选
  const [searchQuery, setSearchQuery] = useState<string>(''); // 搜索关键词
  const [sortBy, setSortBy] = useState<'deadline' | 'createdAt' | 'status'>('createdAt'); // 排序方式
  const [sortOrder, setSortOrder] = useState<'asc' | 'desc'>('desc'); // 排序顺序
  const [groupByStore, setGroupByStore] = useState<boolean>(false); // 是否按店铺分组
  const [currentUser, setCurrentUser] = useState<any>(null); // 当前用户信息
  const [rfqForm, setRfqForm] = useState({
    title: '',
    description: '',
    type: 'NORMAL',
    deadline: '',
    storeId: '',
    orderIds: [] as string[],
  });
  // 收件人组列表（每个收件人可以关联多个商品）
  const [recipientGroups, setRecipientGroups] = useState<Array<{
    id: string;
    recipient: string;
    phone: string;
    address: string;
    items: Array<{
      id: string;
      productName: string;
      boxCondition?: string[]; // 盒况（多选）
      quantity: number;
      unit: string;
      maxPrice?: number;
      instantPrice?: number;
    }>;
  }>>([]);
  // 当前选中的收件人组ID（用于剪切板识别）
  const [selectedRecipientGroupId, setSelectedRecipientGroupId] = useState<string | null>(null);
  // 是否创建后直接发布（默认勾选）
  const [autoPublish, setAutoPublish] = useState(true);

  useEffect(() => {
    const user = authApi.getCurrentUser();
    if (!user) {
      router.push('/login');
      return;
    }

    // 允许管理员、采购员和门店用户访问询价单页面
    if (user.role !== 'ADMIN' && user.role !== 'BUYER' && user.role !== 'STORE') {
      router.push('/dashboard');
      return;
    }

    setCurrentUser(user);

    // 门店用户自动设置自己的门店ID和店铺筛选
    if (user.role === 'STORE' && user.storeId) {
      setStoreFilter(user.storeId); // 自动设置为自己的店铺
      setRfqForm((prev) => ({
        ...prev,
        storeId: user.storeId || '',
      }));
    }

    // 优化：先显示页面，再延迟加载数据（提升首次渲染速度）
    setLoading(false);
    setTimeout(() => {
      fetchData();
    }, 100);
  }, [router]);

  // 当currentUser变化时，重新获取门店列表（用于过滤STORE用户的门店）
  useEffect(() => {
    if (currentUser) {
      fetchStores();
    }
  }, [currentUser]);

  // 当表单打开且stores加载完成时，自动设置默认标题（针对STORE用户）
  // 获取当天已创建的询价单数量，计算序号并显示在标题中
  useEffect(() => {
    if (showCreateForm && createMode === 'manual' && currentUser?.role === 'STORE' && currentUser?.storeId) {
      // 如果标题为空且stores已加载，设置默认标题
      // 使用函数式更新，避免依赖 rfqForm.title
      setRfqForm((prev) => {
        if (!prev.title && stores.length > 0) {
          const selectedStore = stores.find(s => s.id === currentUser.storeId);
          if (selectedStore) {
            const today = new Date();
            const dateStr = today.toLocaleDateString('zh-CN', {
              year: 'numeric',
              month: '2-digit',
              day: '2-digit',
            }).replace(/\//g, '-');
            
            // 获取当天已创建的询价单数量，计算序号
            api.get(`/rfqs/today-count?storeId=${currentUser.storeId}`)
              .then((response) => {
                const count = response.data?.count || 0;
                const sequenceNumber = count + 1;
                setRfqForm((prevForm) => ({
                  ...prevForm,
                  title: `${selectedStore.name} ${dateStr} ${sequenceNumber}`,
                }));
              })
              .catch((error) => {
                console.error('获取当天询价单数量失败:', error);
                // 如果获取失败，仍然设置不带序号的标题（后端会自动添加序号）
                return {
                  ...prev,
                  title: `${selectedStore.name} ${dateStr}`,
                };
              });
            
            // 先返回一个临时标题，等API返回后再更新
            return {
              ...prev,
              title: `${selectedStore.name} ${dateStr}`,
            };
          }
        }
        return prev;
      });
    }
  }, [showCreateForm, createMode, currentUser?.role, currentUser?.storeId, stores.length]);

  // 当筛选条件改变时，重新获取询价单
  useEffect(() => {
    if (!loading) {
      fetchRfqs();
    }
  }, [storeFilter, statusFilter]);
  
  // 搜索防抖
  useEffect(() => {
    if (loading) return;
    const timer = setTimeout(() => {
      fetchRfqs();
    }, 300);
    return () => clearTimeout(timer);
  }, [searchQuery, sortBy, sortOrder]);

  const fetchData = async () => {
    try {
      // 优化：优先加载关键数据（询价单列表），其他数据延迟加载
      await fetchRfqs();
      
      // 延迟加载其他数据（不阻塞首次渲染）
      setTimeout(async () => {
        await Promise.all([fetchOrders(), fetchStores()]);
      }, 200);
    } catch (error) {
      console.error('获取数据失败:', error);
    }
  };

  const fetchRfqs = async () => {
    try {
      const params = new URLSearchParams();
      if (storeFilter) {
        params.append('storeId', storeFilter);
      }
      if (statusFilter) {
        params.append('status', statusFilter);
      }
      const url = `/rfqs${params.toString() ? '?' + params.toString() : ''}`;
      const response = await api.get(url);
      const rfqsData = response.data.data || response.data || [];
      let filteredRfqs = Array.isArray(rfqsData) ? rfqsData : [];
      
      // 客户端搜索过滤
      if (searchQuery.trim()) {
        const query = searchQuery.toLowerCase().trim();
        filteredRfqs = filteredRfqs.filter((rfq) => 
          rfq.rfqNo?.toLowerCase().includes(query) ||
          rfq.title?.toLowerCase().includes(query) ||
          rfq.description?.toLowerCase().includes(query)
        );
      }
      
      // 客户端排序
      filteredRfqs.sort((a, b) => {
        let aValue: number | string = 0;
        let bValue: number | string = 0;
        
        if (sortBy === 'deadline') {
          aValue = new Date(a.deadline).getTime();
          bValue = new Date(b.deadline).getTime();
        } else if (sortBy === 'createdAt') {
          aValue = new Date(a.createdAt).getTime();
          bValue = new Date(b.createdAt).getTime();
        } else if (sortBy === 'status') {
          const statusOrder: Record<string, number> = {
            'DRAFT': 1,
            'PUBLISHED': 2,
            'CLOSED': 3,
            'AWARDED': 4,
            'CANCELLED': 5,
          };
          aValue = statusOrder[a.status] || 99;
          bValue = statusOrder[b.status] || 99;
        }
        
        if (sortOrder === 'asc') {
          return aValue > bValue ? 1 : -1;
        } else {
          return aValue < bValue ? 1 : -1;
        }
      });
      
      setRfqs(filteredRfqs);
    } catch (error: unknown) {
      console.error('获取询价单失败:', error);
      setRfqs([]);
    }
  };

  const fetchOrders = async () => {
    try {
      const response = await api.get('/orders');
      const ordersData = response.data.data || response.data || [];
      setOrders(Array.isArray(ordersData) ? ordersData : []);
    } catch (error: unknown) {
      console.error('获取订单失败:', error);
      setOrders([]);
    }
  };

  const fetchStores = async () => {
    try {
      const response = await api.get('/stores');
      const storesData = response.data.data || response.data || [];
      let storesList = Array.isArray(storesData) ? storesData : [];
      
      // STORE角色用户只能看到自己的门店
      const user = currentUser || authApi.getCurrentUser();
      if (user?.role === 'STORE' && user?.storeId) {
        storesList = storesList.filter((store: any) => store.id === user.storeId);
      }
      
      setStores(storesList);
    } catch (error: unknown) {
      console.error('获取门店失败:', error);
      setStores([]);
    }
  };

  // 设置默认截止时间（当前时间+指定小时数）
  const setDefaultDeadline = (hours: number = 2) => {
    const now = new Date();
    const deadline = new Date(now.getTime() + hours * 60 * 60 * 1000);
    // 格式化为 datetime-local 格式 (YYYY-MM-DDTHH:mm)
    const year = deadline.getFullYear();
    const month = String(deadline.getMonth() + 1).padStart(2, '0');
    const day = String(deadline.getDate()).padStart(2, '0');
    const hoursStr = String(deadline.getHours()).padStart(2, '0');
    const minutesStr = String(deadline.getMinutes()).padStart(2, '0');
    return `${year}-${month}-${day}T${hoursStr}:${minutesStr}`;
  };

  const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files[0]) {
      const selectedFile = e.target.files[0];
      console.log('📋 [前端] 文件选择:', {
        fileName: selectedFile.name,
        fileSize: selectedFile.size,
        fileType: selectedFile.type,
      });
      setFile(selectedFile);
      console.log('📋 [前端] 文件状态已更新');
    } else {
      console.warn('⚠️ [前端] 没有选择文件');
      setFile(null);
    }
  };

  // 解析剪切板文本，提取收件人信息
  const parseClipboardText = (text: string) => {
    const info: { recipient?: string; phone?: string; address?: string } = {};
    
    // 先提取手机号（最可靠的信息）
    // 优先匹配完整的11位手机号（连续数字）
    const phonePatterns = [
      /1[3-9]\d{10}/,  // 连续11位（优先）
      /1[3-9]\d[\s-]?\d{4}[\s-]?\d{4}/,  // 标准格式（带分隔符）
    ];
    
    for (const pattern of phonePatterns) {
      const match = text.match(pattern);
      if (match) {
        const phone = match[0].replace(/[\s-]/g, '');
        // 验证手机号长度必须是11位，且格式正确
        if (phone.length === 11 && /^1[3-9]\d{9}$/.test(phone)) {
          info.phone = phone;
          break;
        }
      }
    }
    
    // 提取收件人姓名（优先从手机号附近提取）
    const lines = text.split('\n').map(line => line.trim()).filter(line => line.length > 0);
    
    // 策略1：带标签的格式（最可靠）
    const labelPatterns = [
      /(?:收件人|姓名|Name|Recipient|收货人|联系人)[：:\s]+([^\n]{1,30})/i,
    ];
    
    for (const pattern of labelPatterns) {
      const match = text.match(pattern);
      if (match && match[1]) {
        const name = match[1].trim();
        // 清理名字：移除可能的手机号和地址关键词
        let cleanName = name.replace(/1[3-9]\d[\s-]?\d{4}[\s-]?\d{4}/g, '').trim();
        cleanName = cleanName.split(/[省市区县路街号]/)[0].trim();
        
        if (cleanName.length >= 1 && cleanName.length <= 30 && 
            !/^\d+$/.test(cleanName) && 
            !cleanName.match(/^[\d\s\-]+$/)) {
          info.recipient = cleanName;
          break;
        }
      }
    }
    
    // 策略2：手机号前后的名字（如果还没找到）
    if (!info.recipient && info.phone) {
      // 找到手机号在文本中的位置
      const phoneIndex = text.indexOf(info.phone);
      if (phoneIndex > 0) {
        // 提取手机号前面的内容
        const beforePhone = text.substring(0, phoneIndex).trim();
        // 提取手机号后面的内容
        const afterPhone = text.substring(phoneIndex + info.phone.length).trim();
        
        // 从手机号前面提取名字（优先）
        // 匹配中文字符串（1-4个中文字符，不包含数字和地址关键词）
        const chineseNamePattern = /([\u4e00-\u9fa5]{1,4})(?:\s|$)/;
        const chineseMatch = beforePhone.match(chineseNamePattern);
        if (chineseMatch && chineseMatch[1]) {
          const name = chineseMatch[1].trim();
          // 确保名字不包含数字和地址关键词
          if (!name.match(/\d/) && !name.match(/[省市区县路街号镇村小区大厦广场室单元栋层座]/)) {
            info.recipient = name;
          }
        }
        
        // 如果没找到中文名字，尝试英文名字
        if (!info.recipient) {
          // 允许单个字母或2-30个字符的英文名字
          const englishNamePattern = /\b([A-Za-z](?:[A-Za-z\s\.\-]{0,28}[A-Za-z])?)(?:\s|$)/i;
          const englishMatch = beforePhone.match(englishNamePattern);
          if (englishMatch && englishMatch[1]) {
            const name = englishMatch[1].trim();
            // 确保名字不包含数字
            if (!name.match(/\d/) && name.length >= 1 && name.length <= 30) {
              info.recipient = name;
            }
          }
        }
        
        // 如果前面没找到，尝试从手机号后面找（但这种情况较少）
        if (!info.recipient && afterPhone) {
          const chineseAfterMatch = afterPhone.match(/^([\u4e00-\u9fa5]{1,4})(?:\s|$)/);
          if (chineseAfterMatch && chineseAfterMatch[1]) {
            const name = chineseAfterMatch[1].trim();
            if (!name.match(/\d/) && !name.match(/[省市区县路街号镇村小区大厦广场室单元栋层座]/)) {
              info.recipient = name;
            }
          }
        }
      }
    }
    
    // 策略3：从文本行中提取（如果还没找到）
    if (!info.recipient) {
      for (const line of lines) {
        // 如果行中包含手机号，尝试提取手机号前面的名字
        if (info.phone && line.includes(info.phone)) {
          const phoneIndex = line.indexOf(info.phone);
          if (phoneIndex > 0) {
            const beforePhone = line.substring(0, phoneIndex).trim();
            // 提取中文字符串（1-4个字符）
            const chineseMatch = beforePhone.match(/([\u4e00-\u9fa5]{1,4})(?:\s|$)/);
            if (chineseMatch && chineseMatch[1]) {
              const name = chineseMatch[1].trim();
              if (!name.match(/\d/) && !name.match(/[省市区县路街号镇村小区大厦广场室单元栋层座]/)) {
                info.recipient = name;
                break;
              }
            }
            // 尝试英文名字
            if (!info.recipient) {
              // 允许单个字母或2-30个字符的英文名字
              const englishMatch = beforePhone.match(/\b([A-Za-z](?:[A-Za-z\s\.\-]{0,28}[A-Za-z])?)(?:\s|$)/i);
              if (englishMatch && englishMatch[1]) {
                const name = englishMatch[1].trim();
                if (!name.match(/\d/) && name.length >= 1 && name.length <= 30) {
                  info.recipient = name;
                  break;
                }
              }
            }
          }
          // 如果这行包含手机号，跳过后续处理（避免提取数字）
          continue;
        }
        
        // 跳过包含地址关键词的行
        if (line.match(/[省市区县路街号镇村小区大厦广场室单元栋层座组巷弄里弄弄堂胡同社区新村花园苑区]/)) {
          continue;
        }
        
        // 跳过纯数字或数字组合
        if (line.match(/^\d+$/) || line.match(/^[\d\s\-]+$/)) {
          continue;
        }
        
        // 跳过包含11位数字的行（可能是手机号）
        if (line.match(/\d{11}/)) {
          continue;
        }
        
        // 检查是否是合理的名字格式（不包含数字）
        if (line.length >= 1 && line.length <= 30 && !line.match(/\d/)) {
          const isChineseName = /^[\u4e00-\u9fa5]{1,4}$/.test(line);
          const isEnglishName = /^[A-Za-z](?:[A-Za-z\s\.\-]{0,28}[A-Za-z])?$/i.test(line);
          const isMixedName = /^[\u4e00-\u9fa5A-Za-z](?:[\u4e00-\u9fa5A-Za-z\s\.\-]{0,28}[\u4e00-\u9fa5A-Za-z])?$/.test(line);
          
          if (isChineseName || isEnglishName || isMixedName) {
            info.recipient = line;
            break;
          }
        }
      }
    }
    
    // 辅助函数：检查是否是有效的地址
    const isValidAddress = (addr: string): boolean => {
      if (!addr || addr.trim().length < 5 || addr.length > 200) {
        return false;
      }
      
      // 不能是已识别的名字（完全匹配）
      if (info.recipient && addr.trim() === info.recipient.trim()) {
        return false;
      }
      
      // 不能包含手机号
      if (addr.match(/1[3-9]\d[\s-]?\d{4}[\s-]?\d{4}/)) {
        return false;
      }
      
      // 不能只包含名字格式（1-4个中文字符的名字）
      if (addr.trim().match(/^[\u4e00-\u9fa5]{1,4}$/)) {
        return false;
      }
      
      // 必须包含地址关键词（扩展更多关键词）
      const addressKeywords = /[省市区县路街号镇村小区大厦广场室单元栋层座组巷弄里弄弄堂胡同社区新村花园苑区]/;
      if (!addressKeywords.test(addr)) {
        return false;
      }
      
      // 应该包含中文
      if (!/[\u4e00-\u9fa5]/.test(addr)) {
        return false;
      }
      
      return true;
    };
    
    // 提取地址（最后提取，避免干扰名字识别）
    // 策略1：带标签的格式
    const addressLabelPatterns = [
      /(?:地址|收货地址|Address|详细地址|配送地址|收件地址|收货人地址|收件人详细地址)[：:\s]+([^\n]+)/i,
    ];
    
    for (const pattern of addressLabelPatterns) {
      const match = text.match(pattern);
      if (match && match[1]) {
        let addr = match[1].trim();
        
        // 清理地址：移除名字（只在开头或结尾）
        if (info.recipient) {
          const recipientEscaped = info.recipient.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
          // 移除开头的名字
          addr = addr.replace(new RegExp(`^${recipientEscaped}[\\s：:，,]*`), '');
          // 移除结尾的名字
          addr = addr.replace(new RegExp(`[\\s：:，,]*${recipientEscaped}$`), '');
          addr = addr.trim();
        }
        // 移除手机号
        addr = addr.replace(/1[3-9]\d[\s-]?\d{4}[\s-]?\d{4}/g, '').trim();
        
        if (isValidAddress(addr)) {
          info.address = addr;
          break;
        }
      }
    }
    
    // 策略2：包含省市区关键词的行
    if (!info.address) {
      for (const line of lines) {
        // 跳过名字行（完全匹配）
        if (info.recipient && line.trim() === info.recipient.trim()) {
          continue;
        }
        
        // 跳过只包含手机号的行
        if (line.trim().match(/^1[3-9]\d[\s-]?\d{4}[\s-]?\d{4}$/)) {
          continue;
        }
        
        // 检查是否包含地址关键词（扩展关键词）
        const addressKeywordsPattern = /[省市区县路街号镇村小区大厦广场室单元栋层座组巷弄里弄弄堂胡同社区新村花园苑区]/;
        if (addressKeywordsPattern.test(line)) {
          let cleanLine = line.trim();
          
          // 移除名字（只在行首或行尾）
          if (info.recipient) {
            const recipientEscaped = info.recipient.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
            // 移除行首的名字
            cleanLine = cleanLine.replace(new RegExp(`^${recipientEscaped}[\\s：:，,]*`), '');
            // 移除行尾的名字
            cleanLine = cleanLine.replace(new RegExp(`[\\s：:，,]*${recipientEscaped}$`), '');
            cleanLine = cleanLine.trim();
          }
          
          // 移除手机号（保留其他数字，如门牌号）
          cleanLine = cleanLine.replace(/1[3-9]\d[\s-]?\d{4}[\s-]?\d{4}/g, '').trim();
          
          // 如果清理后仍然有效，使用清理后的；否则尝试使用原行（可能名字和地址在同一行）
          if (isValidAddress(cleanLine)) {
            info.address = cleanLine;
            break;
          } else if (isValidAddress(line.trim())) {
            // 如果原行本身是有效地址，也使用（可能名字和地址在一起但整体是地址）
            info.address = line.trim();
            break;
          }
        }
      }
    }
    
    // 策略3：合并多行地址（如果单行不够长）
    if (!info.address) {
      const addressLines: string[] = [];
      for (const line of lines) {
        // 跳过名字行（完全匹配）
        if (info.recipient && line.trim() === info.recipient.trim()) continue;
        // 跳过只包含手机号的行
        if (line.trim().match(/^1[3-9]\d[\s-]?\d{4}[\s-]?\d{4}$/)) continue;
        
        // 如果包含地址关键词，收集起来
        if (line.match(/[省市区县路街号镇村小区大厦广场室单元栋层座组巷弄里弄弄堂胡同社区新村花园苑区]/) && 
            line.trim().length > 3 && 
            /[\u4e00-\u9fa5]/.test(line)) {
          addressLines.push(line.trim());
        }
      }
      
      if (addressLines.length > 0) {
        // 合并多行地址，使用空格连接
        let combinedAddr = addressLines.join('').trim();
        // 如果合并后没有空格分隔，尝试用空格分隔
        if (!combinedAddr.includes(' ')) {
          combinedAddr = addressLines.join(' ').trim();
        }
        
        // 清理合并后的地址
        if (info.recipient) {
          const recipientEscaped = info.recipient.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
          // 移除开头的名字
          combinedAddr = combinedAddr.replace(new RegExp(`^${recipientEscaped}[\\s：:，,]*`), '');
          // 移除结尾的名字
          combinedAddr = combinedAddr.replace(new RegExp(`[\\s：:，,]*${recipientEscaped}$`), '');
          combinedAddr = combinedAddr.trim();
        }
        // 移除手机号
        combinedAddr = combinedAddr.replace(/1[3-9]\d[\s-]?\d{4}[\s-]?\d{4}/g, '').trim();
        
        if (isValidAddress(combinedAddr)) {
          info.address = combinedAddr;
        } else if (addressLines.length === 1 && isValidAddress(addressLines[0])) {
          // 如果只有一行且有效，直接使用
          info.address = addressLines[0];
        }
      }
    }
    
    // 策略4：如果还没找到地址，尝试从剩余行中提取（可能是没有地址关键词但包含地址信息）
    if (!info.address) {
      const remainingLines: string[] = [];
      for (const line of lines) {
        // 跳过已识别的名字和手机号行
        if (info.recipient && line.trim() === info.recipient.trim()) continue;
        if (line.trim().match(/^1[3-9]\d[\s-]?\d{4}[\s-]?\d{4}$/)) continue;
        // 跳过太短的行
        if (line.trim().length < 5) continue;
        // 跳过纯数字行
        if (line.trim().match(/^\d+$/)) continue;
        // 必须包含中文
        if (!/[\u4e00-\u9fa5]/.test(line)) continue;
        
        remainingLines.push(line.trim());
      }
      
      // 如果有多行剩余内容，尝试合并
      if (remainingLines.length > 0) {
        let potentialAddr = remainingLines.join('').trim();
        // 清理名字和手机号
        if (info.recipient) {
          const recipientEscaped = info.recipient.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
          potentialAddr = potentialAddr.replace(new RegExp(`^${recipientEscaped}[\\s：:，,]*`), '');
          potentialAddr = potentialAddr.replace(new RegExp(`[\\s：:，,]*${recipientEscaped}$`), '');
          potentialAddr = potentialAddr.trim();
        }
        potentialAddr = potentialAddr.replace(/1[3-9]\d[\s-]?\d{4}[\s-]?\d{4}/g, '').trim();
        
        // 检查是否包含地址特征（长度足够且包含中文）
        if (potentialAddr.length >= 8 && /[\u4e00-\u9fa5]/.test(potentialAddr) && 
            potentialAddr.match(/[省市区县路街号镇村小区大厦广场室单元栋层座组巷弄里弄弄堂胡同社区新村花园苑区]/)) {
          info.address = potentialAddr;
        }
      }
    }
    
    // 更新收件人组信息
    if (selectedRecipientGroupId) {
      setRecipientGroups(prev => prev.map(group => {
        if (group.id === selectedRecipientGroupId) {
          return {
            ...group,
            recipient: info.recipient || group.recipient,
            phone: info.phone || group.phone,
            address: info.address || group.address,
          };
        }
        return group;
      }));
    } else {
      // 如果没有选中的收件人组，创建一个新的
      if (info.recipient || info.phone || info.address) {
        const newGroup = {
          id: Date.now().toString(),
          recipient: info.recipient || '',
          phone: info.phone || '',
          address: info.address || '',
          items: [],
        };
        setRecipientGroups(prev => [...prev, newGroup]);
        setSelectedRecipientGroupId(newGroup.id);
      }
    }
    
    // 显示识别结果
    const resultMessages: string[] = [];
    if (info.recipient) {
      resultMessages.push(`收件人：${info.recipient}`);
    }
    if (info.phone) {
      resultMessages.push(`手机号：${info.phone}`);
    }
    if (info.address) {
      resultMessages.push(`地址：${info.address}`);
    }
    
    if (resultMessages.length > 0) {
      alert(`✅ 识别成功！\n\n${resultMessages.join('\n')}\n\n请检查信息是否正确，如有误可手动修改。`);
    } else {
      alert('⚠️ 未能识别到收件人信息\n\n请检查剪切板内容是否包含：\n• 收件人姓名\n• 手机号（11位）\n• 详细地址\n\n或手动输入信息。');
    }
  };

  const handleCreateRfq = async (e: React.FormEvent) => {
    e.preventDefault();
    
    // 验证门店必填
    if (!rfqForm.storeId || rfqForm.storeId.trim() === '') {
      alert('请选择关联门店');
      return;
    }

    if (!rfqForm.deadline) {
      alert('请填写截止时间');
      return;
    }

    // 手动创建时验证收件人组和商品列表
    if (createMode === 'manual') {
      if (recipientGroups.length === 0) {
        alert('请至少添加一个收件人');
        return;
      }
      
      // 验证所有收件人组都有基本信息
      const invalidGroups = recipientGroups.filter(group => 
        !group.recipient || !group.recipient.trim() || 
        !group.phone || !group.phone.trim() || 
        !group.address || !group.address.trim()
      );
      if (invalidGroups.length > 0) {
        alert('请填写所有收件人的完整信息（姓名、手机号、地址）');
        return;
      }
      
      // 验证所有收件人组都有商品
      const groupsWithoutItems = recipientGroups.filter(group => group.items.length === 0);
      if (groupsWithoutItems.length > 0) {
        alert('每个收件人至少需要添加一个商品');
        return;
      }
      
      // 验证所有商品都有名称
      const allItems = recipientGroups.flatMap(group => group.items);
      const invalidItems = allItems.filter(item => !item.productName || item.productName.trim() === '');
      if (invalidItems.length > 0) {
        alert('请填写所有商品的名称');
        return;
      }
      
      // 验证所有商品都设置了最高限价（必填项）
      const itemsWithoutMaxPrice = allItems.filter(item => !item.maxPrice || item.maxPrice <= 0);
      if (itemsWithoutMaxPrice.length > 0) {
        const itemNames = itemsWithoutMaxPrice.map(item => item.productName).join('、');
        alert(`以下 ${itemsWithoutMaxPrice.length} 个商品未设置最高限价，请设置后再提交：${itemNames}`);
        return;
      }
    }

    // 验证截止时间必须是未来时间
    const selectedDeadline = new Date(rfqForm.deadline);
    const now = new Date();
    
    console.log('📋 前端创建询价单，截止时间:', selectedDeadline.toISOString(), selectedDeadline.getTime());
    console.log('📋 前端创建询价单，当前时间:', now.toISOString(), now.getTime());
    console.log('📋 前端创建询价单，时间差:', (selectedDeadline.getTime() - now.getTime()) / (1000 * 60 * 60), '小时');
    
    if (selectedDeadline <= now) {
      alert('截止时间必须选择未来的时间');
      return;
    }

    try {
      // 将datetime-local格式转换为ISO字符串
      const deadlineISO = selectedDeadline.toISOString();
      
      let response;
      
      console.log('📋 [前端] 创建模式:', createMode);
      console.log('📋 [前端] 文件状态:', {
        hasFile: !!file,
        fileName: file?.name,
        fileSize: file?.size,
      });
      
      if (createMode === 'file' && file) {
        // 从文件创建询价单
        console.log('📋 [前端] 使用文件模式创建询价单');
        const formData = new FormData();
        formData.append('file', file);
        formData.append('title', rfqForm.title || file.name.replace(/\.[^/.]+$/, ''));
        formData.append('description', rfqForm.description || '');
        formData.append('type', rfqForm.type);
        formData.append('deadline', deadlineISO);
        formData.append('storeId', rfqForm.storeId); // 门店必填
        
        console.log('📋 [前端] 从文件创建询价单:', {
          fileName: file.name,
          title: rfqForm.title || file.name.replace(/\.[^/.]+$/, ''),
          deadline: deadlineISO,
          formDataKeys: Array.from(formData.keys()),
        });
        
        // 注意：不要手动设置 Content-Type，让 axios 自动处理 FormData
        console.log('📋 [前端] 准备发送请求到 /rfqs/from-file');
        console.log('📋 [前端] FormData 内容:', {
          hasFile: formData.has('file'),
          hasTitle: formData.has('title'),
          hasDeadline: formData.has('deadline'),
          allKeys: Array.from(formData.keys()),
        });
        
        try {
          response = await api.post('/rfqs/from-file', formData);
          console.log('📋 [前端] 请求成功，响应:', response.data);
          const responseData = response.data.data || response.data;
          console.log('📋 [前端] 解析后的询价单数据:', {
            id: responseData?.id,
            rfqNo: responseData?.rfqNo,
            title: responseData?.title,
            itemsCount: responseData?.items?.length || 0,
            hasItems: !!responseData?.items,
            items: responseData?.items,
          });
          
          // 从文件创建成功后，直接跳转到询价单详情页面，方便设置最高限价
          const rfqId = responseData?.id;
          if (rfqId) {
            console.log('📋 [前端] 从文件创建成功，跳转到询价单详情页面:', rfqId);
            // 清理表单状态
            setShowCreateForm(false);
            setCreateMode('manual');
            setFile(null);
            setParsedItems([]);
            setRfqForm({
              title: '',
              description: '',
              type: 'NORMAL',
              deadline: '',
              storeId: '',
              orderIds: [],
            });
            // 直接跳转到询价单详情页面，并添加 fromFile 参数以便自动打开最高限价设置
            router.push(`/rfqs/${rfqId}?fromFile=true`);
            return; // 提前返回，不执行后续的刷新列表逻辑
          }
        } catch (error: unknown) {
          console.error('❌ [前端] 请求失败:', error);
          if (isApiError(error)) {
            console.error('❌ [前端] 错误详情:', {
              message: error.message,
              status: error.response?.status,
              statusText: error.response?.statusText,
              data: error.response?.data,
              url: error.config?.url,
              method: error.config?.method,
            });
          }
          throw error;
        }
      } else {
        console.log('📋 [前端] 使用手动模式创建询价单');
        // 手动创建询价单
        // 如果是STORE用户且标题为空，允许提交（后端会自动生成标题）
        if (!rfqForm.title && currentUser?.role !== 'STORE') {
          alert('请填写标题');
          return;
        }
        
        // 合并所有收件人组的商品
        const items = recipientGroups.flatMap(group => 
          group.items.map(item => ({
            productName: item.productName,
            quantity: item.quantity || 1,
            unit: item.unit || '件',
            maxPrice: item.maxPrice,
            instantPrice: item.instantPrice,
            description: item.boxCondition && item.boxCondition.length > 0 
              ? `盒况：${item.boxCondition.join('、')}` 
              : undefined,
          }))
        );
        
        // 构建描述，包含所有收件人信息
        let description = rfqForm.description || '';
        if (recipientGroups.length > 0) {
          const recipientTexts = recipientGroups.map((group, index) => {
            const groupItems = group.items.map(item => 
              `${item.productName} × ${item.quantity} ${item.unit}${item.boxCondition && item.boxCondition.length > 0 ? ` (盒况：${item.boxCondition.join('、')})` : ''}`
            ).join('\n  ');
            return `收件人 ${index + 1}：
  收件人：${group.recipient}
  手机号：${group.phone}
  地址：${group.address}
  商品：
  ${groupItems}`;
          }).join('\n\n');
          
          description = description 
            ? `${description}\n\n收件人信息：\n${recipientTexts}` 
            : `收件人信息：\n${recipientTexts}`;
        }
        
        console.log('📋 前端发送的数据:', {
          ...rfqForm,
          deadline: deadlineISO,
          orderIds: rfqForm.orderIds.length > 0 ? rfqForm.orderIds : undefined,
          storeId: rfqForm.storeId || undefined,
          items,
          autoPublish,
        });
        
        response = await api.post('/rfqs', {
          title: rfqForm.title,
          description: description || undefined,
          type: rfqForm.type,
          deadline: deadlineISO, // 使用ISO格式
          orderIds: rfqForm.orderIds.length > 0 ? rfqForm.orderIds : undefined,
          storeId: rfqForm.storeId || undefined,
          items: items.length > 0 ? items : undefined,
        });
        
        // 如果选择自动发布且创建成功，自动发布询价单
        if (autoPublish && response.data) {
          const rfqId = response.data.data?.id || response.data.id;
          if (rfqId) {
            try {
              await api.patch(`/rfqs/${rfqId}/publish`);
              console.log('📋 询价单已自动发布');
            } catch (publishError: unknown) {
              console.error('自动发布失败:', publishError);
              const publishMessage = isApiError(publishError) 
                ? publishError.response?.data?.message || getErrorMessage(publishError)
                : getErrorMessage(publishError);
              alert(`询价单创建成功，但自动发布失败：${publishMessage}`);
            }
          }
        }
      }
      
      console.log('📋 创建询价单成功:', response.data);

      setShowCreateForm(false);
      setCreateMode('manual');
      setFile(null);
      setParsedItems([]);
      setRecipientGroups([]);
      setSelectedRecipientGroupId(null);
      setAutoPublish(true);
      setRfqForm({
        title: '',
        description: '',
        type: 'NORMAL',
        deadline: '',
        storeId: '',
        orderIds: [],
      });
      await fetchRfqs();
    } catch (error: unknown) {
      console.error('创建询价单失败:', error);
      const message = isApiError(error) 
        ? error.response?.data?.message || getErrorMessage(error)
        : getErrorMessage(error);
      alert(message || '创建询价单失败');
    }
  };

  const handleViewDetail = (rfqId: string) => {
    router.push(`/rfqs/${rfqId}`);
  };

  const handleCloseRfq = async (rfqId: string) => {
    if (!confirm('确定要关闭此询价单吗？关闭后将无法接收新的报价。')) {
      return;
    }

    try {
      await api.patch(`/rfqs/${rfqId}/close`);
      await fetchRfqs();
    } catch (error: unknown) {
      console.error('关闭询价单失败:', error);
      const message = isApiError(error) 
        ? error.response?.data?.message || getErrorMessage(error)
        : getErrorMessage(error);
      alert(message || '关闭询价单失败');
    }
  };

  const handleDeleteRfq = async (rfqId: string, rfqNo: string) => {
    // 查找询价单信息，确定是否需要额外警告
    const rfq = rfqs.find(r => r.id === rfqId);
    const user = authApi.getCurrentUser();
    const isAdmin = user?.role === 'ADMIN';
    
    let confirmMessage = `确定要删除询价单 ${rfqNo} 吗？`;
    if (rfq && rfq.status !== 'DRAFT') {
      if (isAdmin) {
        confirmMessage += '\n\n⚠️ 警告：此询价单不是草稿状态，删除将同时删除所有相关的报价、中标记录和发货单！\n此操作不可恢复！';
      } else {
        confirmMessage += '\n\n⚠️ 只能删除草稿状态的询价单！';
      }
    } else {
      confirmMessage += '\n\n此操作不可恢复！';
    }
    
    if (!confirm(confirmMessage)) {
      return;
    }

    try {
      await api.delete(`/rfqs/${rfqId}`);
      alert('询价单已删除');
      await fetchRfqs();
    } catch (error: unknown) {
      console.error('删除询价单失败:', error);
      const message = isApiError(error) 
        ? error.response?.data?.message || getErrorMessage(error)
        : getErrorMessage(error);
      alert(message || '删除询价单失败');
    }
  };

  const getStatusColor = (status: string) => {
    const statusMap: Record<string, { bg: string; text: string }> = {
      DRAFT: { bg: 'bg-gray-100', text: 'text-gray-800' },
      PUBLISHED: { bg: 'bg-blue-100', text: 'text-blue-800' },
      CLOSED: { bg: 'bg-yellow-100', text: 'text-yellow-800' },
      AWARDED: { bg: 'bg-green-100', text: 'text-green-800' },
      CANCELLED: { bg: 'bg-red-100', text: 'text-red-800' },
    };
    return statusMap[status] || { bg: 'bg-gray-100', text: 'text-gray-800' };
  };

  const getStatusText = (status: string) => {
    const statusMap: Record<string, string> = {
      DRAFT: '草稿',
      PUBLISHED: '已发布',
      CLOSED: '已关闭',
      AWARDED: '已选商',
      CANCELLED: '已取消',
    };
    return statusMap[status] || status;
  };

  const getTypeText = (type: string) => {
    const typeMap: Record<string, string> = {
      AUCTION: '竞价',
      FIXED_PRICE: '固定价',
      NORMAL: '正常供货',
    };
    return typeMap[type] || type;
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
      <div className="mx-auto max-w-7xl px-4 py-8 sm:px-6 lg:px-8">
        {/* 头部 */}
        <div className="mb-8">
          <div className="flex items-center justify-between">
            <div>
              <h1 className="text-3xl font-bold text-gray-900">询价管理</h1>
              <p className="mt-2 text-sm text-gray-600">
                共 {rfqs.length} 个询价单
              </p>
            </div>
            <div className="flex gap-3">
              <button
                onClick={fetchRfqs}
                className="flex items-center gap-2 rounded-lg bg-white px-4 py-2 text-sm font-medium text-gray-700 shadow-sm transition-all hover:bg-gray-50 hover:shadow-md"
              >
                <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
                </svg>
                刷新
              </button>
              <button
                onClick={() => {
                  // STORE角色用户打开表单时自动设置storeId
                  if (currentUser?.role === 'STORE' && currentUser?.storeId) {
                    setRfqForm((prev) => ({
                      ...prev,
                      storeId: currentUser.storeId || '',
                    }));
                  }
                  // 如果没有收件人组，创建一个空的
                  if (recipientGroups.length === 0) {
                    const newGroup = {
                      id: Date.now().toString(),
                      recipient: '',
                      phone: '',
                      address: '',
                      items: [],
                    };
                    setRecipientGroups([newGroup]);
                    setSelectedRecipientGroupId(newGroup.id);
                  }
                  // 自动生成询价单标题：店铺名称 + 日期 + 序号
                  const selectedStoreId = currentUser?.role === 'STORE' && currentUser?.storeId 
                    ? currentUser.storeId 
                    : rfqForm.storeId;
                  if (selectedStoreId && stores.length > 0) {
                    const selectedStore = stores.find(s => s.id === selectedStoreId);
                    if (selectedStore) {
                      const today = new Date();
                      const dateStr = today.toLocaleDateString('zh-CN', {
                        year: 'numeric',
                        month: '2-digit',
                        day: '2-digit',
                      }).replace(/\//g, '-');
                      
                      // 获取当天已创建的询价单数量，计算序号
                      api.get(`/rfqs/today-count?storeId=${selectedStoreId}`)
                        .then((response) => {
                          const count = response.data?.count || 0;
                          const sequenceNumber = count + 1;
                          setRfqForm((prev) => ({
                            ...prev,
                            title: `${selectedStore.name} ${dateStr} ${sequenceNumber}`,
                            deadline: prev.deadline || setDefaultDeadline(2), // 默认2小时后
                          }));
                        })
                        .catch((error) => {
                          console.error('获取当天询价单数量失败:', error);
                          // 如果获取失败，设置不带序号的标题（后端会自动添加序号）
                          setRfqForm((prev) => ({
                            ...prev,
                            title: `${selectedStore.name} ${dateStr}`,
                            deadline: prev.deadline || setDefaultDeadline(2),
                          }));
                        });
                      
                      // 先设置默认截止时间
                      setRfqForm((prev) => ({
                        ...prev,
                        deadline: prev.deadline || setDefaultDeadline(2),
                      }));
                    } else {
                      // 如果没有选中店铺，也设置默认截止时间
                      setRfqForm((prev) => ({
                        ...prev,
                        deadline: prev.deadline || setDefaultDeadline(2),
                      }));
                    }
                  } else {
                    // 如果没有选中店铺，也设置默认截止时间
                    setRfqForm((prev) => ({
                      ...prev,
                      deadline: prev.deadline || setDefaultDeadline(2),
                    }));
                  }
                  setShowCreateForm(true);
                }}
                className="flex items-center gap-2 rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white shadow-sm transition-all hover:bg-blue-700 hover:shadow-md"
              >
                <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
                </svg>
                创建询价单
              </button>
            </div>
          </div>
        </div>

        {/* 筛选和搜索选项 */}
        <div className="mb-6 rounded-xl bg-white p-4 shadow-sm">
          <div className="space-y-4">
            {/* 第一行：搜索和状态筛选 */}
            <div className="flex flex-col gap-4 sm:flex-row sm:items-center">
              {/* 搜索框 */}
              <div className="flex-1">
                <div className="relative">
                  <input
                    type="text"
                    placeholder="搜索询价单号、标题或描述..."
                    value={searchQuery}
                    onChange={(e) => setSearchQuery(e.target.value)}
                    className="w-full rounded-md border border-gray-300 px-4 py-2 pl-10 text-sm focus:border-blue-500 focus:outline-none focus:ring-blue-500"
                  />
                  <svg
                    className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-400"
                    fill="none"
                    stroke="currentColor"
                    viewBox="0 0 24 24"
                  >
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
                  </svg>
                </div>
              </div>
              
              {/* 状态筛选 */}
              <div className="flex items-center gap-2">
                <label htmlFor="statusFilter" className="text-sm font-medium text-gray-700 whitespace-nowrap">
                  状态：
                </label>
                <select
                  id="statusFilter"
                  value={statusFilter}
                  onChange={(e) => setStatusFilter(e.target.value)}
                  className="rounded-md border border-gray-300 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none focus:ring-blue-500"
                >
                  <option value="">全部状态</option>
                  <option value="DRAFT">草稿</option>
                  <option value="PUBLISHED">已发布</option>
                  <option value="CLOSED">已关闭</option>
                  <option value="AWARDED">已选商</option>
                  <option value="CANCELLED">已取消</option>
                </select>
              </div>
            </div>
            
            {/* 第二行：店铺筛选、排序和分组 */}
            <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
              <div className="flex flex-wrap items-center gap-4">
                {/* 店铺筛选 - 门店用户不显示 */}
                {currentUser?.role !== 'STORE' && (
                  <div className="flex items-center gap-2">
                    <label htmlFor="storeFilter" className="text-sm font-medium text-gray-700 whitespace-nowrap">
                      店铺：
                    </label>
                    <select
                      id="storeFilter"
                      value={storeFilter}
                      onChange={(e) => setStoreFilter(e.target.value)}
                      className="rounded-md border border-gray-300 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none focus:ring-blue-500"
                    >
                      <option value="">全部店铺</option>
                      {stores.map((store) => (
                        <option key={store.id} value={store.id}>
                          {store.name} ({store.code})
                        </option>
                      ))}
                    </select>
                  </div>
                )}
                {/* 门店用户显示当前店铺信息 */}
                {currentUser?.role === 'STORE' && stores.length > 0 && (
                  <div className="flex items-center gap-2 rounded-lg bg-blue-50 px-3 py-2 border border-blue-200">
                    <svg className="h-4 w-4 text-blue-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 21V5a2 2 0 00-2-2H7a2 2 0 00-2 2v16m14 0h2m-2 0h-5m-9 0H3m2 0h5M9 7h1m-1 4h1m4-4h1m-1 4h1m-5 10v-5a1 1 0 011-1h2a1 1 0 011 1v5m-4 0h4" />
                    </svg>
                    <span className="text-sm font-medium text-blue-900">
                      当前店铺：{stores[0]?.name} ({stores[0]?.code})
                    </span>
                  </div>
                )}
                
                {/* 排序 */}
                <div className="flex items-center gap-2">
                  <label htmlFor="sortBy" className="text-sm font-medium text-gray-700 whitespace-nowrap">
                    排序：
                  </label>
                  <select
                    id="sortBy"
                    value={sortBy}
                    onChange={(e) => setSortBy(e.target.value as any)}
                    className="rounded-md border border-gray-300 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none focus:ring-blue-500"
                  >
                    <option value="createdAt">创建时间</option>
                    <option value="deadline">截止时间</option>
                    <option value="status">状态</option>
                  </select>
                  <button
                    onClick={() => setSortOrder(sortOrder === 'asc' ? 'desc' : 'asc')}
                    className="rounded-md border border-gray-300 px-3 py-2 text-sm hover:bg-gray-50 transition-colors"
                    title={sortOrder === 'asc' ? '升序' : '降序'}
                  >
                    {sortOrder === 'asc' ? '↑' : '↓'}
                  </button>
                </div>
                
                {/* 分组选项 */}
                <div className="flex items-center gap-2">
                  <input
                    type="checkbox"
                    id="groupByStore"
                    checked={groupByStore}
                    onChange={(e) => setGroupByStore(e.target.checked)}
                    className="h-4 w-4 rounded border-gray-300 text-blue-600 focus:ring-blue-500"
                  />
                  <label htmlFor="groupByStore" className="text-sm font-medium text-gray-700 whitespace-nowrap">
                    按店铺分组
                  </label>
                </div>
              </div>
              
              {/* 统计信息 */}
              <div className="text-sm text-gray-600">
                共找到 <span className="font-semibold text-gray-900">{rfqs.length}</span> 个询价单
              </div>
            </div>
          </div>
        </div>

        {/* 询价单列表 */}
        {rfqs.length > 0 ? (
          groupByStore ? (
            // 按店铺分组显示
            (() => {
              const groupedRfqs = rfqs.reduce((acc, rfq) => {
                const storeKey = rfq.store ? `${rfq.store.id}-${rfq.store.name}` : 'no-store';
                if (!acc[storeKey]) {
                  const defaultStore: Store = rfq.store || {
                    id: '',
                    name: '未关联店铺',
                    code: '',
                    status: 'ACTIVE' as const,
                    createdAt: new Date().toISOString(),
                    updatedAt: new Date().toISOString(),
                  };
                  acc[storeKey] = {
                    store: defaultStore,
                    rfqs: [],
                  };
                }
                acc[storeKey].rfqs.push(rfq);
                return acc;
              }, {} as Record<string, { store: Store; rfqs: Rfq[] }>);

              return (
                <div className="space-y-6">
                  {Object.values(groupedRfqs).map((group, groupIdx) => (
                    <div key={groupIdx} className="rounded-xl bg-white p-6 shadow-sm">
                      <div className="mb-4 flex items-center justify-between border-b border-gray-200 pb-3">
                        <div>
                          <h3 className="text-lg font-semibold text-gray-900">
                            {group.store.name}
                            {group.store.code && (
                              <span className="ml-2 text-sm font-normal text-gray-500">
                                ({group.store.code})
                              </span>
                            )}
                          </h3>
                          <p className="mt-1 text-sm text-gray-600">
                            {group.rfqs.length} 个询价单
                          </p>
                        </div>
                      </div>
                      <div className="grid gap-4 sm:grid-cols-1 lg:grid-cols-2 xl:grid-cols-3">
                        {group.rfqs.map((rfq) => {
                          const statusStyle = getStatusColor(rfq.status || 'DRAFT');
                          return (
                            <div
                              key={rfq.id}
                              className="rounded-xl bg-white p-6 shadow-sm transition-all hover:shadow-lg border border-gray-100"
                            >
                              <div className="mb-4 flex items-start justify-between">
                                <div className="flex-1">
                                  <h3 className="font-semibold text-gray-900">{rfq.rfqNo}</h3>
                                  <p className="mt-1 text-sm text-gray-600">{rfq.title}</p>
                                </div>
                                <span className={`ml-2 inline-flex rounded-full px-3 py-1 text-xs font-semibold ${statusStyle.bg} ${statusStyle.text}`}>
                                  {getStatusText(rfq.status || 'DRAFT')}
                                </span>
                              </div>

                              {rfq.description && (
                                <p className="mb-4 text-sm text-gray-500 line-clamp-2">{rfq.description}</p>
                              )}

                              <div className="space-y-2 text-sm">
                                {rfq.store && (
                                  <div className="flex items-center justify-between">
                                    <span className="text-gray-600">门店</span>
                                    <span className="rounded-md bg-blue-50 px-2 py-1 text-xs font-medium text-blue-700">
                                      {rfq.store.name}
                                    </span>
                                  </div>
                                )}
                                <div className="flex items-center justify-between">
                                  <span className="text-gray-600">询价类型</span>
                                  <span className="text-gray-900">{getTypeText(rfq.type || 'NORMAL')}</span>
                                </div>
                                <div className="flex items-center justify-between">
                                  <span className="text-gray-600">截止时间</span>
                                  <span className="text-gray-900">
                                    {new Date(rfq.deadline).toLocaleString('zh-CN')}
                                  </span>
                                </div>
                                <div className="flex items-center justify-between">
                                  <span className="text-gray-600">创建时间</span>
                                  <span className="text-xs text-gray-500">
                                    {new Date(rfq.createdAt).toLocaleDateString('zh-CN')}
                                  </span>
                                </div>
                                {rfq.items && rfq.items.length > 0 && (
                                  <>
                                    <div className="flex items-center justify-between">
                                      <span className="text-gray-600">商品数量</span>
                                      <span className="text-gray-900">{rfq.items.length} 个</span>
                                    </div>
                                    <div className="mt-2 rounded-md bg-gray-50 p-2">
                                      <p className="text-xs font-medium text-gray-700 mb-1">商品明细：</p>
                                      <div className="space-y-1 max-h-32 overflow-y-auto">
                                        {rfq.items?.slice(0, 5).map((item, idx: number) => (
                                          <div key={item.id || idx} className="text-xs text-gray-600">
                                            • {item.productName} × {item.quantity} {item.unit || ''}
                                          </div>
                                        ))}
                                        {rfq.items.length > 5 && (
                                          <div className="text-xs text-gray-500 italic">
                                            还有 {rfq.items.length - 5} 个商品...
                                          </div>
                                        )}
                                      </div>
                                    </div>
                                  </>
                                )}
                                {(rfq.quotes && rfq.quotes.length > 0) || (rfq.quoteCount && rfq.quoteCount > 0) ? (
                                  <div className="flex items-center justify-between">
                                    <span className="text-gray-600">报价数量</span>
                                    <span className="text-gray-900">{rfq.quotes?.length || rfq.quoteCount || 0} 个</span>
                                  </div>
                                ) : null}
                                <div className="mt-4 flex gap-2">
                                  <button
                                    onClick={() => handleViewDetail(rfq.id)}
                                    className="flex-1 rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white transition-all hover:bg-blue-700"
                                  >
                                    查看详情
                                  </button>
                                  {rfq.status === 'DRAFT' && (
                                    <button
                                      onClick={() => handleDeleteRfq(rfq.id, rfq.rfqNo)}
                                      className="rounded-lg border border-red-300 bg-white px-4 py-2 text-sm font-medium text-red-600 transition-all hover:bg-red-50"
                                      title="删除询价单"
                                    >
                                      <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                                      </svg>
                                    </button>
                                  )}
                                </div>
                              </div>

                              {rfq.status === 'PUBLISHED' && (
                                <button
                                  onClick={() => handleCloseRfq(rfq.id)}
                                  className="mt-2 w-full rounded-lg border border-gray-300 bg-white px-4 py-2 text-sm font-medium text-gray-700 transition-all hover:bg-gray-50"
                                >
                                  关闭询价单
                                </button>
                              )}
                            </div>
                          );
                        })}
                      </div>
                    </div>
                  ))}
                </div>
              );
            })()
          ) : (
            // 普通列表显示
            <div className="grid gap-4 sm:grid-cols-1 lg:grid-cols-2 xl:grid-cols-3">
              {rfqs.map((rfq) => {
                const statusStyle = getStatusColor(rfq.status || 'DRAFT');
                return (
                  <div
                    key={rfq.id}
                    className="rounded-xl bg-white p-6 shadow-sm transition-all hover:shadow-lg"
                  >
                    <div className="mb-4 flex items-start justify-between">
                      <div className="flex-1">
                        <h3 className="font-semibold text-gray-900">{rfq.rfqNo}</h3>
                        <p className="mt-1 text-sm text-gray-600">{rfq.title}</p>
                      </div>
                      <span className={`ml-2 inline-flex rounded-full px-3 py-1 text-xs font-semibold ${statusStyle.bg} ${statusStyle.text}`}>
                        {getStatusText(rfq.status || 'DRAFT')}
                      </span>
                    </div>

                    {rfq.description && (
                      <p className="mb-4 text-sm text-gray-500 line-clamp-2">{rfq.description}</p>
                    )}

                    <div className="space-y-2 text-sm">
                      <div className="flex items-center justify-between">
                        <span className="text-gray-600">询价类型</span>
                        <span className="text-gray-900">{getTypeText(rfq.type || 'NORMAL')}</span>
                      </div>
                      <div className="flex items-center justify-between">
                        <span className="text-gray-600">截止时间</span>
                        <span className="text-gray-900">
                          {new Date(rfq.deadline).toLocaleString('zh-CN')}
                        </span>
                      </div>
                      {rfq.store && (
                        <div className="flex items-center justify-between">
                          <span className="text-gray-600">门店</span>
                          <span className="rounded-md bg-blue-50 px-2 py-1 text-xs font-medium text-blue-700">
                            {rfq.store.name}
                          </span>
                        </div>
                      )}
                      {!rfq.store && (
                        <div className="flex items-center justify-between">
                          <span className="text-gray-600">门店</span>
                          <span className="text-xs text-gray-400">未关联</span>
                        </div>
                      )}
                    {rfq.items && rfq.items.length > 0 && (
                      <>
                        <div className="flex items-center justify-between">
                          <span className="text-gray-600">商品数量</span>
                          <span className="text-gray-900">{rfq.items.length} 个</span>
                        </div>
                        <div className="mt-2 rounded-md bg-gray-50 p-2">
                          <p className="text-xs font-medium text-gray-700 mb-1">商品明细：</p>
                          <div className="space-y-1 max-h-32 overflow-y-auto">
                            {rfq.items?.slice(0, 5).map((item, idx: number) => (
                              <div key={item.id || idx} className="text-xs text-gray-600">
                                • {item.productName} × {item.quantity} {item.unit || ''}
                              </div>
                            ))}
                            {rfq.items.length > 5 && (
                              <div className="text-xs text-gray-500 italic">
                                还有 {rfq.items.length - 5} 个商品...
                              </div>
                            )}
                          </div>
                        </div>
                      </>
                    )}
                    {((rfq.quotes && rfq.quotes.length > 0) || (rfq.quoteCount && rfq.quoteCount > 0)) && (
                      <div className="flex items-center justify-between">
                        <span className="text-gray-600">报价数量</span>
                        <span className="text-gray-900">{rfq.quotes?.length || rfq.quoteCount || 0} 个</span>
                      </div>
                    )}
                    <div className="mt-4 flex gap-2">
                      <button
                        onClick={() => handleViewDetail(rfq.id)}
                        className="flex-1 rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white transition-all hover:bg-blue-700"
                      >
                        查看详情
                      </button>
                      {(() => {
                        const user = authApi.getCurrentUser();
                        const isAdmin = user?.role === 'ADMIN';
                        // 草稿状态：所有有权限的用户都可以删除
                        // 其他状态：只有管理员可以删除
                        const canDelete = rfq.status === 'DRAFT' || isAdmin;
                        if (!canDelete) return null;
                        
                        return (
                          <button
                            onClick={() => handleDeleteRfq(rfq.id, rfq.rfqNo)}
                            className="rounded-lg border border-red-300 bg-white px-4 py-2 text-sm font-medium text-red-600 transition-all hover:bg-red-50"
                            title={rfq.status === 'DRAFT' ? '删除询价单' : '管理员强制删除（将同时删除相关报价和中标记录）'}
                          >
                            <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                            </svg>
                          </button>
                        );
                      })()}
                    </div>
                  </div>

                  {rfq.status === 'PUBLISHED' && (
                    <button
                      onClick={() => handleCloseRfq(rfq.id)}
                      className="mt-2 w-full rounded-lg border border-gray-300 bg-white px-4 py-2 text-sm font-medium text-gray-700 transition-all hover:bg-gray-50"
                    >
                      关闭询价单
                    </button>
                  )}
                </div>
                );
              })}
            </div>
          )
        ) : (
          <div className="rounded-xl bg-white p-12 text-center shadow-sm">
            <div className="mx-auto mb-4 flex h-16 w-16 items-center justify-center rounded-full bg-gray-100">
              <svg className="h-8 w-8 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
              </svg>
            </div>
            <h3 className="mb-2 text-lg font-semibold text-gray-900">暂无询价单</h3>
            <p className="mb-6 text-sm text-gray-500">
              {storeFilter ? '当前筛选条件下没有询价单' : '还没有创建任何询价单，请先创建询价单'}
            </p>
            {!storeFilter && (
              <button
                onClick={() => {
                  // STORE角色用户打开表单时自动设置storeId
                  if (currentUser?.role === 'STORE' && currentUser?.storeId) {
                    setRfqForm((prev) => ({
                      ...prev,
                      storeId: currentUser.storeId || '',
                    }));
                  }
                  // 如果没有收件人组，创建一个空的
                  if (recipientGroups.length === 0) {
                    const newGroup = {
                      id: Date.now().toString(),
                      recipient: '',
                      phone: '',
                      address: '',
                      items: [],
                    };
                    setRecipientGroups([newGroup]);
                    setSelectedRecipientGroupId(newGroup.id);
                  }
                  // 自动生成询价单标题：店铺名称 + 日期 + 序号
                  const selectedStoreId = currentUser?.role === 'STORE' && currentUser?.storeId 
                    ? currentUser.storeId 
                    : rfqForm.storeId;
                  if (selectedStoreId && stores.length > 0) {
                    const selectedStore = stores.find(s => s.id === selectedStoreId);
                    if (selectedStore) {
                      const today = new Date();
                      const dateStr = today.toLocaleDateString('zh-CN', {
                        year: 'numeric',
                        month: '2-digit',
                        day: '2-digit',
                      }).replace(/\//g, '-');
                      
                      // 获取当天已创建的询价单数量，计算序号
                      api.get(`/rfqs/today-count?storeId=${selectedStoreId}`)
                        .then((response) => {
                          const count = response.data?.count || 0;
                          const sequenceNumber = count + 1;
                          setRfqForm((prev) => ({
                            ...prev,
                            title: `${selectedStore.name} ${dateStr} ${sequenceNumber}`,
                            deadline: prev.deadline || setDefaultDeadline(2), // 默认2小时后
                          }));
                        })
                        .catch((error) => {
                          console.error('获取当天询价单数量失败:', error);
                          // 如果获取失败，设置不带序号的标题（后端会自动添加序号）
                          setRfqForm((prev) => ({
                            ...prev,
                            title: `${selectedStore.name} ${dateStr}`,
                            deadline: prev.deadline || setDefaultDeadline(2),
                          }));
                        });
                      
                      // 先设置默认截止时间
                      setRfqForm((prev) => ({
                        ...prev,
                        deadline: prev.deadline || setDefaultDeadline(2),
                      }));
                    } else {
                      // 如果没有选中店铺，也设置默认截止时间
                      setRfqForm((prev) => ({
                        ...prev,
                        deadline: prev.deadline || setDefaultDeadline(2),
                      }));
                    }
                  } else {
                    // 如果没有选中店铺，也设置默认截止时间
                    setRfqForm((prev) => ({
                      ...prev,
                      deadline: prev.deadline || setDefaultDeadline(2),
                    }));
                  }
                  setShowCreateForm(true);
                }}
                className="inline-flex items-center gap-2 rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white transition-all hover:bg-blue-700"
              >
                <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
                </svg>
                立即创建询价单
              </button>
            )}
          </div>
        )}

        {/* 创建询价单表单弹窗 */}
        {showCreateForm && (
          <div className="fixed inset-0 z-50 flex items-end justify-center bg-black bg-opacity-50 sm:items-center sm:bg-opacity-50">
            <div className="w-full max-w-2xl max-h-[95vh] sm:max-h-[90vh] rounded-t-2xl bg-white shadow-2xl sm:rounded-xl sm:my-8 flex flex-col overflow-hidden">
              {/* 移动端拖拽指示器 */}
              <div className="mx-auto mt-2 h-1 w-12 rounded-full bg-gray-300 sm:hidden flex-shrink-0"></div>
              
              {/* 头部 */}
              <div className="flex-shrink-0 px-4 pt-4 pb-3 sm:px-6 sm:pt-6 sm:pb-4 border-b border-gray-200">
                <div className="flex items-center justify-between">
                  <div className="flex-1 min-w-0 pr-3">
                    <h2 className="text-lg sm:text-2xl font-bold text-gray-900">创建询价单</h2>
                    <p className="mt-1 text-xs sm:text-sm text-gray-500">填写以下信息创建新的询价单</p>
                  </div>
                  <button
                    onClick={() => {
                    setShowCreateForm(false);
                    setCreateMode('manual');
                    setFile(null);
                    setParsedItems([]);
                    setRecipientGroups([]);
                    setSelectedRecipientGroupId(null);
                    setAutoPublish(true);
                    // STORE角色用户关闭表单时保留storeId
                    const defaultStoreId = currentUser?.role === 'STORE' && currentUser?.storeId 
                      ? currentUser.storeId 
                      : '';
                    setRfqForm({
                      title: '',
                      description: '',
                      type: 'NORMAL',
                      deadline: '',
                      storeId: defaultStoreId,
                      orderIds: [],
                    });
                    }}
                    className="flex h-10 w-10 items-center justify-center rounded-full text-gray-400 active:bg-gray-100 sm:hover:bg-gray-100 sm:hover:text-gray-600 flex-shrink-0"
                  >
                    <svg className="h-6 w-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                    </svg>
                  </button>
                </div>
              </div>

              {/* 创建方式选择 - 现代化标签页 */}
              <div className="flex-shrink-0 px-4 pb-4 sm:px-6 sm:pb-6">
                <div className="flex gap-2 rounded-lg bg-gray-100 p-1">
                  <button
                    type="button"
                    onClick={() => {
                      console.log('📋 [前端] 切换到手动创建模式');
                      setCreateMode('manual');
                      // 确保表单字段始终有值，避免受控/非受控切换
                      setRfqForm((prev) => ({
                        ...prev,
                        title: prev.title || '',
                        description: prev.description || '',
                        deadline: prev.deadline || '',
                        type: prev.type || 'NORMAL',
                        storeId: prev.storeId || '',
                      }));
                    }}
                    className={`flex flex-1 items-center justify-center gap-2 rounded-md px-4 py-2.5 text-sm font-medium transition-all ${
                      createMode === 'manual'
                        ? 'bg-white text-blue-600 shadow-sm'
                        : 'text-gray-600 hover:text-gray-900'
                    }`}
                  >
                    <svg className="h-5 w-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" />
                    </svg>
                    手动创建
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      console.log('📋 [前端] 切换到文件创建模式');
                      setCreateMode('file');
                      // 确保表单字段始终有值，避免受控/非受控切换
                      setRfqForm((prev) => ({
                        ...prev,
                        title: prev.title || '',
                        description: prev.description || '',
                        deadline: prev.deadline || '',
                        type: prev.type || 'NORMAL',
                        storeId: prev.storeId || '',
                      }));
                    }}
                    className={`flex flex-1 items-center justify-center gap-2 rounded-md px-4 py-2.5 text-sm font-medium transition-all ${
                      createMode === 'file'
                        ? 'bg-white text-blue-600 shadow-sm'
                        : 'text-gray-600 hover:text-gray-900'
                    }`}
                  >
                    <svg className="h-5 w-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
                    </svg>
                    从文件创建
                  </button>
                </div>
              </div>

              {/* 可滚动内容区域 */}
              <div className="flex-1 overflow-y-auto px-4 sm:px-6">
                <form id="create-rfq-form" onSubmit={handleCreateRfq} className="space-y-6 pb-4">
                {/* 基本信息卡片 */}
                <div className="rounded-xl border border-gray-200 bg-white p-6 shadow-sm">
                  <div className="mb-4 flex items-center gap-2">
                    <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-blue-100">
                      <svg className="h-5 w-5 text-blue-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                      </svg>
                    </div>
                    <h3 className="text-lg font-semibold text-gray-900">基本信息</h3>
                  </div>
                  
                  <div className="space-y-4">
                    {/* 门店选择 */}
                    <div>
                      <label htmlFor="storeId" className="mb-2 block text-sm font-medium text-gray-700">
                        <span className="flex items-center gap-1">
                          关联门店
                          <span className="text-red-500">*</span>
                        </span>
                      </label>
                      {currentUser?.role === 'STORE' && currentUser?.storeId ? (
                        <div className="mt-1">
                          <div className="flex items-center gap-2 rounded-lg border border-gray-300 bg-gray-50 px-4 py-3">
                            <svg className="h-5 w-5 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 21V5a2 2 0 00-2-2H7a2 2 0 00-2 2v16m14 0h2m-2 0h-5m-9 0H3m2 0h5M9 7h1m-1 4h1m4-4h1m-1 4h1m-5 10v-5a2 2 0 012-2h2a2 2 0 012 2v5m-4 0h4" />
                            </svg>
                            <span className="text-gray-700">{stores.find(s => s.id === currentUser.storeId)?.name || '我的门店'}</span>
                          </div>
                          <p className="mt-2 text-xs text-gray-500">
                            门店用户只能为自己的门店创建询价单
                          </p>
                        </div>
                      ) : (
                        <>
                          <select
                            id="storeId"
                            required
                            value={rfqForm.storeId || ''}
                            onChange={(e) => {
                              const newStoreId = e.target.value;
                              // 如果选择了门店，自动生成标题和截止时间
                              if (newStoreId && stores.length > 0) {
                                const selectedStore = stores.find(s => s.id === newStoreId);
                                if (selectedStore) {
                                  const now = new Date();
                                  const timeStr = now.toLocaleString('zh-CN', { 
                                    year: 'numeric', 
                                    month: '2-digit', 
                                    day: '2-digit', 
                                    hour: '2-digit', 
                                    minute: '2-digit' 
                                  }).replace(/\//g, '-');
                                  setRfqForm({ 
                                    ...rfqForm, 
                                    storeId: newStoreId,
                                    title: `${selectedStore.name} ${timeStr}`,
                                    deadline: rfqForm.deadline || setDefaultDeadline(2), // 如果截止时间为空，设置默认值
                                  });
                                  return;
                                }
                              }
                              setRfqForm({ 
                                ...rfqForm, 
                                storeId: newStoreId,
                                deadline: rfqForm.deadline || setDefaultDeadline(2), // 如果截止时间为空，设置默认值
                              });
                            }}
                            className="mt-1 block w-full rounded-lg border border-gray-300 bg-white px-4 py-2.5 text-sm shadow-sm transition-all focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-500/20"
                          >
                            <option value="">请选择门店</option>
                            {stores.map((store) => (
                              <option key={store.id} value={store.id}>
                                {store.name} ({store.code})
                              </option>
                            ))}
                          </select>
                          <p className="mt-2 text-xs text-gray-500">
                            选择询价单关联的门店，用于后续数据区分和统计
                          </p>
                        </>
                      )}
                    </div>
                  </div>
                </div>

                {createMode === 'file' ? (
                  <div className="rounded-xl border border-gray-200 bg-white p-6 shadow-sm">
                    <div className="mb-4 flex items-center gap-2">
                      <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-blue-100">
                        <svg className="h-5 w-5 text-blue-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
                        </svg>
                      </div>
                      <h3 className="text-lg font-semibold text-gray-900">文件上传</h3>
                    </div>
                    <div className="space-y-4">
                      <div>
                        <label htmlFor="file" className="block text-sm font-medium text-gray-700">
                          选择文件 <span className="text-red-500">*</span>
                        </label>
                        <input
                          id="file"
                          type="file"
                          accept=".xlsx,.xls,.csv"
                          onChange={handleFileChange}
                          className="mt-1 block w-full text-sm text-gray-500 file:mr-4 file:rounded-md file:border-0 file:bg-blue-50 file:px-4 file:py-2 file:text-sm file:font-semibold file:text-blue-700 hover:file:bg-blue-100"
                        />
                        <p className="mt-1 text-xs text-gray-500">
                          支持 Excel (.xlsx, .xls) 和 CSV 格式。文件应包含商品名称、数量、单位等列。
                        </p>
                      </div>
                      {file && (
                        <div className="rounded-md bg-blue-50 p-3 text-sm text-blue-800">
                          <p>已选择文件: {file.name}</p>
                          <p className="mt-1 text-xs">文件大小: {(file.size / 1024).toFixed(2)} KB</p>
                        </div>
                      )}
                      <div>
                        <label htmlFor="title" className="block text-sm font-medium text-gray-700">
                          询价单标题（可选，默认使用文件名）
                        </label>
                        <input
                          id="title"
                          type="text"
                          value={rfqForm.title || ''}
                          onChange={(e) => setRfqForm({ ...rfqForm, title: e.target.value })}
                          className="mt-1 block w-full rounded-md border border-gray-300 px-3 py-2 shadow-sm focus:border-blue-500 focus:outline-none focus:ring-blue-500"
                          placeholder="留空则使用文件名"
                        />
                      </div>
                      
                      {/* 截止时间 */}
                      <div>
                        <label htmlFor="deadline-file" className="mb-2 block text-sm font-medium text-gray-700">
                          <span className="flex items-center gap-1">
                            截止时间
                            <span className="text-red-500">*</span>
                          </span>
                        </label>
                        {/* 快捷选项按钮 */}
                        <div className="mb-2 flex flex-wrap gap-2">
                          <button
                            type="button"
                            onClick={() => setRfqForm({ ...rfqForm, deadline: setDefaultDeadline(2) })}
                            className="rounded-md border border-gray-300 bg-white px-3 py-1.5 text-xs font-medium text-gray-700 transition-all hover:bg-gray-50 hover:border-blue-500 hover:text-blue-600 active:scale-95"
                          >
                            2小时后
                          </button>
                          <button
                            type="button"
                            onClick={() => setRfqForm({ ...rfqForm, deadline: setDefaultDeadline(4) })}
                            className="rounded-md border border-gray-300 bg-white px-3 py-1.5 text-xs font-medium text-gray-700 transition-all hover:bg-gray-50 hover:border-blue-500 hover:text-blue-600 active:scale-95"
                          >
                            4小时后
                          </button>
                          <button
                            type="button"
                            onClick={() => setRfqForm({ ...rfqForm, deadline: setDefaultDeadline(6) })}
                            className="rounded-md border border-gray-300 bg-white px-3 py-1.5 text-xs font-medium text-gray-700 transition-all hover:bg-gray-50 hover:border-blue-500 hover:text-blue-600 active:scale-95"
                          >
                            6小时后
                          </button>
                        </div>
                        <input
                          id="deadline-file"
                          type="datetime-local"
                          required
                          value={rfqForm.deadline || ''}
                          onChange={(e) => setRfqForm({ ...rfqForm, deadline: e.target.value })}
                          className="block w-full rounded-lg border border-gray-300 bg-white px-4 py-2.5 text-sm shadow-sm transition-all focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-500/20"
                          min={new Date().toISOString().slice(0, 16)}
                        />
                        <p className="mt-2 text-xs text-gray-500">
                          请选择未来的时间，默认2小时后
                        </p>
                      </div>
                    </div>
                  </div>
                ) : (
                  <div className="rounded-xl border border-gray-200 bg-white p-6 shadow-sm">
                    <div className="mb-4 flex items-center gap-2">
                      <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-blue-100">
                        <svg className="h-5 w-5 text-blue-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" />
                        </svg>
                      </div>
                      <h3 className="text-lg font-semibold text-gray-900">询价单详情</h3>
                    </div>
                    <div className="space-y-4">
                      {/* 询价单标题 */}
                      <div>
                      <label htmlFor="title" className="mb-2 block text-sm font-medium text-gray-700">
                        <span className="flex items-center gap-1">
                          询价单标题
                          <span className="text-red-500">*</span>
                        </span>
                      </label>
                      <input
                        id="title"
                        type="text"
                        required
                        value={rfqForm.title || ''}
                        onChange={(e) => setRfqForm({ ...rfqForm, title: e.target.value })}
                        className="block w-full rounded-lg border border-gray-300 bg-white px-4 py-2.5 text-sm shadow-sm transition-all placeholder:text-gray-400 focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-500/20"
                        placeholder="例如：模型玩具商品采购询价"
                      />
                    </div>

                    {/* 询价类型和截止时间 */}
                    <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                      <div>
                        <label htmlFor="type" className="mb-2 block text-sm font-medium text-gray-700">
                          询价类型
                        </label>
                        <select
                          id="type"
                          value={rfqForm.type || 'NORMAL'}
                          onChange={(e) => setRfqForm({ ...rfqForm, type: e.target.value })}
                          className="block w-full rounded-lg border border-gray-300 bg-white px-4 py-2.5 text-sm shadow-sm transition-all focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-500/20"
                        >
                          <option value="NORMAL">正常供货</option>
                          <option value="AUCTION">竞价</option>
                          <option value="FIXED_PRICE">固定价</option>
                        </select>
                      </div>

                      <div>
                        <label htmlFor="deadline" className="mb-2 block text-sm font-medium text-gray-700">
                          <span className="flex items-center gap-1">
                            截止时间
                            <span className="text-red-500">*</span>
                          </span>
                        </label>
                        {/* 快捷选项按钮 */}
                        <div className="mb-2 flex flex-wrap gap-2">
                          <button
                            type="button"
                            onClick={() => setRfqForm({ ...rfqForm, deadline: setDefaultDeadline(2) })}
                            className="rounded-md border border-gray-300 bg-white px-3 py-1.5 text-xs font-medium text-gray-700 transition-all hover:bg-gray-50 hover:border-blue-500 hover:text-blue-600 active:scale-95"
                          >
                            2小时后
                          </button>
                          <button
                            type="button"
                            onClick={() => setRfqForm({ ...rfqForm, deadline: setDefaultDeadline(4) })}
                            className="rounded-md border border-gray-300 bg-white px-3 py-1.5 text-xs font-medium text-gray-700 transition-all hover:bg-gray-50 hover:border-blue-500 hover:text-blue-600 active:scale-95"
                          >
                            4小时后
                          </button>
                          <button
                            type="button"
                            onClick={() => setRfqForm({ ...rfqForm, deadline: setDefaultDeadline(6) })}
                            className="rounded-md border border-gray-300 bg-white px-3 py-1.5 text-xs font-medium text-gray-700 transition-all hover:bg-gray-50 hover:border-blue-500 hover:text-blue-600 active:scale-95"
                          >
                            6小时后
                          </button>
                        </div>
                        <input
                          id="deadline"
                          type="datetime-local"
                          required
                          value={rfqForm.deadline || ''}
                          onChange={(e) => setRfqForm({ ...rfqForm, deadline: e.target.value })}
                          className="block w-full rounded-lg border border-gray-300 bg-white px-4 py-2.5 text-sm shadow-sm transition-all focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-500/20"
                          min={new Date().toISOString().slice(0, 16)}
                        />
                        <p className="mt-2 text-xs text-gray-500">
                          请选择未来的时间，默认2小时后
                        </p>
                      </div>
                    </div>

                    {/* 询价单描述 */}
                    <div>
                      <label htmlFor="description" className="mb-2 block text-sm font-medium text-gray-700">
                        询价单描述
                      </label>
                      <textarea
                        id="description"
                        rows={3}
                        value={rfqForm.description || ''}
                        onChange={(e) => setRfqForm({ ...rfqForm, description: e.target.value })}
                        className="block w-full rounded-lg border border-gray-300 bg-white px-4 py-2.5 text-sm shadow-sm transition-all placeholder:text-gray-400 focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-500/20"
                        placeholder="详细描述采购需求（可选）"
                      />
                    </div>
                    </div>
                  </div>
                )}

                {/* 收件人组列表 - 仅在手动创建模式显示 */}
                {createMode === 'manual' && (
                  <div className="space-y-4">
                    {/* 收件人组列表 */}
                    {recipientGroups.map((group, groupIndex) => (
                      <div
                        key={group.id}
                        className={`rounded-xl border-2 ${
                          selectedRecipientGroupId === group.id
                            ? 'border-blue-500 bg-blue-50/30'
                            : 'border-gray-200 bg-white'
                        } p-6 shadow-sm transition-all`}
                      >
                        {/* 收件人组头部 */}
                        <div className="mb-4 flex items-center justify-between border-b border-gray-200 pb-3">
                          <div className="flex items-center gap-2">
                            <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-blue-100">
                              <svg className="h-5 w-5 text-blue-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z" />
                              </svg>
                            </div>
                            <h3 className="text-lg font-semibold text-gray-900">
                              收件人 {groupIndex + 1}
                              <span className="ml-2 text-red-500">*</span>
                            </h3>
                            {group.items.length > 0 && (
                              <span className="rounded-full bg-green-100 px-2.5 py-0.5 text-xs font-medium text-green-700">
                                {group.items.length} 个商品
                              </span>
                            )}
                          </div>
                          <div className="flex items-center gap-2">
                            <button
                              type="button"
                              onClick={() => setSelectedRecipientGroupId(group.id)}
                              className="rounded-lg px-3 py-1.5 text-xs font-medium text-blue-600 hover:bg-blue-50 transition-colors"
                            >
                              选中此收件人
                            </button>
                            {recipientGroups.length > 1 && (
                              <button
                                type="button"
                                onClick={() => {
                                  setRecipientGroups(recipientGroups.filter((_, i) => i !== groupIndex));
                                  if (selectedRecipientGroupId === group.id) {
                                    setSelectedRecipientGroupId(null);
                                  }
                                }}
                                className="rounded-lg p-1.5 text-red-600 transition-colors hover:bg-red-50 hover:text-red-700"
                                title="删除收件人"
                              >
                                <svg className="h-5 w-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                                </svg>
                              </button>
                            )}
                          </div>
                        </div>

                        {/* 收件人信息 */}
                        <div className="mb-4 space-y-3">
                          <div className="flex flex-wrap gap-2">
                            <button
                              type="button"
                              onClick={async () => {
                                setSelectedRecipientGroupId(group.id);
                                try {
                                  if (!navigator.clipboard || !navigator.clipboard.readText) {
                                    const text = prompt('您的浏览器不支持自动读取剪切板。\n\n请粘贴包含收件人信息的文本：\n\n格式示例：\n收件人：张三\n手机号：13800138000\n地址：北京市朝阳区xxx路xxx号');
                                    if (text && text.trim()) {
                                      parseClipboardText(text.trim());
                                    }
                                    return;
                                  }
                                  const text = await navigator.clipboard.readText();
                                  if (text && text.trim()) {
                                    parseClipboardText(text.trim());
                                  } else {
                                    alert('剪切板为空，请先复制包含收件人信息的文本');
                                  }
                                } catch (err: any) {
                                  console.error('读取剪切板失败:', err);
                                  const text = prompt('请粘贴包含收件人信息的文本：\n\n格式示例：\n收件人：张三\n手机号：13800138000\n地址：北京市朝阳区xxx路xxx号\n\n或直接粘贴订单信息文本');
                                  if (text && text.trim()) {
                                    parseClipboardText(text.trim());
                                  }
                                }
                              }}
                              className="inline-flex items-center gap-2 rounded-lg bg-blue-600 px-3 py-1.5 text-xs font-medium text-white shadow-sm transition-all hover:bg-blue-700 active:scale-95"
                            >
                              <svg className="h-3.5 w-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2" />
                              </svg>
                              从剪切板识别
                            </button>
                          </div>
                          <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
                            <div>
                              <label className="mb-1.5 block text-xs font-medium text-gray-700">收件人 <span className="text-red-500">*</span></label>
                              <input
                                type="text"
                                required
                                value={group.recipient || ''}
                                onChange={(e) => {
                                  setRecipientGroups(prev => prev.map(g => 
                                    g.id === group.id ? { ...g, recipient: e.target.value } : g
                                  ));
                                }}
                                className="w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm transition-all placeholder:text-gray-400 focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-500/20"
                                placeholder="姓名"
                              />
                            </div>
                            <div>
                              <label className="mb-1.5 block text-xs font-medium text-gray-700">手机号 <span className="text-red-500">*</span></label>
                              <input
                                type="tel"
                                required
                                value={group.phone || ''}
                                onChange={(e) => {
                                  setRecipientGroups(prev => prev.map(g => 
                                    g.id === group.id ? { ...g, phone: e.target.value } : g
                                  ));
                                }}
                                className="w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm transition-all placeholder:text-gray-400 focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-500/20"
                                placeholder="13800138000"
                              />
                            </div>
                            <div>
                              <label className="mb-1.5 block text-xs font-medium text-gray-700">地址 <span className="text-red-500">*</span></label>
                              <input
                                type="text"
                                required
                                value={group.address || ''}
                                onChange={(e) => {
                                  setRecipientGroups(prev => prev.map(g => 
                                    g.id === group.id ? { ...g, address: e.target.value } : g
                                  ));
                                }}
                                className="w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm transition-all placeholder:text-gray-400 focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-500/20"
                                placeholder="详细地址"
                              />
                            </div>
                          </div>
                        </div>

                        {/* 商品列表 */}
                        <div className="border-t border-gray-200 pt-4">
                          <div className="mb-3 flex items-center justify-between">
                            <h4 className="text-sm font-semibold text-gray-700">商品列表 <span className="text-red-500">*</span></h4>
                            <button
                              type="button"
                              onClick={() => {
                                setRecipientGroups(prev => prev.map(g => 
                                  g.id === group.id 
                                    ? { 
                                        ...g, 
                                        items: [...g.items, {
                                          id: Date.now().toString(),
                                          productName: '',
                                          boxCondition: ['全新带运输盒'], // 默认全选全新带运输盒
                                          quantity: 1,
                                          unit: '件',
                                          maxPrice: undefined,
                                          instantPrice: undefined,
                                        }]
                                      }
                                    : g
                                ));
                              }}
                              className="inline-flex items-center gap-1.5 rounded-lg bg-green-600 px-3 py-1.5 text-xs font-medium text-white shadow-sm transition-all hover:bg-green-700 active:scale-95"
                            >
                              <svg className="h-3.5 w-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 6v6m0 0v6m0-6h6m-6 0H6" />
                              </svg>
                              添加商品
                            </button>
                          </div>
                          {group.items.length === 0 ? (
                            <div className="rounded-lg border-2 border-dashed border-gray-300 bg-gray-50 p-8 text-center">
                              <p className="text-sm text-gray-500">暂无商品，点击&quot;添加商品&quot;开始添加</p>
                            </div>
                          ) : (
                            <div className="space-y-3">
                              {group.items.map((item, itemIndex) => (
                                <div
                                  key={item.id}
                                  className="rounded-lg border border-gray-200 bg-gray-50 p-3 shadow-sm"
                                >
                                  <div className="mb-2 flex items-center justify-between">
                                    <span className="text-xs font-medium text-gray-600">商品 #{itemIndex + 1}</span>
                                    <button
                                      type="button"
                                      onClick={() => {
                                        setRecipientGroups(prev => prev.map(g => 
                                          g.id === group.id 
                                            ? { ...g, items: g.items.filter((_, i) => i !== itemIndex) }
                                            : g
                                        ));
                                      }}
                                      className="rounded p-1 text-red-600 transition-colors hover:bg-red-50"
                                      title="删除商品"
                                    >
                                      <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                                      </svg>
                                    </button>
                                  </div>
                                  {/* 商品名称 */}
                                  <div className="mb-2">
                                    <label className="mb-1 block text-xs font-medium text-gray-700">商品名称 <span className="text-red-500">*</span></label>
                                    <input
                                      type="text"
                                      required
                                      value={item.productName || ''}
                                      onChange={(e) => {
                                        setRecipientGroups(prev => prev.map(g => 
                                          g.id === group.id 
                                            ? { 
                                                ...g, 
                                                items: g.items.map((it, idx) => 
                                                  idx === itemIndex ? { ...it, productName: e.target.value } : it
                                                )
                                              }
                                            : g
                                        ));
                                      }}
                                      className="w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-xs transition-all placeholder:text-gray-400 focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-500/20"
                                      placeholder="请输入商品名称"
                                    />
                                  </div>
                                  
                                  {/* 最高限价和一口价 */}
                                  <div className="mb-2 grid grid-cols-1 sm:grid-cols-2 gap-2">
                                    {/* 最高限价 */}
                                    <div>
                                      <label className="mb-1 block text-xs font-medium text-gray-700">
                                        最高限价 <span className="text-red-500">*</span>
                                      </label>
                                      <div className="relative">
                                        <span className="absolute left-3 top-1/2 -translate-y-1/2 text-xs text-gray-500">¥</span>
                                        <input
                                          type="number"
                                          required
                                          min="0.01"
                                          step="0.01"
                                          value={item.maxPrice || ''}
                                          onChange={(e) => {
                                            setRecipientGroups(prev => prev.map(g => 
                                              g.id === group.id 
                                                ? { 
                                                    ...g, 
                                                    items: g.items.map((it, idx) => 
                                                      idx === itemIndex ? { ...it, maxPrice: e.target.value ? parseFloat(e.target.value) : undefined } : it
                                                    )
                                                  }
                                                : g
                                            ));
                                          }}
                                          className="w-full rounded-lg border border-gray-300 bg-white pl-8 pr-3 py-2 text-xs transition-all placeholder:text-gray-400 focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-500/20"
                                          placeholder="请输入最高限价"
                                        />
                                      </div>
                                    </div>

                                    {/* 一口价（可选） */}
                                    <div>
                                      <label className="mb-1 block text-xs font-medium text-gray-700">
                                        <span className="flex items-center gap-1">
                                          <span className="text-blue-600">一口价</span>
                                          <span className="group relative">
                                            <svg className="h-3.5 w-3.5 text-blue-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                                            </svg>
                                            <span className="absolute left-1/2 top-full mt-1 hidden -translate-x-1/2 whitespace-nowrap rounded bg-gray-900 px-2 py-1 text-xs text-white group-hover:block z-10">报价≤此价格时自动中标</span>
                                          </span>
                                        </span>
                                        <span className="text-xs text-gray-500 font-normal block mt-0.5">（报价≤此价格时自动中标）</span>
                                      </label>
                                      <div className="relative">
                                        <span className="absolute left-3 top-1/2 -translate-y-1/2 text-xs text-gray-500">¥</span>
                                        <input
                                          type="number"
                                          min="0.01"
                                          step="0.01"
                                          value={item.instantPrice || ''}
                                          onChange={(e) => {
                                            setRecipientGroups(prev => prev.map(g => 
                                              g.id === group.id 
                                                ? { 
                                                    ...g, 
                                                    items: g.items.map((it, idx) => 
                                                      idx === itemIndex ? { ...it, instantPrice: e.target.value ? parseFloat(e.target.value) : undefined } : it
                                                    )
                                                  }
                                                : g
                                            ));
                                          }}
                                          className="w-full rounded-lg border border-blue-300 bg-blue-50/30 pl-8 pr-3 py-2 text-xs transition-all placeholder:text-gray-400 focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-500/20"
                                          placeholder="可选：设置一口价自动中标"
                                        />
                                      </div>
                                    </div>
                                  </div>
                                  
                                  {/* 数量和单位 */}
                                  <div className="mb-2 grid grid-cols-2 gap-2">
                                    <div>
                                      <label className="mb-1 block text-xs font-medium text-gray-700">数量</label>
                                      <input
                                        type="number"
                                        min="1"
                                        value={item.quantity || 1}
                                        onChange={(e) => {
                                          setRecipientGroups(prev => prev.map(g => 
                                            g.id === group.id 
                                              ? { 
                                                  ...g, 
                                                  items: g.items.map((it, idx) => 
                                                    idx === itemIndex ? { ...it, quantity: parseInt(e.target.value) || 1 } : it
                                                  )
                                                }
                                              : g
                                          ));
                                        }}
                                        className="w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-xs transition-all focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-500/20"
                                      />
                                    </div>
                                    <div>
                                      <label className="mb-1 block text-xs font-medium text-gray-700">单位</label>
                                      <input
                                        type="text"
                                        value={item.unit || '件'}
                                        onChange={(e) => {
                                          setRecipientGroups(prev => prev.map(g => 
                                            g.id === group.id 
                                              ? { 
                                                  ...g, 
                                                  items: g.items.map((it, idx) => 
                                                    idx === itemIndex ? { ...it, unit: e.target.value } : it
                                                  )
                                                }
                                              : g
                                          ));
                                        }}
                                        className="w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-xs transition-all placeholder:text-gray-400 focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-500/20"
                                        placeholder="件"
                                      />
                                    </div>
                                  </div>
                                  
                                  {/* 盒况 */}
                                  <div>
                                    <label className="mb-1 block text-xs font-medium text-gray-700">盒况</label>
                                    <div className="flex flex-wrap gap-2">
                                      {['全新带运输盒', '单彩盒', '轻微盒损', '盒损'].map((condition) => {
                                        const currentConditions = item.boxCondition && item.boxCondition.length > 0 
                                          ? item.boxCondition 
                                          : ['全新带运输盒'];
                                        const isChecked = currentConditions.includes(condition);
                                        return (
                                          <label
                                            key={condition}
                                            className={`flex items-center gap-1.5 rounded-lg border px-3 py-1.5 text-xs cursor-pointer transition-all ${
                                              isChecked
                                                ? 'border-blue-500 bg-blue-50 text-blue-700'
                                                : 'border-gray-300 bg-white text-gray-700 hover:bg-gray-50 hover:border-blue-500'
                                            }`}
                                          >
                                            <input
                                              type="checkbox"
                                              checked={isChecked}
                                              onChange={(e) => {
                                                setRecipientGroups(prev => prev.map(g => 
                                                  g.id === group.id 
                                                    ? { 
                                                        ...g, 
                                                        items: g.items.map((it, idx) => {
                                                        if (idx === itemIndex) {
                                                          const conditions = (it.boxCondition && it.boxCondition.length > 0) 
                                                            ? it.boxCondition 
                                                            : ['全新带运输盒'];
                                                          let newConditions: string[];
                                                          if (e.target.checked) {
                                                            // 选中：添加到列表（如果不存在）
                                                            newConditions = conditions.includes(condition) 
                                                              ? conditions 
                                                              : [...conditions, condition];
                                                          } else {
                                                            // 取消选中：从列表移除
                                                            newConditions = conditions.filter(c => c !== condition);
                                                            // 如果移除后为空，则默认选中"全新带运输盒"
                                                            if (newConditions.length === 0) {
                                                              newConditions = ['全新带运输盒'];
                                                            }
                                                          }
                                                          return { ...it, boxCondition: newConditions };
                                                        }
                                                          return it;
                                                        })
                                                      }
                                                    : g
                                                ));
                                              }}
                                              className="h-3.5 w-3.5 rounded border-gray-300 text-blue-600 focus:ring-blue-500"
                                            />
                                            <span>{condition}</span>
                                          </label>
                                        );
                                      })}
                                    </div>
                                  </div>
                                </div>
                              ))}
                            </div>
                          )}
                        </div>
                      </div>
                    ))}

                    {/* 添加收件人按钮 */}
                    <button
                      type="button"
                      onClick={() => {
                        const newGroup = {
                          id: Date.now().toString(),
                          recipient: '',
                          phone: '',
                          address: '',
                          items: [],
                        };
                        setRecipientGroups(prev => [...prev, newGroup]);
                        setSelectedRecipientGroupId(newGroup.id);
                      }}
                      className="w-full rounded-xl border-2 border-dashed border-gray-300 bg-gray-50 p-6 text-center transition-all hover:border-blue-400 hover:bg-blue-50/30"
                    >
                      <svg className="mx-auto h-8 w-8 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 6v6m0 0v6m0-6h6m-6 0H6" />
                      </svg>
                      <p className="mt-2 text-sm font-medium text-gray-700">添加收件人</p>
                      <p className="mt-1 text-xs text-gray-500">可以添加多个收件人，每个收件人可以关联多个商品</p>
                    </button>

                    {/* 自动发布选项 */}
                    {recipientGroups.length > 0 && (
                      <div className="rounded-xl border border-gray-200 bg-white p-4 shadow-sm">
                        <label className="flex items-center gap-2 cursor-pointer">
                          <input
                            type="checkbox"
                            checked={autoPublish}
                            onChange={(e) => setAutoPublish(e.target.checked)}
                            className="h-4 w-4 rounded border-gray-300 text-blue-600 focus:ring-blue-500"
                          />
                          <div>
                            <span className="text-sm font-medium text-gray-700">创建后自动发布</span>
                            <p className="text-xs text-gray-500 mt-0.5">
                              创建后将自动发布询价单（最高限价为必填项）
                            </p>
                          </div>
                        </label>
                      </div>
                    )}
                  </div>
                )}

                {/* 关联订单卡片 */}
                <div className="rounded-xl border border-gray-200 bg-white p-6 shadow-sm">
                  <div className="mb-4 flex items-center gap-2">
                    <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-purple-100">
                      <svg className="h-5 w-5 text-purple-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2" />
                      </svg>
                    </div>
                    <h3 className="text-lg font-semibold text-gray-900">关联订单</h3>
                    <span className="rounded-full bg-gray-100 px-2 py-0.5 text-xs font-medium text-gray-600">可选</span>
                  </div>
                  <div className="max-h-40 space-y-2 overflow-y-auto rounded-lg border border-gray-200 bg-gray-50 p-3">
                    {orders.length > 0 ? (
                      orders.map((order) => (
                        <label key={order.id} className="flex items-center gap-2 rounded-md p-2 transition-colors hover:bg-white">
                          <input
                            type="checkbox"
                            checked={rfqForm.orderIds.includes(order.id)}
                            onChange={(e) => {
                              if (e.target.checked) {
                                setRfqForm({
                                  ...rfqForm,
                                  orderIds: [...rfqForm.orderIds, order.id],
                                });
                              } else {
                                setRfqForm({
                                  ...rfqForm,
                                  orderIds: rfqForm.orderIds.filter((id) => id !== order.id),
                                });
                              }
                            }}
                            className="rounded border-gray-300 text-blue-600 focus:ring-blue-500"
                          />
                          <span className="text-sm text-gray-700">
                            {order.orderNo} - {order.productName} (¥{order.price})
                          </span>
                        </label>
                      ))
                    ) : (
                      <p className="text-sm text-gray-500">暂无订单</p>
                    )}
                  </div>
                </div>

                </form>
              </div>

              {/* 操作按钮 - 固定在底部 */}
              <div className="flex-shrink-0 border-t border-gray-200 bg-white px-4 py-4 sm:px-6 sm:py-6">
                <div className="flex gap-3">
                  <button
                    type="button"
                    onClick={() => {
                      setShowCreateForm(false);
                      setCreateMode('manual');
                      setFile(null);
                      setParsedItems([]);
                      setRecipientGroups([]);
                      setSelectedRecipientGroupId(null);
                      setAutoPublish(true);
                      // STORE角色用户取消时保留storeId
                      const defaultStoreId = currentUser?.role === 'STORE' && currentUser?.storeId 
                        ? currentUser.storeId 
                        : '';
                      setRfqForm({
                        title: '',
                        description: '',
                        type: 'NORMAL',
                        deadline: '',
                        storeId: defaultStoreId,
                        orderIds: [],
                      });
                    }}
                    className="flex-1 rounded-lg border border-gray-300 bg-white px-6 py-3 text-sm font-semibold text-gray-700 shadow-sm transition-all hover:bg-gray-50 hover:shadow-md active:bg-gray-100"
                  >
                    取消
                  </button>
                  <button
                    type="submit"
                    form="create-rfq-form"
                    className="flex-1 rounded-lg bg-gradient-to-r from-blue-600 to-blue-700 px-6 py-3 text-sm font-semibold text-white shadow-sm transition-all hover:from-blue-700 hover:to-blue-800 hover:shadow-md active:scale-95"
                  >
                    <span className="flex items-center justify-center gap-2">
                      <svg className="h-5 w-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
                      </svg>
                      创建询价单
                    </span>
                  </button>
                </div>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

