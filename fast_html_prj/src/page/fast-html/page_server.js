const express = require('express');
const fs = require('fs');
const path = require('path');
const app = express();

// ===================== 极简配置（无需修改） =====================
const PORT = 3000;
const RAW_REQUEST_FILE = './raw-requests.json'; // 你的请求记录文件
const STATIC_DIR = './'; // 静态资源根目录（和 Live Server 一致）
// 自动创建的Mock文件存放目录（不存在则自动创建）
const MOCK_AUTO_DIR = './auto-mock-post';
// =================================================================

// 工具函数1：标准化路径（去除末尾斜杠、去掉URL参数、统一格式）
function normalizePath(urlOrPath) {
  if (!urlOrPath) return '';
  // 1. 如果是完整URL，提取path部分；如果是相对路径，直接使用
  let pathOnly = '';
  try {
    // 尝试解析为完整URL，提取path
    const urlObj = new URL(urlOrPath);
    pathOnly = urlObj.pathname;
  } catch (e) {
    // 不是完整URL，直接用相对路径
    pathOnly = urlOrPath;
  }
  // 2. 去除末尾斜杠 + 去掉URL参数（?后的内容） + 统一小写（可选，根据实际场景）
  return pathOnly.replace(/\/$/, '').split('?')[0];
}

// 工具函数2：确保目录存在（用于自动创建Mock文件）
function ensureDirExists(dir) {
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
    console.log(`📁 自动创建目录：${dir}`);
  }
}

// 新增工具函数：检查静态JSON文件是否存在（核心修复）
function checkStaticJsonFile(requestPath) {
  // 修复点1：用path.join拼接路径（兼容Windows反斜杠），避免直接字符串拼接的路径错误
  const jsonFilePath = path.resolve(path.join(STATIC_DIR, `${requestPath}.json`));
  // 检查文件是否存在且是文件（非目录）
  if (fs.existsSync(jsonFilePath) && fs.statSync(jsonFilePath).isFile()) {
    return jsonFilePath;
  }
  // 兜底匹配：尝试去掉前导斜杠的路径（解决路径带/和不带/的差异）
  const jsonFilePathNoLeadingSlash = path.resolve(path.join(STATIC_DIR, `${requestPath.replace(/^\//, '')}.json`));
  if (fs.existsSync(jsonFilePathNoLeadingSlash) && fs.statSync(jsonFilePathNoLeadingSlash).isFile()) {
    console.log(`ℹ️ 匹配到无前置斜杠的静态JSON文件：${jsonFilePathNoLeadingSlash}`);
    return jsonFilePathNoLeadingSlash;
  }
  return null;
}

// 1. 过滤静态资源后缀（避免图片/JS等被误判为接口）
const STATIC_EXTENSIONS = ['.html', '.css', '.js', '.png', '.jpg', '.jpeg', '.gif', '.svg', '.ico', '.txt', '.json'];
function isStaticFile(url) {
  return STATIC_EXTENSIONS.some(ext => url.endsWith(ext));
}

// 初始化：加载 POST 请求的 Mock 映射（核心修复路径匹配）
let postRequestMap = new Map();
try {
  // 确保自动Mock目录存在
  ensureDirExists(MOCK_AUTO_DIR);

  // 检查文件路径（增加日志，确认文件是否找到）
  const rawRequestFullPath = path.resolve(RAW_REQUEST_FILE);
  console.log(`🔍 正在读取请求记录文件：${rawRequestFullPath}`);
  
  if (!fs.existsSync(rawRequestFullPath)) {
    throw new Error(`❌ 未找到请求记录文件：${rawRequestFullPath}`);
  }

  // 读取并解析 JSON
  const rawData = fs.readFileSync(rawRequestFullPath, 'utf8');
  const requests = JSON.parse(rawData);
  console.log(`📄 共读取到 ${requests.length} 条请求记录`);

  // 遍历所有记录，仅处理 POST
  requests.forEach((reqInfo, index) => {
    // 兼容所有 method 字段名 + 转大写
    const method = (reqInfo.method || reqInfo.requestMethod || reqInfo.httpMethod || '').toUpperCase();
    console.log(`📝 第${index+1}条记录 - method：${method}`);

    if (method !== 'POST') {
      console.log(`ℹ️ 第${index+1}条记录非 POST，跳过`);
      return;
    }

    // 核心修复：兼容完整URL/相对路径，标准化路径
    const originalPath = reqInfo.path || reqInfo.requestUrl || reqInfo.url || reqInfo.uri;
    const requestPath = normalizePath(originalPath); // 标准化路径
    if (!requestPath) {
      console.warn(`⚠️ 第${index+1}条 POST 记录缺少路径（path/requestUrl/url），已忽略`);
      return;
    }
    console.log(`📝 第${index+1}条 POST 记录 - 原始路径：${originalPath} → 标准化路径：${requestPath}`);

    // 构建响应文件路径（兼容原有规则 + 增加日志）
    let responseFilePath = '';
    if (reqInfo.responseFilePath) {
      responseFilePath = path.resolve(reqInfo.responseFilePath);
      console.log(`📝 第${index+1}条记录 - 自定义响应路径：${responseFilePath}`);
    } else {
      // 替换特殊字符，生成默认路径（放到自动Mock目录）
      const safePath = requestPath.replace(/[\/:?&=]/g, '_').replace(/^_+/, '');
      responseFilePath = path.resolve(MOCK_AUTO_DIR, `POST_${safePath}.json`);
      console.log(`📝 第${index+1}条记录 - 自动生成响应路径：${responseFilePath}`);
    }

    // 验证响应文件是否存在（支持自动创建空JSON文件）
    let finalPath = null;
    if (fs.existsSync(responseFilePath)) {
      const stat = fs.statSync(responseFilePath);
      if (stat.isFile()) {
        finalPath = responseFilePath;
      } else if (stat.isDirectory()) {
        const indexFiles = ['index.json', 'index'];
        for (const file of indexFiles) {
          const idxPath = path.join(responseFilePath, file);
          if (fs.existsSync(idxPath)) {
            finalPath = idxPath;
            break;
          }
        }
      }
      console.log(`✅ 第${index+1}条记录 - 响应文件存在：${finalPath}`);
    } else {
      // 自动创建空的Mock JSON文件（方便用户填充数据）
      fs.writeFileSync(responseFilePath, JSON.stringify({
        code: 200,
        msg: 'success',
        data: {}
      }, null, 2), 'utf8');
      finalPath = responseFilePath;
      console.log(`✅ 第${index+1}条记录 - 响应文件不存在，已自动创建：${finalPath}`);
    }

    if (finalPath) {
      postRequestMap.set(requestPath, finalPath);
      // 修复点2：同时存入「去掉前导斜杠」的路径（解决key匹配不一致）
      postRequestMap.set(requestPath.replace(/^\//, ''), finalPath);
      console.log(`✅ [POST] 已映射：${requestPath} -> ${finalPath}`);
    } else {
      console.warn(`⚠️ [POST] 未找到响应文件：${requestPath}（预期路径：${responseFilePath}）`);
    }
  });

  // 打印所有已映射的POST路径（关键排查日志）
  console.log(`\n📋 已映射的POST接口路径列表：`);
  postRequestMap.forEach((value, key) => {
    console.log(`   → ${key} → ${value}`);
  });

} catch (err) {
  console.error('❌ 初始化失败：', err.message);
  process.exit(1);
}

// 2. 中间件：解析 POST 请求体 + 静态资源托管（仿 Live Server）
app.use(express.json({ limit: '10mb' })); // 解析 JSON 请求体
app.use(express.urlencoded({ extended: true, limit: '10mb' })); // 解析表单请求体
// 静态资源托管（完全兼容 Live Server，无缓存、自动匹配 index.html）
app.use(express.static(STATIC_DIR, {
  extensions: ['html'],
  cacheControl: false,
  setHeaders: (res, filePath) => {
    // 为 SVG 等资源设置正确的 Content-Type
    if (filePath.endsWith('.svg')) {
      res.setHeader('Content-Type', 'image/svg+xml');
    }
  }
}));

// 3. 核心修复：优先匹配静态JSON文件，再处理mock逻辑
app.post(/^\/(.*)$/, (req, res) => {
  // 标准化请求路径（和初始化时的路径格式保持一致）
  const originalRequestPath = req.path;
  const requestPath = normalizePath(originalRequestPath);
  
  // 增强排查日志
  console.log(`\n🔍 收到POST请求：`);
  console.log(`   原始路径：${originalRequestPath}`);
  console.log(`   标准化路径：${requestPath}`);
  console.log(`   已映射的POST路径：${Array.from(postRequestMap.keys()).join(', ')}`);

  // ===================== 核心新增：优先检查静态JSON文件 =====================
  const staticJsonPath = checkStaticJsonFile(requestPath);
  if (staticJsonPath) {
    try {
      console.log(`✅ 匹配到静态JSON文件：${staticJsonPath}`);
      const content = fs.readFileSync(staticJsonPath, 'utf8');
      const jsonData = JSON.parse(content);
      res.setHeader('Content-Type', 'application/json');
      return res.send(jsonData);
    } catch (err) {
      console.error(`❌ 读取静态JSON失败：${staticJsonPath}`, err.message);
      return res.status(500).json({
        code: 500,
        msg: '读取静态JSON文件失败',
        error: err.message
      });
    }
  }
  // ==========================================================================

  // 修复点3：多维度匹配responseFilePath（解决找不到的核心）
  let responseFilePath = null;
  // 维度1：原标准化路径
  responseFilePath = postRequestMap.get(requestPath);
  // 维度2：去掉前导斜杠的路径
  if (!responseFilePath) responseFilePath = postRequestMap.get(requestPath.replace(/^\//, ''));
  // 维度3：带.json后缀的路径
  if (!responseFilePath) responseFilePath = postRequestMap.get(`${requestPath}.json`);
  // 维度4：去掉前导斜杠 + 带.json后缀
  if (!responseFilePath) responseFilePath = postRequestMap.get(`${requestPath.replace(/^\//, '')}.json`);

  // 新增日志：打印匹配结果
  console.log(`📌 匹配responseFilePath结果：${responseFilePath || '未找到'}`);

  if (responseFilePath) {
    try {
      const ext = path.extname(responseFilePath).toLowerCase();
      // 处理 JSON 响应（接口默认返回 JSON）
      if (ext === '.json') {
        const content = fs.readFileSync(responseFilePath, 'utf8');
        const jsonData = JSON.parse(content);
        res.setHeader('Content-Type', 'application/json');
        return res.send(jsonData);
      }
      // 处理二进制/文本文件
      else {
        return res.sendFile(responseFilePath);
      }
    } catch (err) {
      console.error(`❌ [POST] 响应失败：${requestPath}`, err.message);
      return res.status(500).json({
        code: 500,
        msg: 'Mock 服务内部错误',
        error: err.message
      });
    }
  }

  // 兜底：自动创建未匹配请求的Mock文件
  const safePath = requestPath.replace(/[\/:?&=]/g, '_').replace(/^_+/, '');
  const autoMockPath = path.resolve(MOCK_AUTO_DIR, `POST_${safePath}.json`);
  // 写入默认成功响应
  fs.writeFileSync(autoMockPath, JSON.stringify({
    code: 200,
    msg: 'auto mock success',
    data: {},
    requestPath: requestPath,
    tip: '请在该文件中修改Mock数据：' + autoMockPath
  }, null, 2), 'utf8');
  // 更新postRequestMap（下次请求可直接匹配）
  postRequestMap.set(requestPath, autoMockPath);
  // 修复点4：同时存入去掉前导斜杠的路径（避免下次仍找不到）
  postRequestMap.set(requestPath.replace(/^\//, ''), autoMockPath);
  
  console.log(`✅ [POST] 未匹配接口，已自动创建Mock文件：${autoMockPath}`);
  res.status(200).json({
    code: 200,
    msg: '自动生成Mock响应（请修改文件：' + autoMockPath + '）',
    data: {},
    requestPath: requestPath
  });
});

// 4. 启动服务
app.listen(PORT, () => {
  console.log('\n🚀 Live Server + POST Mock 服务已启动！');
  console.log(`🌐 访问地址：http://localhost:${PORT}`);
  console.log(`📋 已加载 POST 接口 Mock 数量：${postRequestMap.size}`);
  console.log(`📁 自动Mock文件目录：${path.resolve(MOCK_AUTO_DIR)}`);
  console.log(`✅ 静态资源：正常加载（无警告、无报错）`);
  console.log(`✅ POST 接口：优先匹配静态JSON，再自动匹配/创建Mock响应`); // 日志更新
});