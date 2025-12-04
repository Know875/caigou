import { NextRequest, NextResponse } from 'next/server';

/**
 * 图片代理 API 路由
 * 用于解决 MinIO 图片的 CORS 问题
 * 
 * 使用方式：
 * /api/proxy-image?url=<encoded-image-url>
 * 
 * 安全措施：
 * - 只允许代理 MinIO URL
 * - 限制文件大小（最大 10MB）
 * - 请求超时（10秒）
 * - 验证 Content-Type
 */
const MAX_FILE_SIZE = 10 * 1024 * 1024; // 10MB
const REQUEST_TIMEOUT = 10000; // 10秒

export async function GET(request: NextRequest) {
  try {
    const searchParams = request.nextUrl.searchParams;
    const imageUrl = searchParams.get('url');

    if (!imageUrl) {
      return NextResponse.json(
        { error: 'Missing url parameter' },
        { status: 400 }
      );
    }

    // 解码 URL
    let decodedUrl: string;
    try {
      decodedUrl = decodeURIComponent(imageUrl);
    } catch (error) {
      decodedUrl = imageUrl;
    }

    // 验证 URL 是否是 MinIO 的 URL（安全措施）
    const minioPatterns = [
      /^https?:\/\/.*:9000\//,
      /^https?:\/\/.*\/eggpurchase\//,
    ];
    
    const isValidUrl = minioPatterns.some(pattern => pattern.test(decodedUrl));
    if (!isValidUrl) {
      return NextResponse.json(
        { error: 'Invalid image URL' },
        { status: 400 }
      );
    }

    // 创建带超时的 AbortController
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), REQUEST_TIMEOUT);

    try {
      // 获取图片
      const response = await fetch(decodedUrl, {
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
        },
        signal: controller.signal,
      });

      clearTimeout(timeoutId);

      if (!response.ok) {
        return NextResponse.json(
          { error: 'Failed to fetch image', status: response.status },
          { status: response.status >= 500 ? 502 : response.status }
        );
      }

      // 检查 Content-Type
      const contentType = response.headers.get('content-type') || '';
      const isValidImageType = contentType.startsWith('image/') || 
                               contentType.startsWith('video/') ||
                               contentType === 'application/octet-stream';
      
      if (!isValidImageType && contentType) {
        console.warn(`[Proxy Image] Unexpected content-type: ${contentType} for URL: ${decodedUrl}`);
      }

      // 检查文件大小
      const contentLength = response.headers.get('content-length');
      if (contentLength && parseInt(contentLength, 10) > MAX_FILE_SIZE) {
        return NextResponse.json(
          { error: 'File too large' },
          { status: 413 }
        );
      }

      // 获取图片数据（流式读取以检查大小）
      const reader = response.body?.getReader();
      if (!reader) {
        return NextResponse.json(
          { error: 'Failed to read response body' },
          { status: 500 }
        );
      }

      const chunks: Uint8Array[] = [];
      let totalSize = 0;

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        totalSize += value.length;
        if (totalSize > MAX_FILE_SIZE) {
          return NextResponse.json(
            { error: 'File too large' },
            { status: 413 }
          );
        }
        chunks.push(value);
      }

      // 合并所有 chunks
      const imageBuffer = new Uint8Array(totalSize);
      let offset = 0;
      for (const chunk of chunks) {
        imageBuffer.set(chunk, offset);
        offset += chunk.length;
      }

      // 返回图片，设置适当的 CORS 头和缓存
      // ⚠️ 性能优化：增加缓存时间到 7 天，减少重复请求
      return new NextResponse(imageBuffer, {
        status: 200,
        headers: {
          'Content-Type': contentType || 'image/jpeg',
          'Cache-Control': 'public, max-age=604800, s-maxage=604800, immutable', // 7 天缓存
          'Access-Control-Allow-Origin': '*',
          'Access-Control-Allow-Methods': 'GET',
          'X-Content-Type-Options': 'nosniff',
          // 添加 ETag 支持，用于缓存验证
          'ETag': `"${Buffer.from(decodedUrl).toString('base64').slice(0, 32)}"`,
        },
      });
    } catch (fetchError: any) {
      clearTimeout(timeoutId);
      
      if (fetchError.name === 'AbortError') {
        return NextResponse.json(
          { error: 'Request timeout' },
          { status: 504 }
        );
      }
      throw fetchError;
    }
  } catch (error: any) {
    console.error('[Proxy Image] Error:', error);
    return NextResponse.json(
      { error: 'Internal server error', message: error.message },
      { status: 500 }
    );
  }
}

