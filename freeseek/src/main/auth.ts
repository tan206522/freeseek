import { chromium } from "playwright-core";
import fs from "node:fs";
import path from "node:path";

const AUTH_FILE = path.join(__dirname, "..", "..", "data", "auth.json");

function findLocalChrome(): string | null {
  const candidates =
    process.platform === "win32"
      ? [
          path.join(
            process.env["PROGRAMFILES"] || "C:\\Program Files",
            "Google\\Chrome\\Application\\chrome.exe",
          ),
          path.join(
            process.env["PROGRAMFILES(X86)"] || "C:\\Program Files (x86)",
            "Google\\Chrome\\Application\\chrome.exe",
          ),
          path.join(
            process.env["LOCALAPPDATA"] || "",
            "Google\\Chrome\\Application\\chrome.exe",
          ),
          // Edge 也兼容
          path.join(
            process.env["PROGRAMFILES(X86)"] || "C:\\Program Files (x86)",
            "Microsoft\\Edge\\Application\\msedge.exe",
          ),
          path.join(
            process.env["PROGRAMFILES"] || "C:\\Program Files",
            "Microsoft\\Edge\\Application\\msedge.exe",
          ),
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

export interface Credentials {
  cookie: string;
  bearer: string;
  userAgent: string;
  capturedAt: string;
}

/** 读取代理配置 */
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

export async function captureCredentials(
  onStatus?: (msg: string) => void,
  saveToFile = true,
): Promise<Credentials> {
  const log = onStatus ?? console.log;

  log("正在连接 Chrome 调试端口 (9222)...");

  const proxy = loadProxyConfig();
  if (proxy) {
    log(`使用代理: ${proxy}`);
  }

  let browser;
  try {
    const res = await fetch("http://127.0.0.1:9222/json/version");
    const data = (await res.json()) as { webSocketDebuggerUrl: string };
    browser = await chromium.connectOverCDP(data.webSocketDebuggerUrl);
    log("已连接到 Chrome（代理由 Chrome 自身管理）");
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

  await page.goto("https://chat.deepseek.com");
  const userAgent = await page.evaluate(() => navigator.userAgent);

  log("请在浏览器中登录 DeepSeek（最长等待 5 分钟）...");

  return new Promise<Credentials>((resolve, reject) => {
    let capturedBearer = "";
    const timeout = setTimeout(
      () => reject(new Error("登录超时（5分钟）")),
      300_000,
    );

    const tryResolve = async () => {
      if (!capturedBearer) return;

      const cookies = await context.cookies([
        "https://chat.deepseek.com",
        "https://deepseek.com",
      ]);
      if (cookies.length === 0) return;

      const cookieString = cookies
        .map((c) => `${c.name}=${c.value}`)
        .join("; ");
      const hasSession =
        cookieString.includes("ds_session_id=") ||
        cookieString.includes("d_id=") ||
        cookies.length > 3;

      if (hasSession) {
        clearTimeout(timeout);
        const creds: Credentials = {
          cookie: cookieString,
          bearer: capturedBearer,
          userAgent,
          capturedAt: new Date().toISOString(),
        };

        if (saveToFile) {
          fs.mkdirSync(path.dirname(AUTH_FILE), { recursive: true });
          fs.writeFileSync(AUTH_FILE, JSON.stringify(creds, null, 2));
          log("凭证已捕获并保存到 data/auth.json");
        } else {
          log("凭证已捕获");
        }
        resolve(creds);
      }
    };

    page.on("request", async (request) => {
      const url = request.url();
      if (url.includes("/api/v0/")) {
        const auth = request.headers()["authorization"];
        if (auth?.startsWith("Bearer ") && !capturedBearer) {
          capturedBearer = auth.slice(7);
          log("已捕获 Bearer Token");
          await tryResolve();
        }
      }
    });

    page.on("close", () => reject(new Error("浏览器窗口被关闭")));
  });
}

export function loadCredentials(): Credentials | null {
  try {
    if (fs.existsSync(AUTH_FILE)) {
      return JSON.parse(fs.readFileSync(AUTH_FILE, "utf-8"));
    }
  } catch {
    // ignore
  }
  return null;
}

export function clearCredentials(): boolean {
  try {
    if (fs.existsSync(AUTH_FILE)) {
      fs.unlinkSync(AUTH_FILE);
      return true;
    }
  } catch {
    // ignore
  }
  return false;
}

// 直接运行时执行捕获
const isDirectRun =
  process.argv[1]?.endsWith("auth.js") ||
  process.argv[1]?.endsWith("auth.ts");
if (isDirectRun) {
  captureCredentials()
    .then(() => {
      console.log("完成！可以启动代理服务了。");
      process.exit(0);
    })
    .catch((err) => {
      console.error("失败:", err.message);
      process.exit(1);
    });
}
