// @ts-nocheck
// file-writer.worker.js - 独立线程处理文件写入，避免主线程阻塞
const { parentPort, workerData } = require("worker_threads");
const fs = require("fs-extra");
const path = require("path");

// 任务处理函数
const handleTask = async (task) => {
  try {
    switch (task.type) {
      // 保存资源二进制文件
      case "saveResourceBuffer": {
        const { url, buffer, headers, outputDir } = task.data;
        const rel = getLocalRelativePath(url, headers);
        const filePath = path.join(outputDir, rel);
        await fs.ensureDir(path.dirname(filePath));
        if (!(await fs.pathExists(filePath))) {
          await fs.writeFile(filePath, buffer);
        }
        return { success: true, data: rel.replace(/\\/g, "/") };
      }

      // 保存JSON文件（格式化）
      case "writeJsonFile": {
        const { filePath, data, pretty = true } = task.data;
        await fs.ensureDir(path.dirname(filePath));
        const content = pretty ? JSON.stringify(data, null, 2) : JSON.stringify(data);
        await fs.writeFile(filePath, content, "utf8");
        return { success: true };
      }

      // 保存HTML文件
      case "writeHtmlFile": {
        const { filePath, content } = task.data;
        await fs.ensureDir(path.dirname(filePath));
        await fs.writeFile(filePath, content, "utf8");
        return { success: true };
      }

      // 初始化目录（清空/创建）
      case "initOutputDir": {
        const { outputDir } = task.data;
        if (await fs.pathExists(outputDir)) {
          await fs.emptyDir(outputDir);
        } else {
          await fs.ensureDir(outputDir);
        }
        return { success: true };
      }

      default:
        return { success: false, error: `未知任务类型: ${task.type}` };
    }
  } catch (error) {
    console.error(`❌ Worker处理任务失败 [${task.type}]:`, error.message);
    return { success: false, error: error.message };
  }
};

// 复用原有URL转本地路径逻辑（和主脚本保持一致）
const sanitizeFilename = (url) => {
  try {
    let cleanUrl = String(url || "").replace(/^https?:\/\//, "");
    cleanUrl = cleanUrl.replace(/[<>:\"/\\|?*]/g, "_");
    if (cleanUrl.length > 150) cleanUrl = cleanUrl.substring(0, 150);
    if (!cleanUrl) cleanUrl = "unnamed";
    return cleanUrl;
  } catch (e) {
    return "unnamed";
  }
};

const getExtensionFrom = (url, headers = {}) => {
  try {
    const parsed = new URL(url);
    const extFromPath = path.extname(parsed.pathname || "");
    if (extFromPath) return extFromPath;
  } catch (e) {}

  const ct = (headers["content-type"] || headers["Content-Type"] || "").toLowerCase();
  if (ct.includes("javascript")) return ".js";
  if (ct.includes("json")) return ".json";
  if (ct.includes("text/html")) return ".html";
  if (ct.includes("css")) return ".css";
  if (ct.includes("image/png")) return ".png";
  if (ct.includes("image/jpeg") || ct.includes("image/jpg")) return ".jpg";
  if (ct.includes("image/gif")) return ".gif";
  if (ct.includes("svg")) return ".svg";
  if (ct.includes("font")) return ".woff";
  if (ct.includes("audio")) return ".mp3";
  if (ct.includes("video")) return ".mp4";
  return "";
};

const getLocalRelativePath = (url, headers = {}) => {
  try {
    const parsed = new URL(url);
    let pathname = decodeURIComponent(parsed.pathname || "/");
    if (!pathname || pathname === "/") pathname = "/index.html";
    if (pathname.endsWith("/")) pathname += "index.html";

    let ext = path.extname(pathname);
    if (!ext) {
      const guessed = getExtensionFrom(url, headers) || "";
      if (guessed) pathname += guessed;
      ext = path.extname(pathname);
    }

    const parts = pathname.split("/").map((p) => p.replace(/[<>:\"|?*]/g, "_"));
    let rel = parts.join("/");
    rel = rel.replace(/^\/+/, "");
    return rel;
  } catch (e) {
    const name = sanitizeFilename(url);
    return `misc/${name}`;
  }
};

// 监听主线程任务
parentPort.on("message", async (task) => {
  if (task === "EXIT") {
    // 收到退出指令，结束Worker
    parentPort.postMessage({ type: "EXIT_SUCCESS" });
    process.exit(0);
    return;
  }

  // 处理任务并返回结果
  const result = await handleTask(task);
  parentPort.postMessage({
    taskId: task.taskId,
    result,
  });
});

// 向主线程发送就绪信号
parentPort.postMessage({ type: "WORKER_READY" });

// 让该文件在 isolatedModules 下被视为模块
export {};

