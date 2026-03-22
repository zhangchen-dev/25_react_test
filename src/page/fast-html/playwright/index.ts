// @ts-nocheck
import { manualRecordPage } from "../recording/runner";

// 模块化入口：仅做环境兼容和启动，不承载业务逻辑
if (typeof File === "undefined") {
  (global as any).File = class File {};
}

const argv = process.argv.slice(2).filter((a) => a && !a.startsWith("--"));
const defaultUrl = argv[0] && !argv[0].startsWith("--") ? argv[0] : "https://example.com/";
const outputDirArg = process.argv.find((a) => a.startsWith("--output-dir="));
const outputDir = outputDirArg ? outputDirArg.split("=")[1] : undefined;
manualRecordPage(defaultUrl, outputDir);

