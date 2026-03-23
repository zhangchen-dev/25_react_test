/**
 * 全局类型定义
 */
import type { Page } from 'playwright';
import type { WebSocket } from 'ws';

// ========== WS 消息相关类型 ==========
export type WsMessageType = 
  | 'playwright-message' 
  | 'user-action' 
  | 'alert' 
  | 'warning' 
  | 'error' 
  | 'validation-error' 
  | 'server-notify';

export interface BaseWsMessage {
  type: WsMessageType;
  timestamp?: number;
}

// 前端 → 服务端 → Playwright 指令
export interface PlaywrightCommand extends BaseWsMessage {
  type: 'alert' | 'click' | 'set-value' | 'scroll';
  msg?: string;
  selector?: string;
  value?: string;
  top?: number;
}

// Playwright → 服务端 → 前端 操作消息
export interface UserActionMessage extends BaseWsMessage {
  type: 'user-action';
  data: UserActionData;
}

// 用户操作数据结构
export interface UserActionData {
  actionType: UserActionType;
  timestamp: number;
  url: string;
  pageTitle: string;
  target?: ActionTarget;
  scrollPosition?: ScrollPosition;
  key?: string;
  keyCode?: number;
  isCtrl?: boolean;
  isShift?: boolean;
  isAlt?: boolean;
}

// 操作类型
export type UserActionType = 
  | 'click' 
  | 'dblclick' 
  | 'contextmenu' 
  | 'input' 
  | 'change' 
  | 'scroll' 
  | 'keydown' 
  | 'mousemove';

// 元素目标信息
export interface ActionTarget {
  tagName: string;
  id: string;
  className?: string;
  name?: string;
  text?: string;
  value?: string;
  checked?: boolean;
  xpath: string;
  position?: { x: number; y: number };
}

// 滚动位置
export interface ScrollPosition {
  x: number;
  y: number;
  maxX: number;
  maxY: number;
}

// 操作验证结果
export interface ActionJudgeResult {
  isValid: boolean;
  message: string;
  actionType: UserActionType;
}

// ========== 配置类型 ==========
export interface MonitorOptions {
  ignoreEvents?: UserActionType[];
  debounceTime?: number;
}

// ========== WS 服务类型 ==========
export interface WsValidationResult {
  valid: boolean;
  data?: BaseWsMessage | PlaywrightCommand | UserActionMessage;
  error?: string;
}

// ========== 全局扩展 ==========
declare global {
  interface Window {
    sendToServer: (data: UserActionMessage | BaseWsMessage) => void;
    receiveFromServer: (data: PlaywrightCommand) => Promise<{ status: string; cmd: PlaywrightCommand }>;
  }
}