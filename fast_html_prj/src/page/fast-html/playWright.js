// page-recorder.js（多线程写入版：解决请求写入丢失问题）
const fs = require("fs-extra");
const path = require("path");
const { Worker } = require('worker_threads'); // 引入Worker线程
// 兼容性补丁：某些依赖（undici 的 webidl）在旧版 Node 中期望全局 File
if (typeof File === "undefined") {
  global.File = class File {};
}
const { firefox } = require("playwright");
const cheerio = require("cheerio");

// 全局状态：控制录制启停、存储请求数据
const recordState = {
  isRecording: false,
  allRequests: [], // 存储所有原始请求/响应数据
  htmlSnapshots: [], // 存储HTML快照
  browser: null, // 浏览器实例
  outputDir: "./record-requests", // 仅存储请求数据的目录
  requestIdCounter: 1, // 唯一请求ID，便于追踪
  snapshotIdCounter: 1, // HTML快照ID
  // Worker相关状态
  writerWorker: null, // 文件写入Worker实例
  workerReady: false, // Worker是否就绪
  taskQueue: [], // 待处理的写入任务队列
  taskIdCounter: 1, // 任务ID计数器
  pendingTasks: new Map(), // 等待结果的任务（taskId -> resolve/reject）
};

/**
 * 初始化文件写入Worker（单例）
 */
const initWriterWorker = async () => {
  if (recordState.writerWorker) return;

  // 创建Worker实例
  const worker = new Worker(path.join(__dirname, 'file-writer.worker.js'), {
    workerData: { outputDir: recordState.outputDir }
  });

  // 监听Worker消息
  worker.on('message', (msg) => {
    if (msg.type === 'WORKER_READY') {
      // Worker就绪，处理排队的任务
      recordState.workerReady = true;
      console.log(`📌 文件写入Worker已就绪`);
      processTaskQueue();
      return;
    }

    if (msg.type === 'EXIT_SUCCESS') {
      console.log(`📌 文件写入Worker已正常退出`);
      return;
    }

    // 处理任务结果
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

  // 监听Worker错误
  worker.on('error', (error) => {
    console.error(`❌ 文件写入Worker出错:`, error.message);
    // 拒绝所有待处理任务
    recordState.pendingTasks.forEach(({ reject }) => {
      reject(new Error(`Worker出错: ${error.message}`));
    });
    recordState.pendingTasks.clear();
    recordState.workerReady = false;
  });

  // 监听Worker退出
  worker.on('exit', (code) => {
    if (code !== 0) {
      console.error(`❌ 文件写入Worker异常退出，退出码: ${code}`);
      recordState.workerReady = false;
    }
    recordState.writerWorker = null;
  });

  recordState.writerWorker = worker;
};

/**
 * 向Worker发送任务（带重试和队列）
 */
const sendTaskToWorker = (taskType, taskData) => {
  return new Promise((resolve, reject) => {
    const taskId = recordState.taskIdCounter++;
    const task = {
      taskId,
      type: taskType,
      data: taskData
    };

    // 存储Promise的resolve/reject
    recordState.pendingTasks.set(taskId, { resolve, reject });

    // 如果Worker未就绪，加入队列；否则直接发送
    if (recordState.workerReady && recordState.writerWorker) {
      // 处理Buffer传输（避免拷贝）
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

/**
 * 处理任务队列
 */
const processTaskQueue = () => {
  if (!recordState.workerReady || !recordState.writerWorker || recordState.taskQueue.length === 0) {
    return;
  }

  // 批量发送队列中的任务
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

/**
 * 等待所有待处理任务完成
 */
const waitForAllTasks = async () => {
  if (recordState.pendingTasks.size === 0) return;

  console.log(`📌 等待${recordState.pendingTasks.size}个待处理写入任务完成...`);
  await new Promise((resolve) => {
    const checkInterval = setInterval(() => {
      if (recordState.pendingTasks.size === 0) {
        clearInterval(checkInterval);
        resolve();
      }
    }, 100);
  });
  console.log(`📌 所有写入任务已完成`);
};

/**
 * 关闭Worker
 */
const closeWriterWorker = async () => {
  if (!recordState.writerWorker) return;

  // 先等待所有任务完成
  await waitForAllTasks();

  // 发送退出指令
  recordState.writerWorker.postMessage('EXIT');
  
  // 等待Worker退出
  await new Promise((resolve) => {
    recordState.writerWorker.on('exit', resolve);
  });
  
  recordState.writerWorker = null;
  recordState.workerReady = false;
};

/**
 * 初始化输出目录（通过Worker处理）
 */
const initOutputDir = async (outputDir) => {
  // 先初始化Worker
  await initWriterWorker();
  
  // 发送初始化目录任务
  await sendTaskToWorker('initOutputDir', { outputDir });
  
  recordState.outputDir = outputDir;
  console.log(`📁 请求数据输出目录已初始化（已清空旧内容）：${path.resolve(outputDir)}`);
};

/**
 * 监听单个页面的所有网络请求（原封不动捕获）
 * @param {import('playwright').Page} page 页面实例
 */
const listenPageRequests = (page) => {
  // 监听请求发起（捕获原始请求数据）
  page.on("request", (request) => {
    // 临时日志：打印所有请求的类型和URL
    console.log(`[所有请求] type: ${request.resourceType()}, url: ${request.url()}`);
    if (!recordState.isRecording) return;

    // 扩展资源类型捕获，包括文档和脚本等可能影响HTML的内容
    const resourceType = request.resourceType();

    // 生成唯一请求ID，便于关联请求和响应
    const requestId = `req_${recordState.requestIdCounter++}`;

    // 原封不动存储请求原始数据
    const rawRequest = {
      requestId: requestId,
      timestamp: new Date().toISOString(),
      pageUrl: page.url(), // 请求所属页面
      resourceType: resourceType,
      url: request.url(), // 完整原始URL
      method: request.method(),
      headers: request.headers(), // 原始请求头
      postData: request.postData() || null, // 原始POST数据（不解析、不修改）
      response: null, // 后续填充响应数据
    };

    recordState.allRequests.push(rawRequest);
    console.log(`📤 [${requestId}] ${request.method()} ${request.url()}`);
  });

  // 监听请求响应（捕获原始响应数据）
  page.on("response", async (response) => {
    if (!recordState.isRecording) return;
    const request = response.request();
    // 匹配对应的请求记录
    const reqRecord = recordState.allRequests.find((item) => {
      // 匹配URL和方法，以及页面URL
      const isUrlMatch = item.url === request.url();
      const isMethodMatch = item.method === request.method();

      // 为了兼容性，我们只检查URL和方法
      return isUrlMatch && isMethodMatch;
    });

    if (!reqRecord) {
      // 如果找不到匹配项，创建一个新的记录
      const requestId = `req_${recordState.requestIdCounter++}`;
      const rawRequest = {
        requestId: requestId,
        timestamp: new Date().toISOString(),
        pageUrl: page.url(),
        resourceType: request.resourceType(),
        url: request.url(),
        method: request.method(),
        headers: request.headers(),
        postData: request.postData() || null,
        response: request.text(),
      };
      recordState.allRequests.push(rawRequest);
      console.log(`📤 [${requestId}] New request captured: ${request.method()} ${request.url()}`);
    }

    // todoooooo
    if (!reqRecord) return;

    try {
      // 原封不动获取响应数据：先获取原始二进制数据，再转字符串（避免解析JSON破坏格式）
      let responseBody;
      try {
        // 尝试获取响应体（Buffer）
        responseBody = await response.body();
      } catch (e) {
        console.warn(`⚠️ [${reqRecord.requestId}] Could not get response body via Playwright:`, e.message);
        responseBody = Buffer.from("");
      }

      // 如果 Playwright 未能返回 body（某些响应 streaming/重定向），用 node fetch 回退一次
      try {
        if ((!responseBody || responseBody.length === 0) && response.status() < 400) {
          const hdrs = response.headers ? response.headers() : {};
          const fetched = await fetchResource(response.url(), { referer: reqRecord.pageUrl || "", "user-agent": hdrs["user-agent"] || hdrs["User-Agent"] || "Playwright", cookie: "" });
          if (fetched && fetched.buffer && fetched.buffer.length > 0) {
            responseBody = fetched.buffer;
          }
        }
      } catch (e) {
        // ignore fallback errors
      }

      // 尝试将响应体保存为独立资源文件（通过Worker处理）
      let localPath = null;
      try {
        localPath = await sendTaskToWorker('saveResourceBuffer', {
          url: request.url(),
          buffer: responseBody,
          headers: response.headers(),
          outputDir: recordState.outputDir
        });
      } catch (e) {
        console.warn(`⚠️ 保存资源失败: ${request.url()}`, e.message);
      }

      const rawResponse = {
        status: response.status(),
        statusText: response.statusText(),
        headers: response.headers(), // 原始响应头
        localPath: localPath, // 相对于 outputDir 的资源路径
        bodySize: responseBody ? responseBody.length : 0,
        timing: new Date().getTime() - new Date(reqRecord.timestamp).getTime(), // 响应时间（毫秒）
      };

      // 原封不动填充响应数据（不将原始二进制直接嵌入 JSON，节省空间）
      reqRecord.response = rawResponse;
      console.log(`📥 [${reqRecord.requestId}] ${response.status()} ${request.url()} -> ${localPath || "no-file"}`);
    } catch (e) {
      // 捕获失败时仅记录错误，不修改原始数据
      reqRecord.response = {
        status: 500,
        error: `获取响应失败：${e.message}`,
        timestamp: new Date().toISOString(),
      };
      console.error(`❌ [${reqRecord.requestId}] 获取响应失败：${e.message}`);
    }
  });

  // 监听请求失败（补充捕获失败的请求）
  page.on("requestfailed", (request) => {
    if (!recordState.isRecording) return;

    const reqRecord = recordState.allRequests.find((item) => {
      try {
        const requestUrl = request.url();
        const requestMethod = request.method();

        let pageUrl = "";
        if (typeof request.page === "function") {
          const pageObj = request.page();
          if (pageObj && typeof pageObj.url === "function") {
            pageUrl = pageObj.url();
          }
        }

        return item.url === requestUrl && item.method === requestMethod && item.pageUrl === pageUrl && !item.response;
      } catch (error) {
        console.warn("匹配失败请求时出错:", error.message);
        return false;
      }
    });

    if (reqRecord) {
      reqRecord.response = {
        status: 0,
        error: `请求失败：${request.failure()?.errorText || "未知错误"}`,
        timestamp: new Date().toISOString(),
      };
      console.error(`❌ [${reqRecord.requestId}] 请求失败：${request.failure()?.errorText}`);
    }
  });
};

// 使用 node fetch（全局 fetch）获取资源，返回 {status, headers, buffer}
const fetchResource = async (absolute, headers = {}) => {
  try {
    const res = await fetch(absolute, { headers: Object.assign({ accept: "*/*" }, headers), redirect: "follow" });
    if (!res) return null;
    const status = res.status || 0;
    const buf = Buffer.from(await res.arrayBuffer());
    const hdrs = {};
    try {
      res.headers.forEach((v, k) => {
        hdrs[k.toLowerCase()] = v;
      });
    } catch (e) {}
    return { status, headers: hdrs, buffer: buf };
  } catch (e) {
    return null;
  }
};

// 获取指定 URL 的 Cookie header（从当前 page context 中读取）
const getCookiesHeader = async (page, url) => {
  try {
    if (!page || !page.context) return "";
    const cookies = await page.context().cookies(url);
    if (!cookies || cookies.length === 0) return "";
    return cookies.map((c) => `${c.name}=${c.value}`).join("; ");
  } catch (e) {
    return "";
  }
};

// 计算从 snapshot 文件到资源文件的相对路径（用于在 snapshot 中引用资源）
const toSnapshotRelative = (savedRel, snapshotFilePath) => {
  try {
    const absResource = path.join(recordState.outputDir, savedRel);
    let relPath = path.relative(path.dirname(snapshotFilePath), absResource).replace(/\\/g, "/");
    if (!relPath.startsWith(".") && !relPath.startsWith("/")) relPath = "./" + relPath;
    return relPath;
  } catch (e) {
    return savedRel.replace(/\\/g, "/");
  }
};

/**
 * 获取页面的完整HTML，包括动态内容
 */
const getFullPageHtml = async (page) => {
  try {
    // 等待页面完全加载（networkidle 优先）
    try {
      await page.waitForLoadState("networkidle", { timeout: 10000 });
    } catch (e) {
      // networkidle 可能超时，继续
    }

    // 小滚动触发懒加载（确保图片/资源触发加载）
    try {
      await page.evaluate(async () => {
        const total = Math.max(document.body.scrollHeight, document.documentElement.scrollHeight);
        const step = Math.ceil(total / 6);
        for (let y = 0; y <= total; y += step) {
          window.scrollTo(0, y);
          await new Promise((r) => setTimeout(r, 150));
        }
        window.scrollTo(0, 0);
        await new Promise((r) => setTimeout(r, 300));
      });
    } catch (e) {
      // 忽略滚动失败
    }

    // 获取完整的页面HTML，包括动态生成的内容
    const html = await page.content();

    // 获取页面标题
    const title = await page.title();

    return { html, title };
  } catch (error) {
    console.error("❌ 获取完整页面HTML失败:", error.message);
    return { html: "", title: "Error" };
  }
};

/**
 * 保存完整的、可用的HTML快照（通过Worker处理写入）
 */
const captureHtmlSnapshot = async (page, actionDescription = "initial") => {
  if (!recordState.isRecording) return;

  try {
    // 获取完整页面内容
    const { html, title } = await getFullPageHtml(page);

    const url = page.url();
    const timestamp = new Date().toISOString();
    const snapshotId = `snapshot_${recordState.snapshotIdCounter++}`;

    // 创建安全的文件名
    const sanitizedFilename = (() => {
      try {
        let cleanUrl = String(url || "").replace(/^https?:\/\//, "");
        cleanUrl = cleanUrl.replace(/[<>:\"/\\|?*]/g, "_");
        if (cleanUrl.length > 150) cleanUrl = cleanUrl.substring(0, 150);
        if (!cleanUrl) cleanUrl = "unnamed";
        return cleanUrl;
      } catch (e) {
        return "unnamed";
      }
    })();
    
    const fileName = `${snapshotId}_${sanitizedFilename}.html`;
    const filePath = path.join(recordState.outputDir, "html_snapshots", fileName);

    // 尝试保存完整的可用HTML
    let fullHtml = html;

    // 主动抓取页面所需资源并保存为本地文件，重写 HTML 中对应的引用
    try {
      const $ = cheerio.load(html, { decodeEntities: false });
      const comment = `Captured at: ${timestamp} | Action: ${actionDescription} | URL: ${url}`;
      $("html").append(`<!-- ${comment} -->`);

      const resolveUrl = (raw) => {
        try {
          return new URL(raw, url).href;
        } catch (e) {
          return raw;
        }
      };

      // 收集需要下载的资源 selectors
      const resourceAttrs = [
        { sel: 'link[rel="stylesheet"]', attr: "href" },
        { sel: "script[src]", attr: "src" },
        { sel: "img[src]", attr: "src" },
        { sel: "img[data-src]", attr: "data-src" },
        { sel: "img[srcset]", attr: "srcset" },
        { sel: "source[src]", attr: "src" },
        { sel: "source[srcset]", attr: "srcset" },
        { sel: "iframe[src]", attr: "src" },
        { sel: "video[poster]", attr: "poster" },
        { sel: "audio[src]", attr: "src" },
        { sel: 'link[rel~="icon"]', attr: "href" },
      ];

      const urls = new Map(); // absoluteUrl -> {elements: [{el,attr}], type: 'css'|'js'|...}

      for (const r of resourceAttrs) {
        $(r.sel).each((i, el) => {
          const $el = $(el);
          const raw = $el.attr(r.attr);
          if (!raw) return;
          // srcset may contain multiple URLs
          if (r.attr === "srcset") {
            const parts = String(raw)
              .split(",")
              .map((p) => p.trim());
            for (const p of parts) {
              const urlOnly = p.split(" ")[0];
              const absolute = resolveUrl(urlOnly);
              if (!absolute || String(absolute).startsWith("data:")) continue;
              if (!urls.has(absolute)) urls.set(absolute, { elements: [], attr: r.attr });
              urls.get(absolute).elements.push({ el: el, attr: r.attr, original: raw });
            }
          } else {
            const absolute = resolveUrl(raw);
            if (!absolute || String(absolute).startsWith("data:")) return;
            if (!urls.has(absolute)) urls.set(absolute, { elements: [], attr: r.attr });
            urls.get(absolute).elements.push({ el: el, attr: r.attr, original: raw });
          }
        });
      }

      // 另外扫描内联 style 属性中的 url(...)（例如 background-image）
      $("[style]").each((i, el) => {
        const s = $(el).attr("style") || "";
        const matches = [...s.matchAll(/url\((?:'|\")?(.*?)(?:'|\")?\)/g)];
        for (const m of matches) {
          const inner = m[1];
          if (!inner) continue;
          const absolute = resolveUrl(inner);
          if (!absolute || String(absolute).startsWith("data:")) continue; // 保留 data: URI 原样
          if (!urls.has(absolute)) urls.set(absolute, { elements: [], attr: "style" });
          urls.get(absolute).elements.push({ el: el, attr: "style", original: s, match: m[0] });
        }
      });

      // 尝试获取页面 userAgent（用于请求头）
      let pageUA = "";
      try {
        pageUA = await page.evaluate(() => navigator.userAgent);
      } catch (e) {
        pageUA = "Playwright";
      }

      // 对每个资源执行请求并保存为本地文件
      for (const [absolute, info] of urls.entries()) {
        try {
          // 如果已经在 recordState 中捕获了该请求并保存了本地文件，优先复用已有文件
          const existing = recordState.allRequests.find((r) => r.url === absolute && r.response && r.response.localPath);
          if (existing && existing.response.localPath) {
            const rel = toSnapshotRelative(existing.response.localPath.replace(/\\/g, "/"), filePath);
            for (const item of info.elements) {
              if (item.attr === "style") {
                const cur = $(item.el).attr("style") || "";
                const replaced = cur.split(item.match).join(`url(${rel})`);
                $(item.el).attr("style", replaced);
              } else if (item.attr === "srcset") {
                const original = $(item.el).attr("srcset") || item.original || "";
                const replaced = original.split(item.original).join(
                  original
                    .split(",")
                    .map((p) => {
                      const u = p.trim().split(" ")[0];
                      if (new URL(u, url).href === absolute) {
                        const suffix = p.trim().slice(u.length);
                        return `${rel}${suffix}`;
                      }
                      return p;
                    })
                    .join(", "),
                );
                $(item.el).attr("srcset", replaced);
              } else {
                $(item.el).attr(item.attr, rel);
              }
            }
            continue;
          }

          // 构造请求头：referer + UA + cookie（针对具体资源）
          const headersForFetch = { referer: url, "user-agent": pageUA };
          try {
            const cks = await page
              .context()
              .cookies(absolute)
              .catch(() => []);
            if (Array.isArray(cks) && cks.length > 0) {
              const cookieStr = cks.map((c) => `${c.name}=${c.value}`).join("; ");
              headersForFetch.cookie = cookieStr;
            }
          } catch (e) {
            // ignore
          }

          // 先尝试使用 node fetch 来获取资源（更可靠）
          const fetched = await fetchResource(absolute, headersForFetch);
          if (!fetched || fetched.status >= 400) {
            console.warn(`⚠️ 无法获取资源 ${absolute} (status:${fetched ? fetched.status : "err"})`);
            continue;
          }

          // 处理 CSS 特殊情况：需要解析 CSS 中的 url(...) 并下载
          const contentType = (fetched.headers["content-type"] || "").toLowerCase();
          const isCss = contentType.includes("css") || absolute.endsWith(".css");
          let buffer = fetched.buffer;

          if (isCss) {
            // 解析 CSS 中的 url(...) 并下载内嵌资源
            let cssText = buffer.toString("utf8");
            const urlMatches = [...cssText.matchAll(/url\((?:'|")?(.*?)(?:'|")?\)/g)];
            for (const m of urlMatches) {
              const inner = m[1];
              if (!inner) continue;
              const innerAbs = resolveUrl(inner);
              try {
                const innerCookies = await getCookiesHeader(page, innerAbs);
                const rr = await fetchResource(innerAbs, { referer: absolute, "user-agent": pageUA, cookie: innerCookies });
                if (rr && rr.status < 400) {
                  const innerBuf = rr.buffer;
                  // 保存内嵌资源（通过Worker）
                  const saved = await sendTaskToWorker('saveResourceBuffer', {
                    url: innerAbs,
                    buffer: innerBuf,
                    headers: rr.headers,
                    outputDir: recordState.outputDir
                  });
                  if (saved) {
                    const rel = toSnapshotRelative(saved.replace(/\\/g, "/"), filePath);
                    cssText = cssText.split(m[0]).join(`url(${rel})`);
                  }
                }
              } catch (e) {
                console.warn("⚠️ CSS 内部资源下载失败", innerAbs, e.message);
              }
            }

            // 保存修改后的 CSS（通过Worker）
            const savedCssPath = await sendTaskToWorker('saveResourceBuffer', {
              url: absolute,
              buffer: Buffer.from(cssText, "utf8"),
              headers: fetched.headers,
              outputDir: recordState.outputDir
            });
            if (savedCssPath) {
              // 更新所有引用该 CSS 的元素的 href 为相对路径
              const rel = toSnapshotRelative(savedCssPath.replace(/\\/g, "/"), filePath);
              for (const item of info.elements) {
                $(item.el).attr(item.attr, rel);
              }
            }
          } else {
            // 普通资源（JS/图片/font等），保存为二进制（通过Worker）
            const saved = await sendTaskToWorker('saveResourceBuffer', {
              url: absolute,
              buffer: buffer,
              headers: fetched.headers,
              outputDir: recordState.outputDir
            });
            if (saved) {
              const rel = toSnapshotRelative(saved.replace(/\\/g, "/"), filePath);
              for (const item of info.elements) {
                if (item.attr === "style") {
                  // 替换元素 style 中的匹配片段
                  const cur = $(item.el).attr("style") || "";
                  const replaced = cur.split(item.match).join(`url(${rel})`);
                  $(item.el).attr("style", replaced);
                } else if (item.attr === "srcset") {
                  // 替换 srcset 中对应的 URL
                  const original = $(item.el).attr("srcset") || item.original || "";
                  const replaced = original.split(item.original).join(
                    original
                      .split(",")
                      .map((p) => {
                        const u = p.trim().split(" ")[0];
                        if (new URL(u, url).href === absolute) {
                          const suffix = p.trim().slice(u.length);
                          return `${rel}${suffix}`;
                        }
                        return p;
                      })
                      .join(", "),
                  );
                  $(item.el).attr("srcset", replaced);
                } else {
                  $(item.el).attr(item.attr, rel);
                }
              }
            }
          }
        } catch (e) {
          console.warn("⚠️ 处理资源失败:", absolute, e.message);
        }
      }

      // 注入覆盖样式，强制允许纵向滚动，避免某些 CSS 导致只显示首屏
      try {
        $("head").prepend("<style>html,body{height:auto!important;overflow-y:auto!important;}</style>");
      } catch (e) {
        console.warn("注入覆盖样式失败", e.message);
      }
      fullHtml = "<!DOCTYPE html>\n" + $.root().html();
    } catch (e) {
      console.warn("⚠️ 使用 cheerio 处理并下载资源失败，回退为原始 HTML：", e.message);
      fullHtml = html;
    }

    // 如果无法通过DOM方式处理，则直接保存原始HTML
    if (!fullHtml || fullHtml === "") {
      fullHtml = html;
    }

    // 添加捕获信息作为注释
    const fullHtmlWithInfo = `<!-- \nCaptured at: ${timestamp}\nAction: ${actionDescription}\nURL: ${url}\nTitle: ${title}\n-->\n${fullHtml}`;

    // 保存HTML到单独文件（通过Worker处理）
    await sendTaskToWorker('writeHtmlFile', {
      filePath,
      content: fullHtmlWithInfo
    });

    // 保存快照元数据
    const htmlSnapshot = {
      snapshotId,
      action: actionDescription,
      timestamp,
      url,
      title,
      filePath, // 保存文件路径而不是HTML内容
    };

    recordState.htmlSnapshots.push(htmlSnapshot);
    console.log(`📸 [${snapshotId}] 完整HTML快照已保存: ${actionDescription} - ${url} -> ${fileName}`);
  } catch (error) {
    console.error("❌ 获取完整HTML快照失败:", error.message);
  }
};

/**
 * 开始录制：捕获请求/响应和HTML变化
 */
const startRecord = async (page) => {
  if (recordState.isRecording) {
    console.log("⚠️ 已在录制中，无需重复开始");
    return;
  }
  recordState.isRecording = true;

  // 立即捕获当前页面的HTML
  console.log("🔍 开始录制，正在捕获当前页面HTML...");
  await captureHtmlSnapshot(page, "start_recording");

  // 监听已有页面 + 新打开的页面
  const pages = recordState.browser.contexts()[0].pages();
  pages.forEach(listenPageRequests);

  // 监听新页面创建（确保多页面请求都被捕获）
  recordState.browser.contexts()[0].on("page", (newPage) => {
    console.log(`🆕 检测到新页面：${newPage.url()}`);
    listenPageRequests(newPage);
    // 捕获新页面的HTML
    setTimeout(async () => {
      if (recordState.isRecording) {
        await captureHtmlSnapshot(newPage, "new_page");
      }
    }, 1000); // 等待页面加载后再捕获
  });

  console.log("\n====================================");
  console.log("✅ 开始录制请求和HTML变化！");
  console.log("✅ 当前页面HTML已捕获");
  console.log("✅ 所有XHR/Fetch请求将被原封不动捕获");
  console.log("✅ 页面HTML变化也将被记录");
  console.log('✅ 输入 "stop" 并回车停止录制');
  console.log("====================================\n");
};

/**
 * 停止录制：保存所有原始请求/响应数据和HTML快照（通过Worker处理）
 */
const stopRecord = async () => {
  if (!recordState.isRecording) {
    console.log("⚠️ 未在录制中，无需停止");
    return;
  }
  recordState.isRecording = false;

  try {
    // 1. 确保输出目录存在
    await fs.ensureDir(recordState.outputDir);

    // 2. 原封不动保存所有请求数据（通过Worker）
    const requestsFilePath = path.resolve(recordState.outputDir, "raw-requests.json");
    await sendTaskToWorker('writeJsonFile', {
      filePath: requestsFilePath,
      data: recordState.allRequests,
      pretty: true
    });

    // 3. 保存HTML快照元数据（通过Worker）
    const htmlSnapshotsMetadataPath = path.resolve(recordState.outputDir, "html-snapshots-metadata.json");
    await sendTaskToWorker('writeJsonFile', {
      filePath: htmlSnapshotsMetadataPath,
      data: recordState.htmlSnapshots,
      pretty: true
    });

    // 4. 生成录制汇总（通过Worker）
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
    await sendTaskToWorker('writeJsonFile', {
      filePath: summaryFilePath,
      data: summary,
      pretty: true
    });

    // 等待所有写入任务完成
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

    // 优化：录制结束后不清除浏览器和登录数据，允许用户继续使用
    console.log("💡 浏览器将继续保持打开状态，登录数据已保存");
    console.log('💡 如需继续录制，请重新输入 "start"');
    console.log('💡 如需退出程序，请输入 "exit"');
  } catch (error) {
    console.error("❌ 保存请求数据失败：", error);
  }
};

/**
 * 初始化浏览器（仅打开，不录制，等待手动登录）
 */
const initBrowser = async (initUrl) => {
  try {
    // 启动Firefox浏览器（保留原始配置，不修改浏览器行为）
    const browser = await firefox.launch({
      headless: false,
      viewport: { width: 1920, height: 1080 },
      slowMo: 0,
      // 禁用所有可能修改页面的配置
    });
    recordState.browser = browser;

    // 创建持久化上下文以保留登录状态
    const context = await browser.newContext({
      // 保留浏览器原始上下文，不注入任何脚本/样式
      javaScriptEnabled: true,
      ignoreHTTPSErrors: true, // 忽略HTTPS错误，确保能访问各种网站
    });
    const page = await context.newPage();
    // 优雅导航：先尝试 networkidle，失败则回退到 domcontentloaded
    try {
      await page.goto(initUrl, { waitUntil: "networkidle", timeout: 10000 });
    } catch (err) {
      console.warn("⚠️ networkidle 导航失败，降级到 domcontentloaded：", err.message);
      await page.goto(initUrl, { waitUntil: "domcontentloaded", timeout: 10000 }).catch(() => {});
    }

    // 在初始加载后捕获一次HTML
    await captureHtmlSnapshot(page, "initial_page_load");

    // 终端提示
    console.log("\n====================================");
    console.log("✅ Firefox浏览器已原生打开！");
    console.log("✅ 初始页面HTML已捕获");
    console.log("✅ 请先完成登录/页面准备操作（无任何内容修改）");
    console.log('✅ 准备完成后，输入 "start" 并回车开始录制请求和HTML变化');
    console.log('✅ 录制中输入 "stop" 并回车停止，输入 "exit" 退出');
    console.log("====================================\n");

    // 监听终端输入（鲁棒处理）
    process.stdin.setEncoding("utf8");
    process.stdin.on("data", async (input) => {
      const cmd = input.toString().trim().toLowerCase().replace(/\r|\n/g, "");
      if (cmd === "start") {
        await startRecord(page);
      } else if (cmd === "stop") {
        await stopRecord();
      } else if (cmd === "exit") {
        // 退出时关闭Worker和浏览器
        await closeWriterWorker();
        await browser.close();
        console.log("👋 已关闭浏览器和Worker，退出程序");
        process.exit(0);
      } else if (cmd) {
        console.log(`⚠️ 未知指令：${cmd}，支持指令：start/stop/exit`);
      }
    });
    // 返回 page，以便外部可以在 non-interactive/auto 模式下控制录制
    return page;
  } catch (error) {
    console.error("❌ 初始化浏览器失败：", error);
    // 出错时关闭Worker
    await closeWriterWorker();
    process.exit(1);
  }
};

/**
 * 主函数：仅初始化目录和浏览器，聚焦请求捕获
 */
const manualRecordPage = async (initUrl, outputDir) => {
  try {
    // 默认输出到项目的 assets/html/record-requests 目录，便于前端访问
    const defaultOutput = path.resolve(__dirname, "../../assets/html/record-requests");
    const finalOutput = outputDir || defaultOutput;
    
    // 初始化输出目录（同时初始化Worker）
    await initOutputDir(finalOutput);
    
    const page = await initBrowser(initUrl);

    // 支持自动录制模式：传入 --autostart 开始录制，传入 --duration=SECONDS 指定录制时长
    const argv = process.argv.slice(2).map((a) => a.trim());
    const auto = argv.includes("--autostart") || argv.includes("--auto");
    const durArg = argv.find((a) => a.startsWith("--duration="));
    const duration = durArg ? parseInt(durArg.split("=")[1], 10) : 15; // 默认15秒

    if (auto) {
      console.log(`🔁 自动录制模式：开始录制 ${duration}s`);
      await startRecord(page);
      setTimeout(
        async () => {
          await stopRecord();
          // 自动模式下退出时关闭Worker和浏览器
          await closeWriterWorker();
          await recordState.browser.close();
          console.log("🔚 自动录制完成，已退出");
          process.exit(0);
        },
        Math.max(5000, duration * 1000),
      );
    }
  } catch (error) {
    console.error("❌ 程序初始化出错：", error);
    // 出错时关闭Worker
    await closeWriterWorker();
    process.exit(1);
  }
};

// 启动时支持传入 URL 和自动化参数
const defaultUrl = process.argv[2] && !process.argv[2].startsWith("--") ? process.argv[2] : "https://example.com/";
manualRecordPage(defaultUrl);