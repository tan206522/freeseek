import { Transform } from "node:stream";
import crypto from "node:crypto";

/**
 * Claude 网页版 SSE → OpenAI 兼容格式转换器
 *
 * Claude SSE 格式说明：
 * - 每条 SSE 以 "event: xxx" 开头，后跟 "data: {...}"
 * - 主要事件类型：
 *   - message_start: 消息开始，包含 message 元数据
 *   - content_block_start: 内容块开始
 *   - content_block_delta: 内容增量（核心文本在 delta.text 中）
 *   - content_block_stop: 内容块结束
 *   - message_delta: 消息级别增量（stop_reason 等）
 *   - message_stop: 消息结束
 *   - completion: 旧格式，completion 字段包含文本
 *   - error: 错误信息
 */

export interface ClaudeStreamOptions {
  /** 映射后的模型名 */
  model?: string;
}

export function createClaudeStreamConverter(options: ClaudeStreamOptions = {}) {
  const model = options.model || "claude-sonnet-4-6";
  const completionId = `chatcmpl-${crypto.randomUUID().slice(0, 8)}`;
  const created = Math.floor(Date.now() / 1000);
  let buffer = "";
  let currentEvent = "";

  const transform = new Transform({
    transform(chunk, _encoding, callback) {
      buffer += chunk.toString();
      const lines = buffer.split("\n");
      buffer = lines.pop() || "";

      for (const line of lines) {
        const trimmed = line.trim();

        // 捕获事件类型
        if (trimmed.startsWith("event:")) {
          currentEvent = trimmed.slice(6).trim();
          continue;
        }

        if (!trimmed.startsWith("data:")) continue;

        const dataStr = trimmed.startsWith("data: ")
          ? trimmed.slice(6).trim()
          : trimmed.slice(5).trim();

        if (!dataStr || dataStr === "[DONE]") {
          this.push("data: [DONE]\n\n");
          continue;
        }

        try {
          const data = JSON.parse(dataStr);
          const text = extractClaudeText(data, currentEvent);

          if (text) {
            const outChunk = {
              id: completionId,
              object: "chat.completion.chunk",
              created,
              model,
              choices: [{
                index: 0,
                delta: { content: text },
                finish_reason: null,
              }],
            };
            this.push(`data: ${JSON.stringify(outChunk)}\n\n`);
          }

          // 检测结束
          if (
            currentEvent === "message_stop" ||
            currentEvent === "message_delta" && data.delta?.stop_reason
          ) {
            const endChunk = {
              id: completionId,
              object: "chat.completion.chunk",
              created,
              model,
              choices: [{
                index: 0,
                delta: {},
                finish_reason: "stop",
              }],
            };
            this.push(`data: ${JSON.stringify(endChunk)}\n\n`);
            this.push("data: [DONE]\n\n");
          }
        } catch {
          // 忽略解析错误
        }
      }
      callback();
    },

    flush(callback) {
      // 确保发送结束标记
      const endChunk = {
        id: completionId,
        object: "chat.completion.chunk",
        created,
        model,
        choices: [{
          index: 0,
          delta: {},
          finish_reason: "stop",
        }],
      };
      this.push(`data: ${JSON.stringify(endChunk)}\n\n`);
      this.push("data: [DONE]\n\n");
      callback();
    },
  });

  return { transform };
}

/**
 * 从 Claude SSE 数据中提取文本内容
 */
function extractClaudeText(data: any, event: string): string | null {
  // content_block_delta → delta.text（最常见）
  if (event === "content_block_delta" && data.delta?.text) {
    return data.delta.text;
  }

  // 旧格式 completion 事件
  if (event === "completion" && typeof data.completion === "string") {
    return data.completion;
  }

  // message_start 中可能有初始内容（罕见）
  if (event === "content_block_start" && data.content_block?.text) {
    return data.content_block.text;
  }

  return null;
}

/**
 * 非流式：收集 Claude SSE 完整响应
 */
export async function collectClaudeFullResponse(
  stream: ReadableStream<Uint8Array>,
  model: string,
): Promise<object> {
  const reader = stream.getReader();
  const decoder = new TextDecoder();
  let content = "";
  let buffer = "";
  let currentEvent = "";

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;

    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split("\n");
    buffer = lines.pop() || "";

    for (const line of lines) {
      const trimmed = line.trim();

      if (trimmed.startsWith("event:")) {
        currentEvent = trimmed.slice(6).trim();
        continue;
      }

      if (!trimmed.startsWith("data:")) continue;
      const dataStr = trimmed.startsWith("data: ")
        ? trimmed.slice(6).trim()
        : trimmed.slice(5).trim();
      if (!dataStr || dataStr === "[DONE]") continue;

      try {
        const data = JSON.parse(dataStr);
        const text = extractClaudeText(data, currentEvent);
        if (text) content += text;
      } catch { /* ignore */ }
    }
  }

  return {
    id: `chatcmpl-${crypto.randomUUID().slice(0, 8)}`,
    object: "chat.completion",
    created: Math.floor(Date.now() / 1000),
    model,
    choices: [{
      index: 0,
      message: { role: "assistant", content },
      finish_reason: "stop",
    }],
    usage: { prompt_tokens: 0, completion_tokens: 0, total_tokens: 0 },
  };
}
