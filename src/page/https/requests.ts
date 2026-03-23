/**
 * 接口请求相关函数
 */

const API_BASE_URL = "http://localhost:3001";

// 统一的请求处理函数
async function handleRequest<T>(url: string, options: RequestInit): Promise<T> {
  try {
    const response = await fetch(url, options);
    
    // 检查 HTTP 状态码
    if (!response.ok) {
      throw new Error(`HTTP error! status: ${response.status}`);
    }
    
    const result: { body: T; status: number; msg: string } = await response.json();
    
    // 检查业务状态码
    if (result.status >= 200 && result.status < 300) {
      return result.body as T;
    } else {
      throw new Error(result.msg || `Request failed with status: ${result.status}`);
    }
  } catch (error) {
    console.error("API request error:", error);
    throw error;
  }
}

// 调用后端接口打开有头浏览器（用于第二模块）
export const openBrowser = (fullUrl: string) =>
  handleRequest<{ url: string }>(`${API_BASE_URL}/open-guide-page`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      targetUrl: fullUrl,
    }),
  });

// 启动录制
export const startRecord = (targetUrl: string, clearExisting: boolean = true, duration?: number) =>
  handleRequest<{ id: string; pid: number; script: string }>(`${API_BASE_URL}/start-record`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      targetUrl,
      clearExisting,
      duration,
    }),
  });

// 停止录制
export const stopRecord = () =>
  handleRequest<{ id: string }>(`${API_BASE_URL}/stop-record`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({}),
  });

// 查询录制状态
export const getRecordStatus = () =>
  handleRequest<Array<{
    id: string;
    pid?: number;
    targetUrl?: string;
    startedAt?: string;
    exitCode?: number;
    exitedAt?: string;
  }>>(`${API_BASE_URL}/record-status`, {
    method: "GET",
    headers: { "Content-Type": "application/json" },
  });