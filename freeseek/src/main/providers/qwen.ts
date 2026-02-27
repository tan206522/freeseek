import type {
  Provider,
  BaseCredentials,
  CredentialsSummary,
  ModelInfo,
  ChatRequest,
  ChatResponse,
  StreamConverterResult,
  StreamConverterOptions,
} from "./types";
import { QwenWebClient, type QwenCredentials } from "../qwen-client";
import {
  loadQwenCredentials,
  captureQwenCredentials,
} from "../qwen-auth";
import {
  createQwenStreamConverter,
  collectQwenFullResponse,
} from "../qwen-stream";
import { CredentialPool } from "../credential-pool";
import path from "node:path";

const AUTH_FILE = path.join(__dirname, "..", "..", "data", "qwen-auth.json");

/** 千问模型前缀列表 */
const QWEN_PREFIXES = ["qwen", "qwq"];

export class QwenProvider implements Provider {
  readonly id = "qwen";
  readonly name = "通义千问";

  private pool: CredentialPool;
  private chatIdCache = new Map<string, string>();

  constructor() {
    this.pool = new CredentialPool(AUTH_FILE);
  }

  // --- 模型 ---

  getModels(): ModelInfo[] {
    return [
      { id: "qwen3.5-plus", owned_by: "qwen-web" },
      { id: "qwen-max", owned_by: "qwen-web" },
      { id: "qwen-plus", owned_by: "qwen-web" },
      { id: "qwen-turbo", owned_by: "qwen-web" },
      { id: "qwq-plus", owned_by: "qwen-web" },
    ];
  }

  matchModel(model: string): boolean {
    return QWEN_PREFIXES.some((p) => model.startsWith(p));
  }

  mapModel(model: string): string {
    return model;
  }

  // --- 凭证池 ---

  getCredentialPool(): CredentialPool {
    return this.pool;
  }

  // --- 凭证 ---

  loadCredentials(): QwenCredentials | null {
    return this.pool.first() as QwenCredentials | null;
  }

  getCredentialsSummary(): CredentialsSummary | null {
    const creds = this.pool.first() as QwenCredentials | null;
    if (!creds) return null;
    return {
      hasCredentials: true,
      capturedAt: creds.capturedAt,
      hasCookie: !!creds.cookie,
      cookieCount: creds.cookie.split(";").length,
      hasToken: !!creds.token,
      tokenPrefix: creds.token ? creds.token.slice(0, 20) + "..." : "",
      hasBxUa: !!creds.bxUa,
      hasBxUmidtoken: !!creds.bxUmidtoken,
      pool: this.pool.getSummary(),
    };
  }

  clearCredentials(): boolean {
    this.resetClient();
    return this.pool.clearAll();
  }

  saveManualCredentials(data: Record<string, any>): void {
    const creds: QwenCredentials = {
      cookie: data.cookie?.trim() || "",
      token: data.token?.trim() || "",
      bxUa: data.bxUa?.trim() || "",
      bxUmidtoken: data.bxUmidtoken?.trim() || "",
      userAgent:
        data.userAgent?.trim() ||
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/145.0.0.0 Safari/537.36",
      capturedAt: new Date().toISOString(),
    };
    this.pool.set(creds);
    this.resetClient();
  }

  addCredentials(data: Record<string, any>): string {
    const creds: QwenCredentials = {
      cookie: data.cookie?.trim() || "",
      token: data.token?.trim() || "",
      bxUa: data.bxUa?.trim() || "",
      bxUmidtoken: data.bxUmidtoken?.trim() || "",
      userAgent:
        data.userAgent?.trim() ||
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/145.0.0.0 Safari/537.36",
      capturedAt: new Date().toISOString(),
    };
    return this.pool.add(creds);
  }

  removeCredentials(id: string): boolean {
    return this.pool.remove(id);
  }

  resetCredentialStatus(id: string): void {
    this.pool.resetStatus(id);
  }

  async captureCredentials(
    onStatus?: (msg: string) => void,
  ): Promise<BaseCredentials> {
    const creds = await captureQwenCredentials(onStatus, false);
    this.pool.add(creds);
    this.resetClient();
    return creds;
  }

  checkExpiry(): {
    valid: boolean;
    expiresAt?: string | null;
    expired?: boolean;
    expiringSoon?: boolean;
    remainingMs?: number;
  } {
    const creds = this.pool.first() as QwenCredentials | null;
    if (!creds?.token) return { valid: false };
    try {
      const parts = creds.token.split(".");
      if (parts.length !== 3) return { valid: true, expiresAt: null };
      const payload = JSON.parse(
        Buffer.from(parts[1], "base64url").toString(),
      );
      if (payload.exp) {
        const expiresAt = payload.exp * 1000;
        const remaining = expiresAt - Date.now();
        return {
          valid: remaining > 0,
          expiresAt: new Date(expiresAt).toISOString(),
          remainingMs: remaining,
          expired: remaining <= 0,
          expiringSoon: remaining > 0 && remaining < 30 * 60 * 1000,
        };
      }
      return { valid: true, expiresAt: null };
    } catch {
      return { valid: true, expiresAt: null };
    }
  }

  // --- 客户端 ---

  async chat(request: ChatRequest): Promise<ChatResponse> {
    const prompt = this.buildPrompt(request.messages);
    const model = this.mapModel(request.model);
    const chatId = crypto.randomUUID();

    const isThinkingModel =
      model.includes("qwq") ||
      model.includes("qwen3.5") ||
      model.includes("qwen-max");

    // 多账号轮询
    const entry = this.pool.next();
    if (!entry) throw new Error("未找到通义千问凭证，请先捕获登录凭证");

    const creds = entry.credentials as QwenCredentials;
    const client = new QwenWebClient(creds);

    let responseStream: ReadableStream<Uint8Array> | null = null;

    try {
      responseStream = await client.chat({
        message: prompt,
        model,
        chatId,
        thinkingEnabled: isThinkingModel,
        searchEnabled: true,
      });
      this.pool.markSuccess(entry.id);
    } catch (chatErr: any) {
      if (chatErr.message?.includes("401") || chatErr.message?.includes("403")) {
        this.pool.markFailed(entry.id, chatErr.message);
        // 尝试切换到下一个凭证
        const fallback = this.pool.next();
        if (fallback && fallback.id !== entry.id) {
          const fbCreds = fallback.credentials as QwenCredentials;
          const fbClient = new QwenWebClient(fbCreds);
          responseStream = await fbClient.chat({
            message: prompt,
            model,
            chatId: crypto.randomUUID(),
            thinkingEnabled: isThinkingModel,
            searchEnabled: true,
          });
          this.pool.markSuccess(fallback.id);
        } else {
          throw chatErr;
        }
      } else {
        this.pool.markFailed(entry.id, chatErr.message);
        throw chatErr;
      }
    }

    return { stream: responseStream };
  }

  resetClient(): void {
    this.chatIdCache.clear();
  }

  // --- 流转换 ---

  createStreamConverter(options: StreamConverterOptions): StreamConverterResult {
    const { transform } = createQwenStreamConverter({
      model: options.model,
      stripReasoning: options.stripReasoning,
    });
    return { transform };
  }

  collectFullResponse(
    stream: ReadableStream<Uint8Array>,
    model: string,
    options?: { stripReasoning?: boolean; cleanMode?: boolean },
  ): Promise<object> {
    return collectQwenFullResponse(stream, model, options);
  }

  // --- 内部工具 ---

  private buildPrompt(messages: any[]): string {
    const extractContent = (m: any) =>
      typeof m.content === "string"
        ? m.content
        : (m.content || [])
            .filter((p: any) => p.type === "text")
            .map((p: any) => p.text)
            .join("");

    const nonSystemMessages = messages.filter(
      (m: any) => m.role !== "system",
    );
    const systemMessages = messages.filter((m: any) => m.role === "system");

    if (
      nonSystemMessages.length === 1 &&
      nonSystemMessages[0].role === "user"
    ) {
      const userContent = extractContent(nonSystemMessages[0]);
      if (systemMessages.length > 0) {
        const sysContent = systemMessages.map(extractContent).join("\n");
        return `${sysContent}\n\n${userContent}`;
      }
      return userContent;
    }

    const parts: string[] = [];
    for (const m of messages) {
      const content = extractContent(m);
      if (m.role === "system") parts.push(`[System]\n${content}`);
      else if (m.role === "user") parts.push(`[User]\n${content}`);
      else parts.push(`[Assistant]\n${content}`);
    }
    return parts.join("\n\n");
  }
}
