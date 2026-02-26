<script setup lang="ts">
import { ref } from "vue";
import { useAppStore } from "../stores/app";
const store = useAppStore();

const curlTab1 = ref<"linux" | "win">("linux");
const curlTab2 = ref<"linux" | "win">("linux");

function copyText(t: string) {
  navigator.clipboard?.writeText(t);
  store.showToast("已复制", "ok");
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
    <div class="ant-card">
      <div class="ant-card-head"><div class="ant-card-title">OpenAI 兼容端点</div></div>
      <div class="ant-card-body" style="padding:0">
        <table class="ant-table">
          <tr><th>方法</th><th>路径</th><th>说明</th></tr>
          <tr><td><span class="ant-tag ant-tag-success">GET</span></td><td><span class="ant-code">/v1/models</span></td><td>获取可用模型列表</td></tr>
          <tr><td><span class="ant-tag ant-tag-warning">POST</span></td><td><span class="ant-code">/v1/chat/completions</span></td><td>聊天补全（流式/非流式）</td></tr>
          <tr><td><span class="ant-tag ant-tag-success">GET</span></td><td><span class="ant-code">/health</span></td><td>健康检查 & 凭证状态</td></tr>
        </table>
      </div>
    </div>

    <!-- 请求示例 -->
    <div class="ant-card">
      <div class="ant-card-head"><div class="ant-card-title">请求示例 — 流式</div></div>
      <div class="ant-card-body">
        <div class="os-tabs">
          <button :class="['os-tab', { active: curlTab1 === 'linux' }]" @click="curlTab1 = 'linux'">Linux / macOS</button>
          <button :class="['os-tab', { active: curlTab1 === 'win' }]" @click="curlTab1 = 'win'">Windows CMD</button>
        </div>
        <div class="ant-code-block" v-if="curlTab1 === 'linux'"><button class="copy-btn" @click="copyCode">复制</button>curl -N http://127.0.0.1:{{ store.serverPort }}/v1/chat/completions \
  -H "Content-Type: application/json" \
  -d '{
    "model": "deepseek-chat",
    "messages": [
      {"role": "system", "content": "你是一个有帮助的助手"},
      {"role": "user", "content": "用 Python 写一个快速排序"}
    ],
    "stream": true
  }'</div>
        <div class="ant-code-block" v-else><button class="copy-btn" @click="copyCode">复制</button>curl -N http://127.0.0.1:{{ store.serverPort }}/v1/chat/completions -H "Content-Type: application/json" -d "{\"model\":\"deepseek-chat\",\"messages\":[{\"role\":\"system\",\"content\":\"你是一个有帮助的助手\"},{\"role\":\"user\",\"content\":\"用Python写一个快速排序\"}],\"stream\":true}"</div>
      </div>
    </div>

    <!-- 业务集成参数 -->
    <div class="ant-card">
      <div class="ant-card-head"><div class="ant-card-title">业务集成参数</div></div>
      <div class="ant-card-body">
        <p style="margin-bottom:16px">以下参数可通过请求体或 HTTP Header 传递，用于控制输出清洗，适合业务场景集成。</p>
        <table class="ant-table">
          <tr><th>参数</th><th>Header</th><th>说明</th></tr>
          <tr><td><span class="ant-code">strip_reasoning</span></td><td><span class="ant-code">x-strip-reasoning: true</span></td><td>剥离思考链，仅返回最终回复内容</td></tr>
          <tr><td><span class="ant-code">clean_mode</span></td><td><span class="ant-code">x-clean-mode: true</span></td><td>激进清洗模式，去除所有非正文内容</td></tr>
        </table>
        <div class="os-tabs" style="margin-top:16px">
          <button :class="['os-tab', { active: curlTab2 === 'linux' }]" @click="curlTab2 = 'linux'">Linux / macOS</button>
          <button :class="['os-tab', { active: curlTab2 === 'win' }]" @click="curlTab2 = 'win'">Windows CMD</button>
        </div>
        <div class="ant-code-block" v-if="curlTab2 === 'linux'"><button class="copy-btn" @click="copyCode">复制</button># 业务场景：仅获取纯净回复，不含思考链
curl -N http://127.0.0.1:{{ store.serverPort }}/v1/chat/completions \
  -H "Content-Type: application/json" \
  -H "x-strip-reasoning: true" \
  -d '{
    "model": "deepseek-reasoner",
    "messages": [{"role": "user", "content": "1+1=?"}],
    "stream": true
  }'</div>
        <div class="ant-code-block" v-else><button class="copy-btn" @click="copyCode">复制</button>rem 业务场景：仅获取纯净回复，不含思考链
curl -N http://127.0.0.1:{{ store.serverPort }}/v1/chat/completions -H "Content-Type: application/json" -H "x-strip-reasoning: true" -d "{\"model\":\"deepseek-reasoner\",\"messages\":[{\"role\":\"user\",\"content\":\"1+1=?\"}],\"stream\":true}"</div>
      </div>
    </div>

    <!-- 本地 AI 应用接入 -->
    <div class="ant-card">
      <div class="ant-card-head"><div class="ant-card-title">Claude 模型说明</div></div>
      <div class="ant-card-body">
        <p style="margin-bottom:16px">Claude 模型通过相同的 <span class="ant-code">/v1/chat/completions</span> 端点访问，只需将 model 参数设为 Claude 模型 ID。需要先在「登录 & 凭证」页面配置 Claude 凭证。</p>
        <table class="ant-table">
          <tr><th>模型 ID</th><th>说明</th></tr>
          <tr><td><span class="ant-code">claude-sonnet-4-6</span></td><td>Claude Sonnet 4（推荐，性价比最高）</td></tr>
          <tr><td><span class="ant-code">claude-opus-4-6</span></td><td>Claude Opus 4（最强能力）</td></tr>
          <tr><td><span class="ant-code">claude-haiku-4-6</span></td><td>Claude Haiku 4（最快速度）</td></tr>
          <tr><td><span class="ant-code">claude-3-5-sonnet</span></td><td>别名，自动映射到 claude-sonnet-4-6</td></tr>
          <tr><td><span class="ant-code">claude-3-opus</span></td><td>别名，自动映射到 claude-opus-4-6</td></tr>
        </table>
      </div>
    </div>

    <!-- 本地 AI 应用接入 -->
    <div class="ant-card">
      <div class="ant-card-head"><div class="ant-card-title">本地 AI 应用接入</div></div>
      <div class="ant-card-body" style="padding:0">
        <table class="ant-table">
          <tr><th>应用</th><th>配置</th><th></th></tr>
          <tr v-for="app in [
            { name: 'Cursor', desc: 'Settings → Models → OpenAI API Base', url: 'http://127.0.0.1:' + store.serverPort + '/v1' },
            { name: 'Continue', desc: 'config.json → apiBase', url: 'http://127.0.0.1:' + store.serverPort + '/v1' },
            { name: 'Open WebUI', desc: '设置 → API Base URL', url: 'http://127.0.0.1:' + store.serverPort + '/v1' },
            { name: 'ChatBox', desc: '设置 → API 域名', url: 'http://127.0.0.1:' + store.serverPort },
            { name: 'OpenAI SDK', desc: 'baseURL, apiKey 随便填', url: 'http://127.0.0.1:' + store.serverPort + '/v1' },
          ]" :key="app.name">
            <td>{{ app.name }}</td>
            <td>{{ app.desc }}: <span class="ant-code">{{ app.url }}</span></td>
            <td><button class="ant-btn ant-btn-sm ant-btn-link" @click="copyText(app.url)">复制</button></td>
          </tr>
        </table>
      </div>
    </div>
  </div>
</template>

<style scoped>
.os-tabs {
  display: flex;
  gap: 0;
  margin-bottom: 0;
  border-bottom: 1px solid var(--border-secondary);
}
.os-tab {
  padding: 6px 16px;
  font-size: var(--font-size-sm);
  border: none;
  background: none;
  color: var(--text-tertiary);
  cursor: pointer;
  font-family: inherit;
  border-bottom: 2px solid transparent;
  transition: all 0.15s;
  margin-bottom: -1px;
}
.os-tab:hover { color: var(--text); }
.os-tab.active {
  color: var(--primary);
  border-bottom-color: var(--primary);
  font-weight: 500;
}
</style>
