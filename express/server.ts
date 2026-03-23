// @ts-nocheck
// server.js（CommonJS 版本，已修复 spawn 问题）
const express = require('express');
const { spawn } = require('child_process');
const cors = require('cors');
const path = require('path'); // 新增：处理路径
const fs = require('fs-extra');
const { execPath } = process; // 新增：获取当前 node 可执行文件路径
const { firefox } = require('playwright');

const app = express();
app.use(cors());
app.use(express.json());

// 统一响应格式工具函数
function createResponse(body = null, status = 200, msg = 'success') {
  return { body, status, msg };
}

// 用于打开有头浏览器并跳转页面（第二模块，不启动原录制流程）
let guideBrowser = null;
let guideContext = null;
let guidePage = null;

app.post('/open-guide-page', async (req, res) => {
  const { targetUrl } = req.body || {};
  if (!targetUrl) {
    return res.status(400).json(createResponse(null, 400, 'missing targetUrl'));
  }

  let parsed;
  try {
    parsed = new URL(targetUrl);
    if (!['http:', 'https:'].includes(parsed.protocol)) throw new Error('invalid protocol');
  } catch (err) {
    return res.status(400).json(createResponse(null, 400, 'invalid targetUrl: ' + err.message));
  }

  try {
    // 复用已打开浏览器，避免每次点击都拉起新实例
    if (!guideBrowser) {
      guideBrowser = await firefox.launch({
        headless: false,
        slowMo: 0,
      }).catch(err => {
        console.error('Failed to launch browser:', err);
        return res.status(500).json(createResponse(null, 500, 'failed to launch browser: ' + err.message));
      });
      guideContext = await guideBrowser.newContext({
        javaScriptEnabled: true,
        ignoreHTTPSErrors: true,
        viewport: { width: '100%', height: '100%' },
      }).catch(err => {
        console.error('Failed to create new context:', err);
        return res.status(500).json(createResponse(null, 500, 'failed to create context: ' + err.message));
      });
      guidePage = await guideContext.newPage();
    }

    try {
      await guidePage.goto(targetUrl, { waitUntil: 'networkidle', timeout: 15000 });
    } catch (e) {
      await guidePage.goto(targetUrl, { waitUntil: 'domcontentloaded', timeout: 15000 }).catch(() => {});
    }

    return res.json(createResponse({
      url: guidePage.url(),
    }, 200, 'guide page opened'));
  } catch (err) {
    return res.status(500).json(createResponse(null, 500, 'failed to open guide page: ' + err.message));
  }
});

// 前端调用的接口：启动录制脚本
app.post('/start-record', async (req, res) => {
  const { targetUrl, duration, clearExisting } = req.body || {};

  // Basic validation of URL
  if (!targetUrl) return res.status(400).json(createResponse(null, 400, 'missing targetUrl'));
  let parsed;
  try {
    parsed = new URL(targetUrl);
    if (!['http:', 'https:'].includes(parsed.protocol)) throw new Error('invalid protocol');
  } catch (err) {
    return res.status(400).json(createResponse(null, 400, 'invalid targetUrl: ' + err.message));
  }

  // 获取录制脚本绝对路径
  const recordScriptPath = path.resolve(__dirname, '../src/page/fast-html/playwright/index.ts');
  // 通过绝对路径预加载 ts-node，避免 child cwd 变化导致模块解析失败
  const tsNodeRegisterPath = require.resolve("ts-node/register/transpile-only");
  const outCwd = path.join(__dirname, '../html-assets'); // 录制输出目录

  // Check for existing recordings for this host and ask for confirmation
  const recordRequestsDir = path.join(outCwd, 'record-requests');
  try {
    await fs.ensureDir(recordRequestsDir);
  } catch (e) {
    // ignore - will attempt to continue
  }
  const hostname = parsed.hostname || '';
  let existingFiles = [];
  try {
    const entries = await fs.readdir(recordRequestsDir);
    existingFiles = entries.filter(f => hostname && f.includes(hostname));
  } catch (e) {
    existingFiles = [];
  }

  if (existingFiles.length > 0) {
    if (clearExisting === undefined) {
      return res.status(409).json(createResponse({
        files: existingFiles,
        prompt: 'set clearExisting true to delete them, false to keep and overwrite'
      }, 409, 'existing recordings found for this host'));
    }
    if (clearExisting === true) {
      try {
        for (const f of existingFiles) {
          await fs.remove(path.join(recordRequestsDir, f));
        }
      } catch (e) {
        return res.status(500).json(createResponse(null, 500, 'failed to clear existing recordings: ' + e.message));
      }
    }
    // if clearExisting === false -> keep existing files; new recordings will overwrite corresponding files
  }

  // prepare args: [script, url, --output-dir=..., --autostart, --duration=...]
  // 输出目录需与 server 静态服务一致，便于回放访问
  // 从前端启动时默认开启自动录制，否则脚本会等待终端输入 "start" 而无法采集
  const recordOutputDir = path.resolve(path.join(outCwd, "record-requests"));
  const args = ["-r", tsNodeRegisterPath, recordScriptPath, targetUrl, `--output-dir=${recordOutputDir}`];
  const effectiveDuration = (duration && Number(duration) > 0) ? Number(duration) : 3600;
  args.push('--autostart');
  args.push(`--duration=${effectiveDuration}`);

  // spawn child process
  // 重要：保留 stdin 给子进程（inherit），以便在终端中向录制脚本发送交互命令（如 start/stop）
  // TS_NODE_PROJECT：强制录制脚本使用 CommonJS 输出，避免 Node 无法识别 ES 模块 import 语法
  const tsconfigRecording = path.resolve(__dirname, '../tsconfig.recording.json');
  const child = spawn(execPath, args, {
    cwd: outCwd,
    stdio: ['inherit', 'pipe', 'pipe'],
    env: Object.assign({}, process.env, { TS_NODE_PROJECT: tsconfigRecording }),
  });

  // 实时打印子进程的输出到主进程终端，便于交互和调试
  child.stdout.on('data', (data) => {
    process.stdout.write(data);
  });
  child.stderr.on('data', (data) => {
    process.stderr.write(data);
  });

  // register process in memory map
  if (!global.__recordProcesses) global.__recordProcesses = new Map();
  const id = `${Date.now()}-${child.pid}`;
  global.__recordProcesses.set(id, { child, targetUrl, startedAt: new Date().toISOString() });

  // capture logs into memory (kept short)
  const maxLines = 2000;
  const logs = [];
  child.stdout.on('data', (chunk) => {
    const s = String(chunk);
    s.split(/\r?\n/).forEach(l => { if (l) logs.push({ts: new Date().toISOString(), line: l}); });
    while (logs.length > maxLines) logs.shift();
  });
  child.stderr.on('data', (chunk) => {
    const s = String(chunk);
    s.split(/\r?\n/).forEach(l => { if (l) logs.push({ts: new Date().toISOString(), line: l}); });
    while (logs.length > maxLines) logs.shift();
  });

  child.on('exit', (code, signal) => {
    const info = global.__recordProcesses.get(id) || {};
    info.exitCode = code;
    info.exitedAt = new Date().toISOString();
    info.signal = signal;
    info.logs = logs;
    global.__recordProcesses.set(id, info);
  });

  child.on('error', (err) => {
    const info = global.__recordProcesses.get(id) || {};
    info.error = err.message;
    global.__recordProcesses.set(id, info);
  });

  res.json(createResponse({ 
    id, 
    pid: child.pid, 
    script: recordScriptPath 
  }, 200, 'recording started'));
});


// 停止录制（id 可选，不传则停止当前正在运行的录制）
app.post('/stop-record', (req, res) => {
  let { id } = req.body || {};
  let info;
  if (id) {
    info = global.__recordProcesses?.get(id);
  } else {
    // 未传 id 时，停止最后一个仍在运行的录制
    const processes = global.__recordProcesses || new Map();
    for (const [k, v] of processes.entries()) {
      if (v.child && v.child.exitCode == null) {
        info = v;
        id = k;
        break;
      }
    }
  }
  if (!info) return res.status(404).json(createResponse(null, 404, 'recording not found'));
  const { child } = info;
  try {
    child.kill('SIGTERM');
    return res.json(createResponse({ id }, 200, 'stopping'));
  } catch (err) {
    return res.status(500).json(createResponse(null, 500, 'stop failed: ' + err.message));
  }
});

// 查询状态
app.get('/record-status', (req, res) => {
  const list = [];
  for (const [k, v] of (global.__recordProcesses || new Map()).entries()) {
    list.push(Object.assign({ id: k }, { pid: v.child?.pid, targetUrl: v.targetUrl, startedAt: v.startedAt, exitCode: v.exitCode, exitedAt: v.exitedAt }));
  }
  res.json(createResponse(list, 200, 'success'));
});

// 获取日志（内存中最后若干行）
app.get('/record-logs/:id', (req, res) => {
  const id = req.params.id;
  const info = global.__recordProcesses?.get(id);
  if (!info) return res.status(404).json(createResponse(null, 404, 'not found'));
  res.json(createResponse({ id, logs: info.logs || [] }, 200, 'success'));
});


// 启动服务
app.listen(3001, () => {
  console.log('后端服务运行在：http://localhost:3001');
  console.log('当前 Node 路径：', execPath);
  console.log('项目根目录：', __dirname);
});

// 提供已录制资源的静态播放目录
// 将回放目录指向 assets 下的录制输出，便于前端访问
app.use('/playback', express.static(path.join(__dirname, '../html-assets/record-requests')));

// 兼容：某些快照中存在以 "/" 开头的绝对路径（例如 <base href="/"> 导致的根路径引用），
// 浏览器会向根路径发起请求。为了避免这些请求返回 404，我们在根路径上
// 尝试直接从录制输出目录查找对应文件并返回（如果存在），否则继续后续中间件。
app.use(async (req, res, next) => {
  try {
    const candidate = path.resolve(__dirname, '../html-assets/record-requests', '.' + req.path);
    if (await fs.pathExists(candidate)) {
      return res.sendFile(candidate);
    }
  } catch (e) {
    // ignore errors and pass through
  }
  next();
});