const express = require('express');
const fs = require('fs');
const path = require('path');
const app = express();

// ===================== 极简配置（无需修改） =====================
const PORT = 5000;
const RAW_REQUEST_FILE = './raw-requests.json'; // 你的请求记录文件
const STATIC_DIR = './'; // 静态资源根目录（和 Live Server 一致）
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

// 工具函数3：增强版文件匹配（核心修改：无后缀时优先尝试.json）
function findAnyExtFile(requestPath) {
  // 步骤1：标准化路径（保留原后缀）
  const normalizedPath = normalizePath(requestPath);
  const hasExt = path.extname(normalizedPath) !== ''; // 判断是否有后缀

  // ===== 新增：无后缀时优先尝试拼接.json后缀匹配 =====
  let jsonFilePath = null;
  if (!hasExt) {
    // 拼接.json后缀（两种变体：去掉/保留前导斜杠）
    jsonFilePath = path.resolve(path.join(STATIC_DIR, normalizedPath.replace(/^\//, '') + '.json'));
    if (fs.existsSync(jsonFilePath) && fs.statSync(jsonFilePath).isFile()) {
      console.log(`✅ 无后缀请求，匹配到JSON文件：${jsonFilePath}`);
      return jsonFilePath;
    }
    // 兜底：保留前导斜杠的.json路径
    const jsonFilePathWithSlash = path.resolve(path.join(STATIC_DIR, normalizedPath + '.json'));
    if (fs.existsSync(jsonFilePathWithSlash) && fs.statSync(jsonFilePathWithSlash).isFile()) {
      console.log(`✅ 无后缀请求，匹配到带前导斜杠的JSON文件：${jsonFilePathWithSlash}`);
      return jsonFilePathWithSlash;
    }
  }

  // ===== 原有逻辑：优先匹配原后缀文件 =====
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

  // ===== 原有逻辑：降级匹配同名任意后缀文件 =====
  const basePath = getBasePathWithoutExt(normalizedPath);
  const fullBasePath = path.resolve(path.join(STATIC_DIR, basePath.replace(/^\//, '')));
  const dir = path.dirname(fullBasePath);
  const fileName = path.basename(fullBasePath);

  if (fs.existsSync(dir) && fs.statSync(dir).isDirectory()) {
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

  console.log(`⚠️ 未找到任何匹配文件：原路径=${fullPathWithExt} | JSON路径=${jsonFilePath} | 基础路径=${fullBasePath}`);
  return null;
}

// 1. 过滤静态资源后缀（新增.do，避免被误判）
// const STATIC_EXTENSIONS = ['.html', '.css', '.js', '.png', '.jpg', '.jpeg', '.gif', '.svg', '.ico', '.txt', '.json', '.do'];
// function isStaticFile(url) {
//   return STATIC_EXTENSIONS.some(ext => url.endsWith(ext));
// }

// 初始化：仅加载请求记录（移除自动创建Mock文件逻辑）
let requestMap = new Map(); // 修改：支持所有方法，不再仅POST
try {
  const rawRequestFullPath = path.resolve(RAW_REQUEST_FILE);
  console.log(`🔍 正在读取请求记录文件：${rawRequestFullPath}`);
  
  if (fs.existsSync(rawRequestFullPath)) {
    const rawData = fs.readFileSync(rawRequestFullPath, 'utf8');
    const requests = JSON.parse(rawData);
    console.log(`📄 共读取到 ${requests.length} 条请求记录`);

    // 加载所有方法的映射（不再仅过滤POST）
    requests.forEach((reqInfo, index) => {
      const method = (reqInfo.method || reqInfo.requestMethod || reqInfo.httpMethod || 'GET').toUpperCase();
      const originalPath = reqInfo.path || reqInfo.requestUrl || reqInfo.url || reqInfo.uri;
      const requestPath = normalizePath(originalPath);
      if (!requestPath) return;

      let responseFilePath = '';
      if (reqInfo.responseFilePath) {
        responseFilePath = path.resolve(reqInfo.responseFilePath);
      } else {
        const safePath = requestPath.replace(/[\/:?&=]/g, '_').replace(/^_+/, '');
        responseFilePath = path.resolve('./auto-mock', `${method}_${safePath}.json`); // 修改：通用Mock目录
      }

      // 仅当文件存在时才加入映射（不自动创建）
      if (fs.existsSync(responseFilePath) && fs.statSync(responseFilePath).isFile()) {
        const mapKey = `${method}_${requestPath}`; // 新增：方法+路径作为唯一key
        requestMap.set(mapKey, responseFilePath);
        requestMap.set(`${method}_${requestPath.replace(/^\//, '')}`, responseFilePath);
        console.log(`✅ [${method}] 已映射：${requestPath} -> ${responseFilePath}`);
      } else {
        console.warn(`⚠️ [${method}] 跳过不存在的文件：${requestPath} → ${responseFilePath}`);
      }
    });
  } else {
    console.log(`ℹ️ 未找到请求记录文件：${rawRequestFullPath}（不影响核心功能）`);
  }

  // 打印已映射路径
  console.log(`\n📋 已映射的接口路径列表：`);
  requestMap.forEach((value, key) => {
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

// 核心通用处理函数（提取GET/POST共用逻辑）
function handleRequest(req, res) {
  const method = req.method.toUpperCase();
  const originalRequestPath = req.path;
  const requestPath = normalizePath(originalRequestPath);
  
  // 增强排查日志（新增JSON路径打印）
  console.log(`\n🔍 收到${method}请求：`);
  console.log(`   原始路径：${originalRequestPath}`);
  console.log(`   标准化路径（含后缀）：${requestPath}`);
  console.log(`   JSON尝试路径：${path.resolve(path.join(STATIC_DIR, requestPath.replace(/^\//, '') + '.json'))}`);
  console.log(`   原后缀文件路径：${path.resolve(path.join(STATIC_DIR, requestPath.replace(/^\//, '')))}`);

  // 步骤1：优先匹配文件（核心：无后缀自动试.json）
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

  // 步骤2：匹配初始化的Mock映射（支持所有方法）
  let responseFilePath = null;
  const mapKey1 = `${method}_${requestPath}`;
  const mapKey2 = `${method}_${requestPath.replace(/^\//, '')}`;
  const mapKey3 = `${method}_${requestPath}.json`;
  const mapKey4 = `${method}_${requestPath.replace(/^\//, '')}.json`;
  
  responseFilePath = requestMap.get(mapKey1) || requestMap.get(mapKey2) || requestMap.get(mapKey3) || requestMap.get(mapKey4);

  console.log(`📌 匹配${method} Mock映射结果：${responseFilePath || '未找到'}`);

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
  console.warn(`❌ 未找到任何匹配文件：${method} ${requestPath}`);
  return res.status(404).json({
    code: 404,
    msg: '未找到对应的接口响应文件',
    requestMethod: method,
    requestPath: originalRequestPath,
    actualCheckPath: path.resolve(path.join(STATIC_DIR, requestPath.replace(/^\//, ''))),
    jsonCheckPath: path.resolve(path.join(STATIC_DIR, requestPath.replace(/^\//, '') + '.json')),
    tip: '请确认文件路径/名称是否正确，且文件存在于静态资源目录'
  });
}

// 3. 核心路由：支持GET/POST（共用处理逻辑）
app.get(/^\/(.*)$/, handleRequest);
app.post(/^\/(.*)$/, handleRequest);

// 4. 启动服务
app.listen(PORT, () => {
  console.log('\n🚀 静态文件Mock服务已启动！');
  console.log(`🌐 访问地址：http://localhost:${PORT}`);
  console.log(`📋 已加载接口 Mock 数量：${requestMap.size}`);
  console.log(`✅ 匹配规则：`);
  console.log(`   - 无后缀请求：/xft-gateway/xxx/get → 优先匹配 xft-gateway/xxx/get.json`);
  console.log(`   - 有后缀请求：/common/wapi/SYPAMDTA.do → 优先匹配 common/wapi/SYPAMDTA.do`);
  console.log(`   - 降级匹配：请求路径 → 匹配同名任意后缀文件`);
  console.log(`   - 无匹配 → 直接返回404（不创建任何Mock文件）`);
  console.log(`   - 支持 GET/POST 两种请求方法`);
});