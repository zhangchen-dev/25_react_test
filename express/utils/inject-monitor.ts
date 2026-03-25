import { Page } from 'playwright';

export interface MonitorOptions {
  ignoreEvents?: string[];
  debounceTime?: number;
}

export interface UserActionData {
  actionType: string;
  timestamp: number;
  url: string;
  pageTitle: string;
  target?: {
    tagName: string;
    id: string;
    className: string;
    text?: string;
    xpath: string;
    position?: {
      x: number;
      y: number;
    };
    value?: string;
    name?: string;
    checked?: boolean;
  };
  scrollPosition?: {
    x: number;
    y: number;
    maxX: number;
    maxY: number;
  };
  key?: string;
  keyCode?: number;
  isCtrl?: boolean;
  isShift?: boolean;
  isAlt?: boolean;
}

export interface UserActionMessage {
  type: 'user-action';
  data: UserActionData;
}

declare global {
  interface Window {
    sendToServer: (data: UserActionMessage) => void;
  }
}

// 注入用户操作监控的函数
export const injectUserActionMonitor = async (page: Page, options?: MonitorOptions) => {
  const { ignoreEvents = ["mousemove"], debounceTime = 200 } = options || {};
  
  await page.evaluate(({ ignoreEvents, debounceTime }) => {
    // ========== 工具函数：防抖 ==========
    const debounce = <T extends (...args: unknown[]) => void>(fn: T, delay: number): ((...args: Parameters<T>) => void) => {
      let timer: NodeJS.Timeout | null = null;
      return (...args: Parameters<T>) => {
        if (timer) clearTimeout(timer);
        timer = setTimeout(() => fn(...args), delay);
      };
    };

    // ========== 工具函数：生成元素唯一 XPath ==========
    const getElementXPath = (element: Element): string => {
      if (!element || element.nodeType !== 1) return "";
      let path = "";

      for (let el: Element | null = element; el && el.nodeType === 1; el = el.parentElement) {
        let count = 0;
        let sibling = el.previousElementSibling;

        while (sibling) {
          if (sibling.tagName === el.tagName) count++;
          sibling = sibling.previousElementSibling;
        }

        const tagName = el.tagName.toLowerCase();
        const index = count > 0 ? `[${count + 1}]` : "";
        path = `/${tagName}${index}${path}`;
      }

      return path;
    };

    // ========== 工具函数：格式化事件数据 ==========
    const formatEventData = (eventType: string, event: Event): UserActionData => {
      const baseData = {
        actionType: eventType,
        timestamp: Date.now(),
        url: window.location.href,
        pageTitle: document.title,
      };

      const mouseEvent = event as MouseEvent;
      const keyboardEvent = event as KeyboardEvent;
      const inputEvent = event as InputEvent;
      const changeEvent = event as Event;
      const target = event.target as HTMLElement;

      switch (eventType) {
        case "click":
        case "dblclick":
        case "contextmenu":
          return {
            ...baseData,
            target: {
              tagName: target.tagName.toLowerCase(),
              id: target.id,
              className: target.className || '',
              text: target.textContent?.trim().substring(0, 100) || "",
              xpath: getElementXPath(target),
              position: {
                x: mouseEvent.clientX,
                y: mouseEvent.clientY,
              },
            },
          };

        case "input":
          const inputTarget = target as HTMLInputElement;
          return {
            ...baseData,
            target: {
              tagName: inputTarget.tagName.toLowerCase(),
              id: inputTarget.id,
              className: inputTarget.className || '',
              name: inputTarget.name || '',
              value: inputTarget.value.substring(0, 200),
              xpath: getElementXPath(inputTarget),
            },
          };

        case "change":
          const changeTarget = target as HTMLInputElement | HTMLSelectElement;
          return {
            ...baseData,
            target: {
              tagName: changeTarget.tagName.toLowerCase(),
              id: changeTarget.id,
              className: changeTarget.className || '',
              name: changeTarget.name || '',
              value: changeTarget.value,
              checked: "checked" in changeTarget ? changeTarget.checked : undefined,
              xpath: getElementXPath(changeTarget),
            },
          };

        case "scroll":
          return {
            ...baseData,
            scrollPosition: {
              x: window.scrollX,
              y: window.scrollY,
              maxX: document.body.scrollWidth,
              maxY: document.body.scrollHeight,
            },
          };

        case "keydown":
          return {
            ...baseData,
            key: keyboardEvent.key,
            keyCode: keyboardEvent.keyCode,
            isCtrl: keyboardEvent.ctrlKey,
            isShift: keyboardEvent.shiftKey,
            isAlt: keyboardEvent.altKey,
            target: {
              tagName: target.tagName.toLowerCase(),
              id: target.id,
              className: target.className || '',
              xpath: getElementXPath(target),
            },
          };

        default:
          return baseData;
      }
    };

    // ========== 发送操作数据到服务端 ==========
    const sendAction = (eventData: UserActionData) => {
      if ((window as any).sendToServer) {
        const message = {
          type: "user-action",
          data: eventData,
        };
        (window as any).sendToServer(message);
      }
    };

    // ========== 注册全局事件监听 ==========
    const eventsToListen = ["click", "dblclick", "contextmenu", "input", "change", "scroll", "keydown"];

    eventsToListen.forEach((eventType) => {
      if (ignoreEvents.includes(eventType)) return;

      // 高频事件防抖处理
      const handler = (event: Event) => {
        const eventData = formatEventData(eventType, event);
        sendAction(eventData);
      };

      const finalHandler = ["input", "scroll"].includes(eventType) ? debounce(handler, debounceTime) : handler;

      // 捕获阶段监听（确保能监听到所有元素）
      document.addEventListener(eventType, finalHandler, true);
    });

    console.log(`✅ 用户操作监听已启用，监听事件：${eventsToListen.filter((e) => !ignoreEvents.includes(e)).join(", ")}`);
  }, { ignoreEvents, debounceTime });
}
