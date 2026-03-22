// @ts-nocheck

// 模块化入口：仅做环境兼容和启动，不承载业务逻辑
if (typeof File === "undefined") {
  (global as any).File = class File {};
}

import { manualRecordPage } from "../recording/runner";

const defaultUrl = process.argv[2] && !process.argv[2].startsWith("--") ? process.argv[2] : "https://example.com/";
manualRecordPage(defaultUrl);

