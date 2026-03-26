/**
 * WS 通信封装模块（TS版）
 * 提供：前端 ↔ 服务端 ↔ Playwright 页面 双向通信能力
 */
import WebSocket, { WebSocketServer } from 'ws';
import type { Server } from 'http';
import type { Page } from 'playwright';
import type { 
  BaseWsMessage, 
  WsValidationResult, 
  PlaywrightCommand,
  UserActionMessage
} from '../types/record';

export class WsCommunication {
  private wss: WebSocketServer;
  private clientConnections: Set<WebSocket> = new Set(); // 改为支持多个客户端连接
  private playwrightPage: Page | null = null;
  private isPlaywrightFunctionsBound = false;
  private boundPage: Page | null = null;

  constructor(httpServer: Server) {
    this.wss = new WebSocketServer({ server: httpServer });
    this.initWsEvents();
  }

  /**
   * 初始化 WS 事件监听
   */
  private initWsEvents(): void {
    this.wss.on('connection', (ws) => {
      console.log('✅ 前端页面建立 WS 连接');
      this.clientConnections.add(ws); // 添加到连接集合

      ws.on('message', (message) => this.handleClientMessage(message.toString(), ws));
      
      ws.on('close', () => {
        console.log('❌ 前端 WS 连接关闭');
        this.clientConnections.delete(ws); // 从连接集合中移除
      });
      
      ws.on('error', (err) => {
        console.error('WS 连接错误:', err.message);
        this.clientConnections.delete(ws); // 从连接集合中移除
      });
    });
  }

  /**
   * 处理前端页面发来的消息
   */
  private handleClientMessage(message: string, ws: WebSocket): void {
    const { valid, data, error } = this.validateMessage(message);
    
    if (!valid) {
      this.sendToClient({ type: 'error', msg: error, timestamp: Date.now() } as any, ws);
      return;
    }

    if (!data) {
      this.sendToClient({ type: 'error', msg: '消息校验通过但数据为空', timestamp: Date.now() } as any, ws);
      return;
    }

    console.log('📥 接收前端消息:', JSON.stringify(data));
    
    // 处理心跳消息 - 只在服务器和前端之间处理，不转发给 Playwright
    if (data.type === 'ping') {
      // 响应 pong 心跳
      this.sendToClient({ type: 'pong', timestamp: Date.now() }, ws);
      return;
    }
    
    // 其他业务消息才转发给 Playwright 页面
    if (this.playwrightPage) {
      this.playwrightPage.evaluate((cmd) => {
        if (window.receiveFromServer) {
          return window.receiveFromServer(cmd);
        }
        return { status: 'failed', cmd };
      }, data as PlaywrightCommand).catch(err => {
        console.error('转发消息到 Playwright 失败:', err.message);
        this.sendToClient({ 
          type: 'error', 
          msg: `指令执行失败：${err.message}`,
          timestamp: Date.now()
        } as any, ws);
      });
    } else {
      // 对于非 Playwright 相关的消息（如状态查询等），直接响应
      if (data.type === 'ws-status' || data.type === 'user-action-monitor-status') {
        // 这些是查询状态的消息，不需要 Playwright 页面
        // 可以直接忽略或发送确认消息
        return;
      }
      
      this.sendToClient({ type: 'warning', msg: 'Playwright 页面未初始化', timestamp: Date.now() } as any, ws);
    }
  }

  /**
   * 校验消息格式（必须是 JSON）
   */
  public validateMessage(message: string): WsValidationResult {
    try {
      const parsedData = JSON.parse(message);
      
      // 基础类型校验
      if (!parsedData || typeof parsedData !== 'object' || !parsedData.type) {
        return { valid: false, error: '消息缺少必要的 type 字段' };
      }
      
      return { valid: true, data: parsedData };
    } catch (err) {
      const errorMsg = err instanceof Error ? err.message : '未知解析错误';
      return { valid: false, error: `消息格式错误，必须为 JSON：${errorMsg}` };
    }
  }

  /**
   * 向所有客户端发送消息
   */
  public sendToAllClients(message: BaseWsMessage): void {
    const messageStr = JSON.stringify(message);
    this.clientConnections.forEach((ws) => {
      if (ws.readyState === WebSocket.OPEN) {
        ws.send(messageStr);
      }
    });
  }

  /**
   * 向指定客户端发送消息
   */
  public sendToClient(message: BaseWsMessage, ws?: WebSocket): void {
    // 如果传入了具体的 ws 实例，则只发送给该客户端
    if (ws) {
      if (ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify(message));
      }
      return;
    }
    // 否则发送给所有客户端（兼容原有接口）
    this.sendToAllClients(message);
  }

  /**
   * 绑定 Playwright 页面（注入通信逻辑）
   */
  public async bindPlaywrightPage(page: Page): Promise<void> {
    if (!page) {
      throw new Error('Playwright 页面实例不能为空');
    }

    if (this.isPlaywrightFunctionsBound && this.boundPage === page) {
      console.log('⚠️ Playwright 页面已绑定，跳过重复绑定');
      return;
    }

    this.playwrightPage = page;
    this.boundPage = page;
    this.isPlaywrightFunctionsBound = false;

    // 1. 暴露：Playwright 页面 → 服务端 通信函数
    await page.exposeFunction('sendToServer', (data: UserActionMessage | BaseWsMessage) => {
      console.log('📤 Playwright 页面发送消息:', JSON.stringify(data));
      this.sendToAllClients({
        type: 'playwright-message',
        payload: data,
        timestamp: Date.now()
      } as any);
    });

    // 2. 暴露：服务端 → Playwright 页面 指令接收函数
    await page.exposeFunction('receiveFromServer', async (data: PlaywrightCommand) => {
      console.log('📥 服务端 → Playwright 页面:', JSON.stringify(data));
      try {
        return await page.evaluate((cmd: PlaywrightCommand) => {
          // 如果全局有 receiveFromServer 则调用，否则直接执行内置逻辑
          if ((window as any).internalReceiveFromServer) {
             return (window as any).internalReceiveFromServer(cmd);
          }
          
          switch (cmd.type) {
            case 'alert':
              alert(`📢 来自前端指令：${cmd.msg || ''}`);
              break;
            case 'click':
              if (cmd.selector) {
                const element = document.querySelector(cmd.selector);
                if (element && typeof (element as HTMLElement).click === 'function') {
                  (element as HTMLElement).click();
                }
              }
              break;
            case 'set-value':
              if (cmd.selector && cmd.value) {
                const el = document.querySelector(cmd.selector);
                if (el && 'value' in el) {
                  (el as HTMLInputElement).value = cmd.value;
                }
              }
              break;
            case 'scroll':
              window.scrollTo({ 
                top: cmd.top || 0, 
                behavior: 'smooth' 
              });
              break;
            case 'monitor-set-pick-mode': {
              (window as any).__recordStepPickMode = !!cmd.enabled;
              break;
            }
            default:
              console.log('未知指令:', cmd);
          }
          return { status: 'success', cmd };
        }, data);
      } catch (err) {
        console.error('执行 Playwright 指令失败:', err);
        throw err;
      }
    });

    this.isPlaywrightFunctionsBound = true;
    console.log('✅ Playwright 页面已绑定 WS 通信');
  }

  /**
   * 清理资源（服务关闭时调用）
   */
  public cleanup(): void {
    this.clientConnections.forEach(ws => {
      if (ws.readyState === WebSocket.OPEN) {
        ws.close();
      }
    });
    this.wss.close();
    console.log('✅ WS 服务已清理');
  }
}

/**
 * 快捷创建 WS 通信实例
 */
export function createWsServer(httpServer: Server): WsCommunication {
  return new WsCommunication(httpServer);
}