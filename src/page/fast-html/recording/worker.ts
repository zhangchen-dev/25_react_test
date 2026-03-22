// @ts-nocheck

import path from "path";
import { Worker } from "worker_threads";
import { recordState } from "../playwright/state";

// 统一封装 Worker 相关逻辑：
// - 任务队列
// - 主线程与 Worker 通信
// - 生命周期管理（初始化/关闭）
export const processTaskQueue = () => {
  if (!recordState.workerReady || !recordState.writerWorker || recordState.taskQueue.length === 0) {
    return;
  }

  while (recordState.taskQueue.length > 0) {
    const task = recordState.taskQueue.shift();
    if (task.data.buffer) {
      recordState.writerWorker.postMessage(task, [task.data.buffer.buffer]);
    } else {
      recordState.writerWorker.postMessage(task);
    }
    console.log(`📌 发送队列任务${task.taskId}(${task.type})到Worker`);
  }
};

export const initWriterWorker = async () => {
  if (recordState.writerWorker) return;

  // Worker 也需要执行 TypeScript 文件，因此显式预加载 ts-node
  const tsNodeRegisterPath = require.resolve("ts-node/register/transpile-only");
  const worker = new Worker(path.join(__dirname, "./file-writer.worker.ts"), {
    workerData: { outputDir: recordState.outputDir },
    execArgv: ["-r", tsNodeRegisterPath],
  });

  worker.on("message", (msg) => {
    if (msg.type === "WORKER_READY") {
      recordState.workerReady = true;
      console.log("📌 文件写入Worker已就绪");
      processTaskQueue();
      return;
    }

    if (msg.type === "EXIT_SUCCESS") {
      console.log("📌 文件写入Worker已正常退出");
      return;
    }

    const taskId = msg.taskId;
    const taskPromise = recordState.pendingTasks.get(taskId);
    if (taskPromise) {
      const { resolve, reject } = taskPromise;
      if (msg.result.success) {
        resolve(msg.result.data);
      } else {
        reject(new Error(msg.result.error));
      }
      recordState.pendingTasks.delete(taskId);
    }
  });

  worker.on("error", (error) => {
    console.error("❌ 文件写入Worker出错:", error.message);
    recordState.pendingTasks.forEach(({ reject }) => {
      reject(new Error(`Worker出错: ${error.message}`));
    });
    recordState.pendingTasks.clear();
    recordState.workerReady = false;
  });

  worker.on("exit", (code) => {
    if (code !== 0) {
      console.error(`❌ 文件写入Worker异常退出，退出码: ${code}`);
      recordState.workerReady = false;
    }
    recordState.writerWorker = null;
  });

  recordState.writerWorker = worker;
};

export const sendTaskToWorker = (taskType, taskData) => {
  return new Promise((resolve, reject) => {
    const taskId = recordState.taskIdCounter++;
    const task = {
      taskId,
      type: taskType,
      data: taskData,
    };

    recordState.pendingTasks.set(taskId, { resolve, reject });

    if (recordState.workerReady && recordState.writerWorker) {
      if (taskData.buffer) {
        recordState.writerWorker.postMessage(task, [taskData.buffer.buffer]);
      } else {
        recordState.writerWorker.postMessage(task);
      }
    } else {
      recordState.taskQueue.push(task);
      console.log(`📌 任务${taskId}(${taskType})已加入队列，等待Worker就绪`);
    }
  });
};

export const waitForAllTasks = async () => {
  if (recordState.pendingTasks.size === 0) return;

  console.log(`📌 等待${recordState.pendingTasks.size}个待处理写入任务完成...`);
  await new Promise((resolve) => {
    const checkInterval = setInterval(() => {
      if (recordState.pendingTasks.size === 0) {
        clearInterval(checkInterval);
        resolve(null);
      }
    }, 100);
  });
  console.log("📌 所有写入任务已完成");
};

export const closeWriterWorker = async () => {
  if (!recordState.writerWorker) return;

  await waitForAllTasks();
  recordState.writerWorker.postMessage("EXIT");

  await new Promise((resolve) => {
    recordState.writerWorker.on("exit", resolve);
  });

  recordState.writerWorker = null;
  recordState.workerReady = false;
};

export const initOutputDir = async (outputDir) => {
  await initWriterWorker();
  await sendTaskToWorker("initOutputDir", { outputDir });

  recordState.outputDir = outputDir;
  console.log(`📁 请求数据输出目录已初始化（已清空旧内容）：${path.resolve(outputDir)}`);
};

