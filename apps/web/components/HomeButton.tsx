'use client';

import { useRouter, usePathname } from 'next/navigation';
import { useEffect, useState } from 'react';
import { authApi } from '@/lib/auth';

export default function HomeButton() {
  const router = useRouter();
  const pathname = usePathname();
  const [mounted, setMounted] = useState(false);
  
  useEffect(() => {
    setMounted(true);
  }, []);
  
  // 在首页、登录页、注册页不显示返回首页按钮
  const hiddenPaths = ['/', '/login', '/register-supplier', '/register-store'];
  if (!mounted || hiddenPaths.includes(pathname)) {
    return null;
  }

  const handleGoHome = () => {
    const user = authApi.getCurrentUser();
    if (user) {
      router.push('/dashboard');
    } else {
      router.push('/login');
    }
  };

  return (
    <button
      onClick={handleGoHome}
      className="fixed bottom-6 right-6 z-50 flex items-center gap-2 rounded-full bg-blue-600 px-4 py-3 text-sm font-medium text-white shadow-lg transition-all hover:bg-blue-700 hover:shadow-xl focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2"
      title="返回首页"
      style={{ zIndex: 9999 }}
    >
      <svg className="h-5 w-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 12l2-2m0 0l7-7 7 7M5 10v10a1 1 0 001 1h3m10-11l2 2m-2-2v10a1 1 0 01-1 1h-3m-6 0a1 1 0 001-1v-4a1 1 0 011-1h2a1 1 0 011 1v4a1 1 0 001 1m-6 0h6" />
      </svg>
      <span className="hidden sm:inline">返回首页</span>
    </button>
  );
}

