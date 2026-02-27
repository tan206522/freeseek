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
import { ClaudeWebClient, type ClaudeCredentials } from "../claude-client";
import {
  loadClaudeCredentials,
  clearClaudeCredentials,
  captureClaudeCredentials,
} from "../claude-auth";
import {
  createClaudeStreamConverter,
  collectClaudeFullResponse,
} from "../claude-stream";
import { CredentialPool } from "../credential-pool";
import {
  buildToolSystemPrompt,
  serializeToolResultMessage,
  serializeAssistantToolCalls,
} from "../tool-call-parser";
import path from "node:path";

const AUTH_FILE = path.join(__dirname, "..", "..", "data", "claude-auth.json");

/** Claude 模型别名映射 */
const MODEL_ALIASES: Record<string, string> = {
  "claude-3-5-sonnet": "claude-sonnet-4-6",
  "claude-3-opus": "claude-opus-4-6",
  "claude-3-haiku": "claude-haiku-4-6",
  "claude-sonnet": "claude-sonnet-4-6",
  "claude-opus": "claude-opus-4-6",
  "claude-haiku": "claude-haiku-4-6",
};

export class ClaudeProvider implements Provider {
  readonly id = "claude";
  readonly name = "Claude";

  private pool: CredentialPool;
  private clients = new Map<string, ClaudeWebClient>();
  private sessionCache = new Map<string, string>();

  constructor() {
    this.pool = new CredentialPool(AUTH_FILE);
  }

  // --- 模型 ---

  getModels(): ModelInfo[] {
    return [
      { id: "claude-sonnet-4-6", owned_by: "claude-web" },
      { id: "claude-opus-4-6", owned_by: "claude-web" },
      { id: "claude-haiku-4-6", owned_by: "claude-web" },
      { id: "claude-3-5-sonnet", owned_by: "claude-web", aliasOf: "claude-sonnet-4-6" },
      { id: "claude-3-opus", owned_by: "claude-web", aliasOf: "claude-opus-4-6" },
      { id: "claude-3-haiku", owned_by: "claude-web", aliasOf: "claude-haiku-4-6" },
    ];
  }

  matchModel(model: string): boolean {
    return model.startsWith("claude-");
  }

  mapModel(model: string): string {
    return MODEL_ALIASES[model] || model;
  }

  // --- 凭证池 ---

  getCredentialPool(): CredentialPool {
    return this.pool;
  }

  // --- 凭证 ---

  loadCredentials(): ClaudeCredentials | null {
    return this.pool.first() as ClaudeCredentials | null;
  }

  getCredentialsSummary(): CredentialsSummary | null {
    const creds = this.pool.first() as ClaudeCredentials | null;
    if (!creds) return null;
    return {
      hasCredentials: true,
      capturedAt: creds.capturedAt,
      hasSessionKey: !!creds.sessionKey,
      sessionKeyPrefix: creds.sessionKey?.slice(0, 20) + "...",
      hasCookie: !!creds.cookie,
      hasOrganizationId: !!creds.organizationId,
      pool: this.pool.getSummary(),
    };
  }

  clearCredentials(): boolean {
    this.resetClient();
    return this.pool.clearAll();
  }

  saveManualCredentials(data: Record<string, any>): void {
    const creds = {
      sessionKey: data.sessionKey.trim(),
      cookie:
        data.cookie?.trim() || `sessionKey=${data.sessionKey.trim()}`,
      userAgent:
        data.userAgent?.trim() ||
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
      capturedAt: new Date().toISOString(),
    };
    this.pool.set(creds);
    this.resetClient();
  }

  addCredentials(data: Record<string, any>): string {
    const creds = {
      sessionKey: data.sessionKey.trim(),
      cookie:
        data.cookie?.trim() || `sessionKey=${data.sessionKey.trim()}`,
      userAgent:
        data.userAgent?.trim() ||
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
      capturedAt: new Date().toISOString(),
    };
    this.resetClient();
    return this.pool.add(creds);
  }

  removeCredentials(id: string): boolean {
    const removed = this.pool.remove(id);
    if (removed) {
      const client = this.clients.get(id);
      if (client) {
        client.close().catch(() => {});
        this.clients.delete(id);
      }
    }
    return removed;
  }

  resetCredentialStatus(id: string): void {
    this.pool.resetStatus(id);
  }

  async captureCredentials(
    onStatus?: (msg: string) => void,
  ): Promise<BaseCredentials> {
    const creds = await captureClaudeCredentials(onStatus, false);
    this.pool.add(creds);
    this.resetClient();
    return creds;
  }

  // --- 客户端 ---

  private async getClient(credentialId: string, creds: ClaudeCredentials): Promise<ClaudeWebClient> {
    let client = this.clients.get(credentialId);
    if (client) return client;
    client = new ClaudeWebClient(creds);
    await client.init();
    this.clients.set(credentialId, client);
    return client;
  }

  async chat(request: ChatRequest): Promise<ChatResponse> {
    const mappedModel = this.mapModel(request.model);
    const prompt = this.buildPrompt(request.messages, request.tools);
    const sessionKey = request.sessionKey || "claude-default";

    // 多账号轮询
    const entry = this.pool.next();
    if (!entry) throw new Error("未找到 Claude 凭证，请先捕获 Claude 登录凭证");

    const creds = entry.credentials as ClaudeCredentials;
    const client = await this.getClient(entry.id, creds);

    let conversationId = this.sessionCache.get(sessionKey);
    if (!conversationId) {
      conversationId = await client.createConversation();
      this.sessionCache.set(sessionKey, conversationId);
    }

    let responseStream: ReadableStream<Uint8Array> | null = null;

    try {
      responseStream = await client.chat({
        conversationId,
        message: prompt,
        model: mappedModel,
      });
      this.pool.markSuccess(entry.id);
    } catch (chatErr: any) {
      if (
        chatErr.message?.includes("403") ||
        chatErr.message?.includes("401") ||
        chatErr.message?.includes("410") ||
        chatErr.message?.includes("认证")
      ) {
        this.sessionCache.delete(sessionKey);
        try {
          const newConvId = await client.createConversation();
          this.sessionCache.set(sessionKey, newConvId);
          responseStream = await client.chat({
            conversationId: newConvId,
            message: prompt,
            model: mappedModel,
          });
          this.pool.markSuccess(entry.id);
        } catch (retryErr: any) {
          this.pool.markFailed(entry.id, retryErr.message);
          // 尝试切换到下一个凭证
          const fallback = this.pool.next();
          if (fallback && fallback.id !== entry.id) {
            const fbCreds = fallback.credentials as ClaudeCredentials;
            const fbClient = await this.getClient(fallback.id, fbCreds);
            const fbConvId = await fbClient.createConversation();
            responseStream = await fbClient.chat({
              conversationId: fbConvId,
              message: prompt,
              model: mappedModel,
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
    for (const client of this.clients.values()) {
      client.close().catch(() => {});
    }
    this.clients.clear();
    this.sessionCache.clear();
  }

  // --- 流转换 ---

  createStreamConverter(options: StreamConverterOptions): StreamConverterResult {
    const { transform } = createClaudeStreamConverter({
      model: this.mapModel(options.model),
      hasTools: options.hasTools,
    });
    return { transform };
  }

  collectFullResponse(
    stream: ReadableStream<Uint8Array>,
    model: string,
    options?: { stripReasoning?: boolean; cleanMode?: boolean; hasTools?: boolean },
  ): Promise<object> {
    return collectClaudeFullResponse(stream, this.mapModel(model), options);
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
