/**
 * 前端类型定义
 */

export type RfqStatus = 'DRAFT' | 'PUBLISHED' | 'CLOSED' | 'AWARDED' | 'CANCELLED';
export type RfqType = 'AUCTION' | 'FIXED_PRICE' | 'NORMAL';
export type RfqItemStatus = 'PENDING' | 'QUOTED' | 'AWARDED' | 'OUT_OF_STOCK' | 'CANCELLED' | 'SHIPPED' | 'ECOMMERCE_PENDING' | 'ECOMMERCE_PAID' | 'ECOMMERCE_SHIPPED';
export type OrderStatus = 'PENDING' | 'RFQ_CREATED' | 'QUOTED' | 'AWARDED' | 'SHIPPED' | 'DELIVERED' | 'COMPLETED' | 'CANCELLED';
export type OrderSource = 'SUPPLIER' | 'ECOMMERCE';
export type StoreStatus = 'ACTIVE' | 'INACTIVE';

export interface Store {
  id: string;
  name: string;
  code: string;
  address?: string;
  contact?: string;
  status: StoreStatus;
  createdAt: string;
  updatedAt: string;
}

export interface Order {
  id: string;
  orderNo: string;
  orderTime: string;
  openid: string;
  recipient: string;
  phone: string;
  address: string;
  productName: string;
  price: string | number;
  points: number;
  status: OrderStatus;
  storeId?: string;
  buyerId?: string;
  createdAt: string;
  updatedAt: string;
  modifiedAddress?: string;
  shippedAt?: string;
  userNickname?: string;
  source: OrderSource;
  store?: Store;
}

export interface RfqItem {
  id: string;
  rfqId: string;
  productName: string;
  quantity: number;
  unit: string;
  description?: string;
  notes?: string;
  maxPrice?: string | number;
  instantPrice?: string | number;
  costPrice?: string | number;
  itemStatus: RfqItemStatus;
  carrier?: string;
  trackingNo?: string;
  orderNo?: string;
  exceptionReason?: string;
  exceptionAt?: string;
  createdAt: string;
  updatedAt: string;
}

export interface Rfq {
  id: string;
  rfqNo: string;
  title: string;
  description?: string;
  type: RfqType;
  status: RfqStatus;
  deadline: string;
  closeTime?: string;
  storeId?: string;
  buyerId: string;
  createdAt: string;
  updatedAt: string;
  items?: RfqItem[];
  store?: Store;
  buyer?: {
    id: string;
    email: string;
    username?: string;
  };
  quotes?: Quote[];
  quoteCount?: number;
}

export interface ParsedItem {
  productName: string;
  quantity: number;
  unit: string;
  description?: string;
  notes?: string;
}

export type QuoteStatus = 'PENDING' | 'SUBMITTED' | 'WITHDRAWN' | 'AWARDED' | 'REJECTED';
export type AwardStatus = 'ACTIVE' | 'CANCELLED' | 'OUT_OF_STOCK';

export interface QuoteItem {
  id: string;
  quoteId: string;
  rfqItemId: string;
  price: string | number;
  deliveryDays: number;
  notes?: string;
  createdAt: string;
  updatedAt: string;
  quoteStatus?: QuoteStatus;
  supplier?: {
    id: string;
    username?: string;
    email: string;
  };
  rfqItem?: {
    id: string;
    productName: string;
  };
  supplierId?: string;
}

export interface Quote {
  id: string;
  rfqId: string;
  supplierId: string;
  price: string | number;
  deliveryDays: number;
  notes?: string;
  status: QuoteStatus;
  submittedAt: string;
  createdAt: string;
  updatedAt: string;
  items?: QuoteItem[];
  supplier?: {
    id: string;
    username?: string;
    email: string;
  };
}

export interface Shipment {
  id: string;
  shipmentNo: string;
  awardId: string;
  rfqItemId?: string;
  trackingNo?: string;
  carrier?: string;
  status: string;
  shippedAt?: string;
  deliveredAt?: string;
  createdAt: string;
  updatedAt: string;
  packages?: Array<{
    id: string;
    packageNo: string;
    photos?: string[];
    labelUrl?: string;
  }>;
}

export interface Award {
  id: string;
  rfqId: string;
  quoteId: string;
  supplierId: string;
  finalPrice: string | number;
  reason?: string;
  awardedAt: string;
  createdAt: string;
  paymentQrCode?: string;
  paymentQrCodeUrl?: string;
  updatedAt: string;
  cancellationReason?: string;
  cancelledAt?: string;
  cancelledBy?: string;
  status?: AwardStatus;
  quote?: Quote;
  shipments?: Shipment[];
  supplier?: {
    id: string;
    username?: string;
    email: string;
  };
}

export interface UnquotedItemOrder {
  orderNo: string;
  orderTime: string;
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
  shippedAt?: string | null;
}

export interface UnquotedItem {
  rfqId: string;
  rfqNo: string;
  rfqTitle: string;
  itemId: string;
  productName: string;
  quantity: number;
  unit: string | null;
  description: string | null;
  deadline: string;
  trackingNo?: string | null;
  carrier?: string | null;
  costPrice?: number | null;
  orderNo?: string;
  orderTime?: string;
  userNickname?: string;
  openid?: string;
  recipient?: string;
  phone?: string;
  address?: string;
  modifiedAddress?: string;
  orderPrice?: number;
  points?: number;
  orderStatus?: string;
  status?: 'COMPLETED' | 'SHIPPED' | 'AWARDED' | 'PENDING';
  value?: number;
  storeId?: string;
  storeName?: string;
  shippedAt?: string;
  orders?: UnquotedItemOrder[];
}

