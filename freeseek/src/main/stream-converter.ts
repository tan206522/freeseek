import { Transform } from "node:stream";
import crypto from "node:crypto";

/**
 * DeepSeek 网页版 SSE 清洗 & 转换器
 *
 * DeepSeek 网页版 SSE 格式说明：
 * - 每条 SSE 是 JSON 对象，核心字段为 p (path) 和 v (value)
 * - 思考链内容和正文内容通过不同的 p 路径区分
 * - 思考链结束时会发送 <｜end▁of▁thinking｜> 特殊 token
 * - 还可能包含 model_class, finish_reason 等元数据字段
 *
 * 本转换器采用「状态机 + 特殊 token 检测」双重策略：
 * 1. 如果 p 路径包含 thinking/reasoning → 标记为思考链
 * 2. 如果检测到 <｜end▁of▁thinking｜> → 后续内容切换为正文
 * 3. 对所有输出进行清洗：去除 citation、FINISHED、特殊 unicode token 等
 */

// 需要过滤的特殊 token 和标记
const SPECIAL_TOKENS = new Set([
  "<｜end▁of▁thinking｜>",
  "<|endoftext|>",
  "<|im_end|>",
  "<|im_start|>",
  "FINISHED",
  "\nFINISHED",
]);

// 需要清理的正则模式
const CITATION_RE = /\[citation:\d+\]/g;
const SEARCH_REF_RE = /\[ref_\d+\]/g;
const SEARCH_MARKER_RE = /\[search_begin\]|\[search_end\]/g;
const UNICODE_SPECIAL_RE = /[\u200b\u200c\u200d\ufeff]/g; // 零宽字符

/**
 * 清洗文本内容，去除所有 DeepSeek 特有的标记和 artifact
 */
function sanitize(text: string, isReasoning: boolean): string | null {
  if (!text) return null;

  // 检查是否是特殊 token
  const trimmed = text.trim();
  if (SPECIAL_TOKENS.has(trimmed)) return null;

  let cleaned = text;

  // 正文内容清洗（思考链保留原始内容）
  if (!isReasoning) {
    cleaned = cleaned
      .replace(CITATION_RE, "")
      .replace(SEARCH_REF_RE, "")
      .replace(SEARCH_MARKER_RE, "");
  }

  // 通用清洗
  cleaned = cleaned.replace(UNICODE_SPECIAL_RE, "");

  // 如果清洗后为空，返回 null
  if (cleaned.length === 0) return null;

  return cleaned;
}

/**
 * 判断一个 SSE 数据块是否属于思考链
 *
 * 策略优先级：
 * 1. p 路径包含 thinking/reasoning 关键词
 * 2. type 字段为 thinking/reasoning
 * 3. 已有 OpenAI 格式的 reasoning_content
 */
function isThinkingChunk(data: any): boolean | null {
  // 策略 1: 基于 p 路径
  const p = data.p;
  if (typeof p === "string" && p.length > 0) {
    const pLower = p.toLowerCase();
    if (
      pLower.includes("thinking") ||
      pLower.includes("reasoning") ||
      pLower.includes("think_content") ||
      pLower.includes("thought")
    ) {
      return true;
    }
    // 路径存在但不含思考关键词 → 正文
    return false;
  }

  // 策略 2: 基于 type 字段
  if (data.type === "thinking" || data.type === "reasoning") return true;
  if (data.type === "text" || data.type === "content") return false;

  // 策略 3: 已有 OpenAI 格式
  if (data.choices?.[0]?.delta?.reasoning_content) return true;
  if (data.choices?.[0]?.delta?.content !== undefined) return false;

  // 无法判断
  return null;
}

/**
 * 从 SSE 数据块中提取文本内容
 */
function extractContent(data: any): string | null {
  // v 字段（JSON Patch 格式）
  if (typeof data.v === "string") return data.v;

  // content 字段
  if (typeof data.content === "string") return data.content;

  // OpenAI 格式
  const delta = data.choices?.[0]?.delta;
  if (delta?.reasoning_content) return delta.reasoning_content;
  if (delta?.content) return delta.content;

  return null;
}

export interface StreamConverterOptions {
  /** 是否从输出中剥离思考链（业务场景用） */
  stripReasoning?: boolean;
  /** 是否启用激进清洗模式 */
  cleanMode?: boolean;
}

/**
 * 将 DeepSeek Web SSE 流转换为 OpenAI 兼容的 SSE 流
 */
export function createStreamConverter(
  model: string,
  options: StreamConverterOptions = {},
) {
  const completionId = `chatcmpl-${crypto.randomUUID().slice(0, 8)}`;
  const created = Math.floor(Date.now() / 1000);
  let buffer = "";
  let parentMessageId: string | null = null;

  // 状态机：追踪当前是否处于思考阶段
  let thinkingPhase = model.includes("reasoner"); // reasoner 模型默认从思考开始
  let thinkingEnded = false; // 是否已检测到思考结束标记
  let hasAnyContent = false; // 是否已收到任何正文内容
  let firstContentLogged = false; // 是否已记录第一个正文 chunk

  const transform = new Transform({
    transform(chunk, _encoding, callback) {
      buffer += chunk.toString();
      const lines = buffer.split("\n");
      buffer = lines.pop() || "";

      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed || trimmed.startsWith("event:")) continue;

        // 兼容 "data: {...}" 和 "data:{...}"
        let dataStr = "";
        if (trimmed.startsWith("data: ")) {
          dataStr = trimmed.slice(6).trim();
        } else if (trimmed.startsWith("data:")) {
          dataStr = trimmed.slice(5).trim();
        } else {
          continue;
        }

        if (dataStr === "[DONE]") {
          this.push("data: [DONE]\n\n");
          continue;
        }

        try {
          const data = JSON.parse(dataStr);

          // 记录 parent message id
          if (data.response_message_id) {
            parentMessageId = data.response_message_id;
          }

          // 提取文本
          const rawContent = extractContent(data);
          if (rawContent === null || rawContent === undefined) continue;

          // 检测 <｜end▁of▁thinking｜> 标记 → 切换到正文阶段
          if (rawContent.includes("<｜end▁of▁thinking｜>")) {
            thinkingPhase = false;
            thinkingEnded = true;
            // 提取标记之后的正文部分（如果有）
            const afterMarker = rawContent.split("<｜end▁of▁thinking｜>").pop() || "";
            if (afterMarker.trim()) {
              const cleaned = sanitize(afterMarker, false);
              if (cleaned) {
                hasAnyContent = true;
                this.push(
                  `data: ${JSON.stringify(makeChunk(completionId, created, model, cleaned, false))}\n\n`,
                );
              }
            }
            continue;
          }

          // 判断是否为思考链
          const isThinking = isThinkingChunk(data);
          let isReasoning: boolean;

          if (isThinking !== null) {
            // 明确判断
            isReasoning = isThinking;
            // 如果从思考切换到正文，更新状态
            if (!isThinking && thinkingPhase) {
              thinkingPhase = false;
              thinkingEnded = true;
            }
          } else {
            // 无法从数据判断，使用状态机
            isReasoning = thinkingPhase && !thinkingEnded;
          }

          // 清洗内容
          const content = sanitize(rawContent, isReasoning);
          if (content === null) continue;

          // 如果设置了 stripReasoning，跳过思考链
          if (options.stripReasoning && isReasoning) continue;

          if (!isReasoning) hasAnyContent = true;

          // 记录第一个正文 chunk 的原始内容，帮助排查前缀问题
          if (!isReasoning && !firstContentLogged) {
            firstContentLogged = true;
            const charCodes = content.slice(0, 10).split("").map(c => `U+${c.charCodeAt(0).toString(16).toUpperCase().padStart(4, "0")}`);
            console.log(`[StreamConverter] 首个正文 chunk: "${content.slice(0, 60)}" | 前10字符编码: [${charCodes.join(", ")}]`);
          }

          const outChunk = makeChunk(
            completionId,
            created,
            model,
            content,
            isReasoning,
          );
          this.push(`data: ${JSON.stringify(outChunk)}\n\n`);
        } catch {
          // 忽略解析错误
        }
      }
      callback();
    },

    flush(callback) {
      const endChunk = {
        id: completionId,
        object: "chat.completion.chunk",
        created,
        model,
        choices: [
          {
            index: 0,
            delta: {},
            finish_reason: "stop",
          },
        ],
      };
      this.push(`data: ${JSON.stringify(endChunk)}\n\n`);
      this.push("data: [DONE]\n\n");
      callback();
    },
  });

  return { transform, getParentMessageId: () => parentMessageId };
}

function makeChunk(
  id: string,
  created: number,
  model: string,
  content: string,
  isReasoning: boolean,
) {
  return {
    id,
    object: "chat.completion.chunk",
    created,
    model,
    choices: [
      {
        index: 0,
        delta: isReasoning
          ? { reasoning_content: content }
          : { content },
        finish_reason: null,
      },
    ],
  };
}

/**
 * 非流式响应：收集完整内容后返回
 */
export async function collectFullResponse(
  stream: ReadableStream<Uint8Array>,
  model: string,
  options: StreamConverterOptions = {},
): Promise<object> {
  const reader = stream.getReader();
  const decoder = new TextDecoder();
  let content = "";
  let reasoning = "";
  let buffer = "";

  // 状态机
  let thinkingPhase = model.includes("reasoner");
  let thinkingEnded = false;

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;

    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split("\n");
    buffer = lines.pop() || "";

    for (const line of lines) {
      const trimmed = line.trim();
      let dataStr = "";
      if (trimmed.startsWith("data: ")) {
        dataStr = trimmed.slice(6).trim();
      } else if (trimmed.startsWith("data:")) {
        dataStr = trimmed.slice(5).trim();
      } else {
        continue;
      }
      if (dataStr === "[DONE]") continue;

      try {
        const data = JSON.parse(dataStr);
        const rawContent = extractContent(data);
        if (rawContent === null) continue;

        // 检测思考结束标记
        if (rawContent.includes("<｜end▁of▁thinking｜>")) {
          thinkingPhase = false;
          thinkingEnded = true;
          const afterMarker =
            rawContent.split("<｜end▁of▁thinking｜>").pop() || "";
          const cleaned = sanitize(afterMarker, false);
          if (cleaned) content += cleaned;
          continue;
        }

        // 判断类型
        const isThinking = isThinkingChunk(data);
        let isReasoning: boolean;

        if (isThinking !== null) {
          isReasoning = isThinking;
          if (!isThinking && thinkingPhase) {
            thinkingPhase = false;
            thinkingEnded = true;
          }
        } else {
          isReasoning = thinkingPhase && !thinkingEnded;
        }

        const cleaned = sanitize(rawContent, isReasoning);
        if (cleaned === null) continue;

        if (isReasoning) {
          reasoning += cleaned;
        } else {
          content += cleaned;
        }
      } catch {
        // ignore
      }
    }
  }

  return {
    id: `chatcmpl-${crypto.randomUUID().slice(0, 8)}`,
    object: "chat.completion",
    created: Math.floor(Date.now() / 1000),
    model,
    choices: [
      {
        index: 0,
        message: {
          role: "assistant",
          content,
          ...(reasoning && !options.stripReasoning
            ? { reasoning_content: reasoning }
            : {}),
        },
        finish_reason: "stop",
      },
    ],
    usage: { prompt_tokens: 0, completion_tokens: 0, total_tokens: 0 },
  };
}
