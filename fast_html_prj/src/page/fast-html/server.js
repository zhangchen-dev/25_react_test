// server.js（CommonJS 版本，已修复 spawn 问题）
const express = require('express');
const { spawn } = require('child_process');
const cors = require('cors');
const path = require('path'); // 新增：处理路径
const fs = require('fs-extra');
const { execPath } = process; // 新增：获取当前 node 可执行文件路径

const app = express();
app.use(cors());
app.use(express.json());

// 前端调用的接口：启动录制脚本
app.post('/start-record', (req, res) => {
  const { targetUrl, duration } = req.body || {};

  // Basic validation of URL
  if (!targetUrl) return res.status(400).json({ message: 'missing targetUrl' });
  let parsed;
  try {
    parsed = new URL(targetUrl);
    if (!['http:', 'https:'].includes(parsed.protocol)) throw new Error('invalid protocol');
  } catch (err) {
    return res.status(400).json({ message: 'invalid targetUrl', error: err.message });
  }

  const recordScriptPath = path.resolve(__dirname, 'playWright.js');
  const outCwd = path.join(__dirname, '../../assets/html');

  // prepare args: [script, url, --autostart, --duration=...]
  // 仅当 duration 存在时才自动录制，否则进入交互模式
  const args = [recordScriptPath, targetUrl];
  if (duration && Number(duration) > 0) {
    args.push('--autostart');
    args.push(`--duration=${Number(duration)}`);
  }

  // spawn child process
  // 重要：保留 stdin 给子进程（inherit），以便在终端中向录制脚本发送交互命令（如 start/stop）
  const child = spawn(execPath, args, {
    cwd: outCwd,
    stdio: ['inherit', 'pipe', 'pipe'],
    env: Object.assign({}, process.env),
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

  res.json({ message: 'recording started', id, pid: child.pid, script: recordScriptPath });
});


// 停止录制
app.post('/stop-record', (req, res) => {
  const { id } = req.body || {};
  if (!id) return res.status(400).json({ message: 'missing id' });
  const info = global.__recordProcesses?.get(id);
  if (!info) return res.status(404).json({ message: 'recording not found' });
  const { child } = info;
  try {
    child.kill('SIGTERM');
    return res.json({ message: 'stopping', id });
  } catch (err) {
    return res.status(500).json({ message: 'stop failed', error: err.message });
  }
});

// 查询状态
app.get('/record-status', (req, res) => {
  const list = [];
  for (const [k, v] of (global.__recordProcesses || new Map()).entries()) {
    list.push(Object.assign({ id: k }, { pid: v.child?.pid, targetUrl: v.targetUrl, startedAt: v.startedAt, exitCode: v.exitCode, exitedAt: v.exitedAt }));
  }
  res.json(list);
});

// 获取日志（内存中最后若干行）
app.get('/record-logs/:id', (req, res) => {
  const id = req.params.id;
  const info = global.__recordProcesses?.get(id);
  if (!info) return res.status(404).json({ message: 'not found' });
  res.json({ id, logs: info.logs || [] });
});
// 启动服务
app.listen(3001, () => {
  console.log('后端服务运行在：http://localhost:3001');
  console.log('当前 Node 路径：', execPath);
  console.log('项目根目录：', __dirname);
});

// 提供已录制资源的静态播放目录
// 将回放目录指向 assets 下的录制输出，便于前端访问
app.use('/playback', express.static(path.join(__dirname, '../../assets/html/record-requests')));

// 兼容：某些快照中存在以 "/" 开头的绝对路径（例如 <base href="/"> 导致的根路径引用），
// 浏览器会向根路径发起请求。为了避免这些请求返回 404，我们在根路径上
// 尝试直接从录制输出目录查找对应文件并返回（如果存在），否则继续后续中间件。
app.use(async (req, res, next) => {
  try {
    const candidate = path.resolve(__dirname, '../../assets/html/record-requests', '.' + req.path);
    if (await fs.pathExists(candidate)) {
      return res.sendFile(candidate);
    }
  } catch (e) {
    // ignore errors and pass through
  }
  next();
});