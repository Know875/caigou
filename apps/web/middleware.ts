import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';

export function middleware(request: NextRequest) {
  // 检查是否是登录页面或 API 路由
  if (request.nextUrl.pathname.startsWith('/api') || request.nextUrl.pathname === '/login') {
    return NextResponse.next();
  }

  // 这里可以添加更多的认证逻辑
  // 例如检查 token 等

  return NextResponse.next();
}

export const config = {
  matcher: ['/((?!_next/static|_next/image|favicon.ico).*)'],
};

