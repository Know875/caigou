'use client';

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { authApi } from '@/lib/auth';

export default function OrdersPage() {
  const router = useRouter();

  useEffect(() => {
    const user = authApi.getCurrentUser();
    if (!user) {
      router.push('/login');
      return;
    }

    // 重定向到发货管理页面（已合并）
    router.replace('/shipments?tab=orders');
  }, [router]);

  return null;
}

