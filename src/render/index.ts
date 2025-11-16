import { TestRenderProps } from "./testRenderType";

/** 渲染函数 */
export const renderReact = (props: TestRenderProps, rootDom?: string): string | void => {
  const { tagName, className, style, children, id } = props;
  debugger;
  const res = `<${tagName} id="${id}" class="${className.join(" ")}" style="${Object.entries(style)
    .map(([key, value]) => `${key}:${value};`)
    .join(" ")}">
    ${typeof children === "string" ? children : children.map((child) => renderReact(child)).join("")}
  </${tagName}>`;
  if (rootDom) {
    const root = document.querySelector(rootDom);
    if (root) {
      root.innerHTML = res;
    }
  }
  return res;
};
