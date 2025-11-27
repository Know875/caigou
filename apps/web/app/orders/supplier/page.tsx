'use client';

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';

export default function SupplierOrdersPage() {
  const router = useRouter();

  useEffect(() => {
    // 重定向到发货管理页面的库存订单标签
    router.replace('/shipments/supplier?tab=orders');
  }, [router]);

  return (
    <div className="flex min-h-screen items-center justify-center bg-gray-50">
      <div className="text-center">
        <div className="mx-auto h-12 w-12 animate-spin rounded-full border-4 border-blue-600 border-t-transparent"></div>
        <p className="mt-4 text-gray-600">正在跳转...</p>
      </div>
    </div>
  );
}
