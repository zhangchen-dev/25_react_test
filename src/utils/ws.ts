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
  private clientConnection: WebSocket | null = null;
  private playwrightPage: Page | null = null;

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
      this.clientConnection = ws;

      ws.on('message', (message) => this.handleClientMessage(message.toString()));
      
      ws.on('close', () => {
        console.log('❌ 前端 WS 连接关闭');
        this.clientConnection = null;
      });
      
      ws.on('error', (err) => {
        console.error('WS 连接错误:', err.message);
        this.clientConnection = null;
      });
    });
  }

  /**
   * 处理前端页面发来的消息
   */
  private handleClientMessage(message: string): void {
    const { valid, data, error } = this.validateMessage(message);
    
    if (!valid) {
      this.sendToClient({ type: 'error', msg: error });
      return;
    }

    console.log('📥 接收前端消息:', JSON.stringify(data));
    
    // 中转消息到 Playwright 页面
    if (this.playwrightPage && typeof window !== 'undefined') {
      this.playwrightPage.evaluate((cmd) => {
        if (window.receiveFromServer) {
          return window.receiveFromServer(cmd);
        }
        return { status: 'failed', cmd };
      }, data).catch(err => {
        console.error('转发消息到 Playwright 失败:', err.message);
        this.sendToClient({ 
          type: 'error', 
          msg: `指令执行失败：${err.message}` 
        });
      });
    } else {
      this.sendToClient({ type: 'warning', msg: 'Playwright 页面未初始化' });
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
   * 发送消息给前端页面
   */
  public sendToClient(data: BaseWsMessage & { msg?: string; payload?: unknown }): boolean {
    if (!this.clientConnection || this.clientConnection.readyState !== WebSocket.OPEN) {
      console.warn('⚠️ 前端 WS 连接未建立，消息发送失败');
      return false;
    }
    
    try {
      const sendData = {
        ...data,
        timestamp: data.timestamp || Date.now()
      };
      this.clientConnection.send(JSON.stringify(sendData));
      return true;
    } catch (err) {
      const errorMsg = err instanceof Error ? err.message : '未知发送错误';
      console.error('发送消息给前端失败:', errorMsg);
      return false;
    }
  }

  /**
   * 绑定 Playwright 页面（注入通信逻辑）
   */
  public async bindPlaywrightPage(page: Page): Promise<void> {
    if (!page) {
      throw new Error('Playwright 页面实例不能为空');
    }
    this.playwrightPage = page;

    // 1. 暴露：Playwright 页面 → 服务端 通信函数
    await page.exposeFunction('sendToServer', (data: UserActionMessage | BaseWsMessage) => {
      console.log('📤 Playwright 页面发送消息:', JSON.stringify(data));
      this.sendToClient({
        type: 'playwright-message',
        payload: data,
        timestamp: Date.now()
      });
    });

    // 2. 暴露：服务端 → Playwright 页面 指令接收函数
    await page.exposeFunction('receiveFromServer', async (data: PlaywrightCommand) => {
      console.log('📥 服务端 → Playwright 页面:', JSON.stringify(data));
      return page.evaluate((cmd: PlaywrightCommand) => {
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
          default:
            console.log('未知指令:', cmd);
        }
        return { status: 'success', cmd };
      }, data);
    });

    console.log('✅ Playwright 页面已绑定 WS 通信');
  }

  /**
   * 清理资源（服务关闭时调用）
   */
  public cleanup(): void {
    if (this.clientConnection) {
      this.clientConnection.close();
    }
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