import { Transform } from "node:stream";
import type { CredentialPool, PoolSummary } from "../credential-pool";

/**
 * FreeSeek Provider 插件接口
 *
 * 每个 AI 厂商实现此接口即可接入系统。
 * 三件套：Auth（凭证管理）+ Client（API 客户端）+ StreamConverter（SSE 转换）
 */

// ========== 凭证相关 ==========

/** 通用凭证基础字段 */
export interface BaseCredentials {
  capturedAt: string;
  userAgent: string;
  [key: string]: any;
}

/** 凭证摘要（用于前端展示，不含敏感信息） */
export interface CredentialsSummary {
  hasCredentials: boolean;
  capturedAt: string | null;
  /** 凭证池摘要 */
  pool?: PoolSummary;
  /** 厂商自定义的摘要字段 */
  [key: string]: any;
}

// ========== Tool Calling 相关 ==========

export interface ToolFunction {
  name: string;
  description?: string;
  parameters?: Record<string, any>;
}

export interface ToolDefinition {
  type: "function";
  function: ToolFunction;
}

export interface ToolCall {
  id: string;
  type: "function";
  function: { name: string; arguments: string };
}

export type ToolChoice =
  | "auto"
  | "none"
  | "required"
  | { type: "function"; function: { name: string } };

// ========== 聊天相关 ==========

/** OpenAI 格式的消息 */
export interface ChatMessage {
  role: "system" | "user" | "assistant" | "tool";
  content: string | Array<{ type: string; text?: string; image_url?: { url: string } }> | null;
  /** assistant 消息上的工具调用 */
  tool_calls?: ToolCall[];
  /** tool 结果消息的调用 ID */
  tool_call_id?: string;
  /** tool 结果消息的工具名 */
  name?: string;
}

/** 聊天请求参数 */
export interface ChatRequest {
  model: string;
  messages: ChatMessage[];
  stream: boolean;
  strip_reasoning?: boolean;
  clean_mode?: boolean;
  sessionKey?: string;
  /** OpenAI 格式的工具定义 */
  tools?: ToolDefinition[];
  /** 工具调用策略 */
  tool_choice?: ToolChoice;
}

/** 聊天响应（流式返回原始 SSE 流，非流式返回完整 OpenAI 格式对象） */
export interface ChatResponse {
  stream: ReadableStream<Uint8Array> | null;
}

// ========== 模型定义 ==========

export interface ModelInfo {
  id: string;
  owned_by: string;
  /** 可选的别名映射（用户友好名 → 实际 ID） */
  aliasOf?: string;
}

// ========== 流转换器 ==========

export interface StreamConverterResult {
  transform: Transform;
  /** 可选：获取 parent message id 等元数据 */
  getMetadata?: () => Record<string, any>;
}

export interface StreamConverterOptions {
  model: string;
  stripReasoning?: boolean;
  cleanMode?: boolean;
  /** 是否启用 tool call 解析 */
  hasTools?: boolean;
}

// ========== Provider 接口 ==========

export interface Provider {
  /** 厂商唯一标识，如 "deepseek", "claude" */
  readonly id: string;

  /** 厂商显示名 */
  readonly name: string;

  // --- 模型 ---

  /** 返回该厂商支持的所有模型 */
  getModels(): ModelInfo[];

  /** 判断一个模型 ID 是否属于该厂商 */
  matchModel(model: string): boolean;

  /** 模型 ID 映射（别名 → 实际 ID），不需要映射时返回原值 */
  mapModel(model: string): string;

  // --- 凭证 ---

  /** 加载已保存的凭证 */
  loadCredentials(): BaseCredentials | null;

  /** 获取凭证摘要（用于前端展示） */
  getCredentialsSummary(): CredentialsSummary | null;

  /** 清除凭证 */
  clearCredentials(): boolean;

  /** 手动保存凭证 */
  saveManualCredentials(data: Record<string, any>): void;

  /** 自动捕获凭证（通过浏览器自动化） */
  captureCredentials(onStatus?: (msg: string) => void): Promise<BaseCredentials>;

  /** 可选：检查凭证过期状态 */
  checkExpiry?(): { valid: boolean; expiresAt?: string | null; expired?: boolean; expiringSoon?: boolean; remainingMs?: number };

  // --- 客户端 ---

  /** 发起聊天请求，返回原始 SSE 流 */
  chat(request: ChatRequest): Promise<ChatResponse>;

  /** 重置客户端状态（清除会话缓存等） */
  resetClient(): void;

  // --- 流转换 ---

  /** 创建流式 SSE 转换器（原始 SSE → OpenAI 兼容 SSE） */
  createStreamConverter(options: StreamConverterOptions): StreamConverterResult;

  /** 收集完整非流式响应 */
  collectFullResponse(stream: ReadableStream<Uint8Array>, model: string, options?: { stripReasoning?: boolean; cleanMode?: boolean; hasTools?: boolean }): Promise<object>;

  // --- 凭证池（P1 多账号轮询） ---

  /** 获取凭证池实例 */
  getCredentialPool?(): CredentialPool;

  /** 添加凭证到池中，返回凭证 ID */
  addCredentials?(data: Record<string, any>): string;

  /** 从池中移除指定凭证 */
  removeCredentials?(id: string): boolean;

  /** 重置指定凭证状态为 active */
  resetCredentialStatus?(id: string): void;
}
