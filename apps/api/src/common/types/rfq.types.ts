/**
 * RFQ 相关类型定义
 */

export type RfqStatus = 'DRAFT' | 'PUBLISHED' | 'CLOSED' | 'AWARDED';
export type RfqItemStatus = 'PENDING' | 'QUOTED' | 'AWARDED' | 'CANCELLED';
export type ShipmentStatus = 'PENDING' | 'SHIPPED' | 'IN_TRANSIT' | 'DELIVERED' | 'RECEIVED';
export type OrderSource = 'SUPPLIER' | 'ECOMMERCE';

/**
 * RFQ 查询条件
 */
export interface RfqWhereCondition {
  status?: RfqStatus;
  type?: string;
  buyerId?: string;
  storeId?: string;
  deadline?: {
    gt?: Date;
    lt?: Date;
    gte?: Date;
    lte?: Date;
  };
  AND?: RfqWhereCondition[];
  OR?: RfqWhereCondition[];
}

/**
 * 电商采购查询条件
 */
export interface EcommerceWhereCondition {
  source: OrderSource;
  trackingNo?: {
    not: null;
  };
  updatedAt?: {
    gte?: Date;
    lte?: Date;
  };
  rfq?: {
    storeId?: string;
  };
}

