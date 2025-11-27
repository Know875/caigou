/**
 * RFQ 模块 API 响应类型定义
 */

import { RfqStatus, RfqType } from '@prisma/client';

/**
 * 询价单列表项
 */
export interface RfqListItem {
  id: string;
  rfqNo: string;
  title: string;
  description?: string | null;
  type: RfqType;
  status: RfqStatus;
  deadline: Date;
  createdAt: Date;
  updatedAt: Date;
  buyerId: string;
  storeId: string;
  store?: {
    id: string;
    name: string;
    code: string;
  } | null;
  buyer?: {
    id: string;
    username: string;
    email: string;
  } | null;
  items?: Array<{
    id: string;
    productName: string;
    quantity: number;
    unit?: string | null;
    maxPrice?: number | null;
  }>;
  quotes?: Array<{
    id: string;
    status: string;
    supplier?: {
      id: string;
      username: string;
    } | null;
  }>;
  quoteCount?: number;
}

/**
 * 未报价商品项
 */
export interface UnquotedItem {
  rfqId: string;
  rfqNo: string;
  rfqTitle: string;
  itemId: string;
  productName: string;
  quantity: number;
  unit: string | null;
  description: string | null;
  deadline: Date;
  trackingNo?: string | null;
  carrier?: string | null;
  costPrice?: number | null;
  orderNo?: string;
  orderTime?: Date;
  userNickname?: string;
  openid?: string;
  recipient?: string;
  phone?: string;
  address?: string;
  modifiedAddress?: string;
  orderPrice?: number;
  points?: number;
  orderStatus?: string;
  storeId?: string;
  storeName?: string;
  shippedAt?: Date | null;
  orders?: Array<{
    orderNo: string;
    orderTime: Date;
    userNickname?: string | null;
    openid: string;
    recipient: string;
    phone: string;
    address: string;
    modifiedAddress?: string | null;
    productName: string;
    price: number;
    points: number;
    status: string;
    storeId?: string;
    storeName?: string;
    shippedAt?: Date | null;
  }>;
}

/**
 * 询价单查询过滤器
 */
export interface RfqFindAllFilters {
  status?: string;
  type?: string;
  buyerId?: string;
  storeId?: string;
  includeExpired?: boolean;
}

