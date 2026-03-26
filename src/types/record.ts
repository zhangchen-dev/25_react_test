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
  // 下发给 Playwright 的指令（由前端 -> 服务端 -> Playwright）
  | 'click'
  | 'set-value'
  | 'scroll'
  | 'monitor-set-pick-mode'
  | 'warning' 
  | 'error' 
  | 'validation-error' 
  | 'server-notify'
  | 'user-action-monitor-status'
  | 'ws-status'
  | 'ping'
  | 'pong';

export interface BaseWsMessage {
  type: WsMessageType;
  timestamp?: number;
}

// 错误和警告消息类型
export interface ErrorMessage extends BaseWsMessage {
  type: 'error' | 'warning' | 'validation-error' | 'server-notify';
  msg: string;
}

// Playwright 页面消息类型
export interface PlaywrightPageMessage extends BaseWsMessage {
  type: 'playwright-message';
  payload: any;
}

// 前端 → 服务端 → Playwright 指令
export interface PlaywrightCommand extends BaseWsMessage {
  type: 'alert' | 'click' | 'set-value' | 'scroll' | 'monitor-set-pick-mode';
  msg?: string;
  selector?: string;
  value?: string;
  top?: number;
  enabled?: boolean;
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
  // 当前版本用于“拾取当前步骤”：用于生成 elementDom
  outerHTML?: string;
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