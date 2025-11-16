import { renderReact } from "./render";

// 测试渲染函数
const testFn = () => {
  console.log("test");
  renderReact(
    {
      tagName: "div",
      className: ["test"],
      style: {
        color: "red",
      },
      children: [
        {
          tagName: "span",
          className: ["child-span"],
          style: { fontSize: "14px" },
          children: "Hello, World!",
          id: "child1",
        },
      ],
      id: "test",
    },
    "#root"
  );
};

testFn();
