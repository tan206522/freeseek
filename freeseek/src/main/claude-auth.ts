import { chromium } from "playwright-core";
import fs from "node:fs";
import path from "node:path";

const AUTH_FILE = path.join(__dirname, "..", "..", "data", "claude-auth.json");

export interface ClaudeCredentials {
  sessionKey: string;
  cookie: string;
  userAgent: string;
  organizationId?: string;
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
        ? ["/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"]
        : ["/usr/bin/google-chrome", "/usr/bin/google-chrome-stable", "/usr/bin/chromium-browser"];

  for (const p of candidates) {
    if (p && fs.existsSync(p)) return p;
  }
  return null;
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
  // 也检查环境变量
  return process.env.HTTPS_PROXY || process.env.HTTP_PROXY || process.env.https_proxy || process.env.http_proxy || null;
}

/**
 * 通过浏览器自动化捕获 Claude 网页版凭证
 * 核心是拿到 sessionKey cookie（sk-ant-sid01-xxx 或 sk-ant-sid02-xxx 格式）
 */
export async function captureClaudeCredentials(
  onStatus?: (msg: string) => void,
  saveToFile = true,
): Promise<ClaudeCredentials> {
  const log = onStatus ?? console.log;

  log("正在连接 Chrome...");

  const proxy = loadProxyConfig();
  if (proxy) {
    log(`使用代理: ${proxy}`);
  }

  let browser;
  try {
    const res = await fetch("http://127.0.0.1:9222/json/version");
    const data = (await res.json()) as { webSocketDebuggerUrl: string };
    browser = await chromium.connectOverCDP(data.webSocketDebuggerUrl);
    log("已连接到 Chrome 调试端口（代理由 Chrome 自身管理）");
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

  await page.goto("https://claude.ai/");
  const userAgent = await page.evaluate(() => navigator.userAgent);

  log("请在浏览器中登录 Claude（最长等待 5 分钟）...");

  return new Promise<ClaudeCredentials>((resolve, reject) => {
    let capturedSessionKey = "";
    const timeout = setTimeout(() => reject(new Error("登录超时（5分钟）")), 300_000);

    const tryResolve = async () => {
      if (!capturedSessionKey) return;

      const cookies = await context.cookies(["https://claude.ai", "https://www.claude.ai"]);
      if (cookies.length === 0) return;

      const cookieString = cookies.map((c) => `${c.name}=${c.value}`).join("; ");

      if (capturedSessionKey.startsWith("sk-ant-sid01-") || capturedSessionKey.startsWith("sk-ant-sid02-")) {
        clearTimeout(timeout);
        log("✅ Claude 凭证已捕获");

        const creds: ClaudeCredentials = {
          sessionKey: capturedSessionKey,
          cookie: cookieString,
          userAgent,
          capturedAt: new Date().toISOString(),
        };

        if (saveToFile) {
          fs.mkdirSync(path.dirname(AUTH_FILE), { recursive: true });
          fs.writeFileSync(AUTH_FILE, JSON.stringify(creds, null, 2));
        }
        resolve(creds);
      }
    };

    // 监听请求头中的 sessionKey
    page.on("request", async (request) => {
      const url = request.url();
      if (url.includes("claude.ai")) {
        const cookie = request.headers()["cookie"] || "";
        const match = cookie.match(/sessionKey=([^;]+)/);
        if (match && (match[1].startsWith("sk-ant-sid01-") || match[1].startsWith("sk-ant-sid02-"))) {
          if (!capturedSessionKey) {
            capturedSessionKey = match[1];
            log("已捕获 sessionKey");
            await tryResolve();
          }
        }
      }
    });

    // 也监听 cookie 变化
    page.on("response", async (response) => {
      if (response.url().includes("claude.ai") && response.ok()) {
        if (!capturedSessionKey) {
          const cookies = await context.cookies(["https://claude.ai"]);
          const sk = cookies.find(
            (c) => c.name === "sessionKey" || c.value.startsWith("sk-ant-sid01-") || c.value.startsWith("sk-ant-sid02-"),
          );
          if (sk) {
            capturedSessionKey = sk.name === "sessionKey" ? sk.value : sk.value;
            log("已从 cookie 捕获 sessionKey");
            await tryResolve();
          }
        }
      }
    });

    page.on("close", () => reject(new Error("浏览器窗口被关闭")));

    // 定期检查
    const interval = setInterval(async () => {
      await tryResolve();
      if (capturedSessionKey) clearInterval(interval);
    }, 2000);
  });
}

export function loadClaudeCredentials(): ClaudeCredentials | null {
  try {
    if (fs.existsSync(AUTH_FILE)) {
      return JSON.parse(fs.readFileSync(AUTH_FILE, "utf-8"));
    }
  } catch { /* ignore */ }
  return null;
}

export function clearClaudeCredentials(): boolean {
  try {
    if (fs.existsSync(AUTH_FILE)) {
      fs.unlinkSync(AUTH_FILE);
      return true;
    }
  } catch { /* ignore */ }
  return false;
}
