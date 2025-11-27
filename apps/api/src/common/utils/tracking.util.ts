/**
 * 快递单号相关工具函数
 */

/**
 * 检测快递公司
 */
export function detectCarrier(trackingNo: string): string {
  if (!trackingNo) return 'unknown';
  
  const upper = trackingNo.toUpperCase();
  
  // 顺丰
  if (upper.startsWith('SF')) return 'shunfeng';
  
  // 圆通
  if (upper.startsWith('YT') || upper.startsWith('YTO')) return 'yuantong';
  
  // 中通
  if (upper.startsWith('ZTO') || upper.startsWith('ZT')) return 'zhongtong';
  
  // 申通
  if (upper.startsWith('STO') || upper.startsWith('ST')) return 'shentong';
  
  // 韵达
  if (upper.startsWith('YD') || upper.startsWith('YUNDA')) return 'yunda';
  
  // 百世
  if (upper.startsWith('HTKY') || upper.startsWith('HT')) return 'huitong';
  
  // 德邦
  if (upper.startsWith('DBL') || upper.startsWith('DB')) return 'debang';
  
  // 京东
  if (upper.startsWith('JD') || upper.startsWith('JDX')) return 'jingdong';
  
  return 'unknown';
}

/**
 * 获取快递公司中文名称
 */
export function getCarrierName(carrier: string): string {
  const carrierMap: Record<string, string> = {
    shunfeng: '顺丰',
    yuantong: '圆通',
    zhongtong: '中通',
    shentong: '申通',
    yunda: '韵达',
    huitong: '百世',
    debang: '德邦',
    jingdong: '京东',
  };
  
  return carrierMap[carrier.toLowerCase()] || carrier || '未知';
}

/**
 * 生成快递公司官网查询链接
 */
export function getCarrierQueryUrl(trackingNo: string, carrier?: string): string | null {
  if (!trackingNo) return null;
  
  const upperNo = trackingNo.toUpperCase();
  const detectedCarrier = carrier || detectCarrier(trackingNo);

  // 顺丰：直接跳转到官网
  if (detectedCarrier === 'shunfeng' || upperNo.startsWith('SF')) {
    return `https://www.sf-express.com/chn/sc/waybill/waybill-detail/${trackingNo}`;
  }

  // 其他快递公司也可以添加对应的官网链接
  // 圆通：https://www.yto.net.cn/gw/index/query
  // 中通：https://www.zto.com/express/expressQuery
  // 申通：https://www.sto.cn/querybill
  // 韵达：https://www.yundaex.com/query/

  // 如果没有对应的官网链接，返回null，使用百度查询
  return null;
}

/**
 * 生成百度查询链接
 */
export function getBaiduQueryUrl(trackingNo: string): string {
  return `https://www.baidu.com/s?ie=utf-8&wd=${encodeURIComponent(trackingNo)}`;
}

/**
 * 获取快递查询链接（优先官网，否则百度）
 */
export function getTrackingQueryUrl(trackingNo: string, carrier?: string): string {
  const carrierUrl = getCarrierQueryUrl(trackingNo, carrier);
  return carrierUrl || getBaiduQueryUrl(trackingNo);
}

