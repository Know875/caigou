import api from './api';

export interface LoginRequest {
  email: string;
  password: string;
}

export interface LoginResponse {
  access_token?: string;
  user: {
    id: string;
    email: string;
    username: string;
    role: string;
    storeId?: string;
  };
  store?: {
    id: string;
    name: string;
    code: string;
  };
  requiresApproval?: boolean;
  message?: string;
}

export interface RegisterStoreRequest {
  email: string;
  username: string;
  password: string;
  storeName: string;
  storeCode: string;
  address?: string;
  contact?: string;
}

export interface RegisterSupplierRequest {
  email: string;
  username: string;
  password: string;
  companyName?: string;
  contact?: string;
  address?: string;
}

export const authApi = {
  login: async (data: LoginRequest): Promise<LoginResponse> => {
    // console.log('=== AuthAPI 鐧诲綍寮€濮?===');
    // console.log('[AuthAPI] 閭:', data.email);
    // console.log('[AuthAPI] 瀵嗙爜闀垮害:', data.password?.length || 0);
    
    try {
      // console.log('[AuthAPI] 璋冪敤 api.post...');
      const response = await api.post('/auth/login', data);
      // console.log('[AuthAPI] 鏀跺埌鍝嶅簲锛岀姸鎬佺爜:', response.status);
      // console.log('[AuthAPI] 鐧诲綍鍝嶅簲瀹屾暣鏁版嵁:', {
      //   status: response.status,
      //   statusText: response.statusText,
      //   headers: response.headers,
      //   data: response.data,
      // });
      
      // 澶勭悊鍝嶅簲鏍煎紡锛氬彲鑳芥槸 { success: true, data: { access_token, user } } 鎴?{ access_token, user }
      let responseData: any;
      if (response.data.success && response.data.data) {
        // TransformInterceptor 鏍煎紡锛歿 success: true, data: { access_token, user } }
        responseData = response.data.data;
      } else if (response.data.access_token) {
        // 鐩存帴鏍煎紡锛歿 access_token, user }
        responseData = response.data;
      } else {
        // 鍏朵粬鏍煎紡锛屽皾璇曠洿鎺ヤ娇鐢?
        responseData = response.data;
      }
      
      // console.log('[AuthAPI] 瑙ｆ瀽鍚庣殑鍝嶅簲鏁版嵁:', responseData);
      
      if (typeof window !== 'undefined') {
        if (responseData.access_token) {
          localStorage.setItem('token', responseData.access_token);
          localStorage.setItem('user', JSON.stringify(responseData.user));
          // console.log('[AuthAPI] Token 宸蹭繚瀛樺埌 localStorage');
        } else {
          console.error('[AuthAPI] 鍝嶅簲涓病鏈?access_token:', responseData);
          throw new Error('鐧诲綍鍝嶅簲涓病鏈?access_token');
        }
      }
      return responseData;
    } catch (error: any) {
      console.error('[AuthAPI] 鐧诲綍璇锋眰澶辫触:', {
        message: error.message,
        code: error.code,
        status: error.response?.status,
        statusText: error.response?.statusText,
        responseData: error.response?.data,
        responseHeaders: error.response?.headers,
        attemptedUrl: error.config ? `${error.config.baseURL}${error.config.url}` : 'unknown',
        requestData: error.config?.data,
      });
      throw error;
    }
  },

  logout: () => {
    if (typeof window !== 'undefined') {
      localStorage.removeItem('token');
      localStorage.removeItem('user');
      window.location.href = '/login';
    }
  },

  getCurrentUser: () => {
    if (typeof window !== 'undefined') {
      const userStr = localStorage.getItem('user');
      return userStr ? JSON.parse(userStr) : null;
    }
    return null;
  },

  getToken: () => {
    if (typeof window !== 'undefined') {
      return localStorage.getItem('token');
    }
    return null;
  },

  registerStore: async (data: RegisterStoreRequest): Promise<LoginResponse> => {
    // console.log('[AuthAPI] 闂ㄥ簵娉ㄥ唽寮€濮?', { email: data.email, storeName: data.storeName });
    
    try {
      const response = await api.post('/auth/register-store', data);
      
      // 澶勭悊鍝嶅簲鏍煎紡
      let responseData: any;
      if (response.data.success && response.data.data) {
        responseData = response.data.data;
      } else {
        responseData = response.data;
      }
      
      // console.log('[AuthAPI] 闂ㄥ簵娉ㄥ唽鎴愬姛:', responseData);
      
      // 濡傛灉闇€瑕佸鏍革紝涓嶄繚瀛?token
      if (!responseData.requiresApproval && typeof window !== 'undefined') {
        if (responseData.access_token) {
          localStorage.setItem('token', responseData.access_token);
          localStorage.setItem('user', JSON.stringify(responseData.user));
          // console.log('[AuthAPI] Token 宸蹭繚瀛樺埌 localStorage');
        } else {
          console.error('[AuthAPI] 鍝嶅簲涓病鏈?access_token:', responseData);
          // 濡傛灉闇€瑕佸鏍革紝杩欐槸姝ｅ父鐨勶紝涓嶆姏鍑洪敊璇?
          if (!responseData.requiresApproval) {
            throw new Error('娉ㄥ唽鍝嶅簲涓病鏈?access_token');
          }
        }
      }
      
      return responseData;
    } catch (error: any) {
      console.error('[AuthAPI] 闂ㄥ簵娉ㄥ唽澶辫触:', {
        message: error.message,
        code: error.code,
        status: error.response?.status,
        responseData: error.response?.data,
      });
      throw error;
    }
  },

  registerSupplier: async (data: RegisterSupplierRequest): Promise<LoginResponse> => {
    // console.log('[AuthAPI] 渚涘簲鍟嗘敞鍐屽紑濮?', { email: data.email, username: data.username });
    
    try {
      const response = await api.post('/auth/register-supplier', data);
      
      // 澶勭悊鍝嶅簲鏍煎紡
      let responseData: any;
      if (response.data.success && response.data.data) {
        responseData = response.data.data;
      } else {
        responseData = response.data;
      }
      
      // console.log('[AuthAPI] 渚涘簲鍟嗘敞鍐屾垚鍔?', responseData);
      
      // 濡傛灉闇€瑕佸鏍革紝涓嶄繚瀛?token
      if (!responseData.requiresApproval && typeof window !== 'undefined') {
        if (responseData.access_token) {
          localStorage.setItem('token', responseData.access_token);
          localStorage.setItem('user', JSON.stringify(responseData.user));
          // console.log('[AuthAPI] Token 宸蹭繚瀛樺埌 localStorage');
        } else {
          console.error('[AuthAPI] 鍝嶅簲涓病鏈?access_token:', responseData);
          // 濡傛灉闇€瑕佸鏍革紝杩欐槸姝ｅ父鐨勶紝涓嶆姏鍑洪敊璇?
          if (!responseData.requiresApproval) {
            throw new Error('娉ㄥ唽鍝嶅簲涓病鏈?access_token');
          }
        }
      }
      
      return responseData;
    } catch (error: any) {
      console.error('[AuthAPI] 渚涘簲鍟嗘敞鍐屽け璐?', {
        message: error.message,
        code: error.code,
        status: error.response?.status,
        responseData: error.response?.data,
      });
      throw error;
    }
  },
};

