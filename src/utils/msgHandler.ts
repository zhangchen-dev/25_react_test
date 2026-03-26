/**
 * WebSocket 消息处理器
 * 专门处理从 Playwright 页面通过 WebSocket 发送的操作信息
 */

import type { UserActionMessage, BaseWsMessage, PlaywrightCommand } from '../types/record';

// 消息类型常量对象，避免魔法字符串
export const WsMessageTypes = {
  PLAYWRIGHT_MESSAGE: 'playwright-message',
  USER_ACTION: 'user-action',
  WS_STATUS: 'ws-status',
  USER_ACTION_MONITOR_STATUS: 'user-action-monitor-status',
  PING: 'ping',
  PONG: 'pong',
} as const;

// 消息处理器回调类型定义
export type MessageHandlerCallback = (message: UserActionMessage | BaseWsMessage) => void;

// 主题回调映射类型
type TopicCallbacks = Map<string, Set<MessageHandlerCallback>>;

// 全局消息处理器实例
class WsMessageHandler {
  private static instance: WsMessageHandler;
  private topicCallbacks: TopicCallbacks = new Map(); // 按主题存储回调
  private ws: WebSocket | null = null;
  private reconnectAttempts = 0;
  private maxReconnectAttempts = 10;
  private reconnectDelay = 1000;
  private heartbeatInterval: number | null = null;
  private heartbeatTimeout: number | null = null;
  // 调整心跳间隔为 45 秒，超时时间为 15 秒，避免过于频繁
  private heartbeatIntervalMs = 45000; // 45秒发送一次心跳
  private heartbeatTimeoutMs = 15000; // 15秒内未收到 pong 则认为连接异常
  private isClosing = false; // 标记是否正在关闭

  private constructor() {}

  public static getInstance(): WsMessageHandler {
    if (!WsMessageHandler.instance) {
      WsMessageHandler.instance = new WsMessageHandler();
    }
    return WsMessageHandler.instance;
  }

  /**
   * 初始化 WebSocket 连接（支持复用）
   */
  public initWebSocket(url: string = 'ws://localhost:3001'): void {
    // 如果正在关闭过程中，不进行重连
    if (this.isClosing) {
      return;
    }
    
    // 如果连接已存在且正常，直接返回
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      console.log('WebSocket 连接已存在，复用现有连接');
      return;
    }

    // 清理之前的连接资源
    this.cleanupConnection();
    
    try {
      this.ws = new WebSocket(url);
      
      this.ws.onopen = () => {
        console.log('✅ WebSocket 连接已建立');
        this.reconnectAttempts = 0;
        this.startHeartbeat();
        this.isClosing = false;
      };

      this.ws.onmessage = (event) => {
        try {
          const message = JSON.parse(event.data);
          console.log('📥 接收到 WebSocket 消息:', message);
          
          if (message.type === 'pong') {
            this.resetHeartbeatTimeout();
            return;
          }
          
          this.handleMessage(message);
        } catch (error) {
          console.error('❌ WebSocket 消息解析失败:', error);
        }
      };

      this.ws.onclose = () => {
        console.log('❌ WebSocket 连接已关闭');
        this.cleanupConnection();
        if (!this.isClosing) {
          this.attemptReconnect(url);
        }
      };

      this.ws.onerror = (error) => {
        console.error('❌ WebSocket 连接错误:', error);
        this.cleanupConnection();
        if (!this.isClosing) {
          this.attemptReconnect(url);
        }
      };
    } catch (error) {
      console.error('❌ WebSocket 连接初始化失败:', error);
      this.cleanupConnection();
      if (!this.isClosing) {
        this.attemptReconnect(url);
      }
    }
  }

  /**
   * 清理连接相关资源
   */
  private cleanupConnection(): void {
    this.stopHeartbeat();
    this.clearReconnectTimer();
  }

  /**
   * 清理重连定时器
   */
  private clearReconnectTimer(): void {
    // 注意：这里假设重连是通过 setTimeout 实现的
    // 由于 JavaScript 的限制，我们无法直接取消 setTimeout
    // 但可以通过标志位来避免重复重连
  }

  /**
   * 启动心跳机制
   */
  private startHeartbeat(): void {
    this.stopHeartbeat(); // 确保没有重复的心跳
    
    // 定期发送 ping 消息
    this.heartbeatInterval = window.setInterval(() => {
      // 确保连接仍然处于 OPEN 状态
      if (this.ws && this.ws.readyState === WebSocket.OPEN) {
        try {
          this.ws.send(JSON.stringify({ type: 'ping', timestamp: Date.now() }));
          console.log('💓 发送心跳 ping');
          
          // 设置心跳超时检测
          this.heartbeatTimeout = window.setTimeout(() => {
            console.warn('⚠️ 心跳超时，连接可能已断开');
            if (this.ws && this.ws.readyState === WebSocket.OPEN) {
              this.ws.close();
            }
          }, this.heartbeatTimeoutMs);
        } catch (error) {
          console.error('❌ 心跳发送失败:', error);
          this.stopHeartbeat();
        }
      } else {
        // 连接已关闭，停止心跳
        this.stopHeartbeat();
      }
    }, this.heartbeatIntervalMs);
  }

  /**
   * 停止心跳机制
   */
  private stopHeartbeat(): void {
    if (this.heartbeatInterval !== null) {
      clearInterval(this.heartbeatInterval);
      this.heartbeatInterval = null;
    }
    if (this.heartbeatTimeout !== null) {
      clearTimeout(this.heartbeatTimeout);
      this.heartbeatTimeout = null;
    }
  }

  /**
   * 重置心跳超时计时器
   */
  private resetHeartbeatTimeout(): void {
    if (this.heartbeatTimeout !== null) {
      clearTimeout(this.heartbeatTimeout);
      this.heartbeatTimeout = null;
    }
  }

  /**
   * 尝试重新连接 WebSocket
   */
  private attemptReconnect(url: string): void {
    // 如果已经达到最大重试次数，停止重试
    if (this.reconnectAttempts >= this.maxReconnectAttempts) {
      console.error('❌ WebSocket 连接重试次数已达上限，停止重试');
      return;
    }
    
    // 如果已经在重连过程中，避免重复重连
    if (this.reconnectAttempts > 0) {
      return;
    }

    this.reconnectAttempts++;
    const delay = this.reconnectDelay * Math.min(this.reconnectAttempts, 5); // 最大5倍延迟（5秒）
    
    console.log(`🔄 尝试重新连接 WebSocket (第 ${this.reconnectAttempts} 次，延迟 ${delay}ms)...`);
    
    setTimeout(() => {
      // 只有在没有活动连接的情况下才重试
      if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
        this.initWebSocket(url);
      }
    }, delay);
  }

  /**
   * 处理接收到的消息（分发到对应主题的回调）
   */
  private handleMessage(message: UserActionMessage | BaseWsMessage): void {
    // 遍历所有注册的主题回调
    this.topicCallbacks.forEach((callbacks, topic) => {
      // 根据主题过滤消息（这里简化为主题名匹配消息类型）
      // 实际可以根据更复杂的规则进行路由
      callbacks.forEach((callback: MessageHandlerCallback) => {
        try {
          callback(message);
        } catch (error) {
          console.error('❌ 消息回调处理错误:', error);
        }
      });
    });
  }

  /**
   * 注册指定主题的消息处理回调
   */
  public onMessageForTopic(topic: string, callback: MessageHandlerCallback): void {
    if (!this.topicCallbacks.has(topic)) {
      this.topicCallbacks.set(topic, new Set());
    }
    this.topicCallbacks.get(topic)!.add(callback);
  }

  /**
   * 取消指定主题的回调
   */
  public offMessageForTopic(topic: string, callback: MessageHandlerCallback): void {
    if (this.topicCallbacks.has(topic)) {
      this.topicCallbacks.get(topic)!.delete(callback);
      // 如果该主题没有回调了，清理主题
      if (this.topicCallbacks.get(topic)!.size === 0) {
        this.topicCallbacks.delete(topic);
      }
    }
  }

  /**
   * 注册全局消息处理回调（兼容旧接口）
   */
  public onMessage(callback: MessageHandlerCallback): void {
    this.onMessageForTopic('global', callback);
  }

  /**
   * 发送消息到 WebSocket 服务器
   */
  public sendMessage(message: BaseWsMessage | PlaywrightCommand): boolean {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
      console.warn('⚠️ WebSocket 连接未建立，无法发送消息');
      return false;
    }

    try {
      this.ws.send(JSON.stringify(message));
      return true;
    } catch (error) {
      console.error('❌ WebSocket 消息发送失败:', error);
      return false;
    }
  }

  /**
   * 获取当前连接状态
   */
  public isConnected(): boolean {
    return this.ws !== null && this.ws.readyState === WebSocket.OPEN;
  }

  /**
   * 关闭 WebSocket 连接（用于结束录制等场景）
   */
  public close(force: boolean = false): void {
    this.isClosing = true;
    this.cleanupConnection();
    
    if (this.ws) {
      // 浏览器环境中的 WebSocket 没有 terminate 方法，只使用 close
      this.ws.close();
      this.ws = null;
    }
    
    // 清空所有回调
    this.topicCallbacks.clear();
  }
}

// 导出单例实例
export const wsMessageHandler = WsMessageHandler.getInstance();

// 便捷函数：初始化 WebSocket 并注册回调
export const initWsMessageHandler = (callback: MessageHandlerCallback, url?: string): void => {
  wsMessageHandler.onMessage(callback);
  wsMessageHandler.initWebSocket(url);
};

// 新增：按主题初始化 WebSocket 并注册回调
export const initWsMessageHandlerForTopic = (topic: string, callback: MessageHandlerCallback, url?: string): void => {
  wsMessageHandler.onMessageForTopic(topic, callback);
  wsMessageHandler.initWebSocket(url);
};

// 便捷函数：发送消息
export const sendWsMessage = (message: BaseWsMessage | PlaywrightCommand): boolean => {
  return wsMessageHandler.sendMessage(message);
};

// 便捷函数：获取连接状态
export const isWsConnected = (): boolean => {
  return wsMessageHandler.isConnected();
};

// 新增：关闭 WebSocket 连接
export const closeWsConnection = (force: boolean = false): void => {
  wsMessageHandler.close(force);
};