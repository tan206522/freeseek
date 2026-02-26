import express from "express";
import { Readable, Transform as NodeTransform } from "node:stream";
import { DeepSeekWebClient } from "./client";
import { loadCredentials } from "./auth";
import { ClaudeWebClient } from "./claude-client";
import { loadClaudeCredentials } from "./claude-auth";
import {
  createStreamConverter,
  collectFullResponse,
  type StreamConverterOptions,
} from "./stream-converter";
import {
  createClaudeStreamConverter,
  collectClaudeFullResponse,
} from "./claude-stream";

export interface ServerLog {
  time: string;
  level: "info" | "ok" | "warn" | "err";
  msg: string;
}

export type LogCallback = (log: ServerLog) => void;

const sessionCache = new Map<string, string>();
const claudeSessionCache = new Map<string, string>();
let claudeClient: ClaudeWebClient | null = null;
let logCallback: LogCallback | null = null;
let requestCount = 0;
let totalInputTokens = 0;
let totalOutputTokens = 0;

function emitLog(level: ServerLog["level"], msg: string) {
  const log: ServerLog = {
    time: new Date().toLocaleTimeString("zh-CN", { hour12: false }),
    level,
    msg,
  };
  logCallback?.(log);
  const prefix =
    level === "ok" ? "✅" : level === "warn" ? "⚠️" : level === "err" ? "❌" : "ℹ️";
  console.log(`[${log.time}] ${prefix} ${msg}`);
}

function getClient() {
  const creds = loadCredentials();
  if (!creds) throw new Error("未找到 DeepSeek 凭证，请先捕获登录凭证");
  return new DeepSeekWebClient(creds);
}

async function getClaudeClient(): Promise<ClaudeWebClient> {
  if (claudeClient) return claudeClient;
  const creds = loadClaudeCredentials();
  if (!creds) throw new Error("未找到 Claude 凭证，请先捕获 Claude 登录凭证");
  claudeClient = new ClaudeWebClient(creds);
  await claudeClient.init();
  return claudeClient;
}

export function resetClaudeClient() {
  if (claudeClient) {
    claudeClient.close().catch(() => {});
  }
  claudeClient = null;
  claudeSessionCache.clear();
}

/** 判断模型是否为 Claude */
function isClaudeModel(model: string): boolean {
  return model.startsWith("claude-");
}

/** Claude 模型 ID 映射（用户友好名 → Claude 网页端实际 ID） */
function mapClaudeModel(model: string): string {
  const map: Record<string, string> = {
    "claude-3-5-sonnet": "claude-sonnet-4-6",
    "claude-3-opus": "claude-opus-4-6",
    "claude-3-haiku": "claude-haiku-4-6",
    "claude-sonnet": "claude-sonnet-4-6",
    "claude-opus": "claude-opus-4-6",
    "claude-haiku": "claude-haiku-4-6",
  };
  return map[model] || model;
}

export function createApp() {
  const app = express();
  app.use(express.json({ limit: "10mb" }));

  // CORS
  app.use((_req, res, next) => {
    res.header("Access-Control-Allow-Origin", "*");
    res.header("Access-Control-Allow-Headers", "*");
    res.header("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
    if (_req.method === "OPTIONS") return res.sendStatus(200);
    next();
  });

  // 模型列表
  app.get("/v1/models", (_req, res) => {
    emitLog("ok", "GET /v1/models → 200");
    const models: any[] = [
      { id: "deepseek-chat", object: "model", owned_by: "deepseek-web" },
      { id: "deepseek-reasoner", object: "model", owned_by: "deepseek-web" },
      { id: "deepseek-chat-search", object: "model", owned_by: "deepseek-web" },
      { id: "deepseek-reasoner-search", object: "model", owned_by: "deepseek-web" },
    ];
    // 如果有 Claude 凭证，添加 Claude 模型
    const claudeCreds = loadClaudeCredentials();
    if (claudeCreds) {
      models.push(
        { id: "claude-sonnet-4-6", object: "model", owned_by: "claude-web" },
        { id: "claude-opus-4-6", object: "model", owned_by: "claude-web" },
        { id: "claude-haiku-4-6", object: "model", owned_by: "claude-web" },
        { id: "claude-3-5-sonnet", object: "model", owned_by: "claude-web" },
        { id: "claude-3-opus", object: "model", owned_by: "claude-web" },
        { id: "claude-3-haiku", object: "model", owned_by: "claude-web" },
      );
    }
    res.json({ object: "list", data: models });
  });

  // 聊天补全
  app.post("/v1/chat/completions", async (req, res) => {
    try {
      const {
        model = "deepseek-chat",
        messages = [],
        stream = false,
        strip_reasoning = false,
        clean_mode = false,
      } = req.body;

      // ========== Claude 路由 ==========
      if (isClaudeModel(model)) {
        return await handleClaudeRequest(req, res, { model, messages, stream });
      }

      // ========== DeepSeek 路由 ==========
      const client = getClient();

      const converterOpts: StreamConverterOptions = {
        stripReasoning:
          strip_reasoning ||
          req.headers["x-strip-reasoning"] === "true",
        cleanMode:
          clean_mode || req.headers["x-clean-mode"] === "true",
      };

      emitLog(
        "info",
        `POST /v1/chat/completions → model=${model}, stream=${stream}${converterOpts.stripReasoning ? ', strip_reasoning' : ''}${converterOpts.cleanMode ? ', clean_mode' : ''}`,
      );

      // 获取或创建会话
      const sessionKey =
        (req.headers["x-session-id"] as string) || "default";
      let sessionId = sessionCache.get(sessionKey);
      if (!sessionId) {
        sessionId = await client.createSession();
        sessionCache.set(sessionKey, sessionId);
        emitLog("info", `  ├─ 创建会话: ${sessionId.slice(0, 10)}...`);
      } else {
        emitLog("info", `  ├─ 复用会话: ${sessionId.slice(0, 10)}...`);
      }

      // 将 OpenAI messages 拼接为 prompt
      let prompt: string;
      const nonSystemMessages = messages.filter((m: any) => m.role !== "system");
      const systemMessages = messages.filter((m: any) => m.role === "system");

      const extractContent = (m: any) =>
        typeof m.content === "string"
          ? m.content
          : (m.content || [])
              .filter((p: any) => p.type === "text")
              .map((p: any) => p.text)
              .join("");

      if (nonSystemMessages.length === 1 && nonSystemMessages[0].role === "user") {
        const userContent = extractContent(nonSystemMessages[0]);
        if (systemMessages.length > 0) {
          const sysContent = systemMessages.map(extractContent).join("\n");
          prompt = `${sysContent}\n\n${userContent}`;
        } else {
          prompt = userContent;
        }
      } else {
        const parts: string[] = [];
        for (const m of messages) {
          const content = extractContent(m);
          if (m.role === "system") {
            parts.push(`[System]\n${content}`);
          } else if (m.role === "user") {
            parts.push(`[User]\n${content}`);
          } else {
            parts.push(`[Assistant]\n${content}`);
          }
        }
        prompt = parts.join("\n\n");
      }

      const searchEnabled = model.endsWith("-search");
      const baseModel = searchEnabled
        ? model.replace(/-search$/, "")
        : model;

      const inputTokens = Math.ceil(prompt.length / 1.5);
      totalInputTokens += inputTokens;

      const startTime = Date.now();
      let responseStream: ReadableStream<Uint8Array> | null = null;

      try {
        responseStream = await client.chat({
          sessionId,
          message: prompt,
          model: baseModel,
          thinkingEnabled: baseModel.includes("reasoner"),
          searchEnabled,
        });
      } catch (chatErr: any) {
        if (chatErr.message?.includes("40") || chatErr.message?.includes("session")) {
          emitLog("warn", `  ├─ 会话可能失效，重建中...`);
          sessionCache.delete(sessionKey);
          const newSessionId = await client.createSession();
          sessionCache.set(sessionKey, newSessionId);
          emitLog("info", `  ├─ 新会话: ${newSessionId.slice(0, 10)}...`);
          responseStream = await client.chat({
            sessionId: newSessionId,
            message: prompt,
            model: baseModel,
            thinkingEnabled: baseModel.includes("reasoner"),
            searchEnabled,
          });
        } else {
          throw chatErr;
        }
      }

      if (!responseStream) {
        emitLog("err", "  └─ DeepSeek 返回空响应");
        return res
          .status(500)
          .json({ error: { message: "DeepSeek 返回空响应" } });
      }

      requestCount++;

      if (stream) {
        res.setHeader("Content-Type", "text/event-stream");
        res.setHeader("Cache-Control", "no-cache");
        res.setHeader("Connection", "keep-alive");

        const { transform } = createStreamConverter(model, converterOpts);
        const nodeStream = Readable.fromWeb(responseStream as any);

        let debugLines = 0;
        const debugTransform = new NodeTransform({
          transform(chunk, _enc, cb) {
            if (debugLines < 12) {
              const text = chunk.toString();
              for (const rawLine of text.split("\n")) {
                const trimmed = rawLine.trim();
                if (!trimmed.startsWith("data:")) continue;
                const dStr = trimmed.startsWith("data: ") ? trimmed.slice(6) : trimmed.slice(5);
                if (dStr === "[DONE]") continue;
                try {
                  const d = JSON.parse(dStr.trim());
                  const vPreview = typeof d.v === "string" ? d.v.slice(0, 80) : d.v;
                  const info: any = { p: d.p, v: vPreview };
                  if (d.type) info.type = d.type;
                  if (d.model_class) info.model_class = d.model_class;
                  if (d.finish_reason) info.finish = d.finish_reason;
                  if (d.response_message_id) info.msgId = d.response_message_id;
                  if (typeof d.v === "string" && d.v.includes("<｜end▁of▁thinking｜>")) {
                    info._marker = "END_THINKING";
                  }
                  emitLog("info", `  ├─ SSE[${debugLines}]: ${JSON.stringify(info)}`);
                  debugLines++;
                } catch {}
              }
            }
            this.push(chunk);
            cb();
          },
        });

        let outputChars = 0;
        transform.on("data", (chunk: Buffer) => {
          outputChars += chunk.length;
        });

        transform.on("end", () => {
          const outputTokens = Math.ceil(outputChars / 2);
          totalOutputTokens += outputTokens;
          const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
          emitLog(
            "ok",
            `  └─ 完成: ~${outputTokens} token, ${elapsed}s`,
          );
        });

        nodeStream.pipe(debugTransform).pipe(transform).pipe(res);
        req.on("close", () => nodeStream.destroy());
      } else {
        const result = await collectFullResponse(responseStream, model, converterOpts);
        const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
        emitLog("ok", `  └─ 完成 (非流式): ${elapsed}s`);
        res.json(result);
      }
    } catch (err: any) {
      emitLog("err", `请求处理失败: ${err.message}`);
      res.status(500).json({
        error: { message: err.message, type: "server_error" },
      });
    }
  });

  // 健康检查
  app.get("/health", (_req, res) => {
    const creds = loadCredentials();
    const claudeCreds = loadClaudeCredentials();
    emitLog("ok", `GET /health → DS:${creds ? "有效" : "无"} Claude:${claudeCreds ? "有效" : "无"}`);
    res.json({
      status: creds || claudeCreds ? "ok" : "no_credentials",
      deepseek: { hasCredentials: !!creds, capturedAt: creds?.capturedAt },
      claude: { hasCredentials: !!claudeCreds, capturedAt: claudeCreds?.capturedAt },
    });
  });

  return app;
}

/** 处理 Claude 模型请求 */
async function handleClaudeRequest(
  req: express.Request,
  res: express.Response,
  params: { model: string; messages: any[]; stream: boolean },
) {
  const { model, messages, stream } = params;
  const mappedModel = mapClaudeModel(model);

  emitLog("info", `POST /v1/chat/completions → [Claude] model=${model}→${mappedModel}, stream=${stream}`);

  const client = await getClaudeClient();

  // 拼接 prompt（Claude 网页端只接受单条 prompt）
  const extractContent = (m: any) =>
    typeof m.content === "string"
      ? m.content
      : (m.content || [])
          .filter((p: any) => p.type === "text")
          .map((p: any) => p.text)
          .join("");

  const nonSystemMessages = messages.filter((m: any) => m.role !== "system");
  const systemMessages = messages.filter((m: any) => m.role === "system");
  let prompt: string;

  if (nonSystemMessages.length === 1 && nonSystemMessages[0].role === "user") {
    const userContent = extractContent(nonSystemMessages[0]);
    if (systemMessages.length > 0) {
      const sysContent = systemMessages.map(extractContent).join("\n");
      prompt = `${sysContent}\n\n${userContent}`;
    } else {
      prompt = userContent;
    }
  } else {
    const parts: string[] = [];
    for (const m of messages) {
      const content = extractContent(m);
      if (m.role === "system") parts.push(`[System]\n${content}`);
      else if (m.role === "user") parts.push(`[User]\n${content}`);
      else parts.push(`[Assistant]\n${content}`);
    }
    prompt = parts.join("\n\n");
  }

  // 获取或创建 Claude 会话
  const sessionKey = (req.headers["x-session-id"] as string) || "claude-default";
  let conversationId = claudeSessionCache.get(sessionKey);
  if (!conversationId) {
    conversationId = await client.createConversation();
    claudeSessionCache.set(sessionKey, conversationId);
    emitLog("info", `  ├─ Claude 创建会话: ${conversationId.slice(0, 10)}...`);
  } else {
    emitLog("info", `  ├─ Claude 复用会话: ${conversationId.slice(0, 10)}...`);
  }

  const startTime = Date.now();
  let responseStream: ReadableStream<Uint8Array> | null = null;

  try {
    responseStream = await client.chat({
      conversationId,
      message: prompt,
      model: mappedModel,
    });
  } catch (chatErr: any) {
    // 会话失效，重试（仅 403/401/410，不重试 400）
    if (chatErr.message?.includes("403") || chatErr.message?.includes("401") || chatErr.message?.includes("410") || chatErr.message?.includes("认证")) {
      emitLog("warn", `  ├─ Claude 会话可能失效，重建中...`);
      claudeSessionCache.delete(sessionKey);
      const newConvId = await client.createConversation();
      claudeSessionCache.set(sessionKey, newConvId);
      emitLog("info", `  ├─ Claude 新会话: ${newConvId.slice(0, 10)}...`);
      responseStream = await client.chat({
        conversationId: newConvId,
        message: prompt,
        model: mappedModel,
      });
    } else {
      throw chatErr;
    }
  }

  if (!responseStream) {
    emitLog("err", "  └─ Claude 返回空响应");
    return res.status(500).json({ error: { message: "Claude 返回空响应" } });
  }

  requestCount++;

  if (stream) {
    res.setHeader("Content-Type", "text/event-stream");
    res.setHeader("Cache-Control", "no-cache");
    res.setHeader("Connection", "keep-alive");

    const { transform } = createClaudeStreamConverter({ model: mappedModel });
    const nodeStream = Readable.fromWeb(responseStream as any);

    let outputChars = 0;
    transform.on("data", (chunk: Buffer) => { outputChars += chunk.length; });
    transform.on("end", () => {
      const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
      emitLog("ok", `  └─ [Claude] 完成: ~${Math.ceil(outputChars / 2)} token, ${elapsed}s`);
    });

    nodeStream.pipe(transform).pipe(res);
    req.on("close", () => nodeStream.destroy());
  } else {
    const result = await collectClaudeFullResponse(responseStream, mappedModel);
    const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
    emitLog("ok", `  └─ [Claude] 完成 (非流式): ${elapsed}s`);
    res.json(result);
  }
}

export function getStats() {
  return {
    requestCount,
    totalInputTokens,
    totalOutputTokens,
    totalTokens: totalInputTokens + totalOutputTokens,
  };
}

export function resetSessions() {
  sessionCache.clear();
  claudeSessionCache.clear();
  if (claudeClient) {
    claudeClient.close().catch(() => {});
    claudeClient = null;
  }
}

export function startServer(
  port = 3000,
  onLog?: LogCallback,
): ReturnType<ReturnType<typeof createApp>["listen"]> {
  if (onLog) logCallback = onLog;
  const app = createApp();
  return app.listen(port, "127.0.0.1", () => {
    emitLog("info", `FreeSeek 反代服务已启动: http://127.0.0.1:${port}`);
  });
}
