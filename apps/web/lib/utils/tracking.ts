/**
 * 前端快递单号相关工具函数
 */

/**
 * 获取快递查询链接
 */
export async function getTrackingUrl(trackingNo: string, carrier?: string): Promise<string> {
  try {
    const params = new URLSearchParams();
    params.append('trackingNo', trackingNo);
    if (carrier) {
      params.append('carrier', carrier);
    }
    
    const response = await fetch(`/api/tracking/carrier-url?${params.toString()}`);
    const data = await response.json();
    return data.data?.url || data.url || `https://www.baidu.com/s?ie=utf-8&wd=${encodeURIComponent(trackingNo)}`;
  } catch (error) {
    // 如果获取失败，使用百度查询
    return `https://www.baidu.com/s?ie=utf-8&wd=${encodeURIComponent(trackingNo)}`;
  }
}

/**
 * 检测是否为顺丰单号
 */
export function isShunfengTracking(trackingNo: string, carrier?: string): boolean {
  if (!trackingNo) return false;
  const upperNo = trackingNo.toUpperCase();
  return upperNo.startsWith('SF') || carrier === '顺丰' || carrier === 'shunfeng';
}

