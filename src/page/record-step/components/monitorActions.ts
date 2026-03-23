/**
 * Playwright 页面用户操作监听封装（TS版）
 * 功能：监听页面所有用户交互操作，实时发送到服务端
 */
import type { Page } from "playwright";
import type { UserActionData, UserActionType, MonitorOptions, ActionJudgeResult, UserActionMessage } from "../../../types/record";

/**
 * 给 Playwright 页面注入全量用户操作监听
 */
export async function injectUserActionMonitor(page: Page, options: MonitorOptions = {}): Promise<void> {
  const { ignoreEvents = ["mousemove"], debounceTime = 200 } = options;

  // 注入监听逻辑到页面
  await page.evaluate(
    ({ ignoreEvents, debounceTime }: MonitorOptions) => {
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
      const formatEventData = (eventType: UserActionType, event: Event): UserActionData => {
        const baseData: UserActionData = {
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
                className: target.className,
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
                name: inputTarget.name,
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
                name: changeTarget.name,
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
                xpath: getElementXPath(target),
              },
            };

          default:
            return baseData;
        }
      };

      // ========== 发送操作数据到服务端 ==========
      const sendAction = (eventData: UserActionData): void => {
        if (window.sendToServer) {
          const message: UserActionMessage = {
            type: "user-action",
            data: eventData,
          };
          window.sendToServer(message);
        }
      };

      // ========== 注册全局事件监听 ==========
      const eventsToListen: UserActionType[] = ["click", "dblclick", "contextmenu", "input", "change", "scroll", "keydown"];

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
    },
    { ignoreEvents, debounceTime },
  );
}

/**
 * 自定义操作判断逻辑（服务端用）
 */
export function judgeUserAction(actionData: UserActionData): ActionJudgeResult {
  const result: ActionJudgeResult = {
    isValid: true,
    message: "",
    actionType: actionData.actionType,
  };

  // 示例1：验证手机号输入
  if (actionData.actionType === "input" && actionData.target?.name === "phone") {
    const phone = actionData.target.value || "";
    if (phone && !/^1[3-9]\d{9}$/.test(phone)) {
      result.isValid = false;
      result.message = "手机号格式错误";
    }
  }

  // 示例2：验证提交按钮点击（需先输入内容）
  if (actionData.actionType === "click" && actionData.target?.id === "submit-btn") {
    // 注意：这里如果是服务端调用，需要通过 Playwright 获取页面元素值
    // 前端环境下的示例逻辑：
    // const inputVal = document.querySelector('#username')?.value;
    // if (!inputVal) {
    //   result.isValid = false;
    //   result.message = '用户名不能为空';
    // }

    // 服务端环境下建议通过 Playwright API 获取：
    // const inputVal = await page.$eval('#username', el => el.value);
    result.message = "提交按钮点击验证（需结合 Playwright API 实现）";
  }

  return result;
}
