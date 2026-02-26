<script setup lang="ts">
import { ref } from "vue";
import { useAppStore, escapeHtml } from "../stores/app";
const store = useAppStore();

const method = ref("POST");
const url = ref(`http://127.0.0.1:${store.serverPort}/v1/chat/completions`);
const body = ref(JSON.stringify({ model: "deepseek-chat", messages: [{ role: "user", content: "你好，请简短回复" }], stream: false }, null, 2));
const response = ref("点击「发送」或按 Ctrl+Enter 开始测试");
const meta = ref<{ status?: number; elapsed?: number; method?: string; chunks?: number; total?: number } | null>(null);
const sseChunks = ref<{ type: string; text: string }[]>([]);
const showSse = ref(false);
const sending = ref(false);
const history = ref<{ time: string; method: string; url: string; status: number; elapsed: number }[]>([]);
let abortCtrl: AbortController | null = null;

const PRESETS: Record<string, { method: string; url: string; body: string }> = {
  health: { method: "GET", url: "/health", body: "" },
  models: { method: "GET", url: "/v1/models", body: "" },
  chat: { method: "POST", url: "/v1/chat/completions", body: JSON.stringify({ model: "deepseek-chat", messages: [{ role: "user", content: "你好，请简短回复" }], stream: false }, null, 2) },
  stream: { method: "POST", url: "/v1/chat/completions", body: JSON.stringify({ model: "deepseek-chat", messages: [{ role: "user", content: "你好，请简短回复" }], stream: true }, null, 2) },
  reasoner: { method: "POST", url: "/v1/chat/completions", body: JSON.stringify({ model: "deepseek-reasoner", messages: [{ role: "user", content: "1+1等于几？" }], stream: true }, null, 2) },
  search: { method: "POST", url: "/v1/chat/completions", body: JSON.stringify({ model: "deepseek-chat-search", messages: [{ role: "user", content: "今天有什么新闻？" }], stream: true }, null, 2) },
  strip: { method: "POST", url: "/v1/chat/completions", body: JSON.stringify({ model: "deepseek-reasoner", messages: [{ role: "user", content: "1+1等于几？请详细解释" }], stream: true, strip_reasoning: true }, null, 2) },
  claude: { method: "POST", url: "/v1/chat/completions", body: JSON.stringify({ model: "claude-sonnet-4-6", messages: [{ role: "user", content: "你好，请简短回复" }], stream: true }, null, 2) },
  claudeNonStream: { method: "POST", url: "/v1/chat/completions", body: JSON.stringify({ model: "claude-sonnet-4-6", messages: [{ role: "user", content: "你好，请简短回复" }], stream: false }, null, 2) },
};

const presetLabels: Record<string, string> = {
  health: 'GET /health', models: 'GET /v1/models', chat: '聊天 (非流式)',
  stream: '聊天 (流式)', reasoner: 'R1 推理', search: '联网搜索', strip: 'R1 纯净模式',
  claude: 'Claude 流式', claudeNonStream: 'Claude 非流式',
};

function loadPreset(name: string) {
  const p = PRESETS[name];
  if (!p) return;
  method.value = p.method;
  url.value = `http://127.0.0.1:${store.serverPort}${p.url}`;
  body.value = p.body;
  store.showToast("已加载: " + name, "info");
}

function abort() { abortCtrl?.abort(); abortCtrl = null; }

function copyResponse() {
  navigator.clipboard?.writeText(response.value);
  store.showToast("已复制", "ok");
}

async function send() {
  response.value = "请求中...";
  meta.value = null;
  sseChunks.value = [];
  showSse.value = false;
  sending.value = true;
  abortCtrl = new AbortController();
  const t0 = Date.now();
  let isStream = false;
  try { if (body.value) isStream = JSON.parse(body.value).stream === true; } catch {}

  try {
    const opts: RequestInit = { method: method.value, headers: { "Content-Type": "application/json" }, signal: abortCtrl.signal };
    if (method.value === "POST" && body.value) opts.body = body.value;
    const res = await fetch(url.value, opts);
    const el = Date.now() - t0;
    meta.value = { status: res.status, elapsed: el, method: method.value };

    if (isStream && res.body) {
      showSse.value = true;
      response.value = "接收 SSE 流...\n";
      let fc = "", fr = "", cc = 0;
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
          if (!tr || !tr.startsWith("data: ")) continue;
          const ds = tr.slice(6);
          if (ds === "[DONE]") { sseChunks.value.push({ type: "meta", text: "[DONE]" }); continue; }
          try {
            const d = JSON.parse(ds);
            cc++;
            const dt = d.choices?.[0]?.delta;
            if (dt?.reasoning_content) {
              fr += dt.reasoning_content;
              sseChunks.value.push({ type: "reasoning", text: dt.reasoning_content });
            } else if (dt?.content) {
              fc += dt.content;
              sseChunks.value.push({ type: "content", text: dt.content });
            } else {
              sseChunks.value.push({ type: "meta", text: JSON.stringify(dt) });
            }
          } catch {}
        }
      }
      meta.value.chunks = cc;
      meta.value.total = Date.now() - t0;
      response.value = (fr ? "💭 思考过程:\n" + fr + "\n\n---\n\n" : "") + "📝 回复:\n" + fc;
    } else {
      const txt = await res.text();
      try {
        const j = JSON.parse(txt);
        const rc = j.choices?.[0]?.message?.reasoning_content;
        response.value = (rc ? "💭 思考过程:\n" + rc + "\n\n---\n\n" : "") + JSON.stringify(j, null, 2);
      } catch { response.value = txt; }
    }
    history.value.unshift({ method: method.value, url: url.value, status: res.status, elapsed: Date.now() - t0, time: new Date().toLocaleTimeString("zh-CN", { hour12: false }) });
    if (history.value.length > 20) history.value.pop();
  } catch (err: any) {
    if (err.name === "AbortError") {
      response.value = "已中止";
      meta.value = { method: method.value };
    } else {
      response.value = "错误: " + err.message;
      meta.value = { method: method.value };
    }
  }
  sending.value = false;
  abortCtrl = null;
}

function onKeydown(e: KeyboardEvent) {
  if (e.ctrlKey && e.key === "Enter") { e.preventDefault(); send(); }
  if (e.key === "Escape") abort();
}
</script>

<template>
  <div @keydown="onKeydown">
    <div class="ant-card">
      <div class="ant-card-head"><div class="ant-card-title">API 调试器</div></div>
      <div class="ant-card-body">
        <!-- Presets -->
        <div class="preset-bar">
          <button class="ant-btn ant-btn-sm" v-for="(_, name) in PRESETS" :key="name" @click="loadPreset(name as string)">{{ presetLabels[name as string] }}</button>
        </div>

        <!-- URL Bar -->
        <div class="url-bar">
          <select class="ant-select" v-model="method" style="width:90px;flex-shrink:0">
            <option value="GET">GET</option><option value="POST">POST</option>
          </select>
          <input class="ant-input" v-model="url" />
          <button v-if="!sending" class="ant-btn ant-btn-primary" @click="send">发送</button>
          <button v-else class="ant-btn ant-btn-danger" @click="abort">中止</button>
        </div>

        <!-- Panels -->
        <div class="debug-panels">
          <div class="debug-panel">
            <div class="panel-header">请求体</div>
            <div class="panel-body">
              <textarea class="ant-textarea" v-model="body" spellcheck="false" style="height:100%;min-height:300px;border:none;border-radius:0;resize:none;font-family:var(--font-mono);font-size:12px" />
            </div>
          </div>
          <div class="debug-panel">
            <div class="panel-header">
              <span>响应</span>
              <button class="ant-btn ant-btn-sm ant-btn-link" @click="copyResponse">复制</button>
            </div>
            <div v-if="meta" class="response-meta">
              <span v-if="meta.status" :class="['ant-tag', meta.status < 400 ? 'ant-tag-success' : 'ant-tag-error']">{{ meta.status }}</span>
              <span v-if="meta.elapsed" class="ant-tag ant-tag-processing">{{ meta.elapsed }}ms</span>
              <span v-if="meta.method" class="ant-tag ant-tag-warning">{{ meta.method }}</span>
              <span v-if="meta.total" class="ant-tag ant-tag-processing">总计 {{ meta.total }}ms</span>
              <span v-if="meta.chunks" class="ant-tag">{{ meta.chunks }} chunks</span>
            </div>
            <div class="panel-body">
              <div style="font-family:var(--font-mono);font-size:12px;line-height:1.6;white-space:pre-wrap;color:var(--text-secondary)">{{ response }}</div>
            </div>
          </div>
        </div>
      </div>
    </div>

    <div v-if="showSse" class="ant-card">
      <div class="ant-card-head">
        <div class="ant-card-title">SSE 流数据</div>
        <span class="ant-tag">{{ sseChunks.length }} chunks</span>
      </div>
      <div class="ant-card-body" style="padding:0">
        <div class="sse-stream">
          <div v-for="(c, i) in sseChunks" :key="i" class="sse-chunk">
            <span :class="'sse-' + c.type" v-html="escapeHtml(c.text)"></span>
          </div>
        </div>
      </div>
    </div>

    <div class="ant-card">
      <div class="ant-card-head">
        <div class="ant-card-title">请求历史</div>
        <button class="ant-btn ant-btn-sm ant-btn-link" @click="history = []">清空</button>
      </div>
      <div class="ant-card-body" style="padding:0">
        <div v-if="!history.length" style="padding:24px;text-align:center;color:var(--text-quaternary)">暂无记录</div>
        <table v-else class="ant-table">
          <tr><th>时间</th><th>方法</th><th>URL</th><th>状态</th><th>耗时</th></tr>
          <tr v-for="h in history" :key="h.time + h.url">
            <td style="color:var(--text-tertiary)">{{ h.time }}</td>
            <td>{{ h.method }}</td>
            <td style="color:var(--text-secondary);max-width:260px;overflow:hidden;text-overflow:ellipsis">{{ h.url }}</td>
            <td><span :class="['ant-tag', h.status < 400 ? 'ant-tag-success' : 'ant-tag-error']">{{ h.status }}</span></td>
            <td>{{ h.elapsed }}ms</td>
          </tr>
        </table>
      </div>
    </div>
  </div>
</template>

<style scoped>
.preset-bar { display: flex; gap: 6px; flex-wrap: wrap; margin-bottom: 16px; }
.url-bar { display: flex; gap: 8px; align-items: center; margin-bottom: 16px; }
.debug-panels { display: grid; grid-template-columns: 1fr 1fr; gap: 16px; }
.debug-panel {
  background: var(--bg-spotlight);
  border: 1px solid var(--border-secondary);
  border-radius: var(--radius);
  display: flex;
  flex-direction: column;
  min-height: 380px;
}
.panel-header {
  padding: 10px 16px;
  border-bottom: 1px solid var(--border-secondary);
  font-size: var(--font-size-sm);
  color: var(--text-tertiary);
  font-weight: 600;
  display: flex;
  align-items: center;
  justify-content: space-between;
}
.panel-body { flex: 1; padding: 12px; overflow: auto; }
.response-meta { display: flex; gap: 6px; padding: 8px 16px; flex-wrap: wrap; }
.sse-stream {
  padding: 12px 16px;
  font-family: var(--font-mono);
  font-size: 11px;
  max-height: 220px;
  overflow-y: auto;
  line-height: 1.6;
}
.sse-chunk { margin-bottom: 1px; }
.sse-content { color: var(--success); }
.sse-reasoning { color: #722ed1; }
.sse-meta { color: var(--text-quaternary); }
</style>
