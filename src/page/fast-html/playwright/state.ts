// @ts-nocheck

export const recordState = {
  // 录制开关
  isRecording: false,
  // 请求与快照数据
  allRequests: [],
  htmlSnapshots: [],
  // 浏览器实例
  browser: null,
  // 输出目录
  outputDir: "./record-requests",
  // 自增 ID
  requestIdCounter: 1,
  snapshotIdCounter: 1,
  // Worker 相关
  writerWorker: null,
  workerReady: false,
  taskQueue: [],
  taskIdCounter: 1,
  pendingTasks: new Map(),
};

