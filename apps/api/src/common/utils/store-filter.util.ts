/**
 * 数据过滤工具函数
 * 用于确保门店用户只能访问自己门店的数据
 */

export interface UserWithStore {
  id: string;
  role: string;
  storeId?: string | null;
}

/**
 * 根据用户角色和门店ID过滤查询条件
 * @param user 当前用户
 * @param storeIdField 门店ID字段名（默认为 'storeId'）
 * @returns 过滤条件对象，如果用户是门店角色，则添加门店ID过滤
 */
export function getStoreFilter(
  user: UserWithStore,
  storeIdField: string = 'storeId',
): Record<string, any> {
  // 管理员和采购员可以查看所有数据
  if (user.role === 'ADMIN' || user.role === 'BUYER') {
    return {};
  }

  // 门店用户只能查看自己门店的数据
  if (user.role === 'STORE' && user.storeId) {
    return {
      [storeIdField]: user.storeId,
    };
  }

  // 供应商和其他角色不限制（供应商查看自己的报价等）
  return {};
}

/**
 * 检查用户是否有权限访问指定门店的数据
 * @param user 当前用户
 * @param storeId 要访问的门店ID
 * @returns 是否有权限
 */
export function canAccessStore(user: UserWithStore, storeId: string | null | undefined): boolean {
  // 管理员和采购员可以访问所有门店
  if (user.role === 'ADMIN' || user.role === 'BUYER') {
    return true;
  }

  // 门店用户只能访问自己的门店
  if (user.role === 'STORE') {
    return user.storeId === storeId;
  }

  // 其他角色默认不允许访问门店数据
  return false;
}

