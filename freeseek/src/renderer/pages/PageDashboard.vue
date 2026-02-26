<script setup lang="ts">
import { ref } from "vue";
import { useAppStore, formatUptime, formatTokens } from "../stores/app";
const store = useAppStore();

const curlTab = ref<"linux" | "win">("linux");

const connResult = ref<{ status: string; text: string } | null>(null);

async function testConnectivity() {
  connResult.value = { status: "loading", text: "测试中..." };
  const port = store.serverPort;
  const results: string[] = [];
  const t0 = Date.now();
  try {
    const s = Date.now();
    const r = await fetch(`http://127.0.0.1:${port}/health`);
    const d = await r.json();
    results.push(`✅ /health → ${r.status} (${Date.now() - s}ms) ${d.status === "ok" ? "凭证有效" : "⚠ " + d.status}`);
  } catch (e: any) { results.push("❌ /health → " + e.message); }
  try {
    const s = Date.now();
    const r = await fetch(`http://127.0.0.1:${port}/v1/models`);
    const d = await r.json();
    results.push(`✅ /v1/models → ${r.status} (${Date.now() - s}ms) ${d.data?.length || 0}个模型`);
  } catch (e: any) { results.push("❌ /v1/models → " + e.message); }
  try {
    const s = Date.now();
    const r = await fetch(`http://127.0.0.1:${port}/v1/chat/completions`, {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ model: "deepseek-chat", messages: [{ role: "user", content: "Hi" }], stream: false }),
    });
    if (r.ok) {
      const d = await r.json();
      const c = d.choices?.[0]?.message?.content || "";
      results.push(`✅ /v1/chat/completions → ${r.status} (${Date.now() - s}ms) "${c.slice(0, 40)}${c.length > 40 ? "..." : ""}"`);
    } else { results.push(`⚠ /v1/chat/completions → ${r.status}`); }
  } catch (e: any) { results.push("❌ /v1/chat/completions → " + e.message); }
  const hasErr = results.some((r) => r.startsWith("❌"));
  connResult.value = { status: hasErr ? "err" : "ok", text: results.join("\n") + `\n\n总耗时: ${Date.now() - t0}ms` };
}

function copyCode(el: Event) {
  const btn = el.target as HTMLElement;
  const block = btn.closest(".ant-code-block");
  if (block) {
    navigator.clipboard?.writeText(block.textContent?.replace("复制", "").trim() || "");
    btn.textContent = "✓";
    setTimeout(() => (btn.textContent = "复制"), 1200);
  }
}
</script>

<template>
  <div>
    <!-- Stats -->
    <div class="ant-statistic-grid">
      <div class="ant-statistic">
        <div class="ant-statistic-title">服务状态</div>
        <div :class="['ant-statistic-value', store.serverRunning ? 'success' : 'error']">{{ store.serverRunning ? '运行中' : '已停止' }}</div>
      </div>
      <div class="ant-statistic">
        <div class="ant-statistic-title">监听端口</div>
        <div class="ant-statistic-value primary">{{ store.serverPort }}</div>
      </div>
      <div class="ant-statistic">
        <div class="ant-statistic-title">运行时长</div>
        <div class="ant-statistic-value">{{ store.serverRunning ? formatUptime(store.uptime) : '—' }}</div>
      </div>
      <div class="ant-statistic">
        <div class="ant-statistic-title">请求数</div>
        <div class="ant-statistic-value">{{ store.requestCount }}</div>
      </div>
      <div class="ant-statistic">
        <div class="ant-statistic-title">Token 用量</div>
        <div class="ant-statistic-value">{{ formatTokens(store.totalTokens) }}</div>
      </div>
    </div>

    <!-- Actions -->
    <div class="btn-group" style="margin-top:0;margin-bottom:16px">
      <button :class="['ant-btn', store.serverRunning ? 'ant-btn-danger' : 'ant-btn-primary']" @click="store.toggleServer()">
        {{ store.serverRunning ? '停止服务' : '启动服务' }}
      </button>
      <button class="ant-btn" @click="testConnectivity">测试连通性</button>
    </div>

    <div v-if="connResult" :class="['conn-result', connResult.status]">{{ connResult.text }}</div>

    <!-- Credentials -->
    <div class="ant-card">
      <div class="ant-card-head"><div class="ant-card-title">凭证信息</div></div>
      <div class="ant-card-body" style="padding:0">
        <table class="ant-table">
          <tr><th>厂商</th><th>项目</th><th>状态</th><th>详情</th></tr>
          <tr>
            <td rowspan="4">DeepSeek</td>
            <td>Cookie</td>
            <td><span :class="['ant-badge-dot', store.hasCredentials ? 'success' : 'error']" />{{ store.hasCredentials ? '有效' : '未设置' }}</td>
            <td style="color:var(--text-tertiary)">{{ store.hasCredentials ? store.cookieCount + ' 项' + (store.hasSessionId ? ' (含 session)' : '') : '—' }}</td>
          </tr>
          <tr>
            <td>Bearer Token</td>
            <td><span :class="['ant-badge-dot', store.hasCredentials ? 'success' : 'error']" />{{ store.hasCredentials ? '有效' : '未设置' }}</td>
            <td style="color:var(--text-tertiary)">{{ store.hasCredentials ? '长度 ' + store.bearerLength + ' 字符' : '—' }}</td>
          </tr>
          <tr>
            <td>捕获时间</td><td>—</td>
            <td style="color:var(--text-tertiary)">{{ store.capturedAt ? new Date(store.capturedAt).toLocaleString('zh-CN') : '—' }}</td>
          </tr>
          <tr>
            <td>Token 有效期</td>
            <td>
              <span :class="['ant-badge-dot', store.expiryStatus === 'valid' ? 'success' : store.expiryStatus === 'expired' ? 'error' : 'warning']" />
              {{ store.expiryStatus === 'valid' ? '有效' : store.expiryStatus === 'expired' ? '已过期' : store.expiryStatus === 'expiring' ? '即将过期' : '检测中' }}
            </td>
            <td style="color:var(--text-tertiary)">{{ store.expiryDetail || '—' }}</td>
          </tr>
          <tr>
            <td rowspan="2">Claude</td>
            <td>sessionKey</td>
            <td><span :class="['ant-badge-dot', store.hasClaudeCredentials ? 'success' : 'error']" />{{ store.hasClaudeCredentials ? '有效' : '未设置' }}</td>
            <td style="color:var(--text-tertiary)">{{ store.hasClaudeCredentials ? store.claudeSessionKeyPrefix : '—' }}</td>
          </tr>
          <tr>
            <td>捕获时间</td><td>—</td>
            <td style="color:var(--text-tertiary)">{{ store.claudeCapturedAt ? new Date(store.claudeCapturedAt).toLocaleString('zh-CN') : '—' }}</td>
          </tr>
        </table>
      </div>
    </div>

    <!-- Models -->
    <div class="ant-card">
      <div class="ant-card-head"><div class="ant-card-title">可用模型</div></div>
      <div class="ant-card-body" style="padding:0">
        <table class="ant-table">
          <tr><th>模型 ID</th><th>名称</th><th>厂商</th><th>特性</th></tr>
          <tr><td><span class="ant-code">deepseek-chat</span></td><td>DeepSeek Chat (V3)</td><td>DeepSeek</td><td style="color:var(--text-tertiary)">—</td></tr>
          <tr><td><span class="ant-code">deepseek-reasoner</span></td><td>DeepSeek Reasoner (R1)</td><td>DeepSeek</td><td><span class="ant-tag ant-tag-success">深度思考</span></td></tr>
          <tr><td><span class="ant-code">deepseek-chat-search</span></td><td>DeepSeek Chat + 搜索</td><td>DeepSeek</td><td style="color:var(--text-tertiary)">—</td></tr>
          <tr><td><span class="ant-code">deepseek-reasoner-search</span></td><td>DeepSeek Reasoner + 搜索</td><td>DeepSeek</td><td><span class="ant-tag ant-tag-success">深度思考</span></td></tr>
          <tr><td><span class="ant-code">claude-sonnet-4-6</span></td><td>Claude Sonnet 4</td><td>Claude</td><td><span class="ant-tag ant-tag-processing">200K 上下文</span></td></tr>
          <tr><td><span class="ant-code">claude-opus-4-6</span></td><td>Claude Opus 4</td><td>Claude</td><td><span class="ant-tag ant-tag-processing">200K 上下文</span></td></tr>
          <tr><td><span class="ant-code">claude-haiku-4-6</span></td><td>Claude Haiku 4</td><td>Claude</td><td><span class="ant-tag ant-tag-processing">200K 上下文</span></td></tr>
          <tr><td><span class="ant-code">claude-3-5-sonnet</span></td><td>Claude 3.5 Sonnet</td><td>Claude</td><td><span class="ant-tag ant-tag-processing">别名</span></td></tr>
        </table>
      </div>
    </div>

    <!-- Quick Start -->
    <div class="ant-card">
      <div class="ant-card-head"><div class="ant-card-title">快速接入</div></div>
      <div class="ant-card-body">
        <div class="os-tabs">
          <button :class="['os-tab', { active: curlTab === 'linux' }]" @click="curlTab = 'linux'">Linux / macOS</button>
          <button :class="['os-tab', { active: curlTab === 'win' }]" @click="curlTab = 'win'">Windows CMD</button>
        </div>
        <div class="ant-code-block" v-if="curlTab === 'linux'"><button class="copy-btn" @click="copyCode">复制</button>curl -N http://127.0.0.1:{{ store.serverPort }}/v1/chat/completions \
  -H "Content-Type: application/json" \
  -d '{"model":"deepseek-chat","messages":[{"role":"user","content":"你好"}],"stream":true}'</div>
        <div class="ant-code-block" v-else><button class="copy-btn" @click="copyCode">复制</button>curl -N http://127.0.0.1:{{ store.serverPort }}/v1/chat/completions -H "Content-Type: application/json" -d "{\"model\":\"deepseek-chat\",\"messages\":[{\"role\":\"user\",\"content\":\"你好\"}],\"stream\":true}"</div>
      </div>
    </div>
  </div>
</template>

<style scoped>
.conn-result {
  margin-bottom: 16px;
  padding: 12px 16px;
  border-radius: var(--radius);
  font-size: var(--font-size-sm);
  line-height: 1.8;
  font-family: var(--font-mono);
  white-space: pre-wrap;
}
.conn-result.ok { background: var(--success-bg); border: 1px solid var(--success-border); color: var(--success); }
.conn-result.err { background: var(--error-bg); border: 1px solid var(--error-border); color: var(--error); }
.conn-result.loading { background: var(--primary-bg); border: 1px solid var(--primary-border); color: var(--primary); }
.os-tabs { display: flex; gap: 0; margin-bottom: 0; border-bottom: 1px solid var(--border-secondary); }
.os-tab { padding: 6px 16px; font-size: var(--font-size-sm); border: none; background: none; color: var(--text-tertiary); cursor: pointer; font-family: inherit; border-bottom: 2px solid transparent; transition: all 0.15s; margin-bottom: -1px; }
.os-tab:hover { color: var(--text); }
.os-tab.active { color: var(--primary); border-bottom-color: var(--primary); font-weight: 500; }
</style>
