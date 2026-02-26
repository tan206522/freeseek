<script setup lang="ts">
import { ref } from "vue";
import { useAppStore } from "../stores/app";
import { bridge } from "../bridge";
const store = useAppStore();

// DeepSeek
const authStatus = ref("");
const authStatusType = ref<"info" | "success" | "error">("info");
const authBusy = ref(false);
const showManual = ref(false);
const manualCookie = ref("");
const manualBearer = ref("");
const manualUA = ref("");

// Claude
const claudeStatus = ref("");
const claudeStatusType = ref<"info" | "success" | "error">("info");
const claudeBusy = ref(false);
const showClaudeManual = ref(false);
const claudeSessionKey = ref("");
const claudeCookie = ref("");
const claudeUA = ref("");

async function startAutoAuth() {
  authBusy.value = true;
  authStatus.value = "正在启动浏览器...";
  authStatusType.value = "info";
  const cleanup = bridge.onAuthStatus((msg) => {
    authStatus.value = msg;
    authStatusType.value = msg.startsWith("✅") ? "success" : msg.startsWith("❌") ? "error" : "info";
  });
  const r = await bridge.startAuth();
  if (r.ok) {
    authStatus.value = "✅ 凭证捕获成功";
    authStatusType.value = "success";
    store.showToast("DeepSeek 凭证捕获成功", "ok");
  } else {
    authStatus.value = "❌ " + r.error;
    authStatusType.value = "error";
    store.showToast("捕获失败", "err");
  }
  authBusy.value = false;
  cleanup();
  store.refreshStatus();
}

async function saveManualAuth() {
  if (!manualCookie.value.trim() || !manualBearer.value.trim()) {
    store.showToast("请填写 Cookie 和 Bearer", "err");
    return;
  }
  const r = await bridge.saveManualCredentials({
    cookie: manualCookie.value.trim(),
    bearer: manualBearer.value.trim(),
    userAgent: manualUA.value.trim(),
  });
  r.ok ? store.showToast("凭证已保存", "ok") : store.showToast("保存失败", "err");
  store.refreshStatus();
}

async function clearCreds() {
  if (!confirm("确定清除 DeepSeek 凭证？")) return;
  await bridge.clearCredentials();
  store.showToast("已清除", "info");
  store.refreshStatus();
}

async function startClaudeAuth() {
  claudeBusy.value = true;
  claudeStatus.value = "正在启动浏览器...";
  claudeStatusType.value = "info";
  const cleanup = bridge.onClaudeStatus((msg) => {
    claudeStatus.value = msg;
    claudeStatusType.value = msg.startsWith("✅") ? "success" : msg.startsWith("❌") ? "error" : "info";
  });
  const r = await bridge.startClaudeAuth();
  if (r.ok) {
    claudeStatus.value = "✅ Claude 凭证捕获成功";
    claudeStatusType.value = "success";
    store.showToast("Claude 凭证捕获成功", "ok");
  } else {
    claudeStatus.value = "❌ " + r.error;
    claudeStatusType.value = "error";
    store.showToast("Claude 捕获失败", "err");
  }
  claudeBusy.value = false;
  cleanup();
  store.refreshStatus();
}

async function saveClaudeManual() {
  if (!claudeSessionKey.value.trim()) {
    store.showToast("请填写 sessionKey", "err");
    return;
  }
  const r = await bridge.saveClaudeManualCredentials({
    sessionKey: claudeSessionKey.value.trim(),
    cookie: claudeCookie.value.trim() || undefined,
    userAgent: claudeUA.value.trim() || undefined,
  });
  r.ok ? store.showToast("Claude 凭证已保存", "ok") : store.showToast("保存失败", "err");
  store.refreshStatus();
}

async function clearClaudeCreds() {
  if (!confirm("确定清除 Claude 凭证？")) return;
  await bridge.clearClaudeCredentials();
  store.showToast("已清除", "info");
  store.refreshStatus();
}
</script>

<template>
  <div>
    <!-- DeepSeek 凭证 -->
    <div class="ant-card">
      <div class="ant-card-head">
        <div class="ant-card-title">
          <span class="ant-badge-dot" :class="store.hasCredentials ? 'success' : 'error'" />
          DeepSeek 凭证
        </div>
      </div>
      <div class="ant-card-body">
        <p style="margin-bottom:16px">通过浏览器自动化捕获 DeepSeek 网页版登录凭证。点击按钮会打开 Chrome，请在浏览器中完成登录。</p>
        <div class="btn-group" style="margin-top:0">
          <button class="ant-btn ant-btn-primary" :disabled="authBusy" @click="startAutoAuth">
            {{ authBusy ? '捕获中...' : '启动自动捕获' }}
          </button>
          <button class="ant-btn" @click="showManual = !showManual">手动粘贴凭证</button>
          <button class="ant-btn ant-btn-danger" v-if="store.hasCredentials" @click="clearCreds">清除</button>
        </div>
        <div v-if="authStatus" :class="['auth-alert', authStatusType]" style="margin-top:16px">
          <span class="ant-badge-dot" :class="authStatusType === 'success' ? 'success' : authStatusType === 'error' ? 'error' : 'processing'" />
          {{ authStatus }}
        </div>

        <!-- DeepSeek 手动凭证 -->
        <div v-if="showManual" class="manual-section">
          <p style="margin-bottom:12px;color:var(--text-tertiary);font-size:var(--font-size-sm)">
            打开 <span class="ant-code">chat.deepseek.com</span>，按 F12 打开开发者工具，在 Network 面板中找到任意请求，复制 Cookie 和 Authorization 头。
          </p>
          <div class="ant-form-item">
            <label class="ant-form-label">Cookie</label>
            <textarea class="ant-textarea" v-model="manualCookie" rows="2" placeholder="粘贴完整 Cookie 字符串"></textarea>
          </div>
          <div class="ant-form-item">
            <label class="ant-form-label">Bearer Token</label>
            <textarea class="ant-textarea" v-model="manualBearer" rows="2" placeholder="粘贴 Authorization 头中 Bearer 后面的内容"></textarea>
          </div>
          <div class="ant-form-item">
            <label class="ant-form-label">User-Agent（可选）</label>
            <input class="ant-input" v-model="manualUA" placeholder="留空使用默认值" />
          </div>
          <button class="ant-btn ant-btn-primary" @click="saveManualAuth">保存凭证</button>
        </div>
      </div>
    </div>

    <!-- Claude 凭证 -->
    <div class="ant-card">
      <div class="ant-card-head">
        <div class="ant-card-title">
          <span class="ant-badge-dot" :class="store.hasClaudeCredentials ? 'success' : 'error'" />
          Claude 凭证
        </div>
      </div>
      <div class="ant-card-body">
        <p style="margin-bottom:16px">通过浏览器自动化捕获 Claude 网页版登录凭证。需要代理访问 claude.ai，请先在设置页配置代理。</p>
        <div class="btn-group" style="margin-top:0">
          <button class="ant-btn ant-btn-primary" :disabled="claudeBusy" @click="startClaudeAuth">
            {{ claudeBusy ? '捕获中...' : '启动自动捕获' }}
          </button>
          <button class="ant-btn" @click="showClaudeManual = !showClaudeManual">手动粘贴凭证</button>
          <button class="ant-btn ant-btn-danger" v-if="store.hasClaudeCredentials" @click="clearClaudeCreds">清除</button>
        </div>
        <div v-if="claudeStatus" :class="['auth-alert', claudeStatusType]" style="margin-top:16px">
          <span class="ant-badge-dot" :class="claudeStatusType === 'success' ? 'success' : claudeStatusType === 'error' ? 'error' : 'processing'" />
          {{ claudeStatus }}
        </div>

        <!-- Claude 手动凭证 -->
        <div v-if="showClaudeManual" class="manual-section">
          <p style="margin-bottom:12px;color:var(--text-tertiary);font-size:var(--font-size-sm)">
            打开 <span class="ant-code">claude.ai</span>，按 F12 打开开发者工具，在 Application → Cookies 中找到 <span class="ant-code">sessionKey</span>。
          </p>
          <div class="ant-form-item">
            <label class="ant-form-label">sessionKey <span style="color:var(--error)">*</span></label>
            <textarea class="ant-textarea" v-model="claudeSessionKey" rows="2" placeholder="粘贴 sessionKey 值（sk-ant-...）"></textarea>
          </div>
          <div class="ant-form-item">
            <label class="ant-form-label">Cookie（可选）</label>
            <textarea class="ant-textarea" v-model="claudeCookie" rows="2" placeholder="留空则自动使用 sessionKey 构造"></textarea>
          </div>
          <div class="ant-form-item">
            <label class="ant-form-label">User-Agent（可选）</label>
            <input class="ant-input" v-model="claudeUA" placeholder="留空使用默认值" />
          </div>
          <button class="ant-btn ant-btn-primary" @click="saveClaudeManual">保存凭证</button>
        </div>
      </div>
    </div>

    <!-- 凭证状态总览 -->
    <div class="ant-card">
      <div class="ant-card-head"><div class="ant-card-title">凭证状态</div></div>
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
            <td>捕获时间</td>
            <td>—</td>
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
            <td>捕获时间</td>
            <td>—</td>
            <td style="color:var(--text-tertiary)">{{ store.claudeCapturedAt ? new Date(store.claudeCapturedAt).toLocaleString('zh-CN') : '—' }}</td>
          </tr>
        </table>
      </div>
    </div>
  </div>
</template>

<style scoped>
.auth-alert {
  padding: 10px 16px;
  border-radius: var(--radius);
  font-size: var(--font-size);
  display: flex;
  align-items: center;
}
.auth-alert.info { background: var(--primary-bg); border: 1px solid var(--primary-border); color: var(--primary); }
.auth-alert.success { background: var(--success-bg); border: 1px solid var(--success-border); color: var(--success); }
.auth-alert.error { background: var(--error-bg); border: 1px solid var(--error-border); color: var(--error); }

.manual-section {
  margin-top: 20px;
  padding-top: 20px;
  border-top: 1px solid var(--border-secondary);
}
</style>
