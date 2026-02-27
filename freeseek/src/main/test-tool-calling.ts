/**
 * Tool Calling 功能测试脚本
 *
 * 运行方式：
 *   cd freeseek
 *   npx tsx src/main/test-tool-calling.ts
 */

import {
  buildToolSystemPrompt,
  parseToolCalls,
  createStreamToolCallParser,
  serializeToolResultMessage,
  serializeAssistantToolCalls,
  makeToolCallResponse,
} from "./tool-call-parser";
import type { ToolDefinition, ChatMessage } from "./providers/types";

let passed = 0;
let failed = 0;

function assert(condition: boolean, name: string) {
  if (condition) {
    console.log(`  ✅ ${name}`);
    passed++;
  } else {
    console.log(`  ❌ ${name}`);
    failed++;
  }
}

// ========== 测试 1：工具定义注入 ==========
console.log("\n=== 测试 1：buildToolSystemPrompt ===");

const tools: ToolDefinition[] = [
  {
    type: "function",
    function: {
      name: "read",
      description: "Read file contents",
      parameters: {
        type: "object",
        properties: { file_path: { type: "string", description: "Path to file" } },
        required: ["file_path"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "exec",
      description: "Run shell commands",
      parameters: {
        type: "object",
        properties: { command: { type: "string" } },
        required: ["command"],
      },
    },
  },
];

const prompt = buildToolSystemPrompt(tools);
assert(prompt.includes("read"), "包含工具名 read");
assert(prompt.includes("exec"), "包含工具名 exec");
assert(prompt.includes("Read file contents"), "包含工具描述");
assert(prompt.includes("<tool_call"), "包含 XML 格式示例");
assert(prompt.includes("tool_name"), "包含调用格式说明");
console.log("\n  生成的 prompt 长度:", prompt.length, "字符");
console.log("  --- prompt 预览 ---");
console.log(prompt.slice(0, 500));
console.log("  --- end ---");

// ========== 测试 2：完整文本解析 ==========
console.log("\n=== 测试 2：parseToolCalls（完整文本） ===");

// 测试单个 tool_call
const text1 = 'Let me read the file.\n<tool_call name="read">{"file_path": "/tmp/test.txt"}</tool_call>';
const result1 = parseToolCalls(text1);
assert(result1.toolCalls.length === 1, "解析出 1 个 tool_call");
assert(result1.toolCalls[0].function.name === "read", "工具名正确");
assert(JSON.parse(result1.toolCalls[0].function.arguments).file_path === "/tmp/test.txt", "参数正确");
assert(result1.textContent.includes("Let me read the file"), "保留了普通文本");
assert(!result1.textContent.includes("<tool_call"), "移除了 XML 标签");

// 测试多个 tool_call
const text2 = '<tool_call name="read">{"file_path": "a.txt"}</tool_call>\n<tool_call name="exec">{"command": "ls"}</tool_call>';
const result2 = parseToolCalls(text2);
assert(result2.toolCalls.length === 2, "解析出 2 个 tool_call");
assert(result2.toolCalls[0].function.name === "read", "第一个工具名正确");
assert(result2.toolCalls[1].function.name === "exec", "第二个工具名正确");

// 测试带 id 的 tool_call
const text3 = '<tool_call id="call_abc123" name="read">{"file_path": "b.txt"}</tool_call>';
const result3 = parseToolCalls(text3);
assert(result3.toolCalls.length === 1, "带 id 的解析成功");
assert(result3.toolCalls[0].id === "call_abc123", "id 正确提取");

// 测试无 tool_call 的普通文本
const text4 = "这是一段普通文本，没有任何工具调用。";
const result4 = parseToolCalls(text4);
assert(result4.toolCalls.length === 0, "普通文本无 tool_call");
assert(result4.textContent === text4, "普通文本原样保留");

// 测试非法 JSON 参数
const text5 = '<tool_call name="test">not valid json</tool_call>';
const result5 = parseToolCalls(text5);
assert(result5.toolCalls.length === 1, "非法 JSON 也能解析");
assert(result5.toolCalls[0].function.arguments.includes("raw"), "非法 JSON 被包裹为 raw");

// ========== 测试 3：流式解析 ==========
console.log("\n=== 测试 3：StreamToolCallParser（流式） ===");

const parser = createStreamToolCallParser();

// 模拟分片输入
const chunks = [
  "I'll read the file for you.\n",
  "<tool_cal",           // 部分标签
  'l name="read">',     // 标签继续
  '{"file_path":',      // 参数开始
  ' "/tmp/test.txt"}',  // 参数继续
  "</tool_call>",       // 标签结束
  "\nDone.",
];

let allText = "";
let allCalls: any[] = [];
let bufferingCount = 0;

for (const chunk of chunks) {
  const result = parser.feed(chunk);
  if (result.pendingText) allText += result.pendingText;
  if (result.completedCalls.length > 0) allCalls.push(...result.completedCalls);
  if (result.isBuffering) bufferingCount++;
}

const flushed = parser.flush();
if (flushed.pendingText) allText += flushed.pendingText;
if (flushed.completedCalls.length > 0) allCalls.push(...flushed.completedCalls);

assert(allCalls.length === 1, "流式解析出 1 个 tool_call");
assert(allCalls[0]?.function.name === "read", "流式解析工具名正确");
assert(allText.includes("I'll read the file"), "流式保留前置文本");
assert(bufferingCount > 0, "有缓冲行为（证明分片检测 work）");
console.log(`  缓冲发生 ${bufferingCount} 次`);

// ========== 测试 4：普通 HTML 标签不误判 ==========
console.log("\n=== 测试 4：避免误判 ===");

const parser2 = createStreamToolCallParser();
const htmlResult = parser2.feed("This has <div>html</div> and <b>bold</b> text.");
const htmlFlushed = parser2.flush();
const htmlText = htmlResult.pendingText + (htmlFlushed.pendingText || "");
assert(htmlResult.completedCalls.length === 0, "HTML 标签不误判为 tool_call");
assert(htmlText.includes("<div>"), "HTML 标签保留在文本中");

// ========== 测试 5：消息序列化 ==========
console.log("\n=== 测试 5：消息序列化 ===");

const toolResultMsg: ChatMessage = {
  role: "tool",
  content: '{"content": "file contents here"}',
  tool_call_id: "call_abc",
  name: "read",
};
const serialized = serializeToolResultMessage(toolResultMsg);
assert(serialized.includes("[Tool Result]"), "包含 Tool Result 标记");
assert(serialized.includes("tool=read"), "包含工具名");
assert(serialized.includes("call_id=call_abc"), "包含调用 ID");
assert(serialized.includes("file contents here"), "包含结果内容");

const assistantMsg: ChatMessage = {
  role: "assistant",
  content: "Let me check that file.",
  tool_calls: [
    {
      id: "call_abc",
      type: "function",
      function: { name: "read", arguments: '{"file_path": "/tmp/test.txt"}' },
    },
  ],
};
const assistantSerialized = serializeAssistantToolCalls(assistantMsg);
assert(assistantSerialized.includes("Let me check that file"), "包含文本内容");
assert(assistantSerialized.includes('<tool_call name="read">'), "包含 tool_call 标签");

// ========== 测试 6：OpenAI 格式响应构建 ==========
console.log("\n=== 测试 6：makeToolCallResponse ===");

const response = makeToolCallResponse("deepseek-chat", allCalls, "some text") as any;
assert(response.choices[0].finish_reason === "tool_calls", "finish_reason 为 tool_calls");
assert(response.choices[0].message.tool_calls.length === 1, "包含 1 个 tool_call");
assert(response.choices[0].message.tool_calls[0].type === "function", "type 为 function");
assert(response.choices[0].message.content === "some text", "保留文本内容");
assert(response.object === "chat.completion", "object 类型正确");

// ========== 汇总 ==========
console.log(`\n${"=".repeat(50)}`);
console.log(`结果: ${passed} 通过, ${failed} 失败`);
if (failed > 0) {
  process.exit(1);
} else {
  console.log("🎉 所有测试通过！Tool calling 核心逻辑工作正常。");
}

console.log(`\n--- 下一步测试 ---`);
console.log("如果有凭证，启动 FreeSeek 后可以用 curl 发送带 tools 的请求：");
console.log(`
curl http://localhost:3000/v1/chat/completions \\
  -H "Content-Type: application/json" \\
  -d '{
    "model": "deepseek-chat",
    "messages": [{"role": "user", "content": "请读取 /tmp/test.txt 文件的内容"}],
    "stream": false,
    "tools": [{
      "type": "function",
      "function": {
        "name": "read",
        "description": "Read file contents",
        "parameters": {
          "type": "object",
          "properties": {"file_path": {"type": "string"}},
          "required": ["file_path"]
        }
      }
    }]
  }'
`);
