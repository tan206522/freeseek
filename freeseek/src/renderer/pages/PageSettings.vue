<script setup lang="ts">
import { ref, onMounted } from "vue";
import { useAppStore } from "../stores/app";
import { bridge } from "../bridge";
const store = useAppStore();

const proxyUrl = ref("");
const proxySaved = ref(false);
const apiKey = ref("");
const apiKeySaved = ref(false);
const showKey = ref(false);
const listenHost = ref("127.0.0.1");
const settingsSaved = ref(false);

// 限速配置
const rateLimitDeepseek = ref(0);
const rateLimitClaude = ref(0);
const rateLimitQwen = ref(0);
const rateLimitSaved = ref(false);

// 自动刷新配置
const autoRefreshEnabled = ref(true);
const autoRefreshLeadTime = ref(10);
const autoRefreshInterval = ref(60);
const autoRefreshSaved = ref(false);

onMounted(async () => {
  try {
    const cfg = await bridge.getProxy();
    proxyUrl.value = cfg?.proxy || "";
  } catch { /* ignore */ }
  try {
    const s = await bridge.getSettings();
    apiKey.value = s?.apiKey || "";
    listenHost.value = s?.host || "127.0.0.1";
    rateLimitDeepseek.value = s?.rateLimits?.deepseek || 0;
    rateLimitClaude.value = s?.rateLimits?.claude || 0;
    rateLimitQwen.value = s?.rateLimits?.qwen || 0;
    autoRefreshEnabled.value = s?.autoRefresh?.enabled ?? true;
    autoRefreshLeadTime.value = s?.autoRefresh?.leadTimeMinutes ?? 10;
    autoRefreshInterval.value = s?.autoRefresh?.checkIntervalSeconds ?? 60;
  } catch { /* ignore */ }
});

async function saveProxy() {
  const r = await bridge.saveProxy(proxyUrl.value);
  if (r.ok) {
    store.showToast("代理配置已保存", "ok");
    proxySaved.value = true;
    setTimeout(() => { proxySaved.value = false; }, 2000);
  } else {
    store.showToast("保存失败: " + r.error, "err");
  }
}

async function saveApiSettings() {
  const r = await bridge.saveSettings({ apiKey: apiKey.value, host: listenHost.value });
  if (r.ok) {
    store.showToast(r.needRestart ? "设置已保存，重启服务后生效" : "设置已保存", "ok");
    settingsSaved.value = true;
    setTimeout(() => { settingsSaved.value = false; }, 2000);
  } else {
    store.showToast("保存失败: " + r.error, "err");
  }
}

async function saveRateLimits() {
  const rateLimits: Record<string, number> = {};
  if (rateLimitDeepseek.value > 0) rateLimits.deepseek = rateLimitDeepseek.value;
  if (rateLimitClaude.value > 0) rateLimits.claude = rateLimitClaude.value;
  if (rateLimitQwen.value > 0) rateLimits.qwen = rateLimitQwen.value;
  const r = await bridge.saveSettings({ rateLimits });
  if (r.ok) {
    store.showToast("限速配置已保存并立即生效", "ok");
    rateLimitSaved.value = true;
    setTimeout(() => { rateLimitSaved.value = false; }, 2000);
  } else {
    store.showToast("保存失败: " + r.error, "err");
  }
}

async function saveAutoRefresh() {
  const r = await bridge.saveSettings({
    autoRefresh: {
      enabled: autoRefreshEnabled.value,
      leadTimeMinutes: autoRefreshLeadTime.value,
      checkIntervalSeconds: autoRefreshInterval.value,
    },
  });
  if (r.ok) {
    store.showToast("自动刷新配置已保存并立即生效", "ok");
    autoRefreshSaved.value = true;
    setTimeout(() => { autoRefreshSaved.value = false; }, 2000);
  } else {
    store.showToast("保存失败: " + r.error, "err");
  }
}
</script>

<template>
  <div>
    <div class="ant-card">
      <div class="ant-card-head"><div class="ant-card-title">服务配置</div></div>
      <div class="ant-card-body">
        <div class="ant-form-item">
          <label class="ant-form-label">监听端口</label>
          <input class="ant-input" type="text" v-model.number="store.serverPort" style="width:140px" />
        </div>
        <div class="ant-form-item">
          <label class="ant-form-label">监听地址</label>
          <select class="ant-select" v-model="listenHost" style="width:260px">
            <option value="127.0.0.1">127.0.0.1（仅本机访问）</option>
            <option value="0.0.0.0">0.0.0.0（允许局域网 / 外网访问）</option>
          </select>
        </div>
        <div class="ant-form-item">
          <label class="ant-form-label">API Key</label>
          <div style="display:flex;gap:8px;align-items:center">
            <input class="ant-input" v-model="apiKey" :type="showKey ? 'text' : 'password'" placeholder="留空则不鉴权，任何人可调用" style="flex:1" />
            <button class="ant-btn" @click="showKey = !showKey" style="min-width:56px">{{ showKey ? '隐藏' : '显示' }}</button>
          </div>
          <p style="margin-top:6px;color:var(--text-quaternary);font-size:var(--font-size-sm)">
            设置后调用 API 需携带 <span class="ant-code">Authorization: Bearer &lt;key&gt;</span> 请求头。
            <span v-if="listenHost === '0.0.0.0' && !apiKey" style="color:var(--warning)">监听 0.0.0.0 时强烈建议设置 API Key。</span>
          </p>
        </div>
        <div style="margin-top:8px">
          <button class="ant-btn ant-btn-primary" @click="saveApiSettings">{{ settingsSaved ? '✓ 已保存' : '保存设置' }}</button>
        </div>
      </div>
    </div>

    <div class="ant-card">
      <div class="ant-card-head"><div class="ant-card-title">请求限速</div></div>
      <div class="ant-card-body">
        <p style="margin-bottom:12px;color:var(--text-secondary)">
          为每个厂商设置每分钟最大请求数，避免短时间大量请求触发反爬。设为 0 表示不限制。
        </p>
        <div class="ant-form-item">
          <label class="ant-form-label">DeepSeek（次/分钟）</label>
          <input class="ant-input" type="number" v-model.number="rateLimitDeepseek" min="0" style="width:120px" />
        </div>
        <div class="ant-form-item">
          <label class="ant-form-label">Claude（次/分钟）</label>
          <input class="ant-input" type="number" v-model.number="rateLimitClaude" min="0" style="width:120px" />
        </div>
        <div class="ant-form-item">
          <label class="ant-form-label">通义千问（次/分钟）</label>
          <input class="ant-input" type="number" v-model.number="rateLimitQwen" min="0" style="width:120px" />
        </div>
        <p style="margin-top:4px;color:var(--text-quaternary);font-size:var(--font-size-sm)">
          超限时请求会排队等待，不会被拒绝。
        </p>
        <div style="margin-top:8px">
          <button class="ant-btn ant-btn-primary" @click="saveRateLimits">{{ rateLimitSaved ? '✓ 已保存' : '保存限速配置' }}</button>
        </div>
      </div>
    </div>

    <div class="ant-card">
      <div class="ant-card-head"><div class="ant-card-title">凭证自动刷新</div></div>
      <div class="ant-card-body">
        <p style="margin-bottom:12px;color:var(--text-secondary)">
          自动检测 JWT Token 过期状态，快过期时触发凭证自动刷新。需要本机有浏览器支持自动捕获。
        </p>
        <div class="ant-form-item">
          <label class="ant-form-label">
            <input type="checkbox" v-model="autoRefreshEnabled" style="margin-right:6px" />
            启用自动刷新
          </label>
        </div>
        <div class="ant-form-item" v-if="autoRefreshEnabled">
          <label class="ant-form-label">提前刷新时间（分钟）</label>
          <input class="ant-input" type="number" v-model.number="autoRefreshLeadTime" min="1" max="60" style="width:120px" />
          <span style="margin-left:8px;color:var(--text-quaternary);font-size:var(--font-size-sm)">Token 剩余不足此时间时触发刷新</span>
        </div>
        <div class="ant-form-item" v-if="autoRefreshEnabled">
          <label class="ant-form-label">检查间隔（秒）</label>
          <input class="ant-input" type="number" v-model.number="autoRefreshInterval" min="10" max="600" style="width:120px" />
        </div>
        <div style="margin-top:8px">
          <button class="ant-btn ant-btn-primary" @click="saveAutoRefresh">{{ autoRefreshSaved ? '✓ 已保存' : '保存自动刷新配置' }}</button>
        </div>
      </div>
    </div>

    <div class="ant-card">
      <div class="ant-card-head"><div class="ant-card-title">代理配置</div></div>
      <div class="ant-card-body">
        <p style="margin-bottom:12px;color:var(--text-secondary)">
          Playwright 启动的浏览器不会继承系统代理。如果需要通过代理访问 claude.ai 或 deepseek.com，请在此配置。
          也可通过环境变量 <span class="ant-code">HTTPS_PROXY</span> 设置。
        </p>
        <div class="ant-form-item">
          <label class="ant-form-label">代理地址</label>
          <div style="display:flex;gap:8px;align-items:center">
            <input class="ant-input" v-model="proxyUrl" placeholder="http://127.0.0.1:7890 或 socks5://127.0.0.1:1080" style="flex:1" />
            <button class="ant-btn ant-btn-primary" @click="saveProxy">{{ proxySaved ? '✓ 已保存' : '保存' }}</button>
          </div>
        </div>
        <p style="color:var(--text-quaternary);font-size:var(--font-size-sm)">
          留空则不使用代理。支持 http、https、socks5 协议。保存后下次捕获凭证时生效。
        </p>
      </div>
    </div>

    <div class="ant-card">
      <div class="ant-card-head"><div class="ant-card-title">快捷键</div></div>
      <div class="ant-card-body" style="padding:0">
        <table class="ant-table">
          <tr><th>快捷键</th><th>功能</th></tr>
          <tr><td><span class="ant-code">Ctrl+1</span> ~ <span class="ant-code">Ctrl+8</span></td><td>切换页面</td></tr>
          <tr><td><span class="ant-code">Ctrl+Enter</span></td><td>API 调试页发送请求</td></tr>
          <tr><td><span class="ant-code">Escape</span></td><td>中止 API 调试请求</td></tr>
          <tr><td><span class="ant-code">Enter</span></td><td>聊天测试发送消息</td></tr>
        </table>
      </div>
    </div>

    <div class="ant-card">
      <div class="ant-card-head"><div class="ant-card-title">关于</div></div>
      <div class="ant-card-body">
        <p>FreeSeek 是一个 DeepSeek / Claude / 通义千问网页版反向代理工具，在本地提供兼容 OpenAI API 格式的 HTTP 服务。支持多厂商模型路由、多账号轮询负载均衡、凭证自动刷新、请求限速，仅供个人学习研究使用。</p>
      </div>
    </div>
  </div>
</template>
