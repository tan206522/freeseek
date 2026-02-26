import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { chromium } from "playwright-core";
import type { BrowserContext, Page, Browser } from "playwright-core";

export interface ClaudeCredentials {
  sessionKey: string;
  cookie: string;
  userAgent: string;
  organizationId?: string;
  capturedAt: string;
}

export interface ClaudeConversation {
  uuid: string;
  name: string;
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
 * Claude 网页版客户端 — 通过 Playwright 浏览器上下文发请求
 * 所有 API 调用都在浏览器内执行 fetch，绕过 Cloudflare 防护
 */
export class ClaudeWebClient {
  private cookie: string;
  private userAgent: string;
  private organizationId?: string;
  private deviceId: string;
  private baseUrl = "https://claude.ai/api";

  private browser: Browser | null = null;
  private context: BrowserContext | null = null;
  private page: Page | null = null;
  private browserReady = false;

  constructor(creds: ClaudeCredentials) {
    this.cookie = creds.cookie || `sessionKey=${creds.sessionKey}`;
    this.userAgent = creds.userAgent || "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36";
    this.organizationId = creds.organizationId;
    this.deviceId = this.extractDeviceId(this.cookie) || crypto.randomUUID();
  }

  private extractDeviceId(cookie: string): string | undefined {
    const match = cookie.match(/anthropic-device-id=([^;]+)/);
    return match ? match[1] : undefined;
  }

  /** 确保浏览器已连接/启动 */
  private async ensureBrowser(): Promise<Page> {
    if (this.page && this.browserReady) return this.page;

    console.log("[Claude] 正在初始化浏览器上下文...");

    const proxy = loadProxyConfig();

    // 优先连接已有 Chrome 调试端口
    try {
      const res = await fetch("http://127.0.0.1:9222/json/version");
      const data = (await res.json()) as { webSocketDebuggerUrl: string };
      this.browser = await chromium.connectOverCDP(data.webSocketDebuggerUrl);
      this.context = this.browser.contexts()[0] || await this.browser.newContext();
      console.log("[Claude] 已连接到 Chrome 调试端口");
    } catch {
      // 启动新 Chrome
      const chromePath = findLocalChrome();
      const launchOpts: any = {
        headless: false,
        ...(proxy ? { proxy: { server: proxy } } : {}),
      };
      if (chromePath) {
        console.log(`[Claude] 启动 Chrome: ${chromePath}`);
        this.browser = await chromium.launch({ ...launchOpts, executablePath: chromePath });
      } else {
        console.log("[Claude] 启动 Playwright 内置浏览器");
        this.browser = await chromium.launch(launchOpts);
      }
      this.context = this.browser.contexts()[0] || await this.browser.newContext();
    }

    // 注入 cookie
    const cookies = this.cookie.split(";").map((c) => {
      const [name, ...valueParts] = c.trim().split("=");
      return {
        name: name.trim(),
        value: valueParts.join("=").trim(),
        domain: ".claude.ai",
        path: "/",
      };
    }).filter(c => c.name && c.value);

    if (cookies.length > 0) {
      await this.context.addCookies(cookies);
    }

    // 找到或创建 claude.ai 页面
    const pages = this.context.pages();
    let claudePage = pages.find(p => p.url().includes("claude.ai"));
    if (claudePage) {
      console.log("[Claude] 复用已有 Claude 页面");
      this.page = claudePage;
    } else {
      this.page = await this.context.newPage();
      await this.page.goto("https://claude.ai/new", { waitUntil: "domcontentloaded", timeout: 30000 });
      console.log("[Claude] 已打开 Claude 页面");
    }

    this.browserReady = true;
    return this.page;
  }

  /** 自动发现 organization ID（在浏览器内执行） */
  async init(): Promise<void> {
    if (this.organizationId) return;
    try {
      const page = await this.ensureBrowser();
      const result = await page.evaluate(
        async ({ baseUrl, deviceId }) => {
          const res = await fetch(`${baseUrl}/organizations`, {
            headers: {
              "Accept": "application/json",
              "anthropic-client-platform": "web_claude_ai",
              "anthropic-device-id": deviceId,
            },
          });
          if (!res.ok) return { ok: false, status: res.status };
          const data = await res.json();
          return { ok: true, data };
        },
        { baseUrl: this.baseUrl, deviceId: this.deviceId },
      );

      if (result.ok && Array.isArray(result.data) && result.data.length > 0) {
        this.organizationId = result.data[0].uuid;
        console.log(`[Claude] 发现 organization: ${this.organizationId}`);
      } else {
        console.warn(`[Claude] 获取 organization 失败: ${(result as any).status}`);
      }
    } catch (e) {
      console.warn(`[Claude] organization 发现失败: ${e}`);
    }
  }

  getOrganizationId(): string | undefined {
    return this.organizationId;
  }

  async createConversation(): Promise<string> {
    const page = await this.ensureBrowser();
    const url = this.organizationId
      ? `${this.baseUrl}/organizations/${this.organizationId}/chat_conversations`
      : `${this.baseUrl}/chat_conversations`;

    const convUuid = crypto.randomUUID();

    const result = await page.evaluate(
      async ({ url, deviceId, convUuid }) => {
        const res = await fetch(url, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "anthropic-client-platform": "web_claude_ai",
            "anthropic-device-id": deviceId,
          },
          body: JSON.stringify({
            name: `FreeSeek ${new Date().toISOString()}`,
            uuid: convUuid,
          }),
        });
        if (!res.ok) {
          const err = await res.text().catch(() => "");
          return { ok: false, status: res.status, error: err };
        }
        const data = await res.json();
        return { ok: true, data };
      },
      { url, deviceId: this.deviceId, convUuid },
    );

    if (!result.ok) {
      throw new Error(`创建 Claude 会话失败: ${(result as any).status} ${(result as any).error || ""}`);
    }

    return (result as any).data.uuid;
  }

  /**
   * 发送消息 — 在浏览器内执行 fetch，读取完整 SSE 文本后返回为 ReadableStream
   */
  async chat(params: {
    conversationId: string;
    message: string;
    model?: string;
  }): Promise<ReadableStream<Uint8Array> | null> {
    const page = await this.ensureBrowser();

    const url = this.organizationId
      ? `${this.baseUrl}/organizations/${this.organizationId}/chat_conversations/${params.conversationId}/completion`
      : `${this.baseUrl}/chat_conversations/${params.conversationId}/completion`;

    let modelId = params.model || "claude-sonnet-4-6";
    if (modelId.includes("claude-3-5-sonnet")) modelId = "claude-sonnet-4-6";
    else if (modelId.includes("claude-3-opus")) modelId = "claude-opus-4-6";
    else if (modelId.includes("claude-3-haiku")) modelId = "claude-haiku-4-6";

    const body = {
      prompt: params.message,
      parent_message_uuid: "00000000-0000-4000-8000-000000000000",
      model: modelId,
      timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
      rendering_mode: "messages",
      attachments: [],
      files: [],
      locale: "en-US",
      personalized_styles: [],
      sync_sources: [],
      tools: [],
    };

    console.log(`[Claude] 发送消息到: ${url}`);
    console.log(`[Claude] 模型: ${modelId}`);

    // 在浏览器内执行 fetch 并读取完整 SSE 响应
    const responseData = await page.evaluate(
      async ({ url, body, deviceId }) => {
        const res = await fetch(url, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "Accept": "text/event-stream",
            "anthropic-client-platform": "web_claude_ai",
            "anthropic-device-id": deviceId,
          },
          body: JSON.stringify(body),
        });

        if (!res.ok) {
          const errorText = await res.text().catch(() => "");
          return { ok: false, status: res.status, error: errorText };
        }

        const reader = res.body?.getReader();
        if (!reader) return { ok: false, status: 500, error: "No response body" };

        const decoder = new TextDecoder();
        let fullText = "";
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          fullText += decoder.decode(value, { stream: true });
        }

        return { ok: true, data: fullText };
      },
      { url, body, deviceId: this.deviceId },
    );

    if (!responseData.ok) {
      const status = (responseData as any).status;
      const error = (responseData as any).error || "";
      console.error(`[Claude] 请求失败: ${status} - ${error.slice(0, 200)}`);
      if (status === 401) {
        throw new Error("Claude 认证失败，请重新捕获凭证");
      }
      throw new Error(`Claude API 错误: ${status} ${error.slice(0, 200)}`);
    }

    console.log(`[Claude] 响应长度: ${(responseData as any).data?.length || 0} 字节`);

    // 将文本转为 ReadableStream
    const encoder = new TextEncoder();
    const text = (responseData as any).data as string;
    const stream = new ReadableStream({
      start(controller) {
        controller.enqueue(encoder.encode(text));
        controller.close();
      },
    });

    return stream;
  }

  /** 关闭浏览器 */
  async close() {
    this.browserReady = false;
    this.page = null;
    this.context = null;
    // 不关闭通过 CDP 连接的浏览器
    if (this.browser) {
      try { await this.browser.close(); } catch { /* ignore */ }
      this.browser = null;
    }
  }
}
