// src/testRenderProps.ts
export interface TestRenderProps {
  /** 标签名称 */
  tagName: string;
  /** 类名 */
  className: [string];
  /** 样式 */
  style: Record<string, string>;
  /** 子元素 */
  children: string | TestRenderProps[];
  id: string;
}
