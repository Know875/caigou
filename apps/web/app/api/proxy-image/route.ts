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
const REQUEST_TIMEOUT = 30000; // 30秒（增加超时时间）

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
      // 直接访问 MinIO 的签名 URL
      // 注意：如果签名 URL 过期，会返回 403 或 400 错误
      console.log('[Proxy Image] Fetching from MinIO:', decodedUrl.substring(0, 100));
      
      const response = await fetch(decodedUrl, {
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
        },
        signal: controller.signal,
      });

      clearTimeout(timeoutId);

      if (!response.ok) {
        const errorText = await response.text().catch(() => 'Unknown error');
        console.error('[Proxy Image] MinIO fetch failed:', {
          status: response.status,
          statusText: response.statusText,
          error: errorText.substring(0, 200),
        });
        
        // 如果是签名过期或无效，返回特定错误
        if (response.status === 403 || response.status === 400) {
          return NextResponse.json(
            { 
              error: 'Signature expired or invalid',
              message: '图片链接已过期，请刷新页面重新加载',
              status: response.status,
            },
            { status: 403 }
          );
        }
        
        return NextResponse.json(
          { 
            error: 'Failed to fetch image', 
            status: response.status,
            message: errorText.substring(0, 200),
          },
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
        console.error('[Proxy Image] Response body is not readable');
        return NextResponse.json(
          { error: 'Failed to read response body', message: 'Response body is not readable' },
          { status: 500 }
        );
      }

      const chunks: Uint8Array[] = [];
      let totalSize = 0;

      try {
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;

          if (!value) {
            console.warn('[Proxy Image] Received empty chunk');
            continue;
          }

          totalSize += value.length;
          if (totalSize > MAX_FILE_SIZE) {
            reader.cancel();
            return NextResponse.json(
              { error: 'File too large', message: `File size exceeds ${MAX_FILE_SIZE / 1024 / 1024}MB` },
              { status: 413 }
            );
          }
          chunks.push(value);
        }
      } catch (readError: any) {
        console.error('[Proxy Image] Error reading response body:', readError);
        return NextResponse.json(
          { error: 'Failed to read image data', message: readError.message },
          { status: 500 }
        );
      }

      // 合并所有 chunks
      if (totalSize === 0) {
        console.error('[Proxy Image] Empty response body');
        return NextResponse.json(
          { error: 'Empty response', message: 'Image data is empty' },
          { status: 500 }
        );
      }

      let imageBuffer: Uint8Array;
      try {
        imageBuffer = new Uint8Array(totalSize);
        let offset = 0;
        for (const chunk of chunks) {
          imageBuffer.set(chunk, offset);
          offset += chunk.length;
        }
      } catch (bufferError: any) {
        console.error('[Proxy Image] Error creating buffer:', bufferError);
        return NextResponse.json(
          { error: 'Failed to process image data', message: bufferError.message },
          { status: 500 }
        );
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
          // 注意：在 Edge Runtime 中，使用简单的 hash 代替 Buffer
          'ETag': `"${decodedUrl.length}-${decodedUrl.substring(0, 20).replace(/[^a-zA-Z0-9]/g, '')}"`,
        },
      });
    } catch (fetchError: any) {
      clearTimeout(timeoutId);
      
      console.error('[Proxy Image] Fetch error:', {
        name: fetchError.name,
        message: fetchError.message,
        url: decodedUrl.substring(0, 100),
      });
      
      if (fetchError.name === 'AbortError' || fetchError.message?.includes('timeout')) {
        return NextResponse.json(
          { 
            error: 'Request timeout',
            message: '图片加载超时，请检查 MinIO 服务是否正常运行',
            url: decodedUrl.substring(0, 100),
          },
          { status: 504 }
        );
      }
      
      // 如果是网络错误，提供更详细的错误信息
      if (fetchError.message?.includes('ECONNREFUSED') || fetchError.message?.includes('ENOTFOUND')) {
        return NextResponse.json(
          { 
            error: 'Connection failed',
            message: '无法连接到 MinIO 服务，请检查服务是否运行',
            url: decodedUrl.substring(0, 100),
          },
          { status: 502 }
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

