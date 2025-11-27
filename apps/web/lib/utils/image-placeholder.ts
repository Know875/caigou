/**
 * 图片占位符工具
 */

/**
 * 图片加载失败时的占位符 SVG（Base64 编码）
 * 显示"图片加载失败"文本
 */
export const IMAGE_PLACEHOLDER_SVG = 'data:image/svg+xml;base64,PHN2ZyB3aWR0aD0iMjAwIiBoZWlnaHQ9IjIwMCIgeG1sbnM9Imh0dHA6Ly93d3cudzMub3JnLzIwMDAvc3ZnIj48cmVjdCB3aWR0aD0iMjAwIiBoZWlnaHQ9IjIwMCIgZmlsbD0iI2YzZjRmNiIvPjx0ZXh0IHg9IjUwJSIgeT0iNTAlIiBmb250LWZhbWlseT0iQXJpYWwiIGZvbnQtc2l6ZT0iMTQiIGZpbGw9IiM5Y2EzYWYiIHRleHQtYW5jaG9yPSJtaWRkbGUiIGR5PSIuM2VtIj7lm77niYfliqDovb3lpLHotKU8L3RleHQ+PC9zdmc+';

/**
 * 处理图片加载错误，设置占位符
 */
export function handleImageError(e: React.SyntheticEvent<HTMLImageElement, Event>): void {
  const target = e.target as HTMLImageElement;
  target.src = IMAGE_PLACEHOLDER_SVG;
}

/**
 * 处理视频加载错误
 */
export function handleVideoError(e: React.SyntheticEvent<HTMLVideoElement, Event>): void {
  const target = e.target as HTMLVideoElement;
  console.error('视频加载失败:', target.src);
  // 视频加载失败时，可以设置一个占位图片或者隐藏视频元素
  // 这里我们只是记录错误，不设置占位符（因为 video 元素不支持 src 设置为图片）
}

