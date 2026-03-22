// @ts-nocheck

import fs from "fs-extra";
import path from "path";
import { recordState } from "../playwright/state";
import { captureHtmlSnapshot, listenPageRequests } from "../playwright/capture";
import { closeWriterWorker, initOutputDir, sendTaskToWorker, waitForAllTasks } from "./worker";

const { firefox } = require("playwright");

// 录制流程编排层：
// - 启停录制
// - 浏览器生命周期
// - 自动录制参数解析
export const startRecord = async (page) => {
  if (recordState.isRecording) {
    console.log("⚠️ 已在录制中，无需重复开始");
    return;
  }
  recordState.isRecording = true;

  console.log("🔍 开始录制，正在捕获当前页面HTML...");
  await captureHtmlSnapshot(page, "start_recording");

  const pages = recordState.browser.contexts()[0].pages();
  pages.forEach(listenPageRequests);

  recordState.browser.contexts()[0].on("page", (newPage) => {
    console.log(`🆕 检测到新页面：${newPage.url()}`);
    listenPageRequests(newPage);
    setTimeout(async () => {
      if (recordState.isRecording) {
        await captureHtmlSnapshot(newPage, "new_page");
      }
    }, 1000);
  });

  console.log("\n====================================");
  console.log("✅ 开始录制请求和HTML变化！");
  console.log("✅ 当前页面HTML已捕获");
  console.log("✅ 所有XHR/Fetch请求将被原封不动捕获");
  console.log("✅ 页面HTML变化也将被记录");
  console.log('✅ 输入 "stop" 并回车停止录制');
  console.log("====================================\n");
};

const saveRecordedData = async () => {
  try {
    await fs.ensureDir(recordState.outputDir);

    const requestsFilePath = path.resolve(recordState.outputDir, "raw-requests.json");
    await sendTaskToWorker("writeJsonFile", {
      filePath: requestsFilePath,
      data: recordState.allRequests,
      pretty: true,
    });

    const htmlSnapshotsMetadataPath = path.resolve(recordState.outputDir, "html-snapshots-metadata.json");
    await sendTaskToWorker("writeJsonFile", {
      filePath: htmlSnapshotsMetadataPath,
      data: recordState.htmlSnapshots,
      pretty: true,
    });

    const summary = {
      recordTime: new Date().toISOString(),
      totalRequests: recordState.allRequests.length,
      totalHtmlSnapshots: recordState.htmlSnapshots.length,
      successRequests: recordState.allRequests.filter((req) => req.response?.status >= 200 && req.response?.status < 300).length,
      failedRequests: recordState.allRequests.filter((req) => req.response?.status === 0 || req.response?.status >= 500).length,
      outputFiles: {
        requests: requestsFilePath,
        htmlSnapshotsMetadata: htmlSnapshotsMetadataPath,
        htmlSnapshotsDirectory: path.join(recordState.outputDir, "html_snapshots"),
      },
      tips: "所有请求/响应和HTML数据均为原始格式，未做任何修改",
    };
    const summaryFilePath = path.resolve(recordState.outputDir, "record-summary.json");
    await sendTaskToWorker("writeJsonFile", {
      filePath: summaryFilePath,
      data: summary,
      pretty: true,
    });

    await waitForAllTasks();

    console.log("\n====================================");
    console.log(`✅ 录制停止！共捕获 ${recordState.allRequests.length} 条请求`);
    console.log(`✅ 共捕获 ${recordState.htmlSnapshots.length} 个HTML快照`);
    console.log(`📝 原始请求数据已保存：${requestsFilePath}`);
    console.log(`📝 HTML快照元数据已保存：${htmlSnapshotsMetadataPath}`);
    console.log(`📂 HTML快照文件保存在：${path.join(recordState.outputDir, "html_snapshots")}`);
    console.log(`📋 录制汇总已保存：${summaryFilePath}`);
    console.log("💡 所有数据均为原封不动捕获，未修改任何页面内容");
    console.log("====================================\n");
    console.log("💡 浏览器将继续保持打开状态，登录数据已保存");
    console.log('💡 如需继续录制，请重新输入 "start"');
    console.log('💡 如需退出程序，请输入 "exit"');
  } catch (error) {
    console.error("❌ 保存请求数据失败：", error);
  }
};

export const stopRecord = async () => {
  if (!recordState.isRecording) {
    console.log("⚠️ 未在录制中，无需停止");
    return;
  }
  recordState.isRecording = false;
  await saveRecordedData();
};

export const initBrowser = async (initUrl) => {
  try {
    const browser = await firefox.launch({
      headless: false,
      viewport: { width: 1920, height: 1080 },
      slowMo: 0,
    });
    recordState.browser = browser;

    const context = await browser.newContext({
      javaScriptEnabled: true,
      ignoreHTTPSErrors: true,
    });
    const page = await context.newPage();

    try {
      await page.goto(initUrl, { waitUntil: "networkidle", timeout: 10000 });
    } catch (err) {
      console.warn("⚠️ networkidle 导航失败，降级到 domcontentloaded：", err.message);
      await page.goto(initUrl, { waitUntil: "domcontentloaded", timeout: 10000 }).catch(() => {});
    }

    recordState.isRecording = true;
    await captureHtmlSnapshot(page, "initial_page_load");
    recordState.isRecording = false;

    console.log("\n====================================");
    console.log("✅ Firefox浏览器已原生打开！");
    console.log("✅ 初始页面HTML已捕获");
    console.log("✅ 请先完成登录/页面准备操作（无任何内容修改）");
    console.log('✅ 准备完成后，输入 "start" 并回车开始录制请求和HTML变化');
    console.log('✅ 录制中输入 "stop" 并回车停止，输入 "exit" 退出');
    console.log("====================================\n");

    process.stdin.setEncoding("utf8");
    process.stdin.on("data", async (input) => {
      const cmd = input.toString().trim().toLowerCase().replace(/\r|\n/g, "");
      if (cmd === "start") {
        await startRecord(page);
      } else if (cmd === "stop") {
        await stopRecord();
      } else if (cmd === "exit") {
        await closeWriterWorker();
        await browser.close();
        console.log("👋 已关闭浏览器和Worker，退出程序");
        process.exit(0);
      } else if (cmd) {
        console.log(`⚠️ 未知指令：${cmd}，支持指令：start/stop/exit`);
      }
    });

    return page;
  } catch (error) {
    console.error("❌ 初始化浏览器失败：", error);
    await closeWriterWorker();
    process.exit(1);
  }
};

export const manualRecordPage = async (initUrl, outputDir) => {
  try {
    // __dirname = src/page/fast-html/recording
    const defaultOutput = path.resolve(__dirname, "../../../../html-assets/record-requests");
    const finalOutput = outputDir || defaultOutput;

    await initOutputDir(finalOutput);
    const page = await initBrowser(initUrl);

    // 从前端/服务启动时收到 SIGTERM 则先保存数据再退出（用户点击"关闭录制"）
    const handleSigTerm = async () => {
      console.log("\n📴 收到停止信号，正在保存录制数据...");
      recordState.isRecording = false;
      await saveRecordedData();
      await closeWriterWorker();
      if (recordState.browser) await recordState.browser.close();
      process.exit(0);
    };
    process.on("SIGTERM", () => { handleSigTerm().catch((e) => { console.error(e); process.exit(1); }); });

    const argv = process.argv.slice(2).map((a) => a.trim());
    const auto = argv.includes("--autostart") || argv.includes("--auto");
    const durArg = argv.find((a) => a.startsWith("--duration="));
    const duration = durArg ? parseInt(durArg.split("=")[1], 10) : 15;

    if (auto) {
      console.log(`🔁 自动录制模式：开始录制 ${duration}s`);
      await startRecord(page);
      setTimeout(async () => {
        await stopRecord();
        await closeWriterWorker();
        await recordState.browser.close();
        console.log("🔚 自动录制完成，已退出");
        process.exit(0);
      }, Math.max(5000, duration * 1000));
    }
  } catch (error) {
    console.error("❌ 程序初始化出错：", error);
    await closeWriterWorker();
    process.exit(1);
  }
};

