'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { authApi } from '@/lib/auth';

export default function Home() {
  const router = useRouter();
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setMounted(true);
    // 确保只在客户端执行
    if (typeof window !== 'undefined') {
      try {
        const user = authApi.getCurrentUser();
        if (user) {
          router.push('/dashboard');
        } else {
          router.push('/login');
        }
      } catch (error) {
        console.error('Error checking user:', error);
        router.push('/login');
      }
    }
  }, [router]);

  // 加载状态组件（避免重复代码）
  const LoadingScreen = () => (
    <main className="flex min-h-screen flex-col items-center justify-center p-24">
      <div className="z-10 max-w-5xl w-full items-center justify-between font-mono text-sm">
        <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-gray-900 mx-auto"></div>
        <p className="mt-4 text-center">加载中...</p>
      </div>
    </main>
  );

  if (!mounted) {
    return <LoadingScreen />;
  }

  return <LoadingScreen />;
}

