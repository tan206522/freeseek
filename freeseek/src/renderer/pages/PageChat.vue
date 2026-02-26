<script setup lang="ts">
import { ref, nextTick, computed } from "vue";
import { useAppStore, renderMd, escapeHtml } from "../stores/app";
const store = useAppStore();

interface ChatMsg {
  role: "user" | "assistant";
  content: string;
  reasoning?: string;
  elapsed?: number;
  done?: boolean;
  thinkCollapsed?: boolean;
  timestamp?: number;
}

const model = ref("deepseek-chat");
const stream = ref(true);
const stripReasoning = ref(false);
const systemPrompt = ref("");
const input = ref("");
const messages = ref<ChatMsg[]>([]);
const sending = ref(false);
const chatBox = ref<HTMLElement | null>(null);
const inputRef = ref<HTMLTextAreaElement | null>(null);
const showSystemPrompt = ref(false);

const isReasonerModel = computed(() => model.value.includes("reasoner"));
const isClaudeModel = computed(() => model.value.startsWith("claude-"));
const providerName = computed(() => isClaudeModel.value ? "Claude" : "DeepSeek");
const hasMessages = computed(() => messages.value.length > 0);

function scrollBottom() {
  nextTick(() => { if (chatBox.value) chatBox.value.scrollTop = chatBox.value.scrollHeight; });
}
function clearChat() { messages.value = []; store.showToast("对话已清空", "info"); }
function toggleThink(msg: ChatMsg) { msg.thinkCollapsed = !msg.thinkCollapsed; }
function formatTime(ts?: number) {
  if (!ts) return "";
  return new Date(ts).toLocaleTimeString("zh-CN", { hour12: false, hour: "2-digit", minute: "2-digit" });
}
function copyContent(text: string) {
  navigator.clipboard.writeText(text);
  store.showToast("已复制到剪贴板", "ok");
}

async function sendMsg() {
  if (sending.value) return;
  const text = input.value.trim();
  if (!text) return;
  input.value = "";
  if (inputRef.value) inputRef.value.style.height = "44px";

  messages.value.push({ role: "user", content: text, timestamp: Date.now() });
  scrollBottom();

  const apiMsgs: { role: string; content: string }[] = [];
  if (systemPrompt.value.trim()) apiMsgs.push({ role: "system", content: systemPrompt.value.trim() });
  for (const m of messages.value) {
    apiMsgs.push({ role: m.role, content: m.content });
  }

  const assistantMsg: ChatMsg = { role: "assistant", content: "", reasoning: "", done: false, thinkCollapsed: false, timestamp: Date.now() };
  messages.value.push(assistantMsg);
  scrollBottom();
  sending.value = true;
  const t0 = Date.now();

  try {
    const reqBody: any = { model: model.value, messages: apiMsgs, stream: stream.value };
    if (stripReasoning.value) reqBody.strip_reasoning = true;
    const res = await fetch(`http://127.0.0.1:${store.serverPort}/v1/chat/completions`, {
      method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(reqBody),
    });
    if (!res.ok) throw new Error("HTTP " + res.status);

    if (stream.value && res.body) {
      const reader = res.body.getReader();
      const dec = new TextDecoder();
      let buf = "";
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buf += dec.decode(value, { stream: true });
        const lines = buf.split("\n");
        buf = lines.pop() || "";
        for (const l of lines) {
          const tr = l.trim();
          if (!tr.startsWith("data: ") || tr === "data: [DONE]") continue;
          try {
            const d = JSON.parse(tr.slice(6));
            const dt = d.choices?.[0]?.delta;
            if (dt?.content) assistantMsg.content += dt.content;
            if (dt?.reasoning_content) assistantMsg.reasoning = (assistantMsg.reasoning || "") + dt.reasoning_content;
          } catch {}
        }
        assistantMsg.elapsed = +(((Date.now() - t0) / 1000).toFixed(1));
        scrollBottom();
      }
    } else {
      const d = await res.json();
      assistantMsg.content = d.choices?.[0]?.message?.content || "(空)";
      assistantMsg.reasoning = d.choices?.[0]?.message?.reasoning_content || "";
    }
    assistantMsg.done = true;
    assistantMsg.elapsed = +(((Date.now() - t0) / 1000).toFixed(1));
    if (assistantMsg.reasoning && assistantMsg.content) assistantMsg.thinkCollapsed = true;
  } catch (err: any) {
    assistantMsg.content = "请求失败: " + err.message;
    assistantMsg.done = true;
  }
  sending.value = false;
  scrollBottom();
}

function onInputKeydown(e: KeyboardEvent) {
  if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); sendMsg(); }
}
function autoResize(e: Event) {
  const el = e.target as HTMLTextAreaElement;
  el.style.height = "44px";
  el.style.height = Math.min(el.scrollHeight, 160) + "px";
}
</script>

<template>
  <div class="chat-page">
    <!-- Toolbar -->
    <div class="chat-toolbar">
      <div class="toolbar-left">
        <span class="toolbar-title">智能对话</span>
        <span class="ant-tag ant-tag-processing">{{ model }}</span>
      </div>
      <div class="toolbar-right">
        <div class="toolbar-item">
          <span class="toolbar-label">模型</span>
          <select class="ant-select" v-model="model" style="width:180px">
            <optgroup label="DeepSeek">
              <option value="deepseek-chat">DeepSeek Chat</option>
              <option value="deepseek-reasoner">DeepSeek Reasoner</option>
              <option value="deepseek-chat-search">Chat + 搜索</option>
              <option value="deepseek-reasoner-search">Reasoner + 搜索</option>
            </optgroup>
            <optgroup label="Claude">
              <option value="claude-sonnet-4-6">Claude Sonnet 4</option>
              <option value="claude-opus-4-6">Claude Opus 4</option>
              <option value="claude-haiku-4-6">Claude Haiku 4</option>
              <option value="claude-3-5-sonnet">Claude 3.5 Sonnet</option>
            </optgroup>
          </select>
        </div>
        <div class="toolbar-item">
          <span class="toolbar-label">流式</span>
          <div class="ant-switch" :class="{ on: stream }" @click="stream = !stream" role="switch" :aria-checked="stream">
            <div class="ant-switch-handle" />
          </div>
        </div>
        <div class="toolbar-item" v-if="isReasonerModel">
          <span class="toolbar-label">剥离思考</span>
          <div class="ant-switch" :class="{ on: stripReasoning }" @click="stripReasoning = !stripReasoning" role="switch" :aria-checked="stripReasoning">
            <div class="ant-switch-handle" />
          </div>
        </div>
        <button class="ant-btn ant-btn-sm" @click="showSystemPrompt = !showSystemPrompt">系统提示</button>
        <button class="ant-btn ant-btn-sm ant-btn-danger" v-if="hasMessages" @click="clearChat">清空</button>
      </div>
    </div>

    <!-- System Prompt -->
    <div class="system-prompt-bar" v-if="showSystemPrompt">
      <input class="ant-input" v-model="systemPrompt" placeholder="设定 AI 的角色和行为，例如：你是一个专业的技术顾问..." />
    </div>

    <!-- Messages -->
    <div class="chat-messages" ref="chatBox">
      <!-- Empty State -->
      <div class="empty-state" v-if="!hasMessages">
        <div class="empty-icon">💬</div>
        <div class="empty-title">开始新对话</div>
        <div class="empty-desc">选择模型，输入消息开始与 DeepSeek / Claude 对话</div>
        <div class="empty-hints">
          <div class="hint-chip" @click="input = '用简单的语言解释量子计算'">💡 用简单的语言解释量子计算</div>
          <div class="hint-chip" @click="input = '帮我写一个 Python 快速排序'">🧑‍💻 帮我写一个 Python 快速排序</div>
          <div class="hint-chip" @click="input = '分析当前 AI 行业的发展趋势'">📊 分析当前 AI 行业的发展趋势</div>
        </div>
      </div>

      <!-- Messages -->
      <template v-for="(msg, i) in messages" :key="i">
        <!-- User -->
        <div class="msg-row msg-user" v-if="msg.role === 'user'">
          <div class="msg-content">
            <div class="msg-meta-right">
              <span class="msg-time">{{ formatTime(msg.timestamp) }}</span>
            </div>
            <div class="msg-bubble bubble-user">{{ msg.content }}</div>
          </div>
          <div class="msg-avatar avatar-user">你</div>
        </div>

        <!-- Assistant -->
        <div class="msg-row msg-assistant" v-else>
          <div class="msg-avatar avatar-ai">{{ isClaudeModel ? 'CL' : 'DS' }}</div>
          <div class="msg-content">
            <div class="msg-meta-left">
              <span class="msg-sender">{{ providerName }}</span>
              <span class="msg-time">{{ formatTime(msg.timestamp) }}</span>
              <span class="msg-elapsed" v-if="msg.elapsed">{{ msg.elapsed }}s{{ msg.done ? '' : '...' }}</span>
            </div>

            <!-- Thinking -->
            <div class="thinking-card" v-if="msg.reasoning">
              <div class="thinking-header" @click="toggleThink(msg)">
                <span class="thinking-label">
                  💡 思考过程
                  <span class="thinking-badge" v-if="msg.thinkCollapsed && msg.done">{{ Math.ceil((msg.reasoning?.length || 0) / 2) }} 字</span>
                  <span class="thinking-live" v-if="!msg.done">思考中...</span>
                </span>
                <span class="thinking-arrow">{{ msg.thinkCollapsed ? '▶' : '▼' }}</span>
              </div>
              <div class="thinking-body" v-show="!msg.thinkCollapsed">{{ msg.reasoning }}</div>
            </div>

            <!-- Content -->
            <div class="msg-bubble bubble-ai">
              <template v-if="msg.content">
                <div class="md-content" v-html="msg.done ? renderMd(msg.content) : escapeHtml(msg.content)"></div>
                <div class="bubble-footer" v-if="msg.done">
                  <button class="ant-btn ant-btn-sm ant-btn-link" @click="copyContent(msg.content)">复制</button>
                </div>
              </template>
              <template v-else-if="msg.reasoning && !msg.done">
                <span style="color:#722ed1">正在思考中，请稍候...</span>
              </template>
              <template v-else>
                <span class="typing-dots"><span /><span /><span /></span>
                <span style="color:var(--text-tertiary);margin-left:8px">生成中</span>
              </template>
            </div>
          </div>
        </div>
      </template>
    </div>

    <!-- Input -->
    <div class="chat-input-area">
      <div class="input-box">
        <textarea
          ref="inputRef"
          v-model="input"
          placeholder="输入消息，Enter 发送，Shift+Enter 换行..."
          @keydown="onInputKeydown"
          @input="autoResize"
          :disabled="sending"
          rows="1"
        />
        <button class="send-btn" :disabled="sending || !input.trim()" @click="sendMsg">
          <template v-if="!sending">发送</template>
          <template v-else>
            <span class="btn-spinner" />
          </template>
        </button>
      </div>
      <div class="input-hint">
        <span>{{ model }}{{ stream ? ' · 流式' : '' }}{{ isReasonerModel ? ' · 深度思考' : '' }}{{ isClaudeModel ? ' · Claude' : '' }}</span>
        <span v-if="sending" style="color:var(--primary)">● 正在响应...</span>
      </div>
    </div>
  </div>
</template>

<style scoped>
.chat-page {
  display: flex;
  flex-direction: column;
  height: calc(100vh - 48px);
  margin: -24px;
  background: var(--bg-base);
}

/* Toolbar */
.chat-toolbar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 10px 20px;
  border-bottom: 1px solid var(--border-secondary);
  background: var(--bg-container);
  flex-shrink: 0;
  gap: 12px;
  flex-wrap: wrap;
}
.toolbar-left { display: flex; align-items: center; gap: 10px; }
.toolbar-title { font-size: 15px; font-weight: 600; color: var(--text); }
.toolbar-right { display: flex; align-items: center; gap: 12px; flex-wrap: wrap; }
.toolbar-item { display: flex; align-items: center; gap: 6px; }
.toolbar-label { font-size: var(--font-size-sm); color: var(--text-tertiary); white-space: nowrap; }

/* Ant Switch */
.ant-switch {
  width: 36px; height: 20px; border-radius: 10px;
  background: rgba(0,0,0,0.25); cursor: pointer; position: relative; transition: all 0.2s;
}
.ant-switch.on { background: var(--primary); }
.ant-switch-handle {
  width: 14px; height: 14px; border-radius: 50%; background: #fff;
  position: absolute; top: 3px; left: 3px; transition: transform 0.2s;
  box-shadow: 0 1px 2px rgba(0,0,0,0.2);
}
.ant-switch.on .ant-switch-handle { transform: translateX(16px); }

/* System Prompt */
.system-prompt-bar {
  padding: 10px 20px;
  border-bottom: 1px solid var(--border-secondary);
  background: var(--bg-spotlight);
  flex-shrink: 0;
}

/* Messages */
.chat-messages {
  flex: 1;
  overflow-y: auto;
  padding: 20px;
}

/* Empty State */
.empty-state {
  display: flex; flex-direction: column; align-items: center; justify-content: center;
  height: 100%; gap: 8px; user-select: none;
}
.empty-icon { font-size: 48px; opacity: 0.3; }
.empty-title { font-size: 18px; font-weight: 600; color: var(--text-secondary); }
.empty-desc { font-size: var(--font-size); color: var(--text-quaternary); }
.empty-hints { display: flex; gap: 8px; margin-top: 20px; flex-wrap: wrap; justify-content: center; }
.hint-chip {
  padding: 8px 16px; border: 1px solid var(--border-color); border-radius: 20px;
  font-size: var(--font-size-sm); color: var(--text-secondary); cursor: pointer; transition: all 0.15s;
}
.hint-chip:hover { border-color: var(--primary); color: var(--primary); background: var(--primary-bg); }

/* Message Row */
.msg-row { display: flex; gap: 12px; margin-bottom: 20px; max-width: 800px; }
.msg-user { margin-left: auto; justify-content: flex-end; }
.msg-assistant { margin-right: auto; }
.msg-content { display: flex; flex-direction: column; gap: 4px; min-width: 0; max-width: 680px; }
.msg-user .msg-content { align-items: flex-end; }

/* Avatar */
.msg-avatar {
  width: 32px; height: 32px; border-radius: var(--radius);
  display: flex; align-items: center; justify-content: center;
  flex-shrink: 0; font-size: 12px; font-weight: 600;
}
.avatar-user { background: var(--primary-bg); color: var(--primary); border: 1px solid var(--primary-border); }
.avatar-ai { background: var(--primary); color: #fff; }

/* Meta */
.msg-meta-left, .msg-meta-right { display: flex; align-items: center; gap: 8px; padding: 0 2px; }
.msg-sender { font-size: var(--font-size-sm); font-weight: 600; color: var(--text); }
.msg-time { font-size: 11px; color: var(--text-quaternary); }
.msg-elapsed { font-size: 11px; color: var(--text-quaternary); }

/* Bubbles */
.msg-bubble { border-radius: var(--radius-lg); padding: 12px 16px; font-size: var(--font-size); line-height: 1.7; word-break: break-word; }
.bubble-user {
  background: var(--primary); color: #fff;
  border-bottom-right-radius: var(--radius-xs);
  white-space: pre-wrap;
}
.bubble-ai {
  background: var(--bg-spotlight); color: var(--text);
  border: 1px solid var(--border-secondary);
  border-bottom-left-radius: var(--radius-xs);
}
.bubble-footer { margin-top: 8px; padding-top: 8px; border-top: 1px solid var(--border-secondary); }

/* Thinking Card */
.thinking-card {
  border: 1px solid #d3adf7;
  border-radius: var(--radius-lg);
  overflow: hidden;
  background: #f9f0ff;
  margin-bottom: 4px;
}
.thinking-header {
  display: flex; align-items: center; justify-content: space-between;
  padding: 8px 14px; cursor: pointer; transition: background 0.15s;
}
.thinking-header:hover { background: #efdbff; }
.thinking-label { font-size: var(--font-size-sm); font-weight: 500; color: #722ed1; display: flex; align-items: center; gap: 6px; }
.thinking-badge {
  font-size: 11px; background: #efdbff; color: #531dab;
  padding: 0 6px; border-radius: var(--radius-xs); font-weight: 400;
}
.thinking-live { font-size: 11px; color: #9254de; animation: antPulse 1.5s infinite; }
.thinking-arrow { font-size: 10px; color: #9254de; }
.thinking-body {
  padding: 10px 14px; border-top: 1px solid #d3adf7;
  font-size: var(--font-size-sm); color: #531dab; line-height: 1.7;
  white-space: pre-wrap; max-height: 300px; overflow-y: auto;
}

/* Typing dots */
.typing-dots { display: inline-flex; gap: 4px; vertical-align: middle; }
.typing-dots span {
  width: 6px; height: 6px; border-radius: 50%; background: var(--primary);
  animation: dotBounce 1.4s infinite;
}
.typing-dots span:nth-child(2) { animation-delay: 0.2s; }
.typing-dots span:nth-child(3) { animation-delay: 0.4s; }
@keyframes dotBounce { 0%,80%,100%{opacity:.3;transform:scale(.8)} 40%{opacity:1;transform:scale(1)} }

/* Markdown */
.md-content :deep(h1),.md-content :deep(h2),.md-content :deep(h3),.md-content :deep(h4) { margin:14px 0 8px; color:var(--text); font-weight:600; line-height:1.4; }
.md-content :deep(h1) { font-size:20px; border-bottom:1px solid var(--border-secondary); padding-bottom:8px; }
.md-content :deep(h2) { font-size:17px; border-bottom:1px solid var(--border-secondary); padding-bottom:6px; }
.md-content :deep(h3) { font-size:15px; }
.md-content :deep(p) { margin:6px 0; line-height:1.7; }
.md-content :deep(ul),.md-content :deep(ol) { margin:6px 0; padding-left:20px; }
.md-content :deep(li) { margin:3px 0; line-height:1.6; }
.md-content :deep(code) { background:var(--fill-tertiary); padding:1px 5px; border-radius:var(--radius-xs); font-size:var(--font-size-sm); font-family:var(--font-mono); color:#c41d7f; }
.md-content :deep(pre) { background:var(--bg-spotlight); border:1px solid var(--border-secondary); border-radius:var(--radius); padding:14px 16px; margin:10px 0; overflow-x:auto; line-height:1.5; }
.md-content :deep(pre code) { background:none; padding:0; color:var(--text-secondary); font-size:12px; }
.md-content :deep(blockquote) { border-left:3px solid var(--primary); padding:6px 14px; margin:8px 0; color:var(--text-secondary); background:var(--primary-bg); border-radius:0 var(--radius) var(--radius) 0; }
.md-content :deep(strong) { color:var(--text); font-weight:600; }
.md-content :deep(hr) { border:none; border-top:1px solid var(--border-secondary); margin:14px 0; }
.md-content :deep(a) { color:var(--primary); text-decoration:none; }
.md-content :deep(a:hover) { text-decoration:underline; }

/* Input Area */
.chat-input-area {
  padding: 16px 20px 12px;
  border-top: 1px solid var(--border-secondary);
  background: var(--bg-container);
  flex-shrink: 0;
}
.input-box {
  display: flex; align-items: flex-end; gap: 10px;
  background: var(--bg-base); border: 1px solid var(--border-color);
  border-radius: var(--radius-lg); padding: 6px 6px 6px 14px;
  transition: border-color 0.2s, box-shadow 0.2s;
}
.input-box:focus-within { border-color: var(--primary); box-shadow: 0 0 0 2px rgba(5,145,255,0.06); }
.input-box textarea {
  flex: 1; border: none; background: transparent; color: var(--text);
  font-size: var(--font-size); font-family: inherit; line-height: 1.6;
  resize: none; padding: 8px 0; min-height: 44px; max-height: 160px; outline: none;
}
.input-box textarea::placeholder { color: var(--text-quaternary); }
.input-box textarea:disabled { opacity: 0.5; }
.send-btn {
  height: 36px; padding: 0 20px; border-radius: var(--radius);
  border: none; background: var(--primary); color: #fff;
  cursor: pointer; font-size: var(--font-size); font-family: inherit;
  font-weight: 500; transition: all 0.2s; flex-shrink: 0;
  display: flex; align-items: center; justify-content: center;
}
.send-btn:hover:not(:disabled) { background: var(--primary-hover); }
.send-btn:disabled { opacity: 0.4; cursor: not-allowed; }
.btn-spinner {
  width: 16px; height: 16px; border: 2px solid rgba(255,255,255,0.3);
  border-top-color: #fff; border-radius: 50%; animation: antSpin 0.6s linear infinite;
}
.input-hint {
  display: flex; align-items: center; justify-content: space-between;
  padding: 6px 4px 0; font-size: 12px; color: var(--text-quaternary);
}
</style>
