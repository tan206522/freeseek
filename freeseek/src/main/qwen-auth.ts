import { chromium } from "playwright-core";
import fs from "node:fs";
import path from "node:path";

const AUTH_FILE = path.join(__dirname, "..", "..", "data", "qwen-auth.json");

export interface QwenCredentials {
  cookie: string;
  token?: string;
  bxUa?: string;
  bxUmidtoken?: string;
  userAgent: string;
  capturedAt: string;
}

function findLocalChrome(): string | null {
  const candidates =
    process.platform === "win32"
      ? [
          path.join(process.env["PROGRAMFILES"] || "C:\\Program Files", "Google\\Chrome\\Application\\chrome.exe"),
          path.join(process.env["PROGRAMFILES(X86)"] || "C:\\Program Files (x86)", "Google\\Chrome\\Application\\chrome.exe"),
          path.join(process.env["LOCALAPPDATA"] || "", "Google\\Chrome\\Application\\chrome.exe"),
          path.join(process.env["PROGRAMFILES(X86)"] || "C:\\Program Files (x86)", "Microsoft\\Edge\\Application\\msedge.exe"),
          path.join(process.env["PROGRAMFILES"] || "C:\\Program Files", "Microsoft\\Edge\\Application\\msedge.exe"),
        ]
      : process.platform === "darwin"
        ? [
            "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
            "/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge",
          ]
        : [
            "/usr/bin/google-chrome",
            "/usr/bin/google-chrome-stable",
            "/usr/bin/chromium-browser",
            "/usr/bin/chromium",
          ];
  for (const p of candidates) {
    if (p && fs.existsSync(p)) return p;
  }
  return null;
}

function loadProxyConfig(): string | null {
  try {
    const configFile = path.join(__dirname, "..", "..", "data", "proxy.json");
    if (fs.existsSync(configFile)) {
      const cfg = JSON.parse(fs.readFileSync(configFile, "utf-8"));
      if (cfg.proxy && cfg.proxy.trim()) return cfg.proxy.trim();
    }
  } catch { /* ignore */ }
  return process.env.HTTPS_PROXY || process.env.HTTP_PROXY || process.env.https_proxy || process.env.http_proxy || null;
}

/**
 * 通过浏览器自动化捕获通义千问凭证
 * 核心是拿到 cookie 中的 token 字段和风控 headers (bx-ua, bx-umidtoken)
 */
export async function captureQwenCredentials(
  onStatus?: (msg: string) => void,
  saveToFile = true,
): Promise<QwenCredentials> {
  const log = onStatus ?? console.log;

  log("正在连接 Chrome...");

  const proxy = loadProxyConfig();
  if (proxy) log(`使用代理: ${proxy}`);

  let browser;
  try {
    const res = await fetch("http://127.0.0.1:9222/json/version");
    const data = (await res.json()) as { webSocketDebuggerUrl: string };
    browser = await chromium.connectOverCDP(data.webSocketDebuggerUrl);
    log("已连接到 Chrome 调试端口");
  } catch {
    log("未检测到 Chrome 调试端口，正在查找本机 Chrome...");
    const chromePath = findLocalChrome();
    const launchOpts: any = {
      headless: false,
      ...(proxy ? { proxy: { server: proxy } } : {}),
    };
    if (chromePath) {
      log(`找到 Chrome: ${chromePath}`);
      browser = await chromium.launch({ ...launchOpts, executablePath: chromePath });
    } else {
      log("未找到本机 Chrome，尝试 Playwright 内置浏览器...");
      browser = await chromium.launch(launchOpts);
    }
  }

  const context = browser.contexts()[0] || (await browser.newContext());
  const page = context.pages()[0] || (await context.newPage());

  await page.goto("https://chat.qwen.ai/");
  const userAgent = await page.evaluate(() => navigator.userAgent);

  log("请在浏览器中登录通义千问（最长等待 5 分钟）...");

  return new Promise<QwenCredentials>((resolve, reject) => {
    let capturedToken = "";
    let capturedBxUa = "";
    let capturedBxUmidtoken = "";
    let resolved = false;
    let interval: ReturnType<typeof setInterval> | null = null;
    const timeout = setTimeout(() => {
      if (resolved) return;
      resolved = true;
      if (interval) clearInterval(interval);
      browser.close().catch(() => {});
      reject(new Error("登录超时（5分钟）"));
    }, 300_000);

    const cleanup = () => {
      clearTimeout(timeout);
      if (interval) { clearInterval(interval); interval = null; }
    };

    const doResolve = async () => {
      if (resolved) return;

      let cookies;
      try {
        cookies = await context.cookies(["https://chat.qwen.ai"]);
      } catch { return; }
      if (!cookies || cookies.length === 0) return;

      resolved = true;
      cleanup();

      const cookieString = cookies.map((c) => `${c.name}=${c.value}`).join("; ");

      const hasBxHeaders = !!(capturedBxUa && capturedBxUmidtoken);
      if (hasBxHeaders) {
        log("✅ 通义千问凭证已完整捕获（含风控签名）");
      } else {
        log("⚠️ 通义千问凭证已捕获，但缺少风控签名（bx-ua/bx-umidtoken）");
        log("⚠️ 请在浏览器中发送一条消息后重新捕获，或手动粘贴这些 headers");
      }

      const creds: QwenCredentials = {
        cookie: cookieString,
        token: capturedToken,
        bxUa: capturedBxUa,
        bxUmidtoken: capturedBxUmidtoken,
        userAgent,
        capturedAt: new Date().toISOString(),
      };

      if (saveToFile) {
        fs.mkdirSync(path.dirname(AUTH_FILE), { recursive: true });
        fs.writeFileSync(AUTH_FILE, JSON.stringify(creds, null, 2));
      }

      // 关闭浏览器
      try { await browser.close(); } catch { /* ignore */ }

      resolve(creds);
    };

    // 拿到 token 后，等待 bx-ua（最多 15 秒），然后 resolve
    let bxWaitTimer: ReturnType<typeof setTimeout> | null = null;
    const tryResolve = async () => {
      if (resolved || !capturedToken) return;

      // 如果已经有 bx-ua，立即完成
      if (capturedBxUa) {
        await doResolve();
        return;
      }

      // 没有 bx-ua，提示用户并等待
      if (!bxWaitTimer) {
        log("已获取 token，等待风控签名... 请在浏览器中随便发一条消息");
        bxWaitTimer = setTimeout(async () => {
          // 15 秒后无论如何都 resolve
          if (!resolved) await doResolve();
        }, 15_000);
      }
    };

    // 监听请求头中的 token 和风控 headers
    page.on("request", async (request) => {
      if (resolved) return;
      const url = request.url();
      if (url.includes("chat.qwen.ai")) {
        const headers = request.headers();
        const cookie = headers["cookie"] || "";
        const tokenMatch = cookie.match(/(?:^|;\s*)token=([^;]+)/);
        if (tokenMatch && !capturedToken) {
          capturedToken = tokenMatch[1];
          log("已捕获 token");
        }
        if (headers["bx-ua"] && !capturedBxUa) {
          capturedBxUa = headers["bx-ua"];
          log("已捕获 bx-ua 风控签名");
        }
        if (headers["bx-umidtoken"] && !capturedBxUmidtoken) {
          capturedBxUmidtoken = headers["bx-umidtoken"];
          log("已捕获 bx-umidtoken 设备指纹");
        }
        // 有 token + bx-ua 就立即完成
        if (capturedToken && capturedBxUa) {
          if (bxWaitTimer) { clearTimeout(bxWaitTimer); bxWaitTimer = null; }
          await doResolve();
        } else if (capturedToken) {
          await tryResolve();
        }
      }
    });

    // 也监听 cookie 变化
    page.on("response", async (response) => {
      if (resolved) return;
      if (response.url().includes("chat.qwen.ai") && response.ok()) {
        if (!capturedToken) {
          try {
            const cookies = await context.cookies(["https://chat.qwen.ai"]);
            const tk = cookies.find((c) => c.name === "token");
            if (tk) {
              capturedToken = tk.value;
              log("已从 cookie 捕获 token");
              await tryResolve();
            }
          } catch { /* ignore */ }
        }
      }
    });

    page.on("close", () => {
      if (resolved) return;
      resolved = true;
      cleanup();
      if (bxWaitTimer) { clearTimeout(bxWaitTimer); bxWaitTimer = null; }
      reject(new Error("浏览器窗口被关闭"));
    });

    // 定期检查
    interval = setInterval(async () => {
      if (resolved) { if (interval) clearInterval(interval); return; }
      await tryResolve();
    }, 2000);
  });
}

export function loadQwenCredentials(): QwenCredentials | null {
  try {
    if (fs.existsSync(AUTH_FILE)) {
      return JSON.parse(fs.readFileSync(AUTH_FILE, "utf-8"));
    }
  } catch { /* ignore */ }
  return null;
}

export function clearQwenCredentials(): boolean {
  try {
    if (fs.existsSync(AUTH_FILE)) {
      fs.unlinkSync(AUTH_FILE);
      return true;
    }
  } catch { /* ignore */ }
  return false;
}
