'use client';

import { useState, useEffect } from 'react';
import api from '@/lib/api';

interface TrackingNumberLinkProps {
  trackingNo: string;
  carrier?: string;
  className?: string;
}

export default function TrackingNumberLink({ trackingNo, carrier, className = '' }: TrackingNumberLinkProps) {
  const [showMenu, setShowMenu] = useState(false);
  const [copied, setCopied] = useState(false);
  const [trackingUrl, setTrackingUrl] = useState<string>('');

  // 预加载跟踪链接
  useEffect(() => {
    const loadTrackingUrl = async () => {
      try {
        const params = new URLSearchParams();
        params.append('trackingNo', trackingNo);
        if (carrier) {
          params.append('carrier', carrier);
        }
        const response = await api.get(`/tracking/carrier-url?${params.toString()}`);
        const data = response.data.data || response.data;
        setTrackingUrl(data.url);
      } catch (error: any) {
        setTrackingUrl(`https://www.baidu.com/s?ie=utf-8&wd=${encodeURIComponent(trackingNo)}`);
      }
    };
    loadTrackingUrl();
  }, [trackingNo, carrier]);

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(trackingNo);
      setCopied(true);
      setTimeout(() => {
        setCopied(false);
        setShowMenu(false);
      }, 2000);
    } catch (err) {
      // 降级方案：使用传统方法
      const textArea = document.createElement('textarea');
      textArea.value = trackingNo;
      textArea.style.position = 'fixed';
      textArea.style.opacity = '0';
      document.body.appendChild(textArea);
      textArea.select();
      try {
        document.execCommand('copy');
        setCopied(true);
        setTimeout(() => {
          setCopied(false);
          setShowMenu(false);
        }, 2000);
      } catch (e) {
        alert('复制失败，请手动复制：' + trackingNo);
      }
      document.body.removeChild(textArea);
    }
  };

  // 使用 <a> 标签作为主要链接，这样浏览器更可能允许
  // 如果弹窗被阻止，浏览器会自动在当前窗口打开
  const handleLinkClick = (e: React.MouseEvent<HTMLAnchorElement>) => {
    // 如果用户按住 Ctrl/Cmd 或中键点击，让浏览器默认行为处理
    if (e.ctrlKey || e.metaKey || e.button === 1) {
      return;
    }
    
    // 普通点击：尝试在新标签页打开
    e.preventDefault();
    if (trackingUrl) {
      // 尝试打开新标签页，如果被阻止则使用当前窗口
      const newWindow = window.open(trackingUrl, '_blank');
      if (!newWindow || newWindow.closed || typeof newWindow.closed === 'undefined') {
        // 弹窗被阻止，使用当前窗口打开
        window.location.href = trackingUrl;
      }
    }
  };

  return (
    <div className="relative inline-flex items-center gap-1">
      {/* 主要链接 - 使用 <a> 标签，移动端友好 */}
      <a
        href={trackingUrl || '#'}
        onClick={handleLinkClick}
        target="_blank"
        rel="noopener noreferrer"
        className={`font-medium text-blue-600 hover:text-blue-800 hover:underline ${className}`}
      >
        {trackingNo}
      </a>
      
      {/* 复制按钮 - 移动端友好的图标按钮 */}
      <button
        onClick={(e) => {
          e.stopPropagation();
          handleCopy();
        }}
        className="inline-flex items-center justify-center rounded p-1 text-gray-500 hover:bg-gray-100 hover:text-gray-700 focus:outline-none"
        title={copied ? '已复制' : '复制单号'}
      >
        {copied ? (
          <svg className="h-4 w-4 text-green-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
          </svg>
        ) : (
          <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z" />
          </svg>
        )}
      </button>
    </div>
  );
}

