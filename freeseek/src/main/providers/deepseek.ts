import type {
  Provider,
  BaseCredentials,
  CredentialsSummary,
  ModelInfo,
  ChatRequest,
  ChatResponse,
  StreamConverterResult,
  StreamConverterOptions,
  ToolDefinition,
} from "./types";
import { DeepSeekWebClient } from "../client";
import {
  loadCredentials,
  captureCredentials,
  type Credentials,
} from "../auth";
import {
  createStreamConverter as createDSStreamConverter,
  collectFullResponse as collectDSFullResponse,
  type StreamConverterOptions as DSStreamOpts,
} from "../stream-converter";
import { CredentialPool } from "../credential-pool";
import {
  buildToolSystemPrompt,
  serializeToolResultMessage,
  serializeAssistantToolCalls,
} from "../tool-call-parser";
import path from "node:path";

const AUTH_FILE = path.join(__dirname, "..", "..", "data", "auth.json");

export class DeepSeekProvider implements Provider {
  readonly id = "deepseek";
  readonly name = "DeepSeek";

  private pool: CredentialPool;
  private sessionCache = new Map<string, string>();

  constructor() {
    this.pool = new CredentialPool(AUTH_FILE);
  }

  // --- 模型 ---

  getModels(): ModelInfo[] {
    return [
      { id: "deepseek-chat", owned_by: "deepseek-web" },
      { id: "deepseek-reasoner", owned_by: "deepseek-web" },
      { id: "deepseek-chat-search", owned_by: "deepseek-web" },
      { id: "deepseek-reasoner-search", owned_by: "deepseek-web" },
    ];
  }

  matchModel(model: string): boolean {
    return model.startsWith("deepseek-");
  }

  mapModel(model: string): string {
    return model;
  }

  // --- 凭证池 ---

  getCredentialPool(): CredentialPool {
    return this.pool;
  }

  // --- 凭证 ---

  loadCredentials(): Credentials | null {
    return this.pool.first() as Credentials | null;
  }

  getCredentialsSummary(): CredentialsSummary | null {
    const creds = this.pool.first() as Credentials | null;
    if (!creds) return null;
    return {
      hasCredentials: true,
      capturedAt: creds.capturedAt,
      hasCookie: !!creds.cookie,
      cookieCount: creds.cookie.split(";").length,
      hasBearer: !!creds.bearer,
      bearerLength: creds.bearer.length,
      hasSessionId:
        creds.cookie.includes("ds_session_id=") ||
        creds.cookie.includes("d_id="),
      pool: this.pool.getSummary(),
    };
  }

  clearCredentials(): boolean {
    return this.pool.clearAll();
  }

  saveManualCredentials(data: Record<string, any>): void {
    const creds = {
      cookie: data.cookie,
      bearer: data.bearer,
      userAgent:
        data.userAgent ||
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
      capturedAt: new Date().toISOString(),
    };
    this.pool.set(creds);
  }

  addCredentials(data: Record<string, any>): string {
    const creds = {
      cookie: data.cookie,
      bearer: data.bearer,
      userAgent:
        data.userAgent ||
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
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
    const creds = await captureCredentials(onStatus, false);
    this.pool.add(creds);
    return creds;
  }

  checkExpiry(): {
    valid: boolean;
    expiresAt?: string | null;
    expired?: boolean;
    expiringSoon?: boolean;
    remainingMs?: number;
  } {
    const creds = this.pool.first() as Credentials | null;
    if (!creds?.bearer) return { valid: false };
    try {
      const parts = creds.bearer.split(".");
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
    const prompt = this.buildPrompt(request.messages, request.tools);
    const searchEnabled = request.model.endsWith("-search");
    const baseModel = searchEnabled
      ? request.model.replace(/-search$/, "")
      : request.model;
    const sessionKey = request.sessionKey || "default";

    // 多账号轮询：获取下一个凭证
    const entry = this.pool.next();
    if (!entry) throw new Error("未找到 DeepSeek 凭证，请先捕获登录凭证");

    const creds = entry.credentials as Credentials;
    const client = new DeepSeekWebClient(creds);

    let sessionId = this.sessionCache.get(sessionKey);
    if (!sessionId) {
      sessionId = await client.createSession();
      this.sessionCache.set(sessionKey, sessionId);
    }

    let responseStream: ReadableStream<Uint8Array> | null = null;

    try {
      responseStream = await client.chat({
        sessionId,
        message: prompt,
        model: baseModel,
        thinkingEnabled: baseModel.includes("reasoner"),
        searchEnabled,
      });
      this.pool.markSuccess(entry.id);
    } catch (chatErr: any) {
      if (
        chatErr.message?.includes("40") ||
        chatErr.message?.includes("session")
      ) {
        this.sessionCache.delete(sessionKey);
        try {
          const newSessionId = await client.createSession();
          this.sessionCache.set(sessionKey, newSessionId);
          responseStream = await client.chat({
            sessionId: newSessionId,
            message: prompt,
            model: baseModel,
            thinkingEnabled: baseModel.includes("reasoner"),
            searchEnabled,
          });
          this.pool.markSuccess(entry.id);
        } catch (retryErr: any) {
          this.pool.markFailed(entry.id, retryErr.message);
          // 尝试切换到下一个凭证
          const fallback = this.pool.next();
          if (fallback && fallback.id !== entry.id) {
            const fbCreds = fallback.credentials as Credentials;
            const fbClient = new DeepSeekWebClient(fbCreds);
            const fbSession = await fbClient.createSession();
            responseStream = await fbClient.chat({
              sessionId: fbSession,
              message: prompt,
              model: baseModel,
              thinkingEnabled: baseModel.includes("reasoner"),
              searchEnabled,
            });
            this.pool.markSuccess(fallback.id);
          } else {
            throw retryErr;
          }
        }
      } else {
        this.pool.markFailed(entry.id, chatErr.message);
        throw chatErr;
      }
    }

    return { stream: responseStream };
  }

  resetClient(): void {
    this.sessionCache.clear();
  }

  // --- 流转换 ---

  createStreamConverter(options: StreamConverterOptions): StreamConverterResult {
    const dsOpts: DSStreamOpts = {
      stripReasoning: options.stripReasoning,
      cleanMode: options.cleanMode,
      hasTools: options.hasTools,
    };
    const { transform, getParentMessageId } = createDSStreamConverter(
      options.model,
      dsOpts,
    );
    return {
      transform,
      getMetadata: () => ({ parentMessageId: getParentMessageId() }),
    };
  }

  collectFullResponse(
    stream: ReadableStream<Uint8Array>,
    model: string,
    options?: { stripReasoning?: boolean; cleanMode?: boolean; hasTools?: boolean },
  ): Promise<object> {
    return collectDSFullResponse(stream, model, options);
  }

  // --- 内部工具 ---

  private buildPrompt(messages: any[], tools?: ToolDefinition[]): string {
    const extractContent = (m: any) =>
      typeof m.content === "string"
        ? m.content
        : (m.content || [])
            .filter((p: any) => p.type === "text")
            .map((p: any) => p.text)
            .join("");

    // 构建工具注入的 system prompt
    const toolPrompt = tools && tools.length > 0 ? buildToolSystemPrompt(tools) : "";

    const nonSystemMessages = messages.filter(
      (m: any) => m.role !== "system",
    );
    const systemMessages = messages.filter((m: any) => m.role === "system");

    // 合并系统消息和工具 prompt
    const systemParts: string[] = [];
    if (systemMessages.length > 0) {
      systemParts.push(systemMessages.map(extractContent).join("\n"));
    }
    if (toolPrompt) {
      systemParts.push(toolPrompt);
    }
    const fullSystemPrompt = systemParts.join("\n\n");

    // 只有一条 user 消息的简单场景
    if (
      nonSystemMessages.length === 1 &&
      nonSystemMessages[0].role === "user"
    ) {
      const userContent = extractContent(nonSystemMessages[0]);
      if (fullSystemPrompt) {
        return `${fullSystemPrompt}\n\n${userContent}`;
      }
      return userContent;
    }

    // 多轮对话场景
    const parts: string[] = [];
    if (fullSystemPrompt) {
      parts.push(`[System]\n${fullSystemPrompt}`);
    }

    for (const m of messages) {
      if (m.role === "system") continue; // 已合并到上面

      if (m.role === "tool") {
        // 工具执行结果
        parts.push(serializeToolResultMessage(m));
      } else if (m.role === "assistant" && m.tool_calls && m.tool_calls.length > 0) {
        // assistant 消息包含 tool_calls
        parts.push(`[Assistant]\n${serializeAssistantToolCalls(m)}`);
      } else if (m.role === "user") {
        parts.push(`[User]\n${extractContent(m)}`);
      } else if (m.role === "assistant") {
        parts.push(`[Assistant]\n${extractContent(m)}`);
      }
    }
    return parts.join("\n\n");
  }
}
