'use client';

import { useEffect, useState, useRef } from 'react';
import { useRouter } from 'next/navigation';
import { authApi } from '@/lib/auth';
import api from '@/lib/api';

export default function NotificationsPage() {
  const router = useRouter();
  const [notifications, setNotifications] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const previousUnreadCountRef = useRef(0);
  const audioContextRef = useRef<AudioContext | null>(null);

  useEffect(() => {
    const user = authApi.getCurrentUser();
    if (!user) {
      router.push('/login');
      return;
    }

    // 初始化音频上下文
    try {
      audioContextRef.current = new (window.AudioContext || (window as any).webkitAudioContext)();
    } catch (error) {
      console.warn('音频上下文初始化失败:', error);
    }

    fetchNotifications();
    
    // 每30秒轮询一次新通知
    const interval = setInterval(fetchNotifications, 30000);
    
    return () => {
      clearInterval(interval);
      if (audioContextRef.current) {
        audioContextRef.current.close();
      }
    };
  }, [router]);

  const playNotificationSound = async () => {
    try {
      if (!audioContextRef.current) {
        audioContextRef.current = new (window.AudioContext || (window as any).webkitAudioContext)();
      }
      
      const audioContext = audioContextRef.current;
      
      // 如果音频上下文被暂停，尝试恢复
      if (audioContext.state === 'suspended') {
        await audioContext.resume();
      }
      
      // 播放两次提示音，更明显
      for (let i = 0; i < 2; i++) {
        setTimeout(() => {
          try {
            const oscillator = audioContext.createOscillator();
            const gainNode = audioContext.createGain();
            
            oscillator.connect(gainNode);
            gainNode.connect(audioContext.destination);
            
            oscillator.frequency.value = 800 + (i * 200); // 第一声800Hz，第二声1000Hz
            oscillator.type = 'sine';
            
            gainNode.gain.setValueAtTime(0.4, audioContext.currentTime);
            gainNode.gain.exponentialRampToValueAtTime(0.01, audioContext.currentTime + 0.2);
            
            oscillator.start(audioContext.currentTime);
            oscillator.stop(audioContext.currentTime + 0.2);
          } catch (error) {
            console.error('播放通知声音失败:', error);
          }
        }, i * 250); // 两次声音间隔250ms
      }
    } catch (error) {
      console.error('播放通知声音失败:', error);
    }
  };

  const fetchNotifications = async () => {
    try {
      const response = await api.get('/notifications');
      const notificationsData = response.data.data || response.data || [];
      const notificationsArray = Array.isArray(notificationsData) ? notificationsData : [];
      
      const unreadCount = notificationsArray.filter((n: any) => !n.read).length;
      
      // 检查是否有新通知
      if (unreadCount > previousUnreadCountRef.current && previousUnreadCountRef.current > 0) {
        // 有新通知，播放声音
        playNotificationSound();
      }
      
      previousUnreadCountRef.current = unreadCount;
      setNotifications(notificationsArray);
    } catch (error: any) {
      console.error('获取通知失败:', error);
      setNotifications([]);
    } finally {
      setLoading(false);
    }
  };

  const handleMarkAsRead = async (id: string) => {
    try {
      await api.patch(`/notifications/${id}/read`);
      setNotifications((prev) =>
        prev.map((n) => (n.id === id ? { ...n, read: true, readAt: new Date() } : n))
      );
    } catch (error: any) {
      console.error('标记通知为已读失败:', error);
    }
  };

  const handleMarkAllAsRead = async () => {
    try {
      await api.patch('/notifications/read-all');
      await fetchNotifications();
    } catch (error: any) {
      console.error('标记所有通知为已读失败:', error);
    }
  };

  const getTypeColor = (type: string) => {
    const typeMap: Record<string, { bg: string; text: string }> = {
      RFQ_UNQUOTED_ITEMS: { bg: 'bg-yellow-100', text: 'text-yellow-800' },
      RFQ_NO_QUOTES: { bg: 'bg-red-100', text: 'text-red-800' },
      QUOTE_AWARDED: { bg: 'bg-green-100', text: 'text-green-800' },
      RFQ_CLOSED: { bg: 'bg-blue-100', text: 'text-blue-800' },
      QUOTE_REMINDER: { bg: 'bg-orange-100', text: 'text-orange-800' },
      SYSTEM: { bg: 'bg-gray-100', text: 'text-gray-800' },
    };
    return typeMap[type] || { bg: 'bg-gray-100', text: 'text-gray-800' };
  };

  const getTypeText = (type: string) => {
    const typeMap: Record<string, string> = {
      RFQ_UNQUOTED_ITEMS: '未报价商品',
      RFQ_NO_QUOTES: '无报价',
      QUOTE_AWARDED: '报价中标',
      RFQ_CLOSED: '询价单关闭',
      QUOTE_REMINDER: '报价提醒',
      SYSTEM: '系统通知',
    };
    return typeMap[type] || type;
  };

  if (loading) {
    return (
      <div className="flex h-screen items-center justify-center">
        <div className="text-gray-600">加载中...</div>
      </div>
    );
  }

  const unreadCount = notifications.filter((n) => !n.read).length;

  return (
    <div className="min-h-screen bg-gray-50 p-6">
      <div className="mx-auto max-w-4xl">
        {/* 头部 */}
        <div className="mb-6 flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold text-gray-900">通知中心</h1>
            <p className="mt-1 text-sm text-gray-600">
              您有 {unreadCount} 条未读通知
            </p>
          </div>
          {unreadCount > 0 && (
            <button
              onClick={handleMarkAllAsRead}
              className="rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700"
            >
              全部标记为已读
            </button>
          )}
        </div>

        {/* 通知列表 */}
        {notifications.length === 0 ? (
          <div className="rounded-xl bg-white p-12 text-center shadow-sm">
            <div className="mx-auto mb-4 flex h-16 w-16 items-center justify-center rounded-full bg-gray-100">
              <svg className="h-8 w-8 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 17h5l-1.405-1.405A2.032 2.032 0 0118 14.158V11a6.002 6.002 0 00-4-5.659V5a2 2 0 10-4 0v.341C7.67 6.165 6 8.388 6 11v3.159c0 .538-.214 1.055-.595 1.436L4 17h5m6 0v1a3 3 0 11-6 0v-1m6 0H9" />
              </svg>
            </div>
            <h3 className="mb-2 text-lg font-semibold text-gray-900">暂无通知</h3>
            <p className="text-sm text-gray-500">您还没有收到任何通知</p>
          </div>
        ) : (
          <div className="space-y-3">
            {notifications.map((notification) => {
              const typeColor = getTypeColor(notification.type);
              return (
                <div
                  key={notification.id}
                  className={`rounded-xl bg-white p-4 shadow-sm transition-all hover:shadow-md ${
                    !notification.read ? 'border-l-4 border-blue-500' : ''
                  }`}
                >
                  <div className="flex items-start justify-between">
                    <div className="flex-1">
                      <div className="flex items-center gap-2">
                        <span className={`rounded-full px-2 py-1 text-xs font-semibold ${typeColor.bg} ${typeColor.text}`}>
                          {getTypeText(notification.type)}
                        </span>
                        {!notification.read && (
                          <span className="h-2 w-2 rounded-full bg-blue-500"></span>
                        )}
                        <span className="text-xs text-gray-500">
                          {new Date(notification.createdAt).toLocaleString('zh-CN')}
                        </span>
                      </div>
                      <h3 className="mt-2 font-semibold text-gray-900">{notification.title}</h3>
                      <p className="mt-1 text-sm text-gray-600 whitespace-pre-wrap">{notification.content}</p>
                      {notification.link && (
                        <div className="mt-3 flex gap-2">
                          <a
                            href={notification.link}
                            onClick={() => handleMarkAsRead(notification.id)}
                            className="inline-flex items-center gap-1 rounded-lg bg-blue-600 px-3 py-1.5 text-xs font-medium text-white transition-colors hover:bg-blue-700"
                          >
                            查看详情
                            <svg className="h-3 w-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
                            </svg>
                          </a>
                          {notification.type === 'AWARD_NOTIFICATION' && (
                            <>
                              <button
                                onClick={async () => {
                                  const awardId = new URL(notification.link, window.location.origin).searchParams.get('awardId');
                                  if (awardId) {
                                    if (confirm('确定要基于缺货商品重新创建询价单吗？')) {
                                      try {
                                        const response = await api.post(`/awards/${awardId}/recreate-rfq`, {});
                                        alert(`询价单已重新创建：${response.data.data?.rfqNo || response.data.rfqNo}`);
                                        await fetchNotifications();
                                      } catch (error: any) {
                                        alert(error.response?.data?.message || '重新创建失败');
                                      }
                                    }
                                  }
                                }}
                                className="inline-flex items-center gap-1 rounded-lg bg-green-600 px-3 py-1.5 text-xs font-medium text-white transition-colors hover:bg-green-700"
                              >
                                重新发询价单
                              </button>
                              <button
                                onClick={async () => {
                                  const awardId = new URL(notification.link, window.location.origin).searchParams.get('awardId');
                                  if (awardId) {
                                    if (confirm('确定要将缺货商品转为电商平台采购吗？')) {
                                      try {
                                        await api.post(`/awards/${awardId}/convert-to-ecommerce`, {});
                                        alert('已转为电商平台采购');
                                        await fetchNotifications();
                                      } catch (error: any) {
                                        alert(error.response?.data?.message || '转换失败');
                                      }
                                    }
                                  }
                                }}
                                className="inline-flex items-center gap-1 rounded-lg bg-orange-600 px-3 py-1.5 text-xs font-medium text-white transition-colors hover:bg-orange-700"
                              >
                                转为电商采购
                              </button>
                            </>
                          )}
                        </div>
                      )}
                    </div>
                    {!notification.read && (
                      <button
                        onClick={() => handleMarkAsRead(notification.id)}
                        className="ml-4 rounded-lg bg-gray-100 px-3 py-1 text-xs font-medium text-gray-700 hover:bg-gray-200"
                      >
                        标记已读
                      </button>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}

