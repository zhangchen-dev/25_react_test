const express = require('express');
const fs = require('fs');
const path = require('path');
const app = express();

// ===================== 极简配置（无需修改） =====================
const PORT = 3000;
const RAW_REQUEST_FILE = './raw-requests.json'; // 你的请求记录文件
const STATIC_DIR = './'; // 静态资源根目录（和 Live Server 一致）
// 移除自动创建Mock目录的配置（无需再创建）
// =================================================================

// 工具函数1：标准化路径（去除末尾斜杠、去掉URL参数、统一格式）
function normalizePath(urlOrPath) {
  if (!urlOrPath) return '';
  let pathOnly = '';
  try {
    const urlObj = new URL(urlOrPath);
    pathOnly = urlObj.pathname;
  } catch (e) {
    pathOnly = urlOrPath;
  }
  // 去除末尾斜杠 + 去掉URL参数（保留原后缀）
  return pathOnly.replace(/\/$/, '').split('?')[0];
}

// 工具函数2：提取请求路径的基础名（去掉后缀）
// 示例：/common/wapi/SYAGRDTL.do → /common/wapi/SYAGRDTL
function getBasePathWithoutExt(requestPath) {
  const ext = path.extname(requestPath);
  return ext ? requestPath.slice(0, -ext.length) : requestPath;
}

// 工具函数3：优先匹配原后缀文件，再降级匹配同名任意后缀（核心修复）
function findAnyExtFile(requestPath) {
  // 步骤1：标准化路径（保留原后缀）
  const normalizedPath = normalizePath(requestPath);
  
  // ===== 新增：优先匹配原路径带后缀的文件（解决.do匹配不到的核心） =====
  // 变体1：去掉前导斜杠的原路径（优先）
  const fullPathWithExt = path.resolve(path.join(STATIC_DIR, normalizedPath.replace(/^\//, '')));
  if (fs.existsSync(fullPathWithExt) && fs.statSync(fullPathWithExt).isFile()) {
    console.log(`✅ 优先匹配到原后缀文件：${fullPathWithExt}`);
    return fullPathWithExt;
  }
  // 变体2：保留前导斜杠的原路径（兜底）
  const fullPathWithExtWithSlash = path.resolve(path.join(STATIC_DIR, normalizedPath));
  if (fs.existsSync(fullPathWithExtWithSlash) && fs.statSync(fullPathWithExtWithSlash).isFile()) {
    console.log(`✅ 匹配到带前导斜杠的原后缀文件：${fullPathWithExtWithSlash}`);
    return fullPathWithExtWithSlash;
  }

  // ===== 原有逻辑：降级匹配同名任意后缀文件（保留） =====
  const basePath = getBasePathWithoutExt(normalizedPath);
  const fullBasePath = path.resolve(path.join(STATIC_DIR, basePath.replace(/^\//, '')));
  const dir = path.dirname(fullBasePath);
  const fileName = path.basename(fullBasePath);

  if (!fs.existsSync(dir) || !fs.statSync(dir).isDirectory()) {
    console.log(`⚠️ 文件目录不存在：${dir}`);
    return null;
  }

  const files = fs.readdirSync(dir);
  for (const file of files) {
    const fileBaseName = path.basename(file, path.extname(file));
    if (fileBaseName === fileName) {
      const matchFilePath = path.resolve(dir, file);
      if (fs.statSync(matchFilePath).isFile()) {
        console.log(`✅ 降级匹配到同名任意后缀文件：${matchFilePath}`);
        return matchFilePath;
      }
    }
  }

  // 兜底：尝试带前导斜杠的无后缀路径
  const fullBasePathWithSlash = path.resolve(path.join(STATIC_DIR, basePath));
  const dirWithSlash = path.dirname(fullBasePathWithSlash);
  const fileNameWithSlash = path.basename(fullBasePathWithSlash);
  if (fs.existsSync(dirWithSlash) && fs.statSync(dirWithSlash).isDirectory()) {
    const filesWithSlash = fs.readdirSync(dirWithSlash);
    for (const file of filesWithSlash) {
      const fileBaseName = path.basename(file, path.extname(file));
      if (fileBaseName === fileNameWithSlash) {
        const matchFilePath = path.resolve(dirWithSlash, file);
        if (fs.statSync(matchFilePath).isFile()) {
          console.log(`✅ 匹配到带前导斜杠的同名文件：${matchFilePath}`);
          return matchFilePath;
        }
      }
    }
  }

  console.log(`⚠️ 未找到任何匹配文件：原路径=${fullPathWithExt} | 基础路径=${fullBasePath}`);
  return null;
}

// 1. 过滤静态资源后缀（新增.do，避免被误判）
const STATIC_EXTENSIONS = ['.html', '.css', '.js', '.png', '.jpg', '.jpeg', '.gif', '.svg', '.ico', '.txt', '.json', '.do'];
function isStaticFile(url) {
  return STATIC_EXTENSIONS.some(ext => url.endsWith(ext));
}

// 初始化：仅加载请求记录（移除自动创建Mock文件逻辑）
let postRequestMap = new Map();
try {
  const rawRequestFullPath = path.resolve(RAW_REQUEST_FILE);
  console.log(`🔍 正在读取请求记录文件：${rawRequestFullPath}`);
  
  if (fs.existsSync(rawRequestFullPath)) {
    const rawData = fs.readFileSync(rawRequestFullPath, 'utf8');
    const requests = JSON.parse(rawData);
    console.log(`📄 共读取到 ${requests.length} 条请求记录`);

    // 仅加载映射（不创建文件）
    requests.forEach((reqInfo, index) => {
      const method = (reqInfo.method || reqInfo.requestMethod || reqInfo.httpMethod || '').toUpperCase();
      if (method !== 'POST') return;

      const originalPath = reqInfo.path || reqInfo.requestUrl || reqInfo.url || reqInfo.uri;
      const requestPath = normalizePath(originalPath);
      if (!requestPath) return;

      let responseFilePath = '';
      if (reqInfo.responseFilePath) {
        responseFilePath = path.resolve(reqInfo.responseFilePath);
      } else {
        const safePath = requestPath.replace(/[\/:?&=]/g, '_').replace(/^_+/, '');
        responseFilePath = path.resolve('./auto-mock-post', `POST_${safePath}.json`);
      }

      // 仅当文件存在时才加入映射（不自动创建）
      if (fs.existsSync(responseFilePath) && fs.statSync(responseFilePath).isFile()) {
        postRequestMap.set(requestPath, responseFilePath);
        postRequestMap.set(requestPath.replace(/^\//, ''), responseFilePath);
        console.log(`✅ [POST] 已映射：${requestPath} -> ${responseFilePath}`);
      } else {
        console.warn(`⚠️ [POST] 跳过不存在的文件：${requestPath} → ${responseFilePath}`);
      }
    });
  } else {
    console.log(`ℹ️ 未找到请求记录文件：${rawRequestFullPath}（不影响核心功能）`);
  }

  // 打印已映射路径
  console.log(`\n📋 已映射的POST接口路径列表：`);
  postRequestMap.forEach((value, key) => {
    console.log(`   → ${key} → ${value}`);
  });

} catch (err) {
  console.error('❌ 初始化失败：', err.message);
  process.exit(1);
}

// 2. 中间件：解析 POST 请求体 + 静态资源托管
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));
app.use(express.static(STATIC_DIR, {
  extensions: ['html'],
  cacheControl: false,
  setHeaders: (res, filePath) => {
    if (filePath.endsWith('.svg')) {
      res.setHeader('Content-Type', 'image/svg+xml');
    }
    // 为.do文件设置JSON响应头
    if (filePath.endsWith('.do')) {
      res.setHeader('Content-Type', 'application/json');
    }
  }
}));

// 3. 核心逻辑：优先匹配原后缀文件，再匹配任意后缀，无匹配则404
app.post(/^\/(.*)$/, (req, res) => {
  const originalRequestPath = req.path;
  const requestPath = normalizePath(originalRequestPath);
  
  // 增强排查日志（新增原后缀路径打印）
  console.log(`\n🔍 收到POST请求：`);
  console.log(`   原始路径：${originalRequestPath}`);
  console.log(`   标准化路径（含后缀）：${requestPath}`);
  console.log(`   原后缀文件路径：${path.resolve(path.join(STATIC_DIR, requestPath.replace(/^\//, '')))}`);
  console.log(`   已映射的POST路径：${Array.from(postRequestMap.keys()).join(', ')}`);

  // 步骤1：优先匹配原后缀文件（核心修复）
  const matchFilePath = findAnyExtFile(requestPath);
  if (matchFilePath) {
    try {
      const content = fs.readFileSync(matchFilePath, 'utf8');
      // 尝试解析为JSON（兼容所有后缀的JSON内容）
      let responseData = null;
      try {
        responseData = JSON.parse(content);
      } catch (e) {
        responseData = content; // 非JSON则返回文本
      }
      res.setHeader('Content-Type', 'application/json');
      return res.status(200).send(responseData);
    } catch (err) {
      console.error(`❌ 读取文件失败：${matchFilePath}`, err.message);
      return res.status(500).json({
        code: 500,
        msg: '读取静态文件失败',
        error: err.message,
        filePath: matchFilePath
      });
    }
  }

  // 步骤2：匹配初始化的Mock映射（保留原有逻辑）
  let responseFilePath = null;
  responseFilePath = postRequestMap.get(requestPath);
  if (!responseFilePath) responseFilePath = postRequestMap.get(requestPath.replace(/^\//, ''));
  if (!responseFilePath) responseFilePath = postRequestMap.get(`${requestPath}.json`);
  if (!responseFilePath) responseFilePath = postRequestMap.get(`${requestPath.replace(/^\//, '')}.json`);

  console.log(`📌 匹配Mock映射结果：${responseFilePath || '未找到'}`);

  if (responseFilePath) {
    try {
      const ext = path.extname(responseFilePath).toLowerCase();
      if (ext === '.json') {
        const content = fs.readFileSync(responseFilePath, 'utf8');
        const jsonData = JSON.parse(content);
        res.setHeader('Content-Type', 'application/json');
        return res.status(200).send(jsonData);
      } else {
        return res.sendFile(responseFilePath);
      }
    } catch (err) {
      console.error(`❌ 读取Mock文件失败：${requestPath}`, err.message);
      return res.status(500).json({
        code: 500,
        msg: '读取Mock文件失败',
        error: err.message
      });
    }
  }

  // 步骤3：无任何匹配 → 直接返回404（无任何Mock创建）
  console.warn(`❌ 未找到任何匹配文件：${requestPath}`);
  return res.status(404).json({
    code: 404,
    msg: '未找到对应的接口响应文件',
    requestPath: originalRequestPath,
    actualCheckPath: path.resolve(path.join(STATIC_DIR, requestPath.replace(/^\//, ''))),
    tip: '请确认文件路径/名称是否正确，且文件存在于静态资源目录'
  });
});

// 4. 启动服务
app.listen(PORT, () => {
  console.log('\n🚀 静态文件Mock服务已启动！');
  console.log(`🌐 访问地址：http://localhost:${PORT}`);
  console.log(`📋 已加载 POST 接口 Mock 数量：${postRequestMap.size}`);
  console.log(`✅ 匹配规则：`);
  console.log(`   - 优先：请求 /common/wapi/SYPAMDTA.do → 匹配 common/wapi/SYPAMDTA.do`);
  console.log(`   - 降级：请求 /common/wapi/SYPAMDTA.do → 匹配 common/wapi/SYPAMDTA（任意后缀）`);
  console.log(`   - 无匹配 → 直接返回404（不创建任何Mock文件）`);
});