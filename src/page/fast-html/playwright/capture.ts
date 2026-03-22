// @ts-nocheck

import path from "path";
const cheerio = require("cheerio");
import { recordState } from "./state";
import { sendTaskToWorker } from "../recording/worker";

// 抓取层职责：
// - 监听请求/响应并落盘资源
// - 采集页面快照并重写资源引用
// - 保留原始请求与响应信息，便于回放/排查
export const fetchResource = async (absolute, headers = {}) => {
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

export const getCookiesHeader = async (page, url) => {
  try {
    if (!page || !page.context) return "";
    const cookies = await page.context().cookies(url);
    if (!cookies || cookies.length === 0) return "";
    return cookies.map((c) => `${c.name}=${c.value}`).join("; ");
  } catch (e) {
    return "";
  }
};

export const toSnapshotRelative = (savedRel, snapshotFilePath) => {
  try {
    const absResource = path.join(recordState.outputDir, savedRel);
    let relPath = path.relative(path.dirname(snapshotFilePath), absResource).replace(/\\/g, "/");
    if (!relPath.startsWith(".") && !relPath.startsWith("/")) relPath = "./" + relPath;
    return relPath;
  } catch (e) {
    return savedRel.replace(/\\/g, "/");
  }
};

export const listenPageRequests = (page) => {
  page.on("request", (request) => {
    console.log(`[所有请求] type: ${request.resourceType()}, url: ${request.url()}`);
    if (!recordState.isRecording) return;

    const resourceType = request.resourceType();
    const requestId = `req_${recordState.requestIdCounter++}`;

    const rawRequest = {
      requestId,
      timestamp: new Date().toISOString(),
      pageUrl: page.url(),
      resourceType,
      url: request.url(),
      method: request.method(),
      headers: request.headers(),
      postData: request.postData() || null,
      response: null,
    };

    recordState.allRequests.push(rawRequest);
    console.log(`📤 [${requestId}] ${request.method()} ${request.url()}`);
  });

  page.on("response", async (response) => {
    if (!recordState.isRecording) return;
    const request = response.request();
    const reqRecord = recordState.allRequests.find((item) => {
      const isUrlMatch = item.url === request.url();
      const isMethodMatch = item.method === request.method();
      return isUrlMatch && isMethodMatch;
    });

    if (!reqRecord) {
      const requestId = `req_${recordState.requestIdCounter++}`;
      const rawRequest = {
        requestId,
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

    if (!reqRecord) return;

    try {
      let responseBody;
      try {
        responseBody = await response.body();
      } catch (e) {
        console.warn(`⚠️ [${reqRecord.requestId}] Could not get response body via Playwright:`, e.message);
        responseBody = Buffer.from("");
      }

      try {
        if ((!responseBody || responseBody.length === 0) && response.status() < 400) {
          const hdrs = response.headers ? response.headers() : {};
          const fetched = await fetchResource(response.url(), {
            referer: reqRecord.pageUrl || "",
            "user-agent": hdrs["user-agent"] || hdrs["User-Agent"] || "Playwright",
            cookie: "",
          });
          if (fetched && fetched.buffer && fetched.buffer.length > 0) {
            responseBody = fetched.buffer;
          }
        }
      } catch (e) {}

      let localPath = null;
      try {
        localPath = await sendTaskToWorker("saveResourceBuffer", {
          url: request.url(),
          buffer: responseBody,
          headers: response.headers(),
          outputDir: recordState.outputDir,
        });
      } catch (e) {
        console.warn(`⚠️ 保存资源失败: ${request.url()}`, e.message);
      }

      reqRecord.response = {
        status: response.status(),
        statusText: response.statusText(),
        headers: response.headers(),
        localPath,
        bodySize: responseBody ? responseBody.length : 0,
        timing: new Date().getTime() - new Date(reqRecord.timestamp).getTime(),
      };
      console.log(`📥 [${reqRecord.requestId}] ${response.status()} ${request.url()} -> ${localPath || "no-file"}`);
    } catch (e) {
      reqRecord.response = {
        status: 500,
        error: `获取响应失败：${e.message}`,
        timestamp: new Date().toISOString(),
      };
      console.error(`❌ [${reqRecord.requestId}] 获取响应失败：${e.message}`);
    }
  });

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

export const getFullPageHtml = async (page) => {
  try {
    try {
      await page.waitForLoadState("networkidle", { timeout: 10000 });
    } catch (e) {}

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
    } catch (e) {}

    const html = await page.content();
    const title = await page.title();
    return { html, title };
  } catch (error) {
    console.error("❌ 获取完整页面HTML失败:", error.message);
    return { html: "", title: "Error" };
  }
};

export const captureHtmlSnapshot = async (page, actionDescription = "initial") => {
  if (!recordState.isRecording) return;

  try {
    const { html, title } = await getFullPageHtml(page);
    const url = page.url();
    const timestamp = new Date().toISOString();
    const snapshotId = `snapshot_${recordState.snapshotIdCounter++}`;

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
    let fullHtml = html;

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

      const urls = new Map();
      for (const r of resourceAttrs) {
        $(r.sel).each((i, el) => {
          const $el = $(el);
          const raw = $el.attr(r.attr);
          if (!raw) return;

          if (r.attr === "srcset") {
            const parts = String(raw).split(",").map((p) => p.trim());
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

      $("[style]").each((i, el) => {
        const s = $(el).attr("style") || "";
        const matches = [...s.matchAll(/url\((?:'|\")?(.*?)(?:'|\")?\)/g)];
        for (const m of matches) {
          const inner = m[1];
          if (!inner) continue;
          const absolute = resolveUrl(inner);
          if (!absolute || String(absolute).startsWith("data:")) continue;
          if (!urls.has(absolute)) urls.set(absolute, { elements: [], attr: "style" });
          urls.get(absolute).elements.push({ el: el, attr: "style", original: s, match: m[0] });
        }
      });

      let pageUA = "";
      try {
        pageUA = await page.evaluate(() => navigator.userAgent);
      } catch (e) {
        pageUA = "Playwright";
      }

      for (const [absolute, info] of urls.entries()) {
        try {
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
                const replaced = original
                  .split(",")
                  .map((p) => {
                    const u = p.trim().split(" ")[0];
                    if (new URL(u, url).href === absolute) {
                      const suffix = p.trim().slice(u.length);
                      return `${rel}${suffix}`;
                    }
                    return p;
                  })
                  .join(", ");
                $(item.el).attr("srcset", replaced);
              } else {
                $(item.el).attr(item.attr, rel);
              }
            }
            continue;
          }

          const headersForFetch: any = { referer: url, "user-agent": pageUA };
          try {
            const cks = await page.context().cookies(absolute).catch(() => []);
            if (Array.isArray(cks) && cks.length > 0) {
              headersForFetch.cookie = cks.map((c) => `${c.name}=${c.value}`).join("; ");
            }
          } catch (e) {}

          const fetched = await fetchResource(absolute, headersForFetch);
          if (!fetched || fetched.status >= 400) {
            console.warn(`⚠️ 无法获取资源 ${absolute} (status:${fetched ? fetched.status : "err"})`);
            continue;
          }

          const contentType = (fetched.headers["content-type"] || "").toLowerCase();
          const isCss = contentType.includes("css") || absolute.endsWith(".css");
          let buffer = fetched.buffer;

          if (isCss) {
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
                  const saved = await sendTaskToWorker("saveResourceBuffer", {
                    url: innerAbs,
                    buffer: rr.buffer,
                    headers: rr.headers,
                    outputDir: recordState.outputDir,
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

            const savedCssPath = await sendTaskToWorker("saveResourceBuffer", {
              url: absolute,
              buffer: Buffer.from(cssText, "utf8"),
              headers: fetched.headers,
              outputDir: recordState.outputDir,
            });
            if (savedCssPath) {
              const rel = toSnapshotRelative(savedCssPath.replace(/\\/g, "/"), filePath);
              for (const item of info.elements) {
                $(item.el).attr(item.attr, rel);
              }
            }
          } else {
            const saved = await sendTaskToWorker("saveResourceBuffer", {
              url: absolute,
              buffer: buffer,
              headers: fetched.headers,
              outputDir: recordState.outputDir,
            });
            if (saved) {
              const rel = toSnapshotRelative(saved.replace(/\\/g, "/"), filePath);
              for (const item of info.elements) {
                if (item.attr === "style") {
                  const cur = $(item.el).attr("style") || "";
                  const replaced = cur.split(item.match).join(`url(${rel})`);
                  $(item.el).attr("style", replaced);
                } else if (item.attr === "srcset") {
                  const original = $(item.el).attr("srcset") || item.original || "";
                  const replaced = original
                    .split(",")
                    .map((p) => {
                      const u = p.trim().split(" ")[0];
                      if (new URL(u, url).href === absolute) {
                        const suffix = p.trim().slice(u.length);
                        return `${rel}${suffix}`;
                      }
                      return p;
                    })
                    .join(", ");
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

    if (!fullHtml || fullHtml === "") {
      fullHtml = html;
    }

    const fullHtmlWithInfo = `<!-- \nCaptured at: ${timestamp}\nAction: ${actionDescription}\nURL: ${url}\nTitle: ${title}\n-->\n${fullHtml}`;

    await sendTaskToWorker("writeHtmlFile", {
      filePath,
      content: fullHtmlWithInfo,
    });

    recordState.htmlSnapshots.push({
      snapshotId,
      action: actionDescription,
      timestamp,
      url,
      title,
      filePath,
    });
    console.log(`📸 [${snapshotId}] 完整HTML快照已保存: ${actionDescription} - ${url} -> ${fileName}`);
  } catch (error) {
    console.error("❌ 获取完整HTML快照失败:", error.message);
  }
};

