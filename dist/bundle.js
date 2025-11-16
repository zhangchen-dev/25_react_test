/*
 * ATTENTION: The "eval" devtool has been used (maybe by default in mode: "development").
 * This devtool is neither made for production nor for readable output files.
 * It uses "eval()" calls to create a separate source file in the browser devtools.
 * If you are trying to read the output file, select a different devtool (https://webpack.js.org/configuration/devtool/)
 * or disable the default devtool with "devtool: false".
 * If you are looking for production-ready output files, see mode: "production" (https://webpack.js.org/configuration/mode/).
 */
/******/ (() => { // webpackBootstrap
/******/ 	"use strict";
/******/ 	var __webpack_modules__ = ({

/***/ "./src/index.ts":
/*!**********************!*\
  !*** ./src/index.ts ***!
  \**********************/
/***/ ((__unused_webpack_module, exports) => {

eval("{\nObject.defineProperty(exports, \"__esModule\", ({ value: true }));\nexports.renderReact = void 0;\n/** 渲染函数 */\nconst renderReact = (props, rootDom) => {\n    const { tagName, className, style, children, id } = props;\n    return `<${tagName} id=\"${id}\" class=\"${className.join(\" \")}\" style=\"${Object.entries(style)\n        .map(([key, value]) => `${key}:${value};`)\n        .join(\" \")}\">\r\n    ${typeof children === \"string\" ? children : children.map((child) => (0, exports.renderReact)(child)).join(\"\")}\r\n  </${tagName}>`;\n};\nexports.renderReact = renderReact;\nconst testFn = () => {\n    console.log(\"test\");\n    (0, exports.renderReact)({\n        tagName: \"div\",\n        className: [\"test\"],\n        style: {\n            color: \"red\",\n        },\n        children: \"hello world\",\n        id: \"test\",\n    }, \"#root\");\n};\ntestFn();\n\n\n//# sourceURL=webpack:///./src/index.ts?\n}");

/***/ })

/******/ 	});
/************************************************************************/
/******/ 	
/******/ 	// startup
/******/ 	// Load entry module and return exports
/******/ 	// This entry module is referenced by other modules so it can't be inlined
/******/ 	var __webpack_exports__ = {};
/******/ 	__webpack_modules__["./src/index.ts"](0,__webpack_exports__);
/******/ 	
/******/ })()
;