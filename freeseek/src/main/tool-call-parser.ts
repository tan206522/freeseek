/**
 * Tool Call 注入与解析模块
 *
 * 负责将 OpenAI 格式的 tools 定义注入到 prompt 中，
 * 并从模型的文本输出中解析 <tool_call> XML 标签，
 * 转换为标准 OpenAI tool_calls 格式。
 *
 * XML 格式约定（与 OpenClaw deepseek-web-stream.ts 兼容）：
 *   <tool_call id="call_xxx" name="tool_name">{"param": "value"}</tool_call>
 */

import type { ToolDefinition, ToolCall, ChatMessage } from "./providers/types";
import crypto from "node:crypto";

// ========== 工具注入（prompt 构建） ==========

/**
 * 生成工具定义的 system prompt 注入文本
 */
export function buildToolSystemPrompt(tools: ToolDefinition[]): string {
  if (!tools || tools.length === 0) return "";

  const toolDescriptions = tools.map((t) => {
    const fn = t.function;
    let desc = `- **${fn.name}**`;
    if (fn.description) desc += `: ${fn.description}`;
    if (fn.parameters && Object.keys(fn.parameters).length > 0) {
      desc += `\n  Parameters: ${JSON.stringify(fn.parameters)}`;
    }
    return desc;
  });

  return [
    "## Tool Use Instructions",
    "",
    "You have access to the following tools. When you need to use a tool, output a <tool_call> XML tag.",
    "You may call multiple tools in a single response.",
    "",
    "### Format",
    'To call a tool, output exactly this format (the id attribute is optional, one will be assigned if omitted):',
    "",
    '```',
    '<tool_call name="tool_name">{"param_name": "param_value"}</tool_call>',
    '```',
    "",
    "### Important Rules",
    "1. The content inside <tool_call> tags MUST be valid JSON matching the tool's parameters schema.",
    "2. Do NOT wrap <tool_call> tags in markdown code blocks.",
    "3. You can include normal text before or after <tool_call> tags.",
    "4. When you want to call a tool, use <tool_call> tags. When you don't need tools, respond normally.",
    "5. NEVER describe or explain tool calls in text form - always use the XML tag format.",
    "",
    "### Available Tools",
    "",
    ...toolDescriptions,
  ].join("\n");
}

/**
 * 序列化 tool 角色的消息为可读文本（工具执行结果回传给模型）
 */
export function serializeToolResultMessage(msg: ChatMessage): string {
  const name = msg.name || "unknown_tool";
  const callId = msg.tool_call_id || "unknown";
  const content =
    typeof msg.content === "string"
      ? msg.content
      : JSON.stringify(msg.content);

  return `[Tool Result] tool=${name} call_id=${callId}\n${content}`;
}

/**
 * 序列化 assistant 消息中的 tool_calls 为可读文本
 * （用于多轮对话中，将之前的 tool_calls 回传给模型）
 */
export function serializeAssistantToolCalls(msg: ChatMessage): string {
  if (!msg.tool_calls || msg.tool_calls.length === 0) return "";

  const parts = msg.tool_calls.map((tc) => {
    const args = tc.function.arguments;
    return `<tool_call name="${tc.function.name}">${args}</tool_call>`;
  });

  const textContent =
    typeof msg.content === "string"
      ? msg.content
      : msg.content
        ? (msg.content as any[])
            .filter((p: any) => p.type === "text")
            .map((p: any) => p.text)
            .join("")
        : "";

  return textContent
    ? `${textContent}\n${parts.join("\n")}`
    : parts.join("\n");
}

// ========== 工具调用解析（从模型输出中提取） ==========

/**
 * 从完整文本中解析所有 <tool_call> 标签
 */
export function parseToolCalls(text: string): {
  toolCalls: ToolCall[];
  textContent: string;
} {
  const toolCalls: ToolCall[] = [];

  // 匹配 <tool_call name="xxx" id="yyy">...</tool_call>
  // id 属性是可选的
  const tagRegex =
    /<tool_call\s+(?:id=['"]?([^'">\s]+)['"]?\s+)?name=['"]?([^'">\s]+)['"]?\s*(?:id=['"]?([^'">\s]+)['"]?\s*)?>([\s\S]*?)<\/tool_call>/gi;

  let textContent = text;
  let match: RegExpExecArray | null;

  while ((match = tagRegex.exec(text)) !== null) {
    const id = match[1] || match[3] || `call_${crypto.randomUUID().slice(0, 8)}`;
    const name = match[2];
    const argsStr = (match[4] || "{}").trim();

    // 验证 JSON 是否合法
    let validArgs: string;
    try {
      JSON.parse(argsStr);
      validArgs = argsStr;
    } catch {
      // 如果不是合法 JSON，包裹为 raw
      validArgs = JSON.stringify({ raw: argsStr });
    }

    toolCalls.push({
      id,
      type: "function",
      function: {
        name,
        arguments: validArgs,
      },
    });
  }

  // 从文本中移除所有 tool_call 标签，保留纯文本内容
  if (toolCalls.length > 0) {
    textContent = text.replace(tagRegex, "").trim();
  }

  return { toolCalls, textContent };
}

// ========== 流式解析器（状态机） ==========

export interface StreamToolCallParser {
  /**
   * 输入一段文本增量，返回：
   * - pendingText: 可以安全输出的普通文本
   * - completedCalls: 已完成解析的 tool_calls
   * - isBuffering: 是否正在缓冲可能的 tool_call 标签
   */
  feed(chunk: string): {
    pendingText: string;
    completedCalls: ToolCall[];
    isBuffering: boolean;
  };

  /** 流结束时调用，冲刷缓冲区 */
  flush(): {
    pendingText: string;
    completedCalls: ToolCall[];
  };
}

/**
 * 创建流式 tool_call 解析器
 *
 * 策略：缓冲检测 `<tool_call` 开始标签。
 * - 普通文本直接通过
 * - 遇到 `<` 时开始缓冲
 * - 如果缓冲内容匹配 `<tool_call ...>...</tool_call>`，则解析为 ToolCall
 * - 如果缓冲超时或明确不匹配，则将缓冲内容作为普通文本输出
 */
export function createStreamToolCallParser(): StreamToolCallParser {
  let tagBuffer = "";
  let inTag = false;
  let depth = 0; // 追踪嵌套的 < > 深度

  function feed(chunk: string): {
    pendingText: string;
    completedCalls: ToolCall[];
    isBuffering: boolean;
  } {
    let pendingText = "";
    const completedCalls: ToolCall[] = [];

    for (let i = 0; i < chunk.length; i++) {
      const ch = chunk[i];

      if (!inTag) {
        if (ch === "<") {
          // 可能是 tool_call 标签的开始
          inTag = true;
          tagBuffer = "<";
        } else {
          pendingText += ch;
        }
      } else {
        tagBuffer += ch;

        // 检测是否已经可以确定不是 tool_call（前缀不匹配）
        if (tagBuffer.length <= "<tool_call".length) {
          if (!"<tool_call".startsWith(tagBuffer.toLowerCase()) &&
              !"</tool_call".startsWith(tagBuffer.toLowerCase())) {
            // 明确不是 tool_call 标签，把缓冲内容作为普通文本输出
            pendingText += tagBuffer;
            tagBuffer = "";
            inTag = false;
          }
        } else if (tagBuffer.toLowerCase().startsWith("</tool_call")) {
          // 这是一个孤立的闭合标签，不应出现。作为文本输出。
          if (ch === ">") {
            pendingText += tagBuffer;
            tagBuffer = "";
            inTag = false;
          }
        } else if (tagBuffer.toLowerCase().startsWith("<tool_call")) {
          // 继续缓冲直到找到完整的 </tool_call>
          if (tagBuffer.toLowerCase().includes("</tool_call>")) {
            // 完整的 tool_call 标签已缓冲完成
            const parsed = parseToolCalls(tagBuffer);
            if (parsed.toolCalls.length > 0) {
              completedCalls.push(...parsed.toolCalls);
              if (parsed.textContent) {
                pendingText += parsed.textContent;
              }
            } else {
              // 解析失败，作为文本输出
              pendingText += tagBuffer;
            }
            tagBuffer = "";
            inTag = false;
          }
          // 否则继续缓冲
        } else {
          // 缓冲内容超出 tool_call 前缀且不匹配
          pendingText += tagBuffer;
          tagBuffer = "";
          inTag = false;
        }
      }
    }

    return {
      pendingText,
      completedCalls,
      isBuffering: inTag,
    };
  }

  function flush(): {
    pendingText: string;
    completedCalls: ToolCall[];
  } {
    const completedCalls: ToolCall[] = [];
    let pendingText = "";

    if (tagBuffer) {
      // 流结束但还有未完成的缓冲
      const parsed = parseToolCalls(tagBuffer);
      if (parsed.toolCalls.length > 0) {
        completedCalls.push(...parsed.toolCalls);
        if (parsed.textContent) pendingText = parsed.textContent;
      } else {
        pendingText = tagBuffer;
      }
      tagBuffer = "";
      inTag = false;
    }

    return { pendingText, completedCalls };
  }

  return { feed, flush };
}

// ========== OpenAI 格式构建辅助 ==========

/**
 * 构建 OpenAI 格式的流式 tool_calls chunk
 */
export function makeToolCallChunk(
  id: string,
  created: number,
  model: string,
  toolCalls: ToolCall[],
  finishReason: string | null = null,
) {
  return {
    id,
    object: "chat.completion.chunk",
    created,
    model,
    choices: [
      {
        index: 0,
        delta: {
          tool_calls: toolCalls.map((tc, idx) => ({
            index: idx,
            id: tc.id,
            type: "function" as const,
            function: {
              name: tc.function.name,
              arguments: tc.function.arguments,
            },
          })),
        },
        finish_reason: finishReason,
      },
    ],
  };
}

/**
 * 构建 OpenAI 格式的非流式 tool_calls 响应
 */
export function makeToolCallResponse(
  model: string,
  toolCalls: ToolCall[],
  textContent: string | null,
) {
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
          content: textContent || null,
          tool_calls: toolCalls.map((tc) => ({
            id: tc.id,
            type: "function" as const,
            function: {
              name: tc.function.name,
              arguments: tc.function.arguments,
            },
          })),
        },
        finish_reason: "tool_calls",
      },
    ],
    usage: { prompt_tokens: 0, completion_tokens: 0, total_tokens: 0 },
  };
}
