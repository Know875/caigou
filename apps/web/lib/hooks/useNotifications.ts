import { useEffect, useState, useRef, useCallback } from 'react';
import api from '@/lib/api';

export function useNotifications(): {
  notifications: any[];
  unreadCount: number;
  isBlinking: boolean;
  fetchNotifications: () => Promise<void>;
  stopBlinking: () => void;
} {
  const [notifications, setNotifications] = useState<any[]>([]);
  const [unreadCount, setUnreadCount] = useState(0);
  const [isBlinking, setIsBlinking] = useState(false);
  const previousUnreadCountRef = useRef(0);
  const audioContextRef = useRef<AudioContext | null>(null);
  const blinkTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const userInteractedRef = useRef(false);

  // 监听用户交互，解锁音频上下文
  useEffect(() => {
    const unlockAudio = async () => {
      if (userInteractedRef.current) return;
      
      try {
        if (!audioContextRef.current) {
          audioContextRef.current = new (window.AudioContext || (window as any).webkitAudioContext)();
        }
        
        // 尝试恢复音频上下文（如果被暂停）
        if (audioContextRef.current.state === 'suspended') {
          await audioContextRef.current.resume();
        }
        
        // 播放一个静音的短音频来解锁
        const oscillator = audioContextRef.current.createOscillator();
        const gainNode = audioContextRef.current.createGain();
        gainNode.gain.setValueAtTime(0, audioContextRef.current.currentTime);
        oscillator.connect(gainNode);
        gainNode.connect(audioContextRef.current.destination);
        oscillator.start();
        oscillator.stop(audioContextRef.current.currentTime + 0.01);
        
        userInteractedRef.current = true;
        // console.log('✅ 音频上下文已解锁');
      } catch (error) {
        console.warn('解锁音频上下文失败:', error);
      }
    };

    // 监听用户交互事件
    const events = ['click', 'touchstart', 'keydown'];
    events.forEach(event => {
      document.addEventListener(event, unlockAudio, { once: true });
    });

    return () => {
      events.forEach(event => {
        document.removeEventListener(event, unlockAudio);
      });
    };
  }, []);

  const playNotificationSound = useCallback(async () => {
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
  }, []);

  const startBlinking = useCallback(() => {
    setIsBlinking(true);
    
    // 清除之前的定时器
    if (blinkTimeoutRef.current) {
      clearTimeout(blinkTimeoutRef.current);
    }
    
    // 10秒后停止闪烁（更长的提醒时间）
    blinkTimeoutRef.current = setTimeout(() => {
      setIsBlinking(false);
    }, 10000);
  }, []);

  const stopBlinking = useCallback(() => {
    setIsBlinking(false);
    if (blinkTimeoutRef.current) {
      clearTimeout(blinkTimeoutRef.current);
    }
  }, []);

  const fetchNotifications = useCallback(async () => {
    try {
      const response = await api.get('/notifications');
      const notificationsData = response.data.data || response.data || [];
      const notificationsArray = Array.isArray(notificationsData) ? notificationsData : [];
      
      setNotifications(notificationsArray);
      const unread = notificationsArray.filter((n: any) => !n.read).length;
      setUnreadCount(unread);

      // 检查是否有新通知
      if (unread > previousUnreadCountRef.current && previousUnreadCountRef.current > 0) {
        // 有新通知，播放声音并开始闪烁
        playNotificationSound();
        startBlinking();
      }

      previousUnreadCountRef.current = unread;
    } catch (error: any) {
      console.error('获取通知失败:', error);
    }
  }, [playNotificationSound, startBlinking]);

  // 页面标题闪烁提醒
  useEffect(() => {
    if (isBlinking && unreadCount > 0) {
      let titleBlink = true;
      const titleInterval = setInterval(() => {
        document.title = titleBlink 
          ? `【${unreadCount}条新通知】模型玩具采购协同系统`
          : '模型玩具采购协同系统';
        titleBlink = !titleBlink;
      }, 1000);

      return () => {
        clearInterval(titleInterval);
        document.title = '模型玩具采购协同系统';
      };
    } else {
      document.title = unreadCount > 0 
        ? `(${unreadCount}) 模型玩具采购协同系统`
        : '模型玩具采购协同系统';
    }
  }, [isBlinking, unreadCount]);

  useEffect(() => {
    fetchNotifications();
    
    // 每5秒轮询一次新通知（实时更新）
    const interval = setInterval(fetchNotifications, 5000);
    
    return () => {
      clearInterval(interval);
      if (blinkTimeoutRef.current) {
        clearTimeout(blinkTimeoutRef.current);
      }
    };
  }, [fetchNotifications]);

  return {
    notifications,
    unreadCount,
    isBlinking,
    fetchNotifications,
    stopBlinking,
  };
}
